import { GoogleGenAI } from "@google/genai";
import { settingsService } from "./settings-service";
import { buildGroundedConfig } from "./gemini-config";
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
    const candidateLines = input.dataComponents.map((candidate) => (
      `- ${candidate.id} | ${candidate.name}`
    ));

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
  1a. Read the Data Component definition from MITRE
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


STEP 4: RESEARCH VENDOR DOCUMENTATION FOR EACH CANDIDATE
--------------------------------------------------------------------------------
ACTION:
  4a. For each candidate source, search vendor-owned documentation:
      - Vendor domain: registrable domain must contain vendor name before TLD
        OK: docs.vendor.com, vendor.com/docs, vendor.io
        NO: product-docs.thirdparty.com, github.com/vendor (not owned)
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
  PASS: Can you cite vendor documentation for each candidate?
  FAIL: If no vendor documentation found, remove candidate from next steps


STEP 5: IDENTIFY FIELDS RELEVANT TO THE DATA COMPONENT
--------------------------------------------------------------------------------
ACTION:
  5a. For each vendor-documented candidate source:
  5b. Ask: "Which fields in this source contain DC-relevant telemetry?"
  5c. Map abstract DC concept to concrete field names
  5d. Document:
      - Exact field name (as it appears in vendor docs)
      - Data type (timestamp, string, number, boolean, etc.)
      - Example value
      - Field constraints (max length, encoding, truncation risk)

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
       - Vendor documentation explicitly mentions this product name (not inferred)
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
  OK Vendor docs explicitly name this product: ServiceNow ECC Queue
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

      "notes": (string) Mapping explanation + enablement/configuration note (if applicable)
        TEMPLATE:
          "[Product] [log source] provides DC-relevant telemetry via [field names].
          [Enablement note if not default: 'Requires explicit configuration to enable.']
          [Limitations if relevant: 'Field [X] truncated at [N] characters.']"

      "source_url": (string) URL to vendor-owned documentation that substantiates
                             the log source name and/or channel
        EXAMPLES:
          - https://docs.servicenow.com/...
          - https://docs.microsoft.com/en-us/...
          - https://docs.aws.amazon.com/...
          - https://cloud.google.com/logging/...

        NOT ACCEPTABLE:
          - Third-party blogs or tutorials
          - GitHub repositories (unless official vendor org)
          - Archived pages or cached versions
          - Pages that describe SIEM setup (not product native)
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
          "notes": "Mapping rationale and enablement/limitation notes.",
          "source_url": "https://vendor-owned-domain.com/docs/..."
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
    [ ] "channel" contains ONLY concrete technical identifiers (not generic labels)
    [ ] "channel" is NEVER ["NULL"] unless explicitly documented in notes
    [ ] "notes" includes mapping rationale + enablement status (if not default)
    [ ] "source_url" points to vendor-owned domain
    [ ] "source_url" actually substantiates the log source name and channel
    [ ] Vendor docs explicitly mention this product (not inferred from suite/parent)

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
    [ ] HIGH confidence: Vendor docs explicitly name the product, channel is documented, multiple fields support DC
    [ ] MEDIUM confidence: Vendor docs support, some inference about channel, clear field mappings
    [ ] If lower: leave log_sources empty instead of guessing

================================================================================
RESEARCH STRATEGY
================================================================================

PHASE 1: QUICK DISCOVERY (30 minutes per DC)
--------------------------------------------------------------------------------
  1. Search vendor-owned docs for ${productSearch} "[data component name]"
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
  1. Verify vendor-owned domain in source_url
  2. Confirm product name explicitly mentioned (not inferred)
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

2. VENDOR-OWNED SOURCES ONLY
   Use official vendor documentation as source of truth.
   OK: docs.vendor.com, vendor.io, vendor.com/docs
   NO: blog.vendor.com (marketing), github.com/vendor (repo, not docs)

3. CONCRETE CHANNELS ONLY
   Always use technical identifiers; never generic labels.
   OK: "Security:4624", "authpriv.*", "SignInLogs", "ecc_queue"
   NO: "Authentication Events", "User Activity", "System Logs"

4. CONFIDENCE OVER COVERAGE
   Include only high/medium confidence mappings.
   If uncertain: return empty log_sources (do not guess).

   Better to say: "We don't have reliable data on this DC"
   Than to say: "We map it, but we're not sure"

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
2. For each DC, search vendor-owned documentation systematically
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
      config: await buildGroundedConfig() as any,
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
            const isVerified = normalizedUrl.length > 0 && allowedUrls.has(normalizedUrl);
            if (!name) return null;
            const canonicalUrl = sourceUrl
              ? sourcesMap.get(normalizeUrl(sourceUrl))?.url || normalizeUrl(sourceUrl)
              : undefined;
            return {
              name,
              channel,
              notes,
              sourceUrl: canonicalUrl,
              verifiedByAi: sourceUrl ? isVerified : undefined,
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
      config: await buildGroundedConfig() as any,
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
