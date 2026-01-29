import { settingsService } from "./settings-service";

type OptionalNumber = number | undefined;

const readNumber = (value: string | undefined): OptionalNumber => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const buildGroundedConfig = async () => {
  const temperature = readNumber(await settingsService.get("gemini_temperature", "0.1")) ?? 0.1;
  const topP = readNumber(await settingsService.get("gemini_top_p", "1")) ?? 1;
  const topK = readNumber(await settingsService.get("gemini_top_k", "40")) ?? 40;
  const seed = readNumber(await settingsService.get("gemini_seed"));
  const maxOutputTokens = readNumber(await settingsService.get("gemini_max_output_tokens"));

  return {
    tools: [{ googleSearch: {} }],
    temperature,
    topP,
    topK,
    ...(seed !== undefined ? { seed } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
  };
};
