import { GoogleGenAI } from "@google/genai";
import { settingsService } from "./settings-service";
import { PLATFORM_VALUES, normalizePlatformList } from "../../shared/platforms";
import { z } from "zod";

export interface ResearchDataComponentCandidate {
  id: string;
  name: string;
  dataSourceName?: string;
  mutableElements?: string[];
}

export interface ResearchLogSource {
  name: string;
  channel?: string | string[];
  notes?: string;
  sourceUrl?: string;
}

export interface ResearchResultEntry {
  dcId: string;
  dcName: string;
  logSources: ResearchLogSource[];
}

export interface ResearchEnrichmentInput {
  vendor?: string;
  product?: string;
  description?: string;
  aliases?: string[];
  platforms: string[];
  dataComponents: ResearchDataComponentCandidate[];
}

export interface ResearchEnrichmentResult {
  model: string;
  results: ResearchResultEntry[];
  platformSuggestions?: ResearchPlatformSuggestion[];
  sources: Array<{ title?: string; url: string }>;
  note?: string;
}

export interface ResearchPlatformSuggestion {
  platform: string;
  reason?: string;
  evidence?: string;
  sourceUrl?: string;
}

export interface PlatformCheckInput {
  vendor?: string;
  product?: string;
  description?: string;
  platforms: string[];
}

export interface PlatformValidationResult {
  platform: string;
  isSupported: boolean;
  reasoning?: string;
  evidence?: string;
  sourceUrl?: string;
}

export interface PlatformAlternativeResult {
  platform: string;
  reason?: string;
  evidence?: string;
  sourceUrl?: string;
}

export interface PlatformCheckResult {
  model: string;
  validation: PlatformValidationResult[];
  alternativePlatformsFound: PlatformAlternativeResult[];
  sources: Array<{ title?: string; url: string }>;
  note?: string;
}

const DEFAULT_MODEL = "gemini-1.5-flash";

const ALLOWED_PLATFORMS = PLATFORM_VALUES;

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.search = "";
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return trimmed.replace(/#.*$/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  }
};

