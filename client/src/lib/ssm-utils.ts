import type { SsmCapability } from "@shared/schemas/ssm";

export type HeatmapStatus = "significant" | "partial" | "minimal" | "none";

function normalizeTechniqueId(value: string): string {
  const match = value.toUpperCase().match(/T\d{4}(?:\.\d{3})?/);
  return match ? match[0] : value.toUpperCase();
}

export function getAggregateCoverage(
  capabilities: SsmCapability[] | undefined
): Record<string, HeatmapStatus> {
  const coverage: Record<string, HeatmapStatus> = {};

  if (!capabilities) return coverage;

  for (const cap of capabilities) {
    for (const mapping of cap.mappings) {
      const tid = normalizeTechniqueId(mapping.techniqueId);
      const currentStatus = coverage[tid] || "none";
      const newScore = mapping.scoreCategory.toLowerCase() as HeatmapStatus;

      if (newScore === "significant") {
        coverage[tid] = "significant";
      } else if (newScore === "partial" && currentStatus !== "significant") {
        coverage[tid] = "partial";
      } else if (newScore === "minimal" && currentStatus === "none") {
        coverage[tid] = "minimal";
      }
    }
  }

  return coverage;
}
