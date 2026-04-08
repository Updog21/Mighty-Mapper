import { GoogleGenAI } from "@google/genai";
import { settingsService } from "./settings-service";
import { buildGroundedConfig } from "./gemini-config";
import { aiProviderService, toGeminiCompatibleResponse } from "./ai-provider-service";
import { PLATFORM_VALUES, normalizePlatformList } from "../../shared/platforms";
import { z } from "zod";

export interface ResearchDataComponentCandidate {
  id: string;
  name: string;
  description?: string;
  dataSourceName?: string;
  mutableElements?: string[];
  logSourceHints?: Array<{ name: string; channel?: string }>;
}

export interface ResearchLogSource {
  name: string;
  channel?: string | string[];
  requiredFields?: string[];
  missingFields?: string[];
  evidence?: string;
  notes?: string;
  sourceUrl?: string;
  verifiedByAi?: boolean;
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
  provider?: "gemini" | "openai";
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
  sourceUrlVerified?: boolean;
}

export interface PlatformCheckInput {
  vendor?: string;
  product?: string;
  description?: string;
  aliases?: string[];
  platforms: string[];
}

export interface PlatformValidationResult {
  platform: string;
  isSupported: boolean;
  reasoning?: string;
  evidence?: string;
  sourceUrl?: string;
  sourceUrlVerified?: boolean;
}

export interface PlatformAlternativeResult {
  platform: string;
  reason?: string;
  evidence?: string;
  sourceUrl?: string;
  sourceUrlVerified?: boolean;
}

export interface PlatformCheckResult {
  model: string;
  provider?: "gemini" | "openai";
  suggestedPlatforms?: string[];
  validation: PlatformValidationResult[];
  alternativePlatformsFound: PlatformAlternativeResult[];
  sources: Array<{ title?: string; url: string }>;
  note?: string;
}

const DEFAULT_MODEL = "gemini-1.5-flash";
type AiGenerationClient = GoogleGenAI | { provider: "openai"; apiKey: string };

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
  required_fields: z.array(z.string()).optional(),
  missing_fields: z.array(z.string()).optional(),
  evidence: z.string().optional(),
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
  suggested_platforms: z.array(z.string()).optional().default([]),
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

const resolveSourceReference = (
  sourceUrlRaw: unknown,
  allowedUrls: Set<string>,
  sourcesMap: Map<string, { title?: string; url: string }>
) => {
  if (typeof sourceUrlRaw !== "string") {
    return { sourceUrl: undefined, sourceUrlVerified: undefined as boolean | undefined };
  }
  const normalizedUrl = normalizeUrl(sourceUrlRaw);
  if (!normalizedUrl) {
    return { sourceUrl: undefined, sourceUrlVerified: undefined as boolean | undefined };
  }
  return {
    sourceUrl: sourcesMap.get(normalizedUrl)?.url || normalizedUrl,
    sourceUrlVerified: allowedUrls.has(normalizedUrl.toLowerCase()),
  };
};

const extractJsonPayload = (text: string): Record<string, unknown> => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const jsonString = text.slice(start, end + 1).trim();
    try {
      const raw = JSON.parse(jsonString);
      const parsed = EnrichmentResponseSchema.safeParse(raw);
      if (parsed.success) {
        return parsed.data as unknown as Record<string, unknown>;
      }
      // Keep raw payload as a permissive fallback so partially valid responses
      // still produce enrichment results instead of collapsing to an empty set.
      return (raw && typeof raw === "object") ? raw : {};
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
      const parsed = PlatformCheckResponseSchema.safeParse(raw);
      if (parsed.success) {
        return parsed.data;
      }
      return (raw && typeof raw === "object")
        ? raw as Record<string, unknown>
        : { suggested_platforms: [], validation: [], alternative_platforms_found: [] };
    } catch (error) {
      console.warn("Platform check JSON parse/validation failed.", error);
    }
  }
  return { suggested_platforms: [], validation: [], alternative_platforms_found: [] };
};

const containsAny = (value: string, needles: string[]) => {
  const normalized = value.toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
};

const IAAS_POSITIVE_SIGNALS = [
  "self-host",
  "self host",
  "self-managed",
  "self managed",
  "customer-managed",
  "customer managed",
  "customer account",
  "your aws account",
  "your azure subscription",
  "your gcp project",
  "bring your own cloud",
  "byoc",
  "deploy",
  "deployed",
  "installation",
  "helm",
  "kubernetes",
  "terraform",
  "cloudformation",
  "vm",
  "virtual machine",
  "ec2",
  "compute engine",
  "azure vm",
];

const IAAS_NEGATIVE_SIGNALS = [
  "saas",
  "vendor-hosted",
  "vendor hosted",
  "hosted by",
  "runs on aws",
  "runs on azure",
  "runs on gcp",
  "built on aws",
  "hosted on aws",
  "hosted on azure",
  "hosted on gcp",
  "managed service",
  "no deployment required",
];

export class GeminiResearchService {
  private client: AiGenerationClient | null = null;
  private clientKey: string | null = null;
  private modelName: string | null = null;

  private async getClient() {
    const provider = await aiProviderService.getActiveProvider();
    if (provider === "openai") {
      const apiKey = await settingsService.getOpenAIKey();
      if (!apiKey) return null;
      const modelName = (await settingsService.getOpenAIModel()).trim() || "gpt-4o-mini";
      const cacheKey = `${provider}:${apiKey}:${modelName}`;
      if (this.client && this.clientKey === cacheKey && this.modelName === modelName) {
        return { client: this.client, modelName, provider };
      }

      this.client = { provider: "openai", apiKey };
      this.clientKey = cacheKey;
      this.modelName = modelName;
      return { client: this.client, modelName, provider };
    }

    const apiKey = await settingsService.getGeminiKey();
    if (!apiKey) return null;
    const modelName = (await settingsService.getGeminiModel()).trim() || DEFAULT_MODEL;
    const cacheKey = `${provider}:${apiKey}:${modelName}`;
    if (this.client && this.clientKey === cacheKey && this.modelName === modelName) {
      return { client: this.client, modelName, provider };
    }

    this.client = new GoogleGenAI({ apiKey });
    this.clientKey = cacheKey;
    this.modelName = modelName;
    return { client: this.client, modelName, provider };
  }