const sanitizeInput = (input: string): string => {
  if (!input) return "Unknown";
  // Remove potential prompt injection delimiters or control characters
  return input.replace(/"""/g, '"').replace(/`/g, "'").trim();
};

// Zod Schemas for Validation
const LogSourceSchema = z.object({
  name: z.string(),
  channel: z.union([z.string(), z.array(z.string())]).optional(),
  notes: z.string().optional(),
  source_url: z.string().optional(),
});

const ResultEntrySchema = z.object({
  dc_id: z.string(),
  dc_name: z.string().optional(),
  log_sources: z.array(LogSourceSchema).optional().default([]),
});

const PlatformSuggestionSchema = z.object({
  platform: z.string(),
  reason: z.string().optional(),
  evidence: z.string().optional(),
  source_url: z.string().optional(),
});

const EnrichmentResponseSchema = z.object({
  results: z.array(ResultEntrySchema).optional().default([]),
  platform_suggestions: z.array(PlatformSuggestionSchema).optional().default([]),
  note: z.string().optional(),
});

const PlatformValidationSchema = z.object({
  platform: z.string(),
  is_supported: z.boolean().or(z.string().transform(v => v === 'true')).optional().default(false),
  reasoning: z.string().optional(),
  evidence: z.string().optional(),
  source_url: z.string().optional(),
});

const PlatformAlternativeSchema = z.object({
  platform: z.string(),
  reason: z.string().optional(),
  evidence: z.string().optional(),
  source_url: z.string().optional(),
});

const PlatformCheckResponseSchema = z.object({
  validation: z.array(PlatformValidationSchema).optional().default([]),
  alternative_platforms_found: z.array(PlatformAlternativeSchema).optional().default([]),
  note: z.string().optional(),
});

const readResponseText = async (response: any): Promise<string> => {
  if (!response) return "";
  if (typeof response.text === "function") {
    const value = response.text();
    return typeof value === "string" ? value : await value;
  }
  if (typeof response.text === "string") {
    return response.text;
  }
  if (response.response) {
    return readResponseText(response.response);
  }
  return "";
};

const getResponseRoot = (response: any): any => response?.response ?? response;

const extractJsonPayload = (text: string): { results?: ResearchResultEntry[]; note?: string } => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const jsonString = text.slice(start, end + 1).trim();
    try {
      const raw = JSON.parse(jsonString);
      return EnrichmentResponseSchema.parse(raw) as any;
    } catch (error) {
      console.warn("Research JSON parse/validation failed.", error);
    }
  }

  return { results: [] };
};

const extractPlatformCheckPayload = (text: string) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const jsonString = text.slice(start, end + 1).trim();
    try {
      const raw = JSON.parse(jsonString);
      return PlatformCheckResponseSchema.parse(raw);
    } catch (error) {
      console.warn("Platform check JSON parse/validation failed.", error);
    }
  }
  return { validation: [], alternative_platforms_found: [] };
};

export class GeminiResearchService {
  private client: GoogleGenAI | null = null;
  private clientKey: string | null = null;
  private modelName: string | null = null;

  private async getClient() {
    const apiKey = await settingsService.getGeminiKey();
    if (!apiKey) return null;
    const modelName = (await settingsService.getGeminiModel()).trim() || DEFAULT_MODEL;
    if (this.client && this.clientKey === apiKey && this.modelName === modelName) {
      return { client: this.client, modelName };
    }

    this.client = new GoogleGenAI({ apiKey });
    this.clientKey = apiKey;
    this.modelName = modelName;
    return { client: this.client, modelName };
  }

  private buildPrompt(input: ResearchEnrichmentInput): string {
    const vendor = sanitizeInput(input.vendor || "Unknown");
    const product = sanitizeInput(input.product || "Unknown");
    const aliasList = Array.isArray(input.aliases)
      ? Array.from(new Set(input.aliases.map((alias) => sanitizeInput(alias)).filter(Boolean)))
      : [];
    const candidateLines = input.dataComponents.map((candidate) => (
      `- ${candidate.id} | ${candidate.name}`
    ));

    return `
You are a detection engineer researching vendor documentation to identify product-native log sources (and their exact technical channels) that can reliably cover specific Data Components.

Target product
Product: """${vendor} ${product}"""
Aliases: """${aliasList.length > 0 ? aliasList.join(", ") : "None provided"}"""

Goal
For each Data Component listed under "Data Components", determine:
- whether the product has a native logging capability that can cover the Data Component
- if it does, the log source name and its exact channel identifier(s)

If either point cannot be reliably established from documentation, return an empty list for that Data Component.

Authoritative sourcing (source of truth)
Use web sources, prioritizing vendor-owned domains as the source of truth.
"Vendor-owned domain" means the registrable domain contains the vendor name immediately before the TLD (e.g., vendor.com, vendor.io, vendor.co.uk).
If the product name appears before the TLD but the vendor name does not, do not treat it as vendor-owned for source-of-truth purposes.
Third-party sources may be used to find leads, but final mappings must be supported by vendor-owned documentation whenever possible; if conflicting, follow vendor-owned documentation.
Each returned log source must include a URL that substantiates the name and channel.

Scope (native logging only)
Include only product-native logging streams and vendor-supported exports that are part of the product's own capabilities (e.g., built-in audit log, built-in syslog/CEF export, built-in API/audit feed).
Exclude SIEM-/collector-specific configuration objects and pipelines (e.g., Splunk UF stanzas, Sentinel connector setup steps, WEF subscription names).

Channel requirements
For channel, DO NOT use generic labels like "Authentication Logs".
ALWAYS prefer concrete technical identifiers, such as:
- Windows Event Log channel + Event IDs (e.g., "Security:4624")
- Linux syslog facility/priority and/or documented file path (e.g., "authpriv.*", "/var/log/auth.log")
- Cloud dataset/API identifiers (e.g., "SignInLogs")
- Vendor-defined stream/log type identifiers (category IDs, log type names, dataset names, etc.)
If multiple channels apply, return channel as an array of strings.
If no technical identifier exists in documentation, set channel to ["NULL"] and explain why in notes.

Reliability / uncertainty
Include everything that accurately and reliably covers the Data Component; do not include borderline/assumed mappings.
If unsure, return an empty log_sources list for that Data Component (do not guess).

Enablement note
In notes, include a brief enablement note only when documentation indicates the logging is not enabled by default (or requires explicit configuration to emit/export).
If enablement is not mentioned, do a brief targeted search; if it still cannot be reliably determined, do not mention enablement.

Output constraints
Output JSON only (no markdown, no commentary).
Return one results[] entry for EVERY Data Component provided.
Use the exact dc_id and dc_name provided (do not invent or rename).

JSON shape
{
  "results": [
    {
      "dc_id": "DC0001",
      "dc_name": "User Account Authentication",
      "log_sources": [
        {
          "name": "Example log source name",
          "channel": ["channel_one", "channel_two"],
          "notes": "Short mapping note. If not enabled by default: brief enablement note.",
          "source_url": "https://..."
        }
      ]
    }
  ],
  "note": "optional short notes"
}

Data Components:
${candidateLines.join("\n")}
`.trim();
  }

  private buildPlatformPrompt(input: PlatformCheckInput): string {
    const vendor = sanitizeInput(input.vendor || "Unknown");
    const product = sanitizeInput(input.product || "Unknown");
    const description = sanitizeInput(input.description || "No description provided.");
    const selectedPlatforms = input.platforms.length > 0 ? input.platforms.join(", ") : "None selected";
    const normalizedPlatforms = normalizePlatformList(input.platforms).map((platform) => platform.toLowerCase());
    const focusRules: string[] = [];
    if (normalizedPlatforms.some((platform) => ["windows", "linux", "macos", "android", "ios"].includes(platform))) {
      focusRules.push("Focus on host-based telemetry and local agent documentation. Exclude managed or PaaS offerings.");
    }
    if (normalizedPlatforms.some((platform) => [
      "saas",
      "iaas",
      "office 365",
      "office suite",
      "google workspace",
      "identity provider",
      "azure ad",
      "aws",
      "azure",
      "gcp",
    ].includes(platform))) {
      focusRules.push("Focus on API-based or control-plane telemetry. Exclude local OS event log research.");
    }
    if (normalizedPlatforms.some((platform) => ["network devices"].includes(platform))) {
      focusRules.push("Focus on network appliance logs and sensor telemetry. Exclude endpoint agents.");
    }
    if (normalizedPlatforms.includes("containers")) {
      focusRules.push("Focus on container runtime or Kubernetes telemetry. Exclude unrelated SaaS offerings.");
    }
    if (normalizedPlatforms.includes("esxi")) {
      focusRules.push("Focus on ESXi or vSphere telemetry. Exclude guest OS logs unless explicitly part of the product.");
    }
    const focusText = focusRules.length > 0 ? `\nFocus rules:\n- ${focusRules.join("\n- ")}` : "";

    return `
You are a detection engineer reviewing vendor documentation to identify the correct MITRE platform categories for a product.

Product: """${vendor} ${product}"""
Description: """${description}"""
User-selected focus: """${selectedPlatforms}"""

CRITICAL CONSTRAINT:
The user is specifically mapping this product for the [${selectedPlatforms}] platform(s).
Do NOT suggest additional platforms simply because they exist (for example, do not suggest SaaS/Azure SQL if the user is mapping on-prem Windows SQL).
Only suggest an additional platform if it is a TECHNICAL REQUIREMENT for the selected platform to function.
If you find cloud-native variants or unrelated deployments, ignore them for validation and list them under alternative_platforms_found instead.${focusText}

Use Google Search grounding to find authoritative sources.
Validate each selected platform with documentation evidence of telemetry or monitoring coverage.
If you cannot validate a selected platform, mark it as not supported.
If unsure, do not suggest that platform.
Use only this allowlist: ${ALLOWED_PLATFORMS.join(", ")}.
Return JSON only in this shape:
{
  "validation": [
    {
      "platform": "Windows",
      "is_supported": true,
      "reasoning": "Short justification based on docs",
      "evidence": "Snippet or paraphrase",
      "source_url": "https://..."
    }
  ],
  "alternative_platforms_found": [
    {
      "platform": "SaaS",
      "reason": "Cloud-native variant found, outside selected focus",
      "evidence": "Snippet or paraphrase",
      "source_url": "https://..."
    }
  ],
  "note": "optional short notes"
}
`.trim();
  }

  async enrichLogSources(input: ResearchEnrichmentInput): Promise<ResearchEnrichmentResult | null> {
    const clientInfo = await this.getClient();
    if (!clientInfo || !this.modelName) return null;
    const { client, modelName } = clientInfo;

    const baseName = [input.vendor, input.product].filter(Boolean).join(" ").trim();
    if (!baseName) {
      return {
        model: this.modelName,
        results: input.dataComponents.map((dc) => ({
          dcId: dc.id,
          dcName: dc.name,
          logSources: [],
        })),
        sources: [],
        note: "Vendor or product name is required for research.",
      };
    }

    const prompt = this.buildPrompt(input);
    const response = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      } as any,
    });
    const text = await readResponseText(response);
    const payload = extractJsonPayload(text) as any;

    const root = getResponseRoot(response);
    const candidate = root?.candidates?.[0];
    const grounding = candidate?.groundingMetadata || candidate?.grounding_metadata;
    const sourcesMap = new Map<string, { title?: string; url: string }>();

    const addSource = (url?: string, title?: string) => {
      if (!url) return;
      const normalized = normalizeUrl(url);
      if (!normalized) return;
      if (!sourcesMap.has(normalized)) {
        sourcesMap.set(normalized, { title, url: normalized });
      }
    };

    const chunks = grounding?.groundingChunks || grounding?.grounding_chunks || [];
    chunks.forEach((chunk: any) => addSource(chunk.web?.uri || chunk.web?.url, chunk.web?.title));

    const citations = candidate?.citationMetadata?.citationSources
      || candidate?.citation_metadata?.citation_sources
      || [];
    citations.forEach((citation: any) => addSource(citation.uri || citation.url));

    const allowedUrls = new Set(
      Array.from(sourcesMap.keys()).map((url) => url.toLowerCase())
    );
    const allowUnverifiedSources = allowedUrls.size === 0;

    const candidateIds = new Set(
      input.dataComponents.map((dc) => dc.id.toLowerCase())
    );
    const candidateNameToId = new Map(
      input.dataComponents.map((dc) => [dc.name.trim().toLowerCase(), dc.id])
    );
    const candidateIdToName = new Map(
      input.dataComponents.map((dc) => [dc.id.toLowerCase(), dc.name])
    );

    const payloadResults = Array.isArray(payload.results) ? payload.results : [];
    const mappedResults = new Map<string, ResearchResultEntry>();
    const normalizeChannelEntry = (value: unknown): string => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return "";
        return trimmed.toUpperCase() === "NULL" ? "NULL" : trimmed;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
      return "";
    };

    payloadResults.forEach((entry: any) => {
      const rawId = typeof entry?.dc_id === "string" ? entry.dc_id : entry?.dcId;
      const rawName = typeof entry?.dc_name === "string" ? entry.dc_name : entry?.dcName;
      let dcId = typeof rawId === "string" ? rawId.trim() : "";
      let dcName = typeof rawName === "string" ? rawName.trim() : "";
      const normalizedId = dcId.toLowerCase();
      const normalizedName = dcName.toLowerCase();
      if (!candidateIds.has(normalizedId)) {
        const mappedId = candidateNameToId.get(normalizedName);
        if (mappedId) {
          dcId = mappedId;
        }
      }
      const canonicalId = dcId.toLowerCase();
      if (!candidateIds.has(canonicalId)) return;
      if (!dcName) {
        dcName = candidateIdToName.get(canonicalId) || dcId;
      }
      const logSources = Array.isArray(entry?.log_sources) ? entry.log_sources : entry?.logSources;
      const sanitizedSources = Array.isArray(logSources)
        ? logSources
          .map((source: any) => {
            const name = typeof source?.name === "string" ? source.name.trim() : "";
            const channelRaw = source?.channel;
            let channel: string | string[] | undefined;
            if (Array.isArray(channelRaw)) {
              const cleaned = channelRaw
                .map((item) => normalizeChannelEntry(item))
                .filter((item) => item.length > 0);
              if (cleaned.length > 0) {
                channel = cleaned;
              }
            } else if (channelRaw !== undefined) {
              const normalized = normalizeChannelEntry(channelRaw);
              if (normalized.length > 0) {
                channel = normalized;
              }
            }
            const notes = typeof source?.notes === "string"
              ? source.notes.trim()
              : typeof source?.note === "string" ? source.note.trim() : undefined;
            const sourceUrl = typeof source?.source_url === "string"
              ? source.source_url
              : source?.sourceUrl;
            const normalizedUrl = sourceUrl ? normalizeUrl(sourceUrl).toLowerCase() : "";
            const isUrlAllowed = !normalizedUrl || allowUnverifiedSources || allowedUrls.has(normalizedUrl);
            if (!name) return null;
            const canonicalUrl = sourceUrl && isUrlAllowed
              ? sourcesMap.get(normalizeUrl(sourceUrl))?.url || normalizeUrl(sourceUrl)
              : undefined;
            return {
              name,
              channel,
              notes,
              sourceUrl: canonicalUrl,
            } as ResearchLogSource;
          })
          .filter((source): source is ResearchLogSource => Boolean(source))
        : [];

      mappedResults.set(String(dcId).toLowerCase(), {
        dcId: String(dcId),
        dcName: dcName || String(dcId),
        logSources: sanitizedSources,
      });
    });

    const results = input.dataComponents.map((dc) => {
      const matched = mappedResults.get(dc.id.toLowerCase());
      return matched || {
        dcId: dc.id,
        dcName: dc.name,
        logSources: [],
      };
    });

    const sources = Array.from(sourcesMap.values());
    const platformSuggestionsRaw = Array.isArray((payload as any).platform_suggestions)
      ? (payload as any).platform_suggestions
      : Array.isArray((payload as any).platformSuggestions)
        ? (payload as any).platformSuggestions
        : [];
    const allowedPlatformSet = new Set(ALLOWED_PLATFORMS.map((platform) => platform.toLowerCase()));
    const platformSuggestions = Array.isArray(platformSuggestionsRaw)
      ? platformSuggestionsRaw
        .map((entry: any) => {
          const platform = typeof entry?.platform === "string" ? entry.platform.trim() : "";
          if (!platform || !allowedPlatformSet.has(platform.toLowerCase())) return null;
          const sourceUrl = typeof entry?.source_url === "string"
            ? entry.source_url
            : typeof entry?.sourceUrl === "string" ? entry.sourceUrl : "";
          const normalizedUrl = sourceUrl ? normalizeUrl(sourceUrl).toLowerCase() : "";
          if (!normalizedUrl) return null;
          if (!allowedUrls.has(normalizedUrl)) return null;
          return {
            platform,
            reason: typeof entry?.reason === "string" ? entry.reason.trim() : undefined,
            evidence: typeof entry?.evidence === "string" ? entry.evidence.trim() : undefined,
            sourceUrl: normalizedUrl ? sourcesMap.get(normalizeUrl(sourceUrl))?.url || normalizeUrl(sourceUrl) : undefined,
          } as ResearchPlatformSuggestion;
        })
        .filter((entry): entry is ResearchPlatformSuggestion => Boolean(entry))
      : [];

    return {
      model: this.modelName,
      results,
      platformSuggestions,
      sources,
      note: payload.note || (sources.length === 0 ? "No grounded sources were returned for this query." : undefined),
    };
  }

  async suggestPlatforms(input: PlatformCheckInput): Promise<PlatformCheckResult | null> {
    const clientInfo = await this.getClient();
    if (!clientInfo || !this.modelName) return null;
    const { client, modelName } = clientInfo;

    const baseName = [input.vendor, input.product].filter(Boolean).join(" ").trim();
    if (!baseName) {
      return {
        model: this.modelName,
        validation: [],
        alternativePlatformsFound: [],
        sources: [],
        note: "Vendor or product name is required for platform research.",
      };
    }

    const prompt = this.buildPlatformPrompt(input);
    const response = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      } as any,
    });
    const text = await readResponseText(response);
    const payload = extractPlatformCheckPayload(text);

    const root = getResponseRoot(response);
    const candidate = root?.candidates?.[0];
    const grounding = candidate?.groundingMetadata || candidate?.grounding_metadata;
    const sourcesMap = new Map<string, { title?: string; url: string }>();

    const addSource = (url?: string, title?: string) => {
      if (!url) return;
      const normalized = normalizeUrl(url);
      if (!normalized) return;
      if (!sourcesMap.has(normalized)) {
        sourcesMap.set(normalized, { title, url: normalized });
      }
    };

    const chunks = grounding?.groundingChunks || grounding?.grounding_chunks || [];
    chunks.forEach((chunk: any) => addSource(chunk.web?.uri || chunk.web?.url, chunk.web?.title));

    const citations = candidate?.citationMetadata?.citationSources
      || candidate?.citation_metadata?.citation_sources
      || [];
    citations.forEach((citation: any) => addSource(citation.uri || citation.url));

    const allowedUrls = new Set(
      Array.from(sourcesMap.keys()).map((url) => url.toLowerCase())
    );

    const allowedPlatformSet = new Set(ALLOWED_PLATFORMS.map((platform) => platform.toLowerCase()));

    const validationRaw = payload.validation || [];
    const validation = Array.isArray(validationRaw)
      ? validationRaw
        .map((entry: any) => {
          const platform = typeof entry?.platform === "string" ? entry.platform.trim() : "";
          if (!platform || !allowedPlatformSet.has(platform.toLowerCase())) return null;
          const rawSupported = entry?.is_supported ?? entry?.isSupported;
          let isSupported: boolean | null = null;
          if (typeof rawSupported === "boolean") {
            isSupported = rawSupported;
          } else if (typeof rawSupported === "string") {
            const normalized = rawSupported.trim().toLowerCase();
            if (normalized === "true" || normalized === "yes") isSupported = true;
            if (normalized === "false" || normalized === "no") isSupported = false;
          }
          if (isSupported === null) return null;
          const sourceUrl = typeof entry?.source_url === "string"
            ? entry.source_url
            : typeof entry?.sourceUrl === "string" ? entry.sourceUrl : "";
          const normalizedUrl = sourceUrl ? normalizeUrl(sourceUrl).toLowerCase() : "";
          if (!normalizedUrl || !allowedUrls.has(normalizedUrl)) return null;
          return {
            platform,
            isSupported,
            reasoning: typeof entry?.reasoning === "string"
              ? entry.reasoning.trim()
              : typeof entry?.reason === "string" ? entry.reason.trim() : undefined,
            evidence: typeof entry?.evidence === "string" ? entry.evidence.trim() : undefined,
            sourceUrl: sourcesMap.get(normalizeUrl(sourceUrl))?.url || normalizeUrl(sourceUrl),
          } as PlatformValidationResult;
        })
        .filter((entry): entry is PlatformValidationResult => Boolean(entry))
      : [];

    const alternativesRaw = payload.alternative_platforms_found || [];
    const alternativePlatformsFound = Array.isArray(alternativesRaw)
      ? alternativesRaw
        .map((entry: any) => {
          const platform = typeof entry?.platform === "string" ? entry.platform.trim() : "";
          if (!platform || !allowedPlatformSet.has(platform.toLowerCase())) return null;
          const sourceUrl = typeof entry?.source_url === "string"
            ? entry.source_url
            : typeof entry?.sourceUrl === "string" ? entry.sourceUrl : "";
          const normalizedUrl = sourceUrl ? normalizeUrl(sourceUrl).toLowerCase() : "";
          if (!normalizedUrl || !allowedUrls.has(normalizedUrl)) return null;
          return {
            platform,
            reason: typeof entry?.reason === "string" ? entry.reason.trim() : undefined,
            evidence: typeof entry?.evidence === "string" ? entry.evidence.trim() : undefined,
            sourceUrl: sourcesMap.get(normalizeUrl(sourceUrl))?.url || normalizeUrl(sourceUrl),
          } as PlatformAlternativeResult;
        })
        .filter((entry): entry is PlatformAlternativeResult => Boolean(entry))
      : [];

    const sources = Array.from(sourcesMap.values());
    return {
      model: this.modelName,
      validation,
      alternativePlatformsFound,
      sources,
      note: payload.note || (sources.length === 0 ? "No grounded sources were returned for this query." : undefined),
    };
  }
}

export const geminiResearchService = new GeminiResearchService();
