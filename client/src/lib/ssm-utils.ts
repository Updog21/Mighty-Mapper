import type { SsmCapability } from "@shared/schemas/ssm";

export type HeatmapStatus = "significant" | "partial" | "minimal" | "none";
export type CoverageMode = "detect" | "visibility";

function normalizeTechniqueId(value: string): string {
  const match = value.toUpperCase().match(/T\d{4}(?:\.\d{3})?/);
  return match ? match[0] : value.toUpperCase();
}

export function getAggregateCoverage(
  capabilities: SsmCapability[] | undefined,
  mode: CoverageMode = "detect"
): Record<string, HeatmapStatus> {
  const coverage: Record<string, HeatmapStatus> = {};

  if (!capabilities) return coverage;

  for (const cap of capabilities) {
    for (const mapping of cap.mappings) {
      const normalizedType = (mapping.mappingType || "").toLowerCase();
      const normalizedCoverageKind = (mapping.coverageKind || "detect").toLowerCase();
      const isDetectionMapping = normalizedType === "detect" || normalizedCoverageKind === "detect";
      const isVisibilityMapping = normalizedType === "observe" || normalizedCoverageKind === "visibility";

      if (mode === "detect" && !isDetectionMapping) continue;
      if (mode === "visibility" && !(isDetectionMapping || isVisibilityMapping)) continue;

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
