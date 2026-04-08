import { GoogleGenAI } from "@google/genai";
import { buildGroundedConfig } from "./gemini-config";
import { aiProviderService } from "./ai-provider-service";

// Interface for AI Providers
export interface AIProvider {
  validateRule(ruleContent: string, context?: string): Promise<ValidationResult>;
}

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  metadata: {
    channel?: string;
    mutableElements?: string[];
    reasoning: string;
    techniqueId?: string;
  };
}

const VALIDATION_PROMPT = (ruleContent: string, context: string) => `
You are a Senior Security Engineer and Detection Engineering Expert.
Your task is to validate the following detection rule (likely Sigma, SPL, or similar).

Context: ${context}

Rule Content:
${ruleContent}

Perform a two-pass validation:
1. Research/Analysis: Determine the "Ground Truth" (e.g., does this EventID actually mean what the rule says?).
2. Critique: Check for potential false positives or hallucinations.

Return a JSON object with the following structure:
{
  "isValid": boolean, // Is this a high-quality, valid rule?
  "confidence": number, // 0-100 confidence score
  "metadata": {
    "channel": string | null, // The log channel (e.g., "Security", "Sysmon")
    "mutableElements": string[], // List of fields that a user might need to change (e.g., specific usernames, file paths)
    "reasoning": "Brief explanation of your validation findings.",
    "techniqueId": "Txxxx" // Best matching MITRE Technique ID if discernible
  }
}

Respond ONLY with the JSON.
`;

function parseValidationResponse(text: string): ValidationResult {
  const jsonString = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const data = JSON.parse(jsonString);

  return {
    isValid: data.isValid,
    confidence: data.confidence,
    metadata: {
      channel: data.metadata?.channel,
      mutableElements: data.metadata?.mutableElements || [],
      reasoning: data.metadata?.reasoning || "No reasoning provided.",
      techniqueId: data.metadata?.techniqueId,
    },
  };
}

const INCONCLUSIVE_RESULT = (message: string): ValidationResult => ({
  isValid: true,
  confidence: 30,
  metadata: {
    reasoning: "AI Validation inconclusive due to error: " + message,
  },
});

// Gemini Provider Implementation
export class GeminiProvider implements AIProvider {
  private client: GoogleGenAI;
  private modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  async validateRule(ruleContent: string, context: string = ""): Promise<ValidationResult> {
    try {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: VALIDATION_PROMPT(ruleContent, context),
        config: await buildGroundedConfig() as any,
      });
      const text = typeof (response as any).text === "function"
        ? await (response as any).text()
        : typeof (response as any).text === "string"
          ? (response as any).text
          : "";

      return parseValidationResponse(text);
    } catch (error) {
      console.error("Gemini Validation Error:", error);
      return INCONCLUSIVE_RESULT((error as Error).message);
    }
  }
}

// OpenAI Provider Implementation
export class OpenAIProvider implements AIProvider {
  private apiKey: string;
  private modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.apiKey = apiKey;
    this.modelName = modelName;
  }

  async validateRule(ruleContent: string, context: string = ""): Promise<ValidationResult> {
    try {
      const result = await aiProviderService.generateOpenAIResponse({
        apiKey: this.apiKey,
        modelName: this.modelName,
        prompt: VALIDATION_PROMPT(ruleContent, context),
        grounded: false,
      });

      return parseValidationResponse(result.text);
    } catch (error) {
      console.error("OpenAI Validation Error:", error);
      return INCONCLUSIVE_RESULT((error as Error).message);
    }
  }
}

// Validation Service Factory/Manager
import { settingsService } from "./settings-service";

export class ValidationService {
  private provider: AIProvider | null = null;
  private providerCacheKey: string | null = null;

  async getProvider(): Promise<AIProvider | null> {
    const activeProvider = await aiProviderService.getActiveProvider();

    if (activeProvider === "openai") {
      const apiKey = await settingsService.getOpenAIKey();
      const model = (await settingsService.getOpenAIModel()).trim() || "gpt-4o-mini";
      const cacheKey = `openai:${apiKey}:${model}`;
      if (this.provider && this.providerCacheKey === cacheKey) {
        return this.provider;
      }
      if (apiKey) {
        this.provider = new OpenAIProvider(apiKey, model);
        this.providerCacheKey = cacheKey;
        return this.provider;
      }
    }

    // Default to Gemini
    const geminiKey = await settingsService.getGeminiKey();
    const geminiModel = (await settingsService.getGeminiModel()).trim() || "gemini-1.5-flash";
    const cacheKey = `gemini:${geminiKey}:${geminiModel}`;
    if (this.provider && this.providerCacheKey === cacheKey) {
      return this.provider;
    }
    if (geminiKey) {
      this.provider = new GeminiProvider(geminiKey, geminiModel);
      this.providerCacheKey = cacheKey;
      return this.provider;
    }

    console.warn("ValidationService: No AI Provider configured.");
    return null;
  }

  async validate(ruleContent: string, context?: string): Promise<ValidationResult> {
    const provider = await this.getProvider();

    if (!provider) {
      return {
        isValid: false,
        confidence: 0,
        metadata: { reasoning: "No AI Provider configured." }
      };
    }

    return provider.validateRule(ruleContent, context);
  }
}

export const validationService = new ValidationService();