  private async generateWithGroundingFallback(client: AiGenerationClient, modelName: string, prompt: string) {
    if ("provider" in client && client.provider === "openai") {
      try {
        const response = await aiProviderService.generateOpenAIResponse({
          apiKey: client.apiKey,
          modelName,
          prompt,
          grounded: true,
        });
        return { response: toGeminiCompatibleResponse(response), fallbackNote: response.fallbackNote };
      } catch (error) {
        const groundedMessage = error instanceof Error ? error.message : String(error);
        const response = await aiProviderService.generateOpenAIResponse({
          apiKey: client.apiKey,
          modelName,
          prompt,
          grounded: false,
        });
        return {
          response: toGeminiCompatibleResponse(response),
          fallbackNote: `OpenAI web search was unavailable; result generated without web search. ${groundedMessage}`,
        };
      }
    }

    const geminiClient = client as GoogleGenAI;
    const groundedConfig = await buildGroundedConfig() as any;
    const run = async (config: any) => (
      geminiClient.models.generateContent({
        model: modelName,
        contents: prompt,
        config,
      })
    );
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const isRetryableTransportError = (message: string) => (
      /fetch failed|network|timeout|timed out|econnreset|enetunreach|eai_again|enotfound/i.test(message)
    );
    const isGroundingToolError = (message: string) => (
      /search|grounding|retrieval|tool/i.test(message)
    );

    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await run(groundedConfig);
        return { response, fallbackNote: undefined as string | undefined };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!isRetryableTransportError(message)) {
          break;
        }
        if (attempt < 2) {
          await sleep(250 * attempt);
        }
      }
    }

    const fallbackConfig = { ...(groundedConfig || {}) };
    delete fallbackConfig.tools;

    try {
      const response = await run(fallbackConfig);
      return {
        response,
        fallbackNote: "Grounded web research was unavailable; result generated without Google Search grounding.",
      };
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      const lastMessage = lastError instanceof Error ? lastError.message : String(lastError || "");
      if (isGroundingToolError(lastMessage) || isRetryableTransportError(lastMessage) || isRetryableTransportError(fallbackMessage)) {
        throw new Error(`Grounded and fallback Gemini requests failed: ${lastMessage || fallbackMessage}`);
      }
      throw fallbackError;
    }
  }

  private buildPrompt(input: ResearchEnrichmentInput): string {
    const vendorValue = input.vendor?.trim() ? sanitizeInput(input.vendor) : "";
    const productValue = input.product?.trim() ? sanitizeInput(input.product) : "";
    const vendor = vendorValue || "Unknown";
    const product = productValue || (vendorValue ? vendorValue : "Unknown");
    const aliasList = Array.isArray(input.aliases)
      ? Array.from(new Set(input.aliases.map((alias) => sanitizeInput(alias)).filter(Boolean)))
      : [];
    const platformList = normalizePlatformList(Array.isArray(input.platforms) ? input.platforms : []);
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
    const platforms = platformTokens.length > 0 ? platformTokens.join(", ") : "UNKNOWN";
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
    const primaryFunction = sanitizeInput(input.description || "Not provided");
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
    const candidateLines = input.dataComponents.map((candidate) => {
      const description = candidate.description?.trim();
      const dataSource = candidate.dataSourceName?.trim();
      const mutableElements = Array.isArray(candidate.mutableElements)
        ? candidate.mutableElements.filter((value) => value && value.trim().length > 0)
        : [];
      const logSourceHints = Array.isArray(candidate.logSourceHints)
        ? candidate.logSourceHints.filter((hint) => hint.name && hint.name.trim().length > 0)
        : [];
      const logSourceText = logSourceHints.length > 0
        ? logSourceHints
          .slice(0, 6)
          .map((hint) => {
            const channel = typeof hint.channel === "string" ? hint.channel.trim() : "";
            return channel ? `${hint.name} (${channel})` : hint.name;
          })
          .join("; ")
        : "";
      const fieldText = mutableElements.length > 0
        ? mutableElements.slice(0, 8).join(", ")
        : "";

      return [
        `- ${candidate.id} | ${candidate.name}`,
        description ? `  Description: ${description}` : null,
        dataSource ? `  Data Source: ${dataSource}` : null,
        fieldText ? `  Known fields: ${fieldText}` : null,
        logSourceText ? `  Log source hints (MITRE log source table): ${logSourceText}` : null,
      ].filter(Boolean).join("\n");
    });

    return `
You are a detection engineer conducting systematic research to identify product-native
log sources (and their exact technical channels) that reliably cover MITRE ATT&CK
Data Components.

Your task bridges three knowledge domains:
  1. MITRE ATT&CK semantics (what is the DC describing?)
  2. Vendor product architecture (where does the product log this activity?)
  3. Technical channel identification (what is the exact log name/identifier/channel?)

The output will be used by detection engineers to write SIEM queries and establish baselines.

================================================================================
PRODUCT SPECIFICATION
================================================================================
Vendor: """${vendor}"""
Product Name: """${product}"""
Product Aliases: """${aliasList.length > 0 ? aliasList.join(", ") : "None provided"}"""
Product Search String: """${productSearch}"""
Deployment Model: """${deploymentModel}"""  # CLOUD_SAAS|SELF_MANAGED|AGENT_BASED|HYBRID
Target Platforms: """${platforms}"""  # WINDOWS|LINUX|CLOUD|NETWORK|WEB
Primary Function: """${primaryFunction}"""

================================================================================
RESEARCH METHODOLOGY (12-STEP PROCESS)
================================================================================

For EACH Data Component provided, follow this systematic 12-step process:

STEP 1: UNDERSTAND THE MITRE DATA COMPONENT
--------------------------------------------------------------------------------
ACTION:
  1a. Use the provided Data Component description (if present)
      - If missing, read the Data Component definition from MITRE
      URL: attack.mitre.org/datacomponents/[DC_ID]/
  1b. Understand what operational activity is being described
  1c. Note which MITRE techniques use this DC
  1d. Review MITRE detection guidance (if provided)

EXAMPLE:
  DC-0037 (Application Log Content):
  Definition: "Information recorded by an application in an application log"
  Techniques: T1021, T1071, T1078, T1059, T1082, T1083, etc.
  Detection guidance: "Monitor for unusual/suspicious application events"

GATE:
  PASS: Can you explain in 1-2 sentences what this DC means?
  FAIL: If unsure, return empty log_sources list for this DC


STEP 2: UNDERSTAND THE PRODUCT'S FUNCTION
--------------------------------------------------------------------------------
ACTION:
  2a. Research what this product DOES
      - Primary use case
      - How it processes data
      - What systems it interacts with
  2b. Identify primary data stores and outputs
      - Database tables
      - Log files
      - APIs/streaming outputs
      - Message queues
  2c. Draw a conceptual data flow diagram
      External Input -> Product Processing -> Logging Output

EXAMPLE (ServiceNow ECC Queue):
  Function: Bidirectional messaging between ServiceNow instance and external systems
  Primary stores: ecc_queue table, sys_audit table, mid_server table
  Data flow: Instance sends message -> MID Server processes -> Results flow back -> logged in ecc_queue
  Related tables: sys_trigger (scheduling), sys_user (who created), agent0.log (MID Server logs)

SOURCES:
  - Vendor product documentation
  - Architecture guides
  - API/integration guides
  - Schema references

GATE:
  PASS: Can you describe the data flow and primary stores?
  FAIL: If architecture is unclear, return empty log_sources list


STEP 3: IDENTIFY CANDIDATE LOG SOURCES
--------------------------------------------------------------------------------
ACTION:
  3a. Brainstorm ALL possible log sources (don't filter yet)
      - Native tables in databases
      - Built-in audit tables
      - Log files (not database)
      - API response streams
      - Message queues/event streams
      - Vendor-supported exports (syslog, CEF, JSON API)
  3b. List each candidate with brief description
  3c. Mark candidates as:
      - NATIVE: Part of product by default
      - EXPORT: Vendor-supported export mechanism
      - THIRD_PARTY: Not native (exclude)
  3d. Use the provided log source hints (if any) as starting points,
      but validate them against authoritative docs.
  3e. Treat MITRE log source hints as EXAMPLES/ARCHETYPES, not exact-name requirements.
      - Do NOT require lexical name equality with MITRE hints.
      - Accept vendor-specific equivalents when telemetry semantics and fields align.

EXAMPLE (ServiceNow ECC Queue + DC-0037):
  Candidates (NATIVE):
    - ecc_queue table
    - sys_audit table (audit trail)
    - sys_trigger table (scheduling)
    - sys_update_xml table (change tracking)
  Candidates (EXPORT):
    - REST API /api/now/table/ecc_queue
    - Syslog export (if configured)
  Exclude:
    - Splunk TA configuration (SIEM-specific, not product-native)
    - Sentinel connector (SIEM-specific, not product-native)

GATE:
  PASS: Have you identified at least 1 candidate native source?
  FAIL: If no candidates exist, return empty log_sources list


STEP 4: RESEARCH AUTHORITATIVE DOCUMENTATION FOR EACH CANDIDATE
--------------------------------------------------------------------------------
ACTION:
  4a. For each candidate source, search authoritative documentation:
      - Prefer vendor-owned docs for the product (docs.vendor.com, vendor.com/docs)
      - If the product logs to a platform-native dataset (e.g., Microsoft/AWS/GCP),
        platform-owner docs are acceptable for the log channel/fields
      - Third-party blogs/community writeups may be used as supporting evidence when
        official docs are incomplete, but mark this clearly in notes
      - Never rely on SIEM setup guides as primary proof of product-native telemetry
  4b. Search for:
      - Table/object definitions (schema)
      - Field reference documentation
      - API endpoint documentation
      - Log format specifications
      - Built-in export formats
  4c. Extract and verify:
      - Exact table/object names (case-sensitive)
      - All relevant fields
      - Data types
      - Constraints (max length, truncation, etc.)
  4d. Document source URL for each finding

SEARCH QUERIES:
  - ${productSearch} "[source_name]" table schema
  - ${productSearch} "[source_name]" field reference
  - ${productSearch} "[source_name]" documentation
  - ${productSearch} API "[source_name]"
  - ${productSearch} audit logging
  - ${productSearch} export syslog CEF

EXAMPLE (ServiceNow ECC Queue):
  Candidate: ecc_queue table
  Vendor docs found: OK https://docs.servicenow.com/bundle/zurich-servicenow-platform/page/product/mid-server/concept/ecc-queue-mid-server.html
  Fields documented: created, state, payload, topic, agent, agent_correlator, etc.

  Candidate: sys_audit table
  Vendor docs found: OK https://docs.servicenow.com/bundle/tokyo-platform-security/page/administer/security/task/t_EnableAuditingForATable.html
  Enablement: Requires explicit configuration (not default)

GATE:
  PASS: Can you cite authoritative documentation for each candidate?
  FAIL: If no authoritative documentation found, remove candidate from next steps


STEP 5: IDENTIFY FIELDS RELEVANT TO THE DATA COMPONENT
--------------------------------------------------------------------------------
ACTION:
  5a. For each authoritative-documented candidate source:
  5b. Ask: "Which fields in this source contain DC-relevant telemetry?"
  5c. Map abstract DC concept to concrete field names
  5d. Document:
      - Exact field name (as it appears in vendor docs)
      - Data type (timestamp, string, number, boolean, etc.)
      - Example value
      - Field constraints (max length, encoding, truncation risk)
  5e. IMPORTANT: You are responsible for mapping DCs based on field semantics.
      Explicit vendor statements mapping a DC are NOT required if the fields
      clearly satisfy the DC definition.

EXAMPLE (DC-0037 + ecc_queue table):
  Fields relevant to DC-0037 (Application Log Content):
    - created (timestamp): When message was created
    - state (string): Ready/Processing/Processed/Error (message lifecycle)
    - payload (text): Full XML message content
    - topic (string): Message type (discovery, SSH command, etc.)
    - agent (string): Which system processed it
    - error_string (text, optional): Error details if failed
    - agent_correlator (GUID): Links to originating workflow

GATE:
  PASS: Can you list 2+ fields from vendor docs that support this DC?
  FAIL: If fewer than 2 fields, mark as partial or remove candidate


STEP 6: DETERMINE AVAILABILITY (NATIVE VS. CONFIGURED VS. MISSING)
--------------------------------------------------------------------------------
ACTION:
  6a. For each log source candidate:
  6b. Answer: "When is this telemetry captured?"
  6c. Classify as ONE of:
      - NATIVE: Captured/logged by default, no user configuration needed
      - CONFIGURED: Requires explicit user action (enable audit, set flag, etc.)
      - PARTIAL: Some fields native, others conditional
      - MISSING: Product does not provide this telemetry

RESEARCH SOURCES:
  - Feature documentation ("Audit Logging" section)
  - Configuration guides ("Enable auditing" steps)
  - Installation guides (what's enabled by default?)
  - Release notes (features added/removed/deprecated?)

EXAMPLE (ServiceNow):
  ecc_queue.created: NATIVE (always captured)
  ecc_queue.state: NATIVE (always captured)
  ecc_queue.payload: NATIVE (always captured)
  sys_audit table: CONFIGURED (must enable per table)
  sys_audit.sys_user: CONFIGURED (only available if auditing enabled)

GATE:
  PASS: Clearly classified availability for each field
  FAIL: If availability cannot be determined, mark as uncertain


STEP 7: IDENTIFY LOG SOURCE CHANNELS (CONCRETE TECHNICAL IDENTIFIERS)
--------------------------------------------------------------------------------
ACTION:
  7a. For each candidate source, identify the EXACT technical channel identifier:

  7b. NEVER use generic labels. ALWAYS use technical identifiers:
      OK: "Security:4688" (Windows), "authpriv.*" (syslog), "SignInLogs" (Azure)
      NO: "Process Creation Logs", "Authentication Events", "User Activity"

  7c. Channel types by platform:

      WINDOWS EVENT LOGS:
        - Format: "[Channel]:[EventID]"
        - Example: "Security:4624" (successful logon), "System:1004" (service start)
        - Source: Windows Event Log reference docs
        - Multiple channels: Return as array ["Security:4624", "Security:4625"]

      LINUX SYSLOG:
        - Format: "[facility].[priority]" or "/path/to/logfile"
        - Example: "authpriv.*" (authentication), "daemon.info" (daemon messages)
        - File path: "/var/log/auth.log", "/var/log/audit/audit.log"
        - Source: syslog documentation, vendor logging guides
        - Multiple: Return as array ["authpriv.*", "/var/log/auth.log"]

      CLOUD PLATFORMS (AWS/Azure/GCP):
        - Format: "[Service]:[Dataset]" or "[Service]/[Log Type]"
        - AWS CloudTrail: "CloudTrail:GetSecurityAuditLog" or "CloudTrail/API"
        - Azure Entra ID: "SignInLogs", "AuditLogs", "RiskyUsers"
        - GCP: "cloudaudit.googleapis.com", "activity.googleapis.com"
        - Source: Cloud provider API/logging docs

      VENDOR-DEFINED STREAMS:
        - Format: "[Vendor Dataset Name]" or "[Log Type ID]"
        - Example: "ecc_queue" (ServiceNow), "UnifiedAuditLog" (Microsoft 365)
        - Source: Vendor documentation

      VENDOR-SUPPORTED EXPORTS:
        - Format: "REST_API:[endpoint path]" or "SYSLOG:[configured facility]"
        - Example: "REST_API:/api/now/table/ecc_queue", "SYSLOG:local0"
        - Source: Vendor export/integration docs

	  7d. Special case: NO TECHNICAL IDENTIFIER
	      - If vendor docs describe logging but don't define a channel/identifier
	      - Set channel to ["NULL"]
	      - Explain in notes: "Channel not technically defined; requires vendor clarification"
  7e. Equivalent-source rule:
      - If a vendor source is functionally equivalent to a MITRE hint, keep the vendor name/channel.
      - Do not rename vendor telemetry to MITRE labels.
      - Capture equivalence in notes (for example: "Vendor source X is equivalent to MITRE-style auth sign-in telemetry").

EXAMPLE (ServiceNow ECC Queue):
  Log source: ecc_queue table
    Channel: "ecc_queue" (native database table name)
    OR if exported via API: "REST_API:/api/now/table/ecc_queue"
    OR if exported via syslog: "SYSLOG:local0" (if configured)

  Log source: sys_audit (when enabled on ecc_queue)
    Channel: "sys_audit:ecc_queue" (table + audit trail)

GATE:
  PASS: Can you cite a concrete technical identifier from vendor docs?
  FAIL: If only generic labels found, set channel to ["NULL"] and explain


STEP 8: RESEARCH SIEM INTEGRATION PATHS (TO VERIFY QUERYABILITY)
--------------------------------------------------------------------------------
ACTION:
  8a. For each log source candidate:
  8b. Research: "How would a SIEM ingest this log source?"
  8c. Verify that the source can actually be queried/exported to SIEM:
      - Native database: Can SIEM connect via REST API, JDBC, or agent?
      - Log file: Can SIEM collect via agent, syslog, or file transport?
      - Streaming API: Can SIEM pull via API endpoint?
  8d. Identify limitations:
      - Field truncation? (max character limits)
      - Latency? (time to ingest)
      - Completeness? (all fields present or partial?)
  8e. Document SIEM-independent findings (don't design for specific SIEM)

EXAMPLE (ServiceNow ecc_queue):
  Ingestion path 1: REST API (via ServiceNow Add-on for Splunk/Sentinel)
  Ingestion path 2: Direct JDBC (via DBConnect/Synapse)
  Ingestion path 3: Syslog export (if configured in ServiceNow)
  Limitations: payload field can exceed 100 MB (SIEM storage impact)
  Completeness: all DC-relevant fields available

GATE:
  PASS: Can SIEM actually access this data? (At least one ingestion path viable)
  FAIL: If SIEM ingestion impossible, remove from final output


STEP 9: VALIDATE FIELD COMPLETENESS FOR THIS DATA COMPONENT
--------------------------------------------------------------------------------
ACTION:
  9a. Review fields identified in STEP 5
  9b. Assess: "Do these fields provide COMPLETE or PARTIAL telemetry for this DC?"
  9c. Classify as:
      - COMPLETE: All telemetry needed for detection is available
      - PARTIAL: Some telemetry available; correlation with other sources needed
      - INSUFFICIENT: Telemetry exists but doesn't support meaningful detection

EXAMPLE:
  DC-0037 (Application Log Content) + ecc_queue:
    - created (timestamp): OK complete (full timestamp)
    - state (processing state): OK complete (ready/processing/processed/error)
    - payload (message content): OK complete (full XML)
    Assessment: COMPLETE telemetry available

  DC-0064 (Command Execution) + ecc_queue:
    - name (command name): OK partial (intent, but truncated)
    - payload (command details): OK partial (XML, but requires parsing)
    - No execution results: NO missing (target system results not captured)
    Assessment: PARTIAL telemetry (need target system logs for full detection)

GATE:
  PASS: Telemetry is complete or partial but usable
  FAIL: If insufficient, either remove or note limitation clearly


STEP 10: IDENTIFY CORRELATION REQUIREMENTS
--------------------------------------------------------------------------------
ACTION:
  10a. Question: "Can I detect this DC using ONLY this log source?"
  10b. Assess as:
       - STANDALONE: Single source sufficient for detection
       - CORRELATION: Requires multiple sources for meaningful detection
       - EXTERNAL: Requires data completely external to this product
  10c. Document:
       - What can be detected with this source alone
       - What external sources are needed for full detection
       - How to join/correlate sources

EXAMPLE:
  DC-0037 (Application Logs) + ecc_queue:
    STANDALONE: Can detect message creation, state changes, queue depth anomalies
    CORRELATION: To confirm intent matches actual execution, need target system logs
    External needed: Linux/Windows audit logs from target systems

  DC-0002 (User Authentication) + sys_audit:
    STANDALONE: Can detect who created records (if auditing enabled)
    CORRELATION: To detect authentication attempts, need MID Server auth logs
    External needed: MID Server agent0.log, Windows Event ID 4624

GATE:
  PASS: Correlation requirements clearly mapped
  FAIL: If unclear, note as "requires further investigation"


STEP 11: ASSESS PRODUCT DEFAULTS AND CONFIGURATION REQUIREMENTS
--------------------------------------------------------------------------------
ACTION:
  11a. For each log source:
  11b. Question: "Is this logging enabled by default or requires configuration?"
  11c. Research:
       - Installation guides (what's enabled after fresh install?)
       - Configuration documentation (what steps to enable?)
       - Admin guides (best practices)
       - Release notes (defaults changed?)
  11d. Document enablement status:
       - ENABLED_BY_DEFAULT: No user action needed
       - REQUIRES_CONFIG: User must explicitly enable (document steps)
       - CONDITIONAL: Enabled for some deployments/configurations
       - VERSION_DEPENDENT: Varies by product version

EXAMPLE (ServiceNow):
  ecc_queue.created: ENABLED_BY_DEFAULT (always captured)
  sys_audit on ecc_queue: REQUIRES_CONFIG (must enable per table)
    Steps: System Definition -> Dictionary -> [table] -> Check "Audit" -> Save
    Impact: 5-10% table growth

GATE:
  PASS: Enablement status clearly determined or explicitly noted as "not documented"
  FAIL: If unclear after research, note in "notes" field


STEP 12: FINAL VALIDATION AND CONFIDENCE ASSESSMENT
--------------------------------------------------------------------------------
ACTION:
  12a. For each log source identified:
  12b. Validate against criteria:
       - Documentation ties the log source to the product or its platform/module
       - Log source name verified from official docs
       - Channel identifier is concrete/technical (not generic label)
       - At least 2 fields support the DC
       - SIEM ingestion path exists
       - Source is product-native (not SIEM-specific)
  12c. Confidence assessment:
       - HIGH: All criteria met, multiple independent sources confirm
       - MEDIUM: Most criteria met, single authoritative source confirms
       - LOW: Some criteria uncertain, requires further investigation
  12d. If any criteria not met:
       - EITHER remove from output
       - OR mark as uncertain and return empty log_sources

EXAMPLE VALIDATION:
  Log source: ecc_queue
  OK Documentation describes ECC Queue as a core ServiceNow log source
  OK Log source name verified: Table name "ecc_queue" in ServiceNow docs
  OK Channel is technical: "ecc_queue" (not "Integration Messages")
  OK Fields support DC-0037: created, state, payload, topic, agent
  OK SIEM can ingest: REST API, JDBC, syslog export all viable
  OK Product-native: Part of core ServiceNow platform
  CONFIDENCE: HIGH

GATE:
  PASS: Confidence HIGH or MEDIUM: Include in output
  FAIL: Confidence LOW or unmet criteria: Return empty log_sources list


================================================================================
OUTPUT REQUIREMENTS
================================================================================

PRINCIPLE: Include only log sources that meet HIGH or MEDIUM confidence criteria.
           If uncertain, return empty log_sources array (do not guess).

FOR EACH DATA COMPONENT, return one results[] entry with:

  dc_id: (string) EXACT DC ID as provided (e.g., "DC0001")
  dc_name: (string) EXACT DC name as provided
  log_sources: (array of objects) Each object contains:
    {
      "name": (string) Log source name (exact as documented)
        EXAMPLES:
          - "ecc_queue" (database table)
          - "sys_audit" (audit table)
          - "Security Event Log" (Windows)
          - "auth.log" (Linux file)
          - "/api/now/table/[table_name]" (REST API endpoint)
          - "SignInLogs" (Azure dataset)

	      "channel": (array of strings) Concrete technical identifier(s)
        EXAMPLES:
          - ["ecc_queue"] (database table name)
          - ["rest_api:/api/now/table/ecc_queue"] (API endpoint)
          - ["syslog:local0"] (syslog facility)
          - ["Security:4624", "Security:4625"] (multiple Windows Event IDs)
          - ["authpriv.*", "/var/log/auth.log"] (syslog + file path)
	          - ["SignInLogs", "AuditLogs"] (multiple Azure datasets)
	          - ["NULL"] (only if channel not technically defined in docs)

	      "required_fields": (array of strings, optional but recommended)
	        - Fields from the product log source that map to the DC's mutable/expected fields
	        - This is a fidelity/maturity signal, NOT a pass/fail gate

	      "missing_fields": (array of strings, optional)
	        - Expected/mutable fields that are not present or not documented for this source
	        - Use to indicate partial maturity/fidelity, not to reject otherwise valid evidence

	      "evidence": (string, optional)
	        - Short field-level mapping justification (1-2 sentences)
	        - Example: "payload, state, and created map to command content + execution status + timestamp."

      "notes": (string) Mapping explanation + enablement/configuration note (if applicable)
        TEMPLATE:
          "[Product] [log source] provides DC-relevant telemetry via [field names].
          [Enablement note if not default: 'Requires explicit configuration to enable.']
          [Limitations if relevant: 'Field [X] truncated at [N] characters.']"

      "source_url": (string) URL that substantiates the log source name and/or channel
                             (prefer authoritative vendor/platform docs; community sources allowed as fallback)
        EXAMPLES:
          - https://docs.servicenow.com/...
          - https://docs.microsoft.com/en-us/...
          - https://docs.aws.amazon.com/...
          - https://cloud.google.com/logging/...

        NOT ACCEPTABLE AS PRIMARY EVIDENCE:
          - SIEM setup guides that do not prove product-native telemetry
          - Unrelated marketing content with no technical detail
          - Archived pages when newer conflicting documentation exists
        ALLOWED AS SUPPORTING EVIDENCE:
          - Reputable third-party community/blog content (mark in notes as community-sourced)
          - GitHub repositories from official vendor organizations
    }

  If log_sources is empty: Return ONLY {"dc_id": "...", "dc_name": "...", "log_sources": []}
  Do NOT include "notes" or "source_url" fields if log_sources is empty.

OVERALL OUTPUT STRUCTURE:
{
  "results": [
    {
      "dc_id": "DC0001",
      "dc_name": "Data Component Name",
      "log_sources": [
	        {
	          "name": "log source name",
	          "channel": ["channel1", "channel2"],
	          "required_fields": ["field_a", "field_b"],
	          "missing_fields": ["field_c"],
	          "evidence": "Short field-level mapping rationale.",
	          "notes": "Mapping rationale and enablement/limitation notes.",
	          "source_url": "https://vendor-or-platform-domain.com/docs/..."
	        }
      ]
    },
    {
      "dc_id": "DC0002",
      "dc_name": "Another Data Component",
      "log_sources": []
    }
  ],
  "note": "Optional summary of research methodology, caveats, or recommendations."
}

================================================================================
QUALITY GATES (BEFORE RETURNING RESULTS)
================================================================================

Validation checklist - answer each question before returning output:

[ ] For EVERY Data Component in input, return exactly ONE results[] entry
    (using exact dc_id and dc_name provided)

[ ] For EVERY log_sources entry:
    [ ] "name" matches vendor documentation (case-sensitive, exact spelling)
    [ ] Exact name match to MITRE hint is NOT required; semantic equivalence is acceptable
    [ ] "channel" contains ONLY concrete technical identifiers (not generic labels)
    [ ] "channel" is NEVER ["NULL"] unless explicitly documented in notes
    [ ] "notes" includes mapping rationale + enablement status (if not default)
	    [ ] "source_url" points to authoritative vendor/platform domain
	    [ ] "source_url" actually substantiates the log source name and channel
	    [ ] Docs clearly tie the log source to the product or its platform/module
	    [ ] required_fields/missing_fields (if provided) are used ONLY as fidelity signal
	        and do NOT by themselves disqualify an otherwise valid log source

[ ] For empty log_sources (when returning []):
    [ ] Document in "note" field why this DC is not covered
    [ ] Do NOT exclude due to laziness; search thoroughly

[ ] Do NOT:
    [ ] Include SIEM-specific configuration (Splunk inputs, Sentinel connectors)
    [ ] Include third-party integrations (unless vendor-supported/documented)
    [ ] Guess at channel names (if uncertain, set to ["NULL"] + document)
    [ ] Mix product names or infer vendor support from similar products

[ ] For sources listed as CONFIGURED (not default):
    [ ] Document configuration requirement in "notes"
    [ ] Include source_url pointing to configuration guide (if available)

[ ] Confidence in output:
    [ ] HIGH confidence: Log source + fields documented, strong alignment to DC (explicit DC mention not required)
    [ ] MEDIUM confidence: Log source documented, reasonable inference to DC from fields
    [ ] If lower: leave log_sources empty instead of guessing

================================================================================
RESEARCH STRATEGY
================================================================================

PHASE 1: QUICK DISCOVERY (30 minutes per DC)
--------------------------------------------------------------------------------
  1. Search authoritative docs for ${productSearch} "[data component name]"
  2. Search for ${productSearch} logging + "[DC concept]" (e.g., "authentication logging")
  3. Search for ${productSearch} audit
  4. Scan API/integration documentation for log output types

PHASE 2: DEEP RESEARCH (if Phase 1 inconclusive, 30-60 minutes per DC)
--------------------------------------------------------------------------------
  1. Read full product documentation (logging section)
  2. Search for table/field schemas if product uses database
  3. Look for API endpoint documentation
  4. Check configuration guides for enablement options
  5. Review release notes for features/changes

PHASE 3: VALIDATION (15 minutes per log source)
--------------------------------------------------------------------------------
  1. Verify authoritative vendor/platform domain in source_url
  2. Confirm log source belongs to the product or platform/module
  3. Cross-check field names against schema docs
  4. Verify channel identifier is documented (not invented)

ESCALATION: If after Phase 2 you are still uncertain
--------------------------------------------------------------------------------
  Return empty log_sources for that DC (do not guess).
  Document in "note": "DC [ID] could not be reliably mapped; further vendor clarification needed."

================================================================================
IMPORTANT REMINDERS
================================================================================

1. PRODUCT-NATIVE ONLY
   Include only what the product itself provides (not SIEM-specific configuration).
   OK: "ecc_queue" database table (product-native)
   NO: "Splunk TA ServiceNow inputs.conf" (SIEM-specific)

2. SOURCE HIERARCHY
   Prefer official vendor/platform-owner documentation as source of truth.
   OK: docs.vendor.com, vendor.com/docs, docs.microsoft.com, docs.aws.amazon.com
   Community sources are acceptable when official docs are incomplete, but
   must be marked as community-sourced in notes and should not be the only weak claim.
   NO: SIEM setup guides as primary proof, unrelated marketing pages

3. CONCRETE CHANNELS ONLY
   Always use technical identifiers; never generic labels.
   OK: "Security:4624", "authpriv.*", "SignInLogs", "ecc_queue"
   NO: "Authentication Events", "User Activity", "System Logs"

4. CONFIDENCE OVER COVERAGE
   Include only high/medium confidence mappings.
   Inference is allowed when fields clearly satisfy DC semantics.
   If uncertain: return empty log_sources (do not guess).

5. ENABLEMENT TRANSPARENCY
   If logging is not enabled by default:
   - Document in "notes" field
   - Include configuration steps (if available in vendor docs)
   - Link to configuration guide in "source_url"

================================================================================
DATA COMPONENTS TO MAP
================================================================================
${candidateLines.join("\n")}

================================================================================
INSTRUCTIONS
================================================================================

1. Work through EACH Data Component in order (Step 1-12 for each)
2. For each DC, search authoritative documentation systematically
3. Identify candidate log sources (Step 3-4)
4. Map to concrete channel identifiers (Step 7)
5. Validate against quality gates (Step 12)
6. Return JSON only (no markdown, no commentary)
7. Include EVERY Data Component in results[] (even if log_sources is empty)
8. For empty mappings, document reason in top-level "note" field

================================================================================
OUTPUT
================================================================================

Return ONLY valid JSON matching the shape specified above.
No markdown, no code fences, no explanatory text before or after JSON.
`.trim();
  }

  private buildPlatformPrompt(input: PlatformCheckInput): string {
    const vendorValue = input.vendor?.trim() ? sanitizeInput(input.vendor) : "";
    const productValue = input.product?.trim() ? sanitizeInput(input.product) : "";
    const aliasList = Array.isArray(input.aliases)
      ? Array.from(new Set(input.aliases.map((alias) => sanitizeInput(alias)).filter(Boolean)))
      : [];
    const vendor = vendorValue || "Unknown";
    const product = productValue || vendorValue || "Unknown";
    const productIdentifier = vendorValue && productValue
      ? `${vendorValue} ${productValue}`
      : (productValue || vendorValue || "Unknown");
    const searchTokens = Array.from(new Set([productIdentifier, ...aliasList].filter(Boolean)));
    const productSearch = searchTokens.map((token) => `"${token}"`).join(" OR ") || `"${productIdentifier}"`;
    const description = sanitizeInput(input.description || "No description provided.");
    const selectedPlatforms = input.platforms.length > 0 ? input.platforms.join(", ") : "None selected";
    const normalizedPlatforms = normalizePlatformList(input.platforms).map((platform) => platform.toLowerCase());
    const hasSelectedPlatforms = input.platforms.length > 0;
    
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
    const mode = hasSelectedPlatforms ? "VALIDATE_SELECTED" : "SUGGEST_AND_VALIDATE";
    const modeSpecificConstraints = hasSelectedPlatforms
      ? `
MODE-SPECIFIC CONSTRAINTS (VALIDATE_SELECTED):
- The user selected: [${selectedPlatforms}]
- Validate ONLY these selected platforms in validation[].
- Return one validation entry for EACH selected platform exactly once.
- Do NOT add extra platforms to validation[].
- If you find additional valid platforms outside selected scope, place them ONLY in alternative_platforms_found[].
- Never return empty validation[] when selected platforms are provided.
`
      : `
MODE-SPECIFIC CONSTRAINTS (SUGGEST_AND_VALIDATE):
- No platforms are pre-selected by the user.
- Determine which allowlisted platforms are supported by evidence.
- Include each supported platform in suggested_platforms[].
- Include validation[] entries for supported platforms in suggested_platforms[].
- Keep unsupported/no-evidence platforms out of suggested_platforms[].
- In this mode, validation[] must contain only supported platforms (is_supported=true).
`;

    return `
You are a detection engineer reviewing vendor documentation to determine and validate MITRE ATT&CK platform mappings for a security product.

MODE: """${mode}"""
Product: """${vendor} ${product}"""
Product Identifier: """${productIdentifier}"""
Product Aliases: """${aliasList.length > 0 ? aliasList.join(", ") : "None provided"}"""
Product Search String: """${productSearch}"""
Description: """${description}"""
User-selected platforms: """${selectedPlatforms}"""
Allowlist: """${ALLOWED_PLATFORMS.join(", ")}"""${focusText}

TASK:
- Research product/platform documentation and determine supported ATT&CK platforms.
- Use Google Search grounding when available.
- If grounding is unavailable, continue with best-effort research and state that fallback clearly in "note".
- Use only allowlisted platform labels.
- Produce evidence-backed results only.

${modeSpecificConstraints}

RELIABILITY REQUIREMENTS:
- Identity disambiguation first:
  1. Confirm pages reference this exact product identifier or a listed alias
  2. Exclude similarly named products, partner integrations, or unrelated modules
- Source quality priority (highest to lowest):
  1. Official product documentation and admin guides
  2. Official API/schema/logging reference docs
  3. Official vendor knowledge base / release notes
  4. Platform-owner docs (AWS/Azure/GCP/Microsoft/Google) when telemetry is platform-native
- Third-party blogs, analyst writeups, community research, and marketing pages may be used as evidence.
  If official docs are missing, you may still claim support when at least 2 independent, recent,
  reputable community sources agree on concrete telemetry/platform behavior.
  In that case, explicitly state in "reasoning" and/or "note" that support is community-sourced.
- Freshness: prefer recent/current docs; if evidence is old or version-limited, mention in "note".
- IaaS decision rule (strict):
  - Mark "IaaS" supported ONLY when evidence shows customer-deployed or customer-managed deployment in the customer's cloud account/subscription/project.
  - "Runs on AWS/Azure/GCP", vendor-hosted architecture, or cloud API integration alone is NOT enough to claim "IaaS".
  - If evidence indicates vendor-hosted SaaS on cloud infrastructure, classify as "SaaS" (or cloud-provider specific platforms if explicitly documented), not "IaaS".
  - Return verdicts using allowlisted canonical labels only.
- Minimum research breadth:
  - At least 3 targeted searches for each platform before marking unsupported/no evidence

EVIDENCE CONTRACT:
- supported entries must include reasoning + evidence + source_url when available
- unsupported entries (used in VALIDATE_SELECTED mode) must include reasoning + evidence describing what was checked and what was missing
- do not fabricate links; omit source_url only if no credible URL exists after research

Return JSON only with these top-level keys (do not add top-level fields).
"source_url" is optional per entry:
{
  "suggested_platforms": ["Windows", "Linux", ...],
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
    const { client, modelName, provider } = clientInfo;

    const aliasList = Array.isArray(input.aliases)
      ? input.aliases.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const baseName = [input.vendor, input.product, ...aliasList].filter(Boolean).join(" ").trim();
    if (!baseName) {
      return {
        model: this.modelName,
        provider,
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
    const { response, fallbackNote } = await this.generateWithGroundingFallback(client, modelName, prompt);
    const text = await readResponseText(response);
    const payload = extractJsonPayload(text) as any;
    const sourcesMap = extractSources(response);

    const allowedUrls = new Set(
      Array.from(sourcesMap.keys()).map((url) => url.toLowerCase())
    );

    const normalizeDcKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const candidateIds = new Set(
      input.dataComponents.map((dc) => dc.id.toLowerCase())
    );
    const candidateIdByCompactKey = new Map(
      input.dataComponents.map((dc) => [normalizeDcKey(dc.id), dc.id])
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
        const compactId = dcId ? normalizeDcKey(dcId) : "";
        const mappedByCompactId = compactId ? candidateIdByCompactKey.get(compactId) : undefined;
        if (mappedByCompactId) {
          dcId = mappedByCompactId;
        }
      }
      if (!candidateIds.has(dcId.toLowerCase())) {
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
            const sourceUrlRaw = typeof source?.source_url === "string"
              ? source.source_url
              : source?.sourceUrl;
            const { sourceUrl, sourceUrlVerified } = resolveSourceReference(
              sourceUrlRaw,
              allowedUrls,
              sourcesMap
            );
            if (!name) return null;
            const requiredFieldsRaw = Array.isArray(source?.required_fields)
              ? source.required_fields
              : Array.isArray(source?.requiredFields) ? source.requiredFields : [];
            const missingFieldsRaw = Array.isArray(source?.missing_fields)
              ? source.missing_fields
              : Array.isArray(source?.missingFields) ? source.missingFields : [];
            const requiredFields = requiredFieldsRaw
              .map((field: unknown) => (typeof field === "string" ? field.trim() : ""))
              .filter((field: string) => field.length > 0);
            const missingFields = missingFieldsRaw
              .map((field: unknown) => (typeof field === "string" ? field.trim() : ""))
              .filter((field: string) => field.length > 0);
            const normalizedNotes = notes || "";
            const notesWithCitation = sourceUrl && sourceUrlVerified === false
              ? `${normalizedNotes}${normalizedNotes ? " " : ""}Source URL was not grounding-verified; review evidence manually.`
              : normalizedNotes;
            return {
              name,
              channel,
              requiredFields: requiredFields.length > 0 ? requiredFields : undefined,
              missingFields: missingFields.length > 0 ? missingFields : undefined,
              evidence: typeof source?.evidence === "string" ? source.evidence.trim() : undefined,
              notes: notesWithCitation || undefined,
              sourceUrl,
              verifiedByAi: sourceUrl ? sourceUrlVerified : undefined,
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
          const sourceUrlRaw = typeof entry?.source_url === "string"
            ? entry.source_url
            : typeof entry?.sourceUrl === "string" ? entry.sourceUrl : "";
          const { sourceUrl, sourceUrlVerified } = resolveSourceReference(
            sourceUrlRaw,
            allowedUrls,
            sourcesMap
          );
          const rawReason = typeof entry?.reason === "string" ? entry.reason.trim() : "";
          const reason = sourceUrl && sourceUrlVerified === false
            ? `${rawReason}${rawReason ? " " : ""}Source URL was not grounding-verified; review evidence manually.`
            : (rawReason || undefined);
          return {
            platform,
            reason,
            evidence: typeof entry?.evidence === "string" ? entry.evidence.trim() : undefined,
            sourceUrl,
            sourceUrlVerified,
          } as ResearchPlatformSuggestion;
        })
        .filter((entry): entry is ResearchPlatformSuggestion => Boolean(entry))
      : [];

    return {
      model: this.modelName,
      provider,
      results,
      platformSuggestions,
      sources,
      note: [payload.note, fallbackNote, (sources.length === 0 ? "No grounded sources were returned for this query." : undefined)]
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join(" ")
        || undefined,
    };
  }

  async suggestPlatforms(input: PlatformCheckInput): Promise<PlatformCheckResult | null> {
    const clientInfo = await this.getClient();
    if (!clientInfo || !this.modelName) return null;
    const { client, modelName, provider } = clientInfo;

    const aliasList = Array.isArray(input.aliases)
      ? input.aliases.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const baseName = [input.vendor, input.product, ...aliasList].filter(Boolean).join(" ").trim();
    if (!baseName) {
      return {
        model: this.modelName,
        provider,
        validation: [],
        alternativePlatformsFound: [],
        sources: [],
        note: "Vendor or product name is required for platform research.",
      };
    }

    const prompt = this.buildPlatformPrompt(input);
    const { response, fallbackNote } = await this.generateWithGroundingFallback(client, modelName, prompt);
    const text = await readResponseText(response);
    const payload = extractPlatformCheckPayload(text) as any;
    const sourcesMap = extractSources(response);

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
          const sourceUrlRaw = typeof entry?.source_url === "string"
            ? entry.source_url
            : typeof entry?.sourceUrl === "string" ? entry.sourceUrl : "";
          const { sourceUrl, sourceUrlVerified } = resolveSourceReference(
            sourceUrlRaw,
            allowedUrls,
            sourcesMap
          );
          const rawReasoning = typeof entry?.reasoning === "string"
            ? entry.reasoning.trim()
            : typeof entry?.reason === "string" ? entry.reason.trim() : "";
          const rawEvidence = typeof entry?.evidence === "string" ? entry.evidence.trim() : "";
          const iaasCandidate = platform.toLowerCase() === "iaas" && isSupported === true;
          if (iaasCandidate) {
            const combinedEvidence = `${rawReasoning} ${rawEvidence}`.trim();
            const hasPositiveSignal = containsAny(combinedEvidence, IAAS_POSITIVE_SIGNALS);
            const hasNegativeSignal = containsAny(combinedEvidence, IAAS_NEGATIVE_SIGNALS);
            if (!hasPositiveSignal || hasNegativeSignal) {
              isSupported = false;
            }
          }
          const unsupportedByIaasRule = platform.toLowerCase() === "iaas" && isSupported === false && iaasCandidate;
          const baseReasoning = unsupportedByIaasRule
            ? `${rawReasoning}${rawReasoning ? " " : ""}Downgraded by policy: IaaS requires explicit customer-managed deployment evidence; vendor-hosted or provider-name-only evidence is insufficient.`.trim()
            : rawReasoning;
          const reasoning = sourceUrl && sourceUrlVerified === false
            ? `${baseReasoning}${baseReasoning ? " " : ""}Source URL was not grounding-verified; review evidence manually.`
            : (baseReasoning || undefined);
          return {
            platform,
            isSupported,
            reasoning,
            evidence: rawEvidence || undefined,
            sourceUrl,
            sourceUrlVerified,
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
          const sourceUrlRaw = typeof entry?.source_url === "string"
            ? entry.source_url
            : typeof entry?.sourceUrl === "string" ? entry.sourceUrl : "";
          const { sourceUrl, sourceUrlVerified } = resolveSourceReference(
            sourceUrlRaw,
            allowedUrls,
            sourcesMap
          );
          const rawReason = typeof entry?.reason === "string" ? entry.reason.trim() : "";
          const reason = sourceUrl && sourceUrlVerified === false
            ? `${rawReason}${rawReason ? " " : ""}Source URL was not grounding-verified; review evidence manually.`
            : (rawReason || undefined);
          return {
            platform,
            reason,
            evidence: typeof entry?.evidence === "string" ? entry.evidence.trim() : undefined,
            sourceUrl,
            sourceUrlVerified,
          } as PlatformAlternativeResult;
        })
        .filter((entry): entry is PlatformAlternativeResult => Boolean(entry))
      : [];

    const sources = Array.from(sourcesMap.values());
    
    // Suggested platforms are derived from evidence-backed validation entries.
    // This prevents auto-selection from unsupported or unverified suggestions.
    const suggestedPlatforms = Array.from(new Set(
      validation
        .filter((entry) => (
          entry.isSupported
          && typeof entry.reasoning === "string"
          && entry.reasoning.trim().length > 0
          && typeof entry.evidence === "string"
          && entry.evidence.trim().length > 0
        ))
        .map((entry) => entry.platform)
    ));
    
    return {
      model: this.modelName,
      provider,
      suggestedPlatforms,
      validation,
      alternativePlatformsFound,
      sources,
      note: [payload.note, fallbackNote, (sources.length === 0 ? "No grounded sources were returned for this query." : undefined)]
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join(" ")
        || undefined,
    };
  }
}

export const geminiResearchService = new GeminiResearchService();
