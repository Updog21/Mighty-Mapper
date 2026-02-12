import { GoogleGenAI } from "@google/genai";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import crypto from "crypto";
import { settingsService } from "./settings-service";
import { buildGroundedConfig } from "./gemini-config";
import { normalizePlatformList } from "../../shared/platforms";
import decisionSchema from "../schemas/gemini-mapping-decision.schema.json";
import { z } from "zod";

export interface GeminiDataComponentCandidate {
  id: string;
  name: string;
  description: string;
  dataSourceName?: string;
  examples?: string[];
  mutableElements?: string[];
  logSourceHints?: Array<{ name: string; channel?: string }>;
}

export interface GeminiMappingInput {
  vendor?: string;
  product?: string;
  description?: string;
  aliases?: string[];
  platforms: string[];
  candidates: GeminiDataComponentCandidate[];
}

export interface GeminiMappingResult {
  suggestedIds: string[];
  decisions?: GeminiMappingDecision[];
  evaluatedCount?: number;
  sources?: Array<{ title?: string; url: string }>;
  notes?: string;
  metrics?: GeminiMappingMetrics;
}

export interface GeminiMappingDecision {
  id: string;
  selected: boolean;
  reason?: string;
  evidence?: string;
  sourceUrl?: string;
  sourceUrlVerified?: boolean;
  confidence?: "high" | "medium" | "low";
  scope?: "exact" | "suite-explicit" | "platform-explicit";
  completeness?: "native" | "partial";
  dataSource?: string;
  notes?: string;
}

export interface GeminiKeyTestResult {
  ok: boolean;
  model: string;
  usage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
  };
  usageRemaining: number | null;
  note?: string;
}

export interface GeminiMappingMetrics {
  pipelineMode: GeminiPipelineMode;
  legacyLatencyMs?: number;
  optimizedLatencyMs?: number;
  selectedParity?: boolean;
  selectedDeltaCount?: number;
  schemaValidRate?: number;
  cacheUsed?: boolean;
  cacheKey?: string;
}

type GeminiPipelineMode = "legacy" | "shadow" | "optimized";
type TriageBucket = "HARD_NO" | "LIKELY" | "MAYBE";

const DEFAULT_MODEL = "gemini-1.5-flash";
const MAX_CANDIDATES_PER_PROMPT = 24;
const MAX_BATCH_ATTEMPTS = 2;
const MAX_REQUEST_ATTEMPTS = 2;
const REQUEST_RETRY_DELAY_MS = 450;
const DEFAULT_PIPELINE_MODE: GeminiPipelineMode = "legacy";
const DEFAULT_CACHE_TTL = "43200s";
const OPT_MAX_RESEARCH_QUERIES_PER_DC = 2;
const OPT_HIGH_VALUE_EXTRA_QUERIES = 1;
const OPT_TRIAGE_TOP_LIMIT = 36;

