import { GoogleGenAI } from "@google/genai";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
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
}

export interface GeminiMappingDecision {
  id: string;
  selected: boolean;
  reason?: string;
  evidence?: string;
  sourceUrl?: string;
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

const DEFAULT_MODEL = "gemini-1.5-flash";

const normalizeUrl = (value: string) => value.trim().replace(/#.*$/, "").replace(/\/$/, "");

const sanitizeInput = (input: string): string => {
  if (!input) return "Unknown";
  // Remove potential prompt injection delimiters or control characters
  return input.replace(/"""/g, '"').replace(/`/g, "'").trim();
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

  // Fallback: try to match IDs if JSON fails
  const ids = Array.from(new Set(text.match(/DC\\d{4}/g) || []));
  return { selected_ids: ids, decisions: [] };
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
  if (sourceUrlRaw) {
    const normalizedUrl = normalizeUrl(sourceUrlRaw);
    if (normalizedUrl && allowedUrls.has(normalizedUrl.toLowerCase())) {
      sourceUrl = sourcesMap.get(normalizedUrl)?.url || normalizedUrl;
    }
  }

  return {
    id: canonicalId,
    selected,
    reason,
    evidence,
    sourceUrl,
    confidence,
    scope,
    completeness,
    dataSource,
    notes,
  };
};

export class GeminiMappingService {
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
      return `- ${candidate.id} | ${candidate.name} | Data Source: ${dataSource} | ${descriptionSnippet} | Examples: ${examples}`;
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

EVALUATION METHODOLOGY
======================
For each candidate Data Component (DC0001), determine whether the product 
generates native telemetry for that specific behavior using this framework:

1. EVIDENCE THRESHOLD:
   - Vendor documentation must EXPLICITLY mention this product name or official alias
   - Generic suite-level statements (e.g., "our platform logs X") do NOT qualify unless 
     the specific product is named
   - Feature documentation, API references, and logging guides are authoritative sources
   - Marketing materials and general security whitepapers do NOT qualify as evidence
   - Third-party testing or research does NOT replace vendor documentation

2. SCOPE DETERMINATION:
   - "exact": Vendor documentation explicitly states THIS PRODUCT logs this DC
   - "suite-explicit": Vendor explicitly lists this product among modules that log this DC
   - "platform-explicit": Vendor explicitly states platform-wide telemetry including this product
   - Do NOT infer or extrapolate; document exactly what the vendor states

3. CONFIDENCE LEVELS:
   - "high": Multiple authoritative sources, explicit product name, clear feature description
   - "medium": Single authoritative source, explicit product name, clear feature description
   - "low": Explicit product name mentioned, but ambiguous or indirect evidence
   - "unconfirmed": Cannot verify from vendor documentation; set selected=false

4. PLATFORM/DEPLOYMENT FILTERING:
   - If the product is Cloud SaaS only, and DC describes on-premises-specific behavior, 
     default to false
   - If the product is agent-based EDR and DC describes network-level telemetry the 
     agent cannot capture, set false
   - Exception: Only override if vendor documentation explicitly states cross-platform 
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

  Step 1: Search vendor documentation explicitly mentioning this product
          Query: ${productSearch} "<DC_DESCRIPTION>" logging events telemetry
          
  Step 2: If Step 1 yields results, extract the exact statement and source URL
          
  Step 3: If Step 1 is inconclusive, search for feature documentation or API reference
          Query: ${productSearch} "<FEATURE_RELATED_TO_DC>" logs events
          
  Step 4: If Step 3 is inconclusive, search for deployment guides or configuration
          Query: ${productSearch} logging configuration enable audit events
          
  Step 5: If Steps 1-4 yield no explicit match, set selected=false
          Do NOT infer; do NOT extrapolate
          
  Step 6: For EACH selected=true result:
          - Extract direct quote or paraphrase from vendor source
          - Confirm product name is explicitly mentioned (not inferred)
          - Verify source_url is from official vendor domain (not archived/cached)
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
      "evidence": "Direct quote or precise paraphrase from vendor documentation",
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
- Evidence must mention this product explicitly (not inferred from suite/parent product)
- Confidence levels:
  * high: Multiple sources OR single authoritative + unambiguous statement
  * medium: Single authoritative source + clear statement
  * low: Explicit mention but indirect/ambiguous evidence
- Scope levels:
  * exact: "ProductName logs DC0001" or "ProductName generates <behavior>"
  * suite-explicit: "Suite including ProductName logs DC0001"
  * platform-explicit: "All ProductName instances across platforms log DC0001"
- Completeness:
  * native: Product logs this by default, no configuration required
  * partial: Requires configuration, integration, or custom code
- Gaps section: Include only CRITICAL gaps (high detection value, not currently provided)

QUALITY GATES
=============
Before returning JSON:

  [ ] Every candidate ID has exactly one decision entry
  [ ] No selected=true entries lack confidence, scope, completeness, reason, evidence, source_url
  [ ] Every source_url is from official vendor domain (e.g., docs.vendor.com, support.vendor.com)
  [ ] Every evidence quote is directly traceable to source_url
  [ ] No inferred or extrapolated statements in reason/evidence fields
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
        };
      }

      const runPrompt = async (candidates: GeminiDataComponentCandidate[]) => {
        const prompt = this.buildPrompt({
          ...input,
          candidates,
        });
        const response = await client.models.generateContent({
          model: modelName,
          contents: prompt,
          config: await buildGroundedConfig() as any,
        });
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
        if (normalizedDecisions.length === 0 && payload.selected_ids?.length) {
          payload.selected_ids.forEach((id) => {
            if (typeof id === "string") {
              const canonicalId = candidateMap.get(id.toLowerCase());
              if (canonicalId) {
                normalizedDecisions.push({ id: canonicalId, selected: true });
              }
            }
          });
        }

        return {
          decisions: normalizedDecisions,
          notes: payload.notes,
          sources: sourcesMap,
        };
      };

      const baseResult = await runPrompt(candidateList);
      const decisionMap = new Map<string, GeminiMappingDecision>();
      baseResult.decisions.forEach((decision) => {
        decisionMap.set(decision.id, decision);
      });

      const sourcesMap = new Map(baseResult.sources);
      const notes: string[] = [];
      if (baseResult.notes) notes.push(baseResult.notes);

      const missing = candidateList.filter((candidate) => !decisionMap.has(candidate.id));
      if (missing.length > 0) {
        const followUp = await runPrompt(missing);
        followUp.decisions.forEach((decision) => {
          decisionMap.set(decision.id, decision);
        });
        followUp.sources.forEach((value, key) => {
          if (!sourcesMap.has(key)) sourcesMap.set(key, value);
        });
        if (followUp.notes) notes.push(`Follow-up: ${followUp.notes}`);
      }

      const finalDecisions = candidateList.map((candidate) => (
        decisionMap.get(candidate.id) || { id: candidate.id, selected: false }
      ));
      const suggestedIds = finalDecisions.filter((decision) => decision.selected).map((decision) => decision.id);

      if (missing.length > 0 && decisionMap.size < candidateList.length) {
        const missingCount = candidateList.length - decisionMap.size;
        notes.push(`Gemini did not return decisions for ${missingCount} components; they were left unselected.`);
      }

      return {
        suggestedIds,
        decisions: finalDecisions,
        evaluatedCount: decisionMap.size,
        sources: Array.from(sourcesMap.values()),
        notes: notes.length > 0 ? notes.join(" ") : undefined,
      };
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
