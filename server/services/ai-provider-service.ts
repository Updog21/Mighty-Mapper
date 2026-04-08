import { settingsService } from "./settings-service";

export type AiProvider = "gemini" | "openai";

export interface AiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface AiGeneratedResponse {
  text: string;
  sources: Array<{ title?: string; url: string }>;
  usageMetadata: AiUsageMetadata;
  fallbackNote?: string;
  raw?: unknown;
}

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const readNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeProvider = (value?: string | null): AiProvider => (
  value?.trim().toLowerCase() === "openai" ? "openai" : "gemini"
);

const extractOpenAiText = (payload: any): string => {
  if (typeof payload?.output_text === "string") {
    return payload.output_text;
  }

  const textFragments: string[] = [];
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  outputs.forEach((item: any) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    content.forEach((part: any) => {
      if (typeof part?.text === "string") {
        textFragments.push(part.text);
      }
      if (typeof part?.content === "string") {
        textFragments.push(part.content);
      }
    });
  });

  return textFragments.join("\n").trim();
};

const extractOpenAiSources = (payload: any): Array<{ title?: string; url: string }> => {
  const sourceMap = new Map<string, { title?: string; url: string }>();
  const add = (url?: unknown, title?: unknown) => {
    if (typeof url !== "string" || !url.trim()) return;
    const normalized = url.trim().replace(/#.*$/, "").replace(/\/$/, "");
    if (!normalized || sourceMap.has(normalized)) return;
    sourceMap.set(normalized, {
      url: normalized,
      title: typeof title === "string" && title.trim() ? title.trim() : undefined,
    });
  };

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const record = value as Record<string, unknown>;
    add(record.url || record.uri, record.title);
    if (Array.isArray(record.annotations)) {
      record.annotations.forEach((annotation) => {
        if (!annotation || typeof annotation !== "object") return;
        const ann = annotation as Record<string, unknown>;
        add(ann.url || ann.uri, ann.title);
      });
    }
    Object.values(record).forEach(visit);
  };

  visit(payload?.output);
  return Array.from(sourceMap.values());
};

export const toGeminiCompatibleResponse = (result: AiGeneratedResponse) => ({
  text: result.text,
  usageMetadata: result.usageMetadata,
  response: {
    usageMetadata: result.usageMetadata,
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: result.sources.map((source) => ({
            web: {
              uri: source.url,
              title: source.title,
            },
          })),
        },
      },
    ],
  },
  raw: result.raw,
});

export class AiProviderService {
  async getActiveProvider(): Promise<AiProvider> {
    return normalizeProvider(await settingsService.get("ai_provider", process.env.AI_PROVIDER || "gemini"));
  }

  async setActiveProvider(provider: AiProvider): Promise<void> {
    await settingsService.set("ai_provider", provider);
  }

  async getOpenAIModel(): Promise<string> {
    const configured = await settingsService.get("openai_model", process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL);
    return configured.trim() || DEFAULT_OPENAI_MODEL;
  }

  async generateOpenAIResponse(input: {
    apiKey: string;
    modelName: string;
    prompt: string;
    grounded?: boolean;
  }): Promise<AiGeneratedResponse> {
    const temperature = readNumber(await settingsService.get("openai_temperature", "0.1"));
    const topP = readNumber(await settingsService.get("openai_top_p", "1"));
    const maxOutputTokens = readNumber(await settingsService.get("openai_max_output_tokens"));
    const requestBody: Record<string, unknown> = {
      model: input.modelName,
      input: input.prompt,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
      ...(input.grounded ? { tools: [{ type: "web_search_preview" }] } : {}),
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || response.statusText || "OpenAI request failed";
      if (input.grounded && /tool|web_search|not supported|not available|invalid.*tool/i.test(message)) {
        console.warn("[AiProviderService] OpenAI web_search_preview tool not available for model:", input.modelName, "—", message);
      }
      throw new Error(message);
    }

    const usage = payload?.usage || {};
    const text = extractOpenAiText(payload);
    if (!text) {
      console.warn("[AiProviderService] OpenAI returned empty text. Model:", input.modelName, "Status:", response.status);
    }
    return {
      text,
      sources: extractOpenAiSources(payload),
      usageMetadata: {
        promptTokenCount: usage.input_tokens,
        candidatesTokenCount: usage.output_tokens,
        totalTokenCount: usage.total_tokens,
      },
      raw: payload,
    };
  }

  async testOpenAIKey(apiKey?: string, modelOverride?: string) {
    const resolvedKey = apiKey || await settingsService.getOpenAIKey();
    if (!resolvedKey) return null;
    const modelName = (modelOverride?.trim() || await this.getOpenAIModel()).trim() || DEFAULT_OPENAI_MODEL;

    try {
      const response = await this.generateOpenAIResponse({
        apiKey: resolvedKey,
        modelName,
        prompt: "Respond with OK.",
        grounded: false,
      });
      return {
        ok: true,
        model: modelName,
        usage: {
          promptTokens: response.usageMetadata.promptTokenCount || 0,
          candidatesTokens: response.usageMetadata.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata.totalTokenCount || 0,
        },
        usageRemaining: null,
        note: "OpenAI does not return remaining quota; usage is for this test call only.",
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

export const aiProviderService = new AiProviderService();