const normalizeUrl = (value: string) => value.trim().replace(/#.*$/, "").replace(/\/$/, "");

const sanitizeInput = (input: string): string => {
  if (!input) return "Unknown";
  // Remove potential prompt injection delimiters or control characters
  return input.replace(/"""/g, '"').replace(/`/g, "'").trim();
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientRequestError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|timeout|timed out|429|500|502|503|504|econnreset|enotfound|eai_again|socket/i.test(message);
};

type GeminiDecisionPayload = {
  id: string;
  selected: boolean;
  confidence?: "high" | "medium" | "low";
  scope?: "exact" | "suite-explicit" | "platform-explicit";
  completeness?: "native" | "partial";
  data_source?: string;
  reason?: string;
  evidence?: string;
  source_url?: string;
  notes?: string;
};

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateDecision = ajv.compile<GeminiDecisionPayload>(decisionSchema);

const ResponseSchema = z.object({
  decisions: z.array(z.unknown()).optional().default([]),
  selected_ids: z.array(z.string()).optional().default([]),
  notes: z.string().optional(),
  product: z.unknown().optional(),
  summary: z.unknown().optional(),
  gaps: z.unknown().optional(),
  research_notes: z.string().optional(),
}).passthrough();

const TriageSchema = z.object({
  triage: z.array(z.object({
    id: z.string(),
    bucket: z.enum(["HARD_NO", "LIKELY", "MAYBE"]),
    reason: z.string().optional(),
  })).optional().default([]),
  notes: z.string().optional(),
}).passthrough();

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

const extractUsageMetadata = (response: any): {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
} => {
  const root = getResponseRoot(response);
  const usage = response?.usageMetadata || root?.usageMetadata || {};
  return {
    promptTokenCount: usage.promptTokenCount,
    candidatesTokenCount: usage.candidatesTokenCount,
    totalTokenCount: usage.totalTokenCount,
    cachedContentTokenCount: usage.cachedContentTokenCount,
  };
};

const getResponseRoot = (response: any): any => response?.response ?? response;

const extractJsonPayload = (text: string) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const jsonString = text.slice(start, end + 1).trim();
    try {
      const raw = JSON.parse(jsonString);
      const parsed = ResponseSchema.parse(raw);
      const decisions = (parsed.decisions || [])
        .map((entry) => {
          if (!validateDecision(entry)) {
            console.warn("Gemini mapping decision failed schema validation.", validateDecision.errors);
            return null;
          }
          return entry as GeminiDecisionPayload;
        })
        .filter((entry): entry is GeminiDecisionPayload => Boolean(entry));
      return {
        ...parsed,
        decisions,
      };
    } catch (error) {
      console.warn("Gemini mapping JSON parse/validation failed.", error);
    }
  }

  return { selected_ids: [], decisions: [], notes: "Model response did not contain valid JSON." };
};

const extractSources = (response: any): Map<string, { title?: string; url: string }> => {
  const sourcesMap = new Map<string, { title?: string; url: string }>();
  const addSource = (url?: string, title?: string) => {
    if (!url) return;
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    if (!sourcesMap.has(normalized)) {
      sourcesMap.set(normalized, { title, url: normalized });
    }
  };

  const root = getResponseRoot(response);
  const candidate = root?.candidates?.[0];
  const grounding = candidate?.groundingMetadata || candidate?.grounding_metadata;
  const chunks = grounding?.groundingChunks || grounding?.grounding_chunks || [];
  chunks.forEach((chunk: any) => addSource(chunk.web?.uri || chunk.web?.url, chunk.web?.title));

  const citations = candidate?.citationMetadata?.citationSources
    || candidate?.citation_metadata?.citation_sources
    || [];
  citations.forEach((citation: any) => addSource(citation.uri || citation.url));

  return sourcesMap;
};

const normalizeDecision = (
  entry: GeminiDecisionPayload,
  candidateMap: Map<string, string>,
  allowedUrls: Set<string>,
  sourcesMap: Map<string, { title?: string; url: string }>
): GeminiMappingDecision | null => {
  const idRaw = entry.id;
  const id = idRaw.trim();
  const normalizedId = id.replace(/^DC-?/i, "DC");
  const canonicalId = normalizedId ? candidateMap.get(normalizedId.toLowerCase()) : undefined;
  if (!canonicalId) return null;
  const selected = entry.selected;
  const reason = entry.reason?.trim();
  const evidence = entry.evidence?.trim();
  const confidence = entry.confidence?.trim() as GeminiMappingDecision["confidence"];
  const scope = entry.scope?.trim() as GeminiMappingDecision["scope"];
  const completeness = entry.completeness?.trim() as GeminiMappingDecision["completeness"];
  const dataSource = entry.data_source?.trim();
  const notes = entry.notes?.trim();
  const sourceUrlRaw = entry.source_url;
  let sourceUrl: string | undefined;
  let sourceUrlVerified: boolean | undefined;
  if (sourceUrlRaw) {
    const normalizedUrl = normalizeUrl(sourceUrlRaw);
    if (normalizedUrl) {
      sourceUrl = sourcesMap.get(normalizedUrl)?.url || normalizedUrl;
      sourceUrlVerified = allowedUrls.has(normalizedUrl.toLowerCase());
    }
  }
  const normalizedNotes = notes || "";
  const withCitationNote = selected && sourceUrl && sourceUrlVerified === false
    ? `${normalizedNotes}${normalizedNotes ? " " : ""}Source URL was not grounding-verified; review evidence manually.`
    : normalizedNotes;

  return {
    id: canonicalId,
    selected,
    reason,
    evidence,
    sourceUrl,
    sourceUrlVerified,
    confidence,
    scope,
    completeness,
    dataSource,
    notes: withCitationNote || undefined,
  };
};

export class GeminiMappingService {
  private client: GoogleGenAI | null = null;
  private clientKey: string | null = null;
  private modelName: string | null = null;
  private promptCacheByKey = new Map<string, string>();

  private parsePipelineMode(value?: string): GeminiPipelineMode {
    const normalized = (value || "").trim().toLowerCase();
    if (normalized === "shadow") return "shadow";
    if (normalized === "optimized") return "optimized";
    return "legacy";
  }

  private async getPipelineMode(): Promise<GeminiPipelineMode> {
    const fromSettings = await settingsService.get(
      "gemini_dc_pipeline_mode",
      process.env.GEMINI_DC_PIPELINE_MODE || DEFAULT_PIPELINE_MODE
    );
    return this.parsePipelineMode(fromSettings);
  }

  private parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (!value) return fallback;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
    return fallback;
  }

  private async isPromptCacheEnabled(): Promise<boolean> {
    const raw = await settingsService.get(
      "gemini_dc_cache_enabled",
      process.env.GEMINI_DC_CACHE_ENABLED || "true"
    );
    return this.parseBoolean(raw, true);
  }

  private async getPromptCacheTtl(): Promise<string> {
    const raw = await settingsService.get(
      "gemini_dc_cache_ttl",
      process.env.GEMINI_DC_CACHE_TTL || DEFAULT_CACHE_TTL
    );
    const value = raw.trim();
    return value || DEFAULT_CACHE_TTL;
  }

  private async getPromptPolicyVersion(): Promise<string> {
    const raw = await settingsService.get(
      "gemini_dc_policy_version",
      process.env.GEMINI_DC_POLICY_VERSION || "v1"
    );
    const value = raw.trim();
    return value || "v1";
  }

  private async requireLegacyParityGuard(): Promise<boolean> {
    const raw = await settingsService.get(
      "gemini_dc_require_legacy_parity",
      process.env.GEMINI_DC_REQUIRE_LEGACY_PARITY || "true"
    );
    return this.parseBoolean(raw, true);
  }

  private async getOrCreatePromptCache(
    client: GoogleGenAI,
    modelName: string,
    prefix: string
  ): Promise<{ cacheName?: string; cacheKey?: string }> {
    const enabled = await this.isPromptCacheEnabled();
    if (!enabled || !prefix.trim()) return {};

    const policyVersion = await this.getPromptPolicyVersion();
    const prefixHash = crypto
      .createHash("sha256")
      .update(`${policyVersion}::${modelName}::${prefix}`)
      .digest("hex")
      .slice(0, 16);
    const cacheKey = `${modelName}:${policyVersion}:${prefixHash}`;
    const existing = this.promptCacheByKey.get(cacheKey);
    if (existing) {
      return { cacheName: existing, cacheKey };
    }

    try {
      const ttl = await this.getPromptCacheTtl();
      const created = await client.caches.create({
        model: modelName,
        config: {
          displayName: `dc-map-${policyVersion}-${prefixHash.slice(0, 8)}`,
          ttl,
          contents: [
            {
              role: "user",
              parts: [{ text: prefix }],
            },
          ],
        } as any,
      } as any);
      const cacheName = (created as any)?.name;
      if (typeof cacheName === "string" && cacheName.length > 0) {
        this.promptCacheByKey.set(cacheKey, cacheName);
        return { cacheName, cacheKey };
      }
      return { cacheKey };
    } catch (error) {
      console.warn("Gemini prompt cache creation failed; continuing without cache.", error);
      return { cacheKey };
    }
  }

  private async buildUngroundedConfig() {
    const grounded = await buildGroundedConfig();
    const { tools, ...rest } = grounded as any;
    return rest;
  }

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

  private buildPrompt(input: GeminiMappingInput): string {
    const vendorValue = input.vendor?.trim() ? sanitizeInput(input.vendor) : "";
    const productValue = input.product?.trim() ? sanitizeInput(input.product) : "";
    const vendor = vendorValue || "Unknown";
    const product = productValue || (vendorValue ? vendorValue : "Unknown");
    const aliasList = Array.isArray(input.aliases)
      ? Array.from(new Set(input.aliases.map((alias) => sanitizeInput(alias)).filter(Boolean)))
      : [];
    const platformList = normalizePlatformList(Array.isArray(input.platforms) ? input.platforms : []);
    const platforms = platformList.length > 0 ? platformList.join(", ") : "Unknown";

    const candidateList = Array.isArray(input.candidates) ? input.candidates : [];
    const groupedCandidates = new Map<string, GeminiDataComponentCandidate[]>();
    candidateList.forEach((candidate) => {
      const group = candidate.dataSourceName?.trim() || "Unknown";
      if (!groupedCandidates.has(group)) {
        groupedCandidates.set(group, []);
      }
      groupedCandidates.get(group)!.push(candidate);
    });

    const groupEntries = Array.from(groupedCandidates.entries());
    const groupSummaries = groupEntries.map(([group, candidates]) => {
      const ids = candidates.map((candidate) => candidate.id).join(", ");
      return `${group.toUpperCase()}: ${ids}`;
    });

    const candidateLines = groupEntries.flatMap(([group, candidates]) => {
      const header = `Data Source: ${group}`;
      const lines = candidates.map((candidate) => {
        const descriptionSnippet = typeof candidate.description === "string"
          ? candidate.description.replace(/\s+/g, " ")
          : "";
        const examples = Array.isArray(candidate.examples) && candidate.examples.length > 0
          ? candidate.examples.join("; ")
          : "None listed";
        const dataSource = candidate.dataSourceName || "Unknown";
        const fields = Array.isArray(candidate.mutableElements) && candidate.mutableElements.length > 0
          ? candidate.mutableElements.slice(0, 8).join(", ")
          : "";
        const logSourceHints = Array.isArray(candidate.logSourceHints) && candidate.logSourceHints.length > 0
          ? candidate.logSourceHints
            .slice(0, 6)
            .map((hint) => {
              const channel = typeof hint.channel === "string" ? hint.channel.trim() : "";
              return channel ? `${hint.name} (${channel})` : hint.name;
            })
            .join("; ")
          : "";
        return [
          `- ${candidate.id} | ${candidate.name} | Data Source: ${dataSource} | ${descriptionSnippet} | Examples: ${examples}`,
          fields ? `  Known fields: ${fields}` : null,
          logSourceHints ? `  Log source hints (MITRE log source table): ${logSourceHints}` : null,
        ].filter(Boolean).join("\n");
      });
      return [header, ...lines];
    });

    const description = sanitizeInput(input.description || "Not provided");
    const baseName = productValue
      ? (vendorValue ? `${vendorValue} ${productValue}` : productValue)
      : vendorValue;
    const productSearchTokens = [baseName, ...aliasList]
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value !== "Unknown");
    const uniqueTokens = Array.from(new Set(productSearchTokens));
    const productSearch = uniqueTokens.length > 0
      ? uniqueTokens.map((value) => `"${value}"`).join(" OR ")
      : vendor;
    const toCategory = (platform: string): string => {
      const value = platform.toLowerCase();
      if (value.includes("windows")) return "WINDOWS";
      if (value.includes("linux")) return "LINUX";
      if (value.includes("network")) return "NETWORK";
      if (value.includes("web")) return "WEB";
      if ([
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
      ].some((token) => value.includes(token))) {
        return "CLOUD";
      }
      return "OTHER";
    };
    const platformTokens = Array.from(new Set(platformList.map((platform) => toCategory(platform))));
    const normalizedPlatforms = platformTokens.length > 0 ? platformTokens.join(", ") : "OTHER";
    const hasCloud = platformTokens.includes("CLOUD");
    const hasHost = platformTokens.some((token) => ["WINDOWS", "LINUX", "OTHER"].includes(token));
    let deploymentModel = "UNKNOWN";
    if (hasCloud && hasHost) {
      deploymentModel = "HYBRID";
    } else if (hasCloud) {
      deploymentModel = "CLOUD_SAAS";
    } else if (hasHost) {
      deploymentModel = "SELF_MANAGED";
    }
    const loggingCapabilities = "Not provided";
    const evaluationDate = new Date().toISOString().slice(0, 10);

    return `
You are a MITRE ATT&CK Data Component mapping analyst. Your task is to evaluate 
whether a specific vendor product generates telemetry for MITRE ATT&CK Data Components.

PRODUCT DEFINITION
==================
Vendor: """${vendor}"""
Product Name: """${product}"""
Product Search String: """${productSearch}"""
Product Aliases: """${aliasList.length > 0 ? aliasList.join(", ") : "None provided"}"""
Deployment Model: """${deploymentModel}"""
Target Platforms: """${normalizedPlatforms}"""
Primary Function: """${description}"""
Key Logging Capabilities: """${loggingCapabilities}"""

Input Trust Level:
- Primary Function is user-provided context and may be incomplete or inaccurate
- Treat it as a low-trust hint and corroborate with authoritative documentation

EVALUATION METHODOLOGY
======================
For each candidate Data Component (DC0001), determine whether the product 
generates native telemetry for that specific behavior using this framework:

1. EVIDENCE THRESHOLD:
   - Use authoritative documentation for the product or its platform/module
   - Prefer vendor-owned docs; platform-owner docs are OK for platform-native datasets
   - You may infer DC coverage from documented log fields/channels if they clearly
     satisfy the DC definition
   - Marketing materials and general security whitepapers do NOT qualify as evidence
   - Third-party blogs do NOT replace authoritative documentation

2. SCOPE DETERMINATION:
   - "exact": Docs describe THIS PRODUCT/module log source producing DC-relevant fields
   - "suite-explicit": Docs list this product among modules emitting the log source
   - "platform-explicit": Platform-wide dataset applies to this product deployment
   - Inference from fields is allowed if aligned to DC semantics

3. CONFIDENCE LEVELS:
   - "high": Log source + fields documented, strong alignment to DC semantics
   - "medium": Log source documented, reasonable inference to DC from fields
   - "low": Evidence is indirect or field coverage is ambiguous
   - "unconfirmed": Cannot verify from authoritative docs; set selected=false

4. PLATFORM/DEPLOYMENT FILTERING:
   - If the product is Cloud SaaS only, and DC describes on-premises-specific behavior, 
     default to false
   - If the product is agent-based EDR and DC describes network-level telemetry the 
     agent cannot capture, set false
   - Exception: Only override if authoritative documentation explicitly states cross-platform 
     support
   - Document the platform mismatch in "notes" field

5. DATA COMPLETENESS vs. DATA AVAILABILITY:
   - AVAILABLE: Product natively generates and logs this telemetry by default
   - PARTIAL: Product can generate telemetry but requires:
     * Configuration/enablement (feature flag, setting)
     * Integration (3rd-party connector, plugin)
     * Custom code (custom fields, scripting)
   - MISSING: Product does not generate this telemetry regardless of configuration
   - For PARTIAL: Set selected=true, but add "completeness": "partial" to JSON and 
     explain in reason field

6. LOGGING vs. DETECTION:
   - Assess whether the product LOGS the activity, NOT whether it detects it
   - Example: A SIEM detecting command execution (via external logs) is NOT the same 
     as that SIEM generating native command execution logs
   - Example: A proxy logging HTTP requests DOES generate network connection logs (DC0015)
   - Be precise about data source origin

RESEARCH PROCESS
================
For each Data Component candidate:

  Step 1: Start from the DC description + log source hints + known fields (if provided)
          Query: ${productSearch} "<DC_DESCRIPTION>" logging events telemetry
          
  Step 2: If Step 1 yields results, extract the relevant log source details and source URL
          
  Step 3: If Step 1 is inconclusive, search for feature documentation or API reference
          Query: ${productSearch} "<FEATURE_RELATED_TO_DC>" logs events
          
  Step 4: If Step 3 is inconclusive, search for deployment guides or configuration
          Query: ${productSearch} logging configuration enable audit events
          
  Step 5: If Steps 1-4 yield no authoritative evidence, set selected=false
          Do NOT guess
          
  Step 6: For EACH selected=true result:
          - Provide a short paraphrase of the log source documentation
          - Confirm the log source belongs to the product or its platform/module
          - Verify source_url is from authoritative docs (vendor or platform owner)
          - Assess confidence and scope
          - Document completeness (native vs. partial/configured)

EVALUATION OUTPUT
=================
Return ONLY valid JSON (no markdown fences, no code blocks, no explanatory text).

JSON Structure:
{
  "product": {
    "vendor": "${vendor}",
    "name": "${product}",
    "aliases": [${aliasList.map((alias) => `"${alias}"`).join(", ")}],
    "deployment_model": "${deploymentModel}",
    "platforms": [${platformTokens.map((platform) => `"${platform}"`).join(", ")}],
    "evaluation_date": "${evaluationDate}"
  },
  "summary": {
    "total_candidates": <NUMBER>,
    "selected_count": <NUMBER>,
    "coverage_percentage": <0-100>,
    "coverage_level": "<STRONG|MODERATE|WEAK|NONE>"
  },
  "decisions": [
    {
      "id": "DC0001",
      "data_source": "<PARENT_DATA_SOURCE>",
      "selected": true,
      "confidence": "high|medium|low",
      "scope": "exact|suite-explicit|platform-explicit",
      "completeness": "native|partial",
      "reason": "Concise explanation of why this DC is applicable",
      "evidence": "Direct quote or precise paraphrase from authoritative documentation",
      "source_url": "https://official-vendor-domain/exact-page",
      "notes": "Additional context (configuration required, limitations, etc.)"
    },
    {
      "id": "DC0002",
      "data_source": "<PARENT_DATA_SOURCE>",
      "selected": false
    }
  ],
  "gaps": [
    {
      "id": "DC0003",
      "reason": "Why product does not provide this telemetry",
      "impact": "High|Medium|Low",
      "remediation": "Optional: how to close this gap (e.g., integration, configuration)"
    }
  ],
  "research_notes": "Summary of evaluation methodology, data source limitations, caveats"
}

SELECTION RULES
===============
- Provide a decision entry for EVERY candidate ID (include each ID exactly once)
- For selected=false: ONLY include "id" and "selected" fields (omit all others)
- For selected=true: ALWAYS include confidence, scope, completeness, reason, evidence, source_url
- Do NOT fabricate evidence, quotes, or URLs
- If you cannot find an authoritative source: set selected=false
- Evidence must tie the log source to the product or its platform/module
- Confidence levels:
  * high: Strong field alignment to DC with documented log source
  * medium: Reasonable inference from documented log source fields
  * low: Indirect/ambiguous evidence
- Scope levels:
  * exact: "Product/module log source generates DC-relevant fields"
  * suite-explicit: "Suite including Product logs the source"
  * platform-explicit: "Platform dataset applies to this deployment"
- Completeness:
  * native: Product logs this by default, no configuration required
  * partial: Requires configuration, integration, or custom code
- Gaps section: Include only CRITICAL gaps (high detection value, not currently provided)

QUALITY GATES
=============
Before returning JSON:

  [ ] Every candidate ID has exactly one decision entry
  [ ] No selected=true entries lack confidence, scope, completeness, reason, evidence, source_url
  [ ] Every source_url is from authoritative vendor/platform docs
  [ ] Every evidence quote is directly traceable to source_url
  [ ] Reason/evidence grounded in documented log sources and fields (inference allowed)
  [ ] Coverage percentages calculated correctly: (selected_count / total_candidates) x 100
  [ ] Coverage level assigned correctly:
      - STRONG: 70-100%
      - MODERATE: 40-69%
      - WEAK: 1-39%
      - NONE: 0%
  [ ] Platform/deployment filters applied (cross-platform exceptions documented)
  [ ] Data completeness (native vs. partial) clearly indicated
  [ ] Critical gaps identified and explained in gaps[] array

CANDIDATE DATA COMPONENTS
==========================
${groupSummaries.join("\n")}

${candidateLines.join("\n")}

INSTRUCTIONS
============
1. Work through each data source group in order
2. For EACH candidate ID: research systematically using Steps 1-6 above
3. Document all decisions in JSON structure above
4. For each selected=true: Provide grounded evidence from official vendor source
5. Return JSON ONLY; no markdown, no preamble, no explanation
6. If research is incomplete, note in research_notes field and set confidence accordingly
`.trim();
  }

  private selectedIdSet(result: GeminiMappingResult): Set<string> {
    return new Set((result.suggestedIds || []).map((id) => id.toLowerCase()));
  }

  private compareSelectedParity(a: GeminiMappingResult, b: GeminiMappingResult): { parity: boolean; delta: number } {
    const left = this.selectedIdSet(a);
    const right = this.selectedIdSet(b);
    let delta = 0;
    left.forEach((id) => {
      if (!right.has(id)) delta += 1;
    });
    right.forEach((id) => {
      if (!left.has(id)) delta += 1;
    });
    return { parity: delta === 0, delta };
  }

  private buildOptimizedPolicyPrefix(): string {
    return `
ROLE: Detection engineer mapping MITRE ATT&CK Data Components to product-native telemetry.

NON-NEGOTIABLES
- Output valid JSON only.
- Never fabricate evidence, fields, channels, or URLs.
- If authoritative docs do not support a claim, selected=false unless community fallback criteria are met.

COMMUNITY FALLBACK (STRICT)
- Allowed only when authoritative docs are unavailable.
- Require at least 2 independent reputable sources with concrete technical detail.
- If used, mark it in notes and cap confidence at medium.

TRIAGE RULES
- Buckets: HARD_NO | LIKELY | MAYBE.
- HARD_NO only when contradiction is provable from product deployment/platform facts and DC semantics.
- Ambiguous cases must be MAYBE, not HARD_NO.

EVIDENCE RULES
- Research only LIKELY and MAYBE IDs.
- Default search budget per DC: ${OPT_MAX_RESEARCH_QUERIES_PER_DC}; escalate by ${OPT_HIGH_VALUE_EXTRA_QUERIES} for unresolved high-value DCs.
- Return one decision per candidate ID.

DECISION JSON SHAPE
{
  "decisions": [
    {
      "id": "DC0001",
      "selected": true,
      "confidence": "high|medium|low",
      "scope": "exact|suite-explicit|platform-explicit",
      "completeness": "native|partial",
      "data_source": "Data Source Name",
      "reason": "short reason",
      "evidence": "short evidence paraphrase",
      "source_url": "https://...",
      "notes": "optional"
    }
  ],
  "notes": "optional"
}
`.trim();
  }

  private buildOptimizedTriagePayload(input: GeminiMappingInput, candidates: GeminiDataComponentCandidate[]): string {
    const vendor = sanitizeInput(input.vendor || "Unknown");
    const product = sanitizeInput(input.product || input.vendor || "Unknown");
    const aliases = Array.isArray(input.aliases) ? input.aliases.map((alias) => sanitizeInput(alias)).filter(Boolean) : [];
    const platforms = normalizePlatformList(Array.isArray(input.platforms) ? input.platforms : []).join(", ") || "Unknown";
    const description = sanitizeInput(input.description || "Not provided");
    const lines = candidates.map((candidate) => {
      const fields = Array.isArray(candidate.mutableElements) && candidate.mutableElements.length > 0
        ? candidate.mutableElements.slice(0, 6).join(", ")
        : "none";
      const hints = Array.isArray(candidate.logSourceHints) && candidate.logSourceHints.length > 0
        ? candidate.logSourceHints
          .slice(0, 4)
          .map((hint) => hint.channel ? `${hint.name} (${hint.channel})` : hint.name)
          .join("; ")
        : "none";
      return `- ${candidate.id} | ${candidate.name} | ${candidate.description.replace(/\s+/g, " ")} | fields: ${fields} | hints: ${hints}`;
    }).join("\n");

    return `
MODE: TRIAGE
Vendor: "${vendor}"
Product: "${product}"
Aliases: "${aliases.length > 0 ? aliases.join(", ") : "None"}"
Platforms: "${platforms}"
Primary function (low trust): "${description}"

Classify each candidate into HARD_NO, LIKELY, or MAYBE.
HARD_NO only on explicit contradictions. Do not use unsupported assumptions.
Return JSON only:
{
  "triage": [
    { "id": "DC0001", "bucket": "HARD_NO|LIKELY|MAYBE", "reason": "optional short reason" }
  ],
  "notes": "optional"
}

CANDIDATES
${lines}
`.trim();
  }

  private buildOptimizedEvidencePayload(
    input: GeminiMappingInput,
    allCandidates: GeminiDataComponentCandidate[],
    evidenceCandidates: GeminiDataComponentCandidate[],
    hardNoIds: string[]
  ): string {
    const vendor = sanitizeInput(input.vendor || "Unknown");
    const product = sanitizeInput(input.product || input.vendor || "Unknown");
    const aliases = Array.isArray(input.aliases) ? input.aliases.map((alias) => sanitizeInput(alias)).filter(Boolean) : [];
    const platforms = normalizePlatformList(Array.isArray(input.platforms) ? input.platforms : []).join(", ") || "Unknown";
    const description = sanitizeInput(input.description || "Not provided");
    const evidenceIds = new Set(evidenceCandidates.map((candidate) => candidate.id.toLowerCase()));
    const allLines = allCandidates.map((candidate) => {
      const scope = evidenceIds.has(candidate.id.toLowerCase()) ? "RESEARCH" : "AUTO_FALSE";
      const fields = Array.isArray(candidate.mutableElements) && candidate.mutableElements.length > 0
        ? candidate.mutableElements.slice(0, 6).join(", ")
        : "none";
      const hints = Array.isArray(candidate.logSourceHints) && candidate.logSourceHints.length > 0
        ? candidate.logSourceHints
          .slice(0, 4)
          .map((hint) => hint.channel ? `${hint.name} (${hint.channel})` : hint.name)
          .join("; ")
        : "none";
      return `- ${candidate.id} | ${scope} | ${candidate.name} | ${candidate.description.replace(/\s+/g, " ")} | fields: ${fields} | hints: ${hints}`;
    }).join("\n");

    return `
MODE: EVIDENCE
Vendor: "${vendor}"
Product: "${product}"
Aliases: "${aliases.length > 0 ? aliases.join(", ") : "None"}"
Platforms: "${platforms}"
Primary function (low trust): "${description}"
Hard-no IDs (do not research, force selected=false): [${hardNoIds.join(", ")}]

Tasks:
1. Research IDs marked RESEARCH and return evidence-backed decisions.
2. Keep AUTO_FALSE IDs as selected=false.
3. Every candidate ID must appear exactly once in decisions[].
4. Keep reason/evidence concise.
5. Prefer authoritative docs; apply strict community fallback rule only when needed.

CANDIDATES
${allLines}
`.trim();
  }

  private async generateWithRetries(
    client: GoogleGenAI,
    modelName: string,
    contents: string,
    config: Record<string, unknown>
  ): Promise<any> {
    let response: any;
    let lastError: unknown = null;
    for (let requestAttempt = 0; requestAttempt < MAX_REQUEST_ATTEMPTS; requestAttempt += 1) {
      try {
        response = await client.models.generateContent({
          model: modelName,
          contents,
          config: config as any,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const canRetry = requestAttempt < MAX_REQUEST_ATTEMPTS - 1 && isTransientRequestError(error);
        if (!canRetry) {
          throw error;
        }
        await wait(REQUEST_RETRY_DELAY_MS * (requestAttempt + 1));
      }
    }
    if (!response && lastError) {
      throw lastError;
    }
    return response;
  }

  private async runLegacyMapping(
    client: GoogleGenAI,
    modelName: string,
    input: GeminiMappingInput
  ): Promise<GeminiMappingResult> {
    const startedAt = Date.now();
    const candidateList = Array.isArray(input.candidates) ? input.candidates : [];
    if (candidateList.length === 0) {
      return {
        suggestedIds: [],
        decisions: [],
        evaluatedCount: 0,
        sources: [],
        notes: "No candidate data components were provided.",
        metrics: {
          pipelineMode: "legacy",
          legacyLatencyMs: Date.now() - startedAt,
          schemaValidRate: 1,
        },
      };
    }

    const runPrompt = async (candidates: GeminiDataComponentCandidate[]) => {
      const prompt = this.buildPrompt({
        ...input,
        candidates,
      });
      const response = await this.generateWithRetries(
        client,
        modelName,
        prompt,
        await buildGroundedConfig() as any
      );
      const text = await readResponseText(response);
      const payload = extractJsonPayload(text);
      const sourcesMap = extractSources(response);
      const allowedUrls = new Set(
        Array.from(sourcesMap.keys()).map((url) => url.toLowerCase())
      );
      const candidateMap = new Map(
        candidates.map((candidate) => [candidate.id.toLowerCase(), candidate.id])
      );
      const rawDecisions = payload.decisions || [];
      const normalizedDecisions = rawDecisions
        .map((entry) => normalizeDecision(entry, candidateMap, allowedUrls, sourcesMap))
        .filter((decision): decision is GeminiMappingDecision => Boolean(decision));
      const selectedIdHints = Array.isArray(payload.selected_ids)
        ? payload.selected_ids.filter((id): id is string => typeof id === "string")
        : [];
      const parsedIds = new Set(normalizedDecisions.map((decision) => decision.id.toLowerCase()));
      const ignoredHints = selectedIdHints
        .map((id) => candidateMap.get(id.toLowerCase()) || id)
        .filter((id) => typeof id === "string" && !parsedIds.has(id.toLowerCase()));
      const noteFragments = [
        typeof payload.notes === "string" ? payload.notes.trim() : "",
        typeof payload.research_notes === "string" ? payload.research_notes.trim() : "",
        ignoredHints.length > 0
          ? `Ignored ${ignoredHints.length} selected_ids hint(s) without schema-valid decision objects.`
          : "",
      ].filter(Boolean);
      const usage = extractUsageMetadata(response);

      return {
        decisions: normalizedDecisions,
        notes: noteFragments.join(" "),
        sources: sourcesMap,
        usage,
      };
    };

    const decisionMap = new Map<string, GeminiMappingDecision>();
    const sourcesMap = new Map<string, { title?: string; url: string }>();
    const notes: string[] = [];
    const attemptCounts = new Map<string, number>();
    let totalPromptTokens = 0;
    let totalCandidatesTokens = 0;
    let totalTokens = 0;
    let totalCachedTokens = 0;

    const chunkCandidates = <T,>(items: T[], size: number): T[][] => {
      const chunks: T[][] = [];
      for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
      }
      return chunks;
    };

    const mergeResult = (result: Awaited<ReturnType<typeof runPrompt>>) => {
      result.decisions.forEach((decision) => {
        decisionMap.set(decision.id, decision);
      });
      result.sources.forEach((value, key) => {
        if (!sourcesMap.has(key)) sourcesMap.set(key, value);
      });
      if (result.notes) {
        notes.push(result.notes);
      }
      totalPromptTokens += result.usage.promptTokenCount || 0;
      totalCandidatesTokens += result.usage.candidatesTokenCount || 0;
      totalTokens += result.usage.totalTokenCount || 0;
      totalCachedTokens += result.usage.cachedContentTokenCount || 0;
    };

    const runWithTracking = async (candidates: GeminiDataComponentCandidate[]) => {
      candidates.forEach((candidate) => {
        attemptCounts.set(candidate.id, (attemptCounts.get(candidate.id) || 0) + 1);
      });
      const result = await runPrompt(candidates);
      mergeResult(result);
    };

    const batches = chunkCandidates(candidateList, MAX_CANDIDATES_PER_PROMPT);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex] as GeminiDataComponentCandidate[];
      let unresolved: GeminiDataComponentCandidate[] = batch.filter((candidate) => !decisionMap.has(candidate.id));
      const batchFailures: string[] = [];
      for (let attempt = 0; attempt < MAX_BATCH_ATTEMPTS && unresolved.length > 0; attempt += 1) {
        try {
          await runWithTracking(unresolved);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          batchFailures.push(`Batch ${batchIndex + 1} attempt ${attempt + 1} failed: ${message}`);
        }
        unresolved = batch.filter((candidate) => !decisionMap.has(candidate.id));
      }
      if (unresolved.length > 0 && batchFailures.length > 0) {
        notes.push(batchFailures[batchFailures.length - 1]);
      }
      if (unresolved.length > 0) {
        for (const candidate of unresolved) {
          try {
            await runWithTracking([candidate]);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            notes.push(`Single-candidate retry failed for ${candidate.id}: ${message}`);
          }
        }
      }
    }

    const finalDecisions = candidateList.map((candidate) => (
      decisionMap.get(candidate.id) || {
        id: candidate.id,
        selected: false,
        notes: `No schema-valid decision returned after ${attemptCounts.get(candidate.id) || 0} attempt(s).`,
      }
    ));
    const suggestedIds = finalDecisions.filter((decision) => decision.selected).map((decision) => decision.id);

    if (decisionMap.size < candidateList.length) {
      const missingCount = candidateList.length - decisionMap.size;
      notes.push(`Gemini returned no schema-valid decision for ${missingCount} component(s); they were left unselected after retries.`);
    }

    const dedupedNotes = Array.from(new Set(
      notes
        .map((note) => note.trim())
        .filter((note) => note.length > 0)
    ));

    return {
      suggestedIds,
      decisions: finalDecisions,
      evaluatedCount: candidateList.length,
      sources: Array.from(sourcesMap.values()),
      notes: dedupedNotes.length > 0 ? dedupedNotes.join(" ") : undefined,
      metrics: {
        pipelineMode: "legacy",
        legacyLatencyMs: Date.now() - startedAt,
        schemaValidRate: candidateList.length > 0 ? decisionMap.size / candidateList.length : 1,
        cacheUsed: totalCachedTokens > 0,
      },
    };
  }

  private async runOptimizedMapping(
    client: GoogleGenAI,
    modelName: string,
    input: GeminiMappingInput
  ): Promise<GeminiMappingResult> {
    const startedAt = Date.now();
    const candidateList = Array.isArray(input.candidates) ? input.candidates : [];
    if (candidateList.length === 0) {
      return {
        suggestedIds: [],
        decisions: [],
        evaluatedCount: 0,
        sources: [],
        notes: "No candidate data components were provided.",
        metrics: {
          pipelineMode: "optimized",
          optimizedLatencyMs: Date.now() - startedAt,
          schemaValidRate: 1,
        },
      };
    }

    const prefix = this.buildOptimizedPolicyPrefix();
    const { cacheName, cacheKey } = await this.getOrCreatePromptCache(client, modelName, prefix);
    const groundedConfig = await buildGroundedConfig();
    const ungroundedConfig = await this.buildUngroundedConfig();
    const baseGroundedConfig = {
      ...(groundedConfig as any),
      ...(cacheName ? { cachedContent: cacheName } : {}),
    };
    const baseUngroundedConfig = {
      ...(ungroundedConfig as any),
      ...(cacheName ? { cachedContent: cacheName } : {}),
    };

    const decisionMap = new Map<string, GeminiMappingDecision>();
    const sourcesMap = new Map<string, { title?: string; url: string }>();
    const notes: string[] = [];
    const chunkCandidates = <T,>(items: T[], size: number): T[][] => {
      const chunks: T[][] = [];
      for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
      }
      return chunks;
    };
    let parsedDecisionCount = 0;

    const optimizedBatches = chunkCandidates(candidateList, MAX_CANDIDATES_PER_PROMPT);
    for (let batchIndex = 0; batchIndex < optimizedBatches.length; batchIndex += 1) {
      const batch = optimizedBatches[batchIndex] as GeminiDataComponentCandidate[];
      const candidateMap = new Map<string, string>(
        batch.map((candidate: GeminiDataComponentCandidate) => [candidate.id.toLowerCase(), candidate.id])
      );
      let hardNoIds = new Set<string>();
      let shortlistIds = new Set<string>();

      try {
        const triagePayload = this.buildOptimizedTriagePayload(input, batch);
        const triageResponse = await this.generateWithRetries(
          client,
          modelName,
          triagePayload,
          baseUngroundedConfig
        );
        const triageText = await readResponseText(triageResponse);
        const start = triageText.indexOf("{");
        const end = triageText.lastIndexOf("}");
        if (start >= 0 && end > start) {
          const raw = JSON.parse(triageText.slice(start, end + 1));
          const parsed = TriageSchema.parse(raw);
          parsed.triage.forEach((entry) => {
            const id = candidateMap.get(entry.id.trim().toLowerCase());
            if (!id) return;
            const bucket = entry.bucket as TriageBucket;
            if (bucket === "HARD_NO") {
              hardNoIds.add(id);
            } else {
              shortlistIds.add(id);
            }
          });
          if (parsed.notes) {
            notes.push(`Batch ${batchIndex + 1} triage: ${parsed.notes.trim()}`);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notes.push(`Batch ${batchIndex + 1} triage failed; using full evidence set. ${message}`);
      }

      if (shortlistIds.size === 0) {
        batch.forEach((candidate: GeminiDataComponentCandidate) => {
          if (!hardNoIds.has(candidate.id)) {
            shortlistIds.add(candidate.id);
          }
        });
      }

      const limitedShortlist = Array.from(shortlistIds).slice(0, OPT_TRIAGE_TOP_LIMIT);
      const evidenceCandidates = batch.filter((candidate: GeminiDataComponentCandidate) => limitedShortlist.includes(candidate.id));

      if (evidenceCandidates.length > 0) {
        const hardNoList = Array.from(hardNoIds);
        const evidencePayload = this.buildOptimizedEvidencePayload(input, batch, evidenceCandidates, hardNoList);
        try {
          const evidenceResponse = await this.generateWithRetries(
            client,
            modelName,
            evidencePayload,
            baseGroundedConfig
          );
          const evidenceText = await readResponseText(evidenceResponse);
          const payload = extractJsonPayload(evidenceText);
          const extractedSources = extractSources(evidenceResponse);
          extractedSources.forEach((value, key) => {
            if (!sourcesMap.has(key)) sourcesMap.set(key, value);
          });
          const allowedUrls = new Set(
            Array.from(extractedSources.keys()).map((url) => url.toLowerCase())
          );
          const normalizedDecisions = (payload.decisions || [])
            .map((entry) => normalizeDecision(entry, candidateMap, allowedUrls, extractedSources))
            .filter((decision): decision is GeminiMappingDecision => Boolean(decision));
          parsedDecisionCount += normalizedDecisions.length;
          normalizedDecisions.forEach((decision) => decisionMap.set(decision.id, decision));
          const usage = extractUsageMetadata(evidenceResponse);
          if ((usage.cachedContentTokenCount || 0) > 0 && cacheName) {
            notes.push(`Batch ${batchIndex + 1} used prompt cache.`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          notes.push(`Batch ${batchIndex + 1} evidence failed: ${message}`);
        }
      }

      batch.forEach((candidate: GeminiDataComponentCandidate) => {
        if (decisionMap.has(candidate.id)) return;
        if (hardNoIds.has(candidate.id)) {
          decisionMap.set(candidate.id, { id: candidate.id, selected: false, notes: "Hard contradiction in triage." });
          return;
        }
        decisionMap.set(candidate.id, { id: candidate.id, selected: false, notes: "No evidence-confirmed support in optimized pass." });
      });
    }

    const finalDecisions = candidateList.map((candidate) => (
      decisionMap.get(candidate.id) || { id: candidate.id, selected: false }
    ));
    const suggestedIds = finalDecisions.filter((decision) => decision.selected).map((decision) => decision.id);
    const dedupedNotes = Array.from(new Set(notes.map((note) => note.trim()).filter(Boolean)));

    return {
      suggestedIds,
      decisions: finalDecisions,
      evaluatedCount: candidateList.length,
      sources: Array.from(sourcesMap.values()),
      notes: dedupedNotes.length > 0 ? dedupedNotes.join(" ") : undefined,
      metrics: {
        pipelineMode: "optimized",
        optimizedLatencyMs: Date.now() - startedAt,
        schemaValidRate: candidateList.length > 0 ? parsedDecisionCount / candidateList.length : 1,
        cacheUsed: Boolean(cacheName),
        cacheKey,
      },
    };
  }

  async suggestDataComponents(input: GeminiMappingInput): Promise<GeminiMappingResult | null> {
    const clientInfo = await this.getClient();
    if (!clientInfo) return null;
    const { client, modelName } = clientInfo;

    try {
      const candidateList = Array.isArray(input.candidates) ? input.candidates : [];
      if (candidateList.length === 0) {
        return {
          suggestedIds: [],
          decisions: [],
          evaluatedCount: 0,
          sources: [],
          notes: "No candidate data components were provided.",
          metrics: { pipelineMode: "legacy", schemaValidRate: 1 },
        };
      }

      const mode = await this.getPipelineMode();
      if (mode === "legacy") {
        const result = await this.runLegacyMapping(client, modelName, input);
        result.metrics = {
          ...result.metrics,
          pipelineMode: "legacy",
        };
        return result;
      }

      if (mode === "shadow") {
        const legacyResult = await this.runLegacyMapping(client, modelName, input);
        let optimizedResult: GeminiMappingResult | null = null;
        try {
          optimizedResult = await this.runOptimizedMapping(client, modelName, input);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          legacyResult.notes = `${legacyResult.notes ? `${legacyResult.notes} ` : ""}Optimized shadow run failed: ${message}`;
        }

        if (optimizedResult) {
          const parity = this.compareSelectedParity(legacyResult, optimizedResult);
          legacyResult.notes = [
            legacyResult.notes || "",
            `Shadow parity=${parity.parity ? "match" : "mismatch"} delta=${parity.delta}.`,
          ].filter(Boolean).join(" ");
          legacyResult.metrics = {
            pipelineMode: "shadow",
            legacyLatencyMs: legacyResult.metrics?.legacyLatencyMs,
            optimizedLatencyMs: optimizedResult.metrics?.optimizedLatencyMs,
            selectedParity: parity.parity,
            selectedDeltaCount: parity.delta,
            schemaValidRate: legacyResult.metrics?.schemaValidRate,
            cacheUsed: optimizedResult.metrics?.cacheUsed,
            cacheKey: optimizedResult.metrics?.cacheKey,
          };
        } else {
          legacyResult.metrics = {
            ...legacyResult.metrics,
            pipelineMode: "shadow",
          };
        }
        return legacyResult;
      }

      const optimizedResult = await this.runOptimizedMapping(client, modelName, input);
      const requireParity = await this.requireLegacyParityGuard();
      if (!requireParity) {
        optimizedResult.metrics = {
          ...optimizedResult.metrics,
          pipelineMode: "optimized",
        };
        return optimizedResult;
      }

      const legacyResult = await this.runLegacyMapping(client, modelName, input);
      const parity = this.compareSelectedParity(legacyResult, optimizedResult);
      if (!parity.parity) {
        legacyResult.notes = [
          legacyResult.notes || "",
          `Optimized result rejected by parity guard (delta=${parity.delta}); legacy result returned.`,
        ].filter(Boolean).join(" ");
        legacyResult.metrics = {
          pipelineMode: "optimized",
          legacyLatencyMs: legacyResult.metrics?.legacyLatencyMs,
          optimizedLatencyMs: optimizedResult.metrics?.optimizedLatencyMs,
          selectedParity: false,
          selectedDeltaCount: parity.delta,
          schemaValidRate: legacyResult.metrics?.schemaValidRate,
          cacheUsed: optimizedResult.metrics?.cacheUsed,
          cacheKey: optimizedResult.metrics?.cacheKey,
        };
        return legacyResult;
      }

      optimizedResult.notes = [
        optimizedResult.notes || "",
        "Optimized result passed legacy parity guard.",
      ].filter(Boolean).join(" ");
      optimizedResult.metrics = {
        pipelineMode: "optimized",
        legacyLatencyMs: legacyResult.metrics?.legacyLatencyMs,
        optimizedLatencyMs: optimizedResult.metrics?.optimizedLatencyMs,
        selectedParity: true,
        selectedDeltaCount: 0,
        schemaValidRate: optimizedResult.metrics?.schemaValidRate,
        cacheUsed: optimizedResult.metrics?.cacheUsed,
        cacheKey: optimizedResult.metrics?.cacheKey,
      };
      return optimizedResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/search|grounding|retrieval|tool/i.test(message)) {
        throw new Error(
          `Grounded search is required for mapping, but the model '${this.modelName || DEFAULT_MODEL}' does not support it.`
        );
      }
      throw error;
    }
  }

  async testKey(apiKey?: string, modelOverride?: string): Promise<GeminiKeyTestResult | null> {
    const resolvedKey = apiKey || await settingsService.getGeminiKey();
    if (!resolvedKey) return null;

    const modelName = (modelOverride?.trim() || await settingsService.getGeminiModel()).trim() || DEFAULT_MODEL;
    try {
      const client = new GoogleGenAI({ apiKey: resolvedKey });
      const response = await client.models.generateContent({
        model: modelName,
        contents: "Use Google Search grounding. Respond with OK.",
        config: await buildGroundedConfig() as any,
      });
      const usage = (response as any).usageMetadata || (response as any).response?.usageMetadata || {};

      return {
        ok: true,
        model: modelName,
        usage: {
          promptTokens: usage.promptTokenCount || 0,
          candidatesTokens: usage.candidatesTokenCount || 0,
          totalTokens: usage.totalTokenCount || 0,
        },
        usageRemaining: null,
        note: "Gemini does not return remaining quota; usage is for this test call only.",
      };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const note = rawMessage.length > 200 ? `${rawMessage.slice(0, 200)}...` : rawMessage;
      return {
        ok: false,
        model: modelName,
        usage: {
          promptTokens: 0,
          candidatesTokens: 0,
          totalTokens: 0,
        },
        usageRemaining: null,
        note,
      };
    }
  }
}

export const geminiMappingService = new GeminiMappingService();
