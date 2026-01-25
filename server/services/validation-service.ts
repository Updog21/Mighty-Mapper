import { GoogleGenAI } from "@google/genai";

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

// Gemini Provider Implementation
export class GeminiProvider implements AIProvider {
  private client: GoogleGenAI;
  private modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  async validateRule(ruleContent: string, context: string = ""): Promise<ValidationResult> {
    const prompt = `
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

    try {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: prompt,
      });
      const text = typeof (response as any).text === "function"
        ? await (response as any).text()
        : typeof (response as any).text === "string"
          ? (response as any).text
          : "";
      
      // Basic cleanup to ensure JSON parsing
      const jsonString = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const data = JSON.parse(jsonString);

      return {
        isValid: data.isValid,
        confidence: data.confidence,
        metadata: {
          channel: data.metadata?.channel,
          mutableElements: data.metadata?.mutableElements || [],
          reasoning: data.metadata?.reasoning || "No reasoning provided.",
          techniqueId: data.metadata?.techniqueId
        }
      };
    } catch (error) {
      console.error("Gemini Validation Error:", error);
      return {
        isValid: false,
        confidence: 0,
        metadata: {
          reasoning: "AI Validation failed due to error: " + (error as Error).message
        }
      };
    }
  }
}

// Validation Service Factory/Manager
import { settingsService } from "./settings-service";

export class ValidationService {
  private provider: AIProvider | null = null;
  private providerKey: string | null = null;
  private providerModel: string | null = null;

  async getProvider(): Promise<AIProvider | null> {
    // Check settings for provider preference (future proofing)
    // For now, default to Gemini if key exists
    const geminiKey = await settingsService.getGeminiKey();
    const geminiModel = (await settingsService.getGeminiModel()).trim();
    if (this.provider && this.providerKey === geminiKey && this.providerModel === geminiModel) {
      return this.provider;
    }
    if (geminiKey) {
      this.provider = new GeminiProvider(geminiKey, geminiModel || "gemini-1.5-flash");
      this.providerKey = geminiKey;
      this.providerModel = geminiModel;
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
