import { platformMatchesAny } from '../../shared/platforms';

export function isRuleRelevantToPlatform(
  rulePlatforms: string[] | undefined,
  targetPlatform: string
): boolean {
  if (!rulePlatforms || rulePlatforms.length === 0) {
    return true;
  }
  return platformMatchesAny(rulePlatforms, [targetPlatform]);
}

export function slugifyPlatform(platform: string): string {
  return platform
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeTechniqueId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.toUpperCase().match(/T\d{4}(?:\.\d{3})?/);
  return match ? match[0] : null;
}
