import type { DetectionStrategy } from '@/lib/mitreData';
import type { StixAnalytic, StixDetectionStrategy } from '@/hooks/useAutoMapper';
import type { SsmCapability } from '@shared/schemas/ssm';
import { platformMatchesAny } from '@shared/platforms';

type Strategy = DetectionStrategy | StixDetectionStrategy;

function normalizeTechniqueId(value: string): string {
  const match = value.toUpperCase().match(/T\d{4}(?:\.\d{3})?/);
  return match ? match[0] : value.toUpperCase();
}

export function getHybridStrategies(
  ssmCapabilities: SsmCapability[],
  stixStrategies: StixDetectionStrategy[] | undefined,
  fallbackStrategies: DetectionStrategy[],
  targetPlatforms: string[]
): Strategy[] {
  const hasSsmCoverage = ssmCapabilities.length > 0;
  const baseStrategies = hasSsmCoverage
    ? (stixStrategies || [])
    : fallbackStrategies;

  const rawMetadataByTechnique = buildMetadataByTechnique(ssmCapabilities);
  const metadataByTechnique = new Map(
    Array.from(rawMetadataByTechnique.entries()).map(([key, value]) => [key.toUpperCase(), value])
  );
  const coveredTechniques = new Set(
    ssmCapabilities.flatMap(cap => cap.mappings.map(mapping => normalizeTechniqueId(mapping.techniqueId)))
  );
  const techniqueNames = new Map<string, string>();
  ssmCapabilities.forEach(cap => {
    cap.mappings.forEach(mapping => {
      const normalized = normalizeTechniqueId(mapping.techniqueId);
      if (!techniqueNames.has(normalized) && mapping.techniqueName) {
        techniqueNames.set(normalized, mapping.techniqueName);
      }
    });
  });

  const techniquesWithStrategies = new Set<string>();
  baseStrategies.forEach(strategy => {
    (strategy.techniques || []).forEach(techId => techniquesWithStrategies.add(normalizeTechniqueId(techId)));
  });

  const synthesizedStrategies: StixDetectionStrategy[] = Array.from(coveredTechniques)
    .filter(techId => !techniquesWithStrategies.has(normalizeTechniqueId(techId)))
    .map(techId => ({
      id: `SYNTH-${techId}`,
      name: `Detect ${techniqueNames.get(techId) || techId}`,
      description: 'Synthesized detection strategy (no official MITRE strategy available).',
      techniques: [techId],
      analytics: [],
    }));

  const strategiesToRender = [...baseStrategies, ...synthesizedStrategies];

  return strategiesToRender.map((strategy): Strategy => {
    const strategyAnalytics = Array.isArray(strategy.analytics) ? strategy.analytics : [];
    const filteredAnalytics = targetPlatforms.length > 0
      ? strategyAnalytics.filter((analytic: any) =>
          platformMatchesAny(analytic.platforms || [], targetPlatforms)
        )
      : strategyAnalytics;
    const analyticsToRender = filteredAnalytics.length > 0 ? filteredAnalytics : strategyAnalytics;

    // If platform filtering is too strict, fall back to strategy analytics instead of showing zero.
    if (analyticsToRender.length > 0) {
      return {
        ...strategy,
        analytics: analyticsToRender,
      } as Strategy;
    }

    const strategyTechniques = strategy.techniques || [];
    const normalizedStrategyTechniques = strategyTechniques.map(normalizeTechniqueId);
    const hasEvidence = normalizedStrategyTechniques.some(techId => coveredTechniques.has(techId));

    if (!hasEvidence) {
      return {
        ...strategy,
        analytics: [],
      };
    }

    const hasMetadata = normalizedStrategyTechniques.some(techId => metadataByTechnique.has(techId));
    const injectedAnalytic: StixAnalytic = {
      id: `custom-${strategy.id}`,
      name: 'Custom Detection Logic',
      description: hasMetadata
        ? 'Detection logic derived from mapped product evidence.'
        : 'Detection logic derived from mapped product coverage.',
      platforms: targetPlatforms.length > 0 ? targetPlatforms : [],
      dataComponents: [],
      logSources: [],
      mutableElements: [],
    };

    return {
      ...strategy,
      analytics: [injectedAnalytic],
    };
  });
}

export function buildMappingIdsByTechnique(ssmCapabilities: SsmCapability[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  ssmCapabilities.forEach(cap => {
    cap.mappings.forEach(mapping => {
      if (!mapping.id) return;
      const normalized = normalizeTechniqueId(mapping.techniqueId);
      const existing = map.get(normalized) || [];
      existing.push(mapping.id);
      map.set(normalized, existing);
    });
  });
  return map;
}

export function buildMetadataByTechnique(ssmCapabilities: SsmCapability[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  ssmCapabilities.forEach(cap => {
    cap.mappings.forEach(mapping => {
      const normalized = normalizeTechniqueId(mapping.techniqueId);
      if (mapping.metadata && !map.has(normalized)) {
        map.set(normalized, mapping.metadata as Record<string, unknown>);
      }
    });
  });
  return map;
}
