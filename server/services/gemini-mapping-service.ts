import { GoogleGenAI } from "@google/genai";
import { settingsService } from "./settings-service";
import { normalizePlatformList } from "../../shared/platforms";
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

const DecisionSchema = z.object({
  id: z.string(),
  selected: z.boolean().or(z.string().transform(v => v === 'true')).optional().default(false),
  reason: z.string().optional(),
  evidence: z.string().optional(),
  source_url: z.string().optional().or(z.literal("")).transform(v => v || undefined),
});

const ResponseSchema = z.object({
  decisions: z.array(DecisionSchema).optional().default([]),
  selected_ids: z.array(z.string()).optional().default([]),
  notes: z.string().optional(),
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

const extractJsonPayload = (text: string) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const jsonString = text.slice(start, end + 1).trim();
    try {
      const raw = JSON.parse(jsonString);
      return ResponseSchema.parse(raw);
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
  entry: z.infer<typeof DecisionSchema>,
  candidateMap: Map<string, string>,
  allowedUrls: Set<string>,
  sourcesMap: Map<string, { title?: string; url: string }>
): GeminiMappingDecision | null => {
  const idRaw = entry.id;
  const id = idRaw.trim();
  const canonicalId = id ? candidateMap.get(id.toLowerCase()) : undefined;
  if (!canonicalId) return null;
  const selected = entry.selected;
  const reason = entry.reason?.trim();
  const evidence = entry.evidence?.trim();
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
    const vendor = sanitizeInput(input.vendor || "Unknown");
    const product = sanitizeInput(input.product || "Unknown");
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

    return `
You are mapping product telemetry to MITRE ATT&CK Data Components.

Product: """${vendor} ${product}"""
Aliases: """${aliasList.length > 0 ? aliasList.join(", ") : "None provided"}"""
Platforms: """${platforms}"""

Select the Data Component IDs that this product or service likely generates logs for.
Only choose IDs from the candidate list.
Return JSON only in this shape:
{
  "decisions": [
    { "id": "DC0001", "selected": true, "reason": "Short justification", "evidence": "Quote or paraphrase", "source_url": "https://..." },
    { "id": "DC0002", "selected": false }
  ],
  "notes": "optional short notes"
}
Rules:
- Provide a decision entry for EVERY candidate ID listed below (include each ID exactly once).
- If you are unsure if a product provides specific telemetry, set "selected": false.
- Prefer higher-confidence matches over exhaustive coverage.
- For selected entries, include a grounded reason, evidence, and a source_url from the search results.
Work through each data source group in order and evaluate every ID before moving to the next group.
Use Google Search grounding to confirm vendor documentation. Only select IDs if evidence indicates the product generates logs for that data component.

Candidate groups (by data source):
${groupSummaries.join("\n")}

Candidates:
${candidateLines.join("\n")}
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
          config: {
            tools: [{ googleSearch: {} }],
          } as any,
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
        config: {
          tools: [{ googleSearch: {} }],
        } as any,
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
