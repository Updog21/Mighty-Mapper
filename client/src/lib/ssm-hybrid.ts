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
  const baseStrategies = ssmCapabilities.length > 0 && stixStrategies && stixStrategies.length > 0
    ? stixStrategies
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
    (strategy.techniques || []).forEach(techId => techniquesWithStrategies.add(techId.toUpperCase()));
  });

  const synthesizedStrategies: StixDetectionStrategy[] = Array.from(coveredTechniques)
    .filter(techId => !techniquesWithStrategies.has(techId))
    .map(techId => ({
      id: `SYNTH-${techId}`,
      name: `Detect ${techniqueNames.get(techId) || techId}`,
      description: 'Synthesized detection strategy (no official MITRE strategy available).',
      techniques: [techId],
      analytics: [],
    }));

  const strategiesToRender = [...baseStrategies, ...synthesizedStrategies];

  return strategiesToRender.map(strategy => {
    const filteredAnalytics = strategy.analytics.filter((analytic: { platforms?: string[] }) =>
      platformMatchesAny(analytic.platforms || [], targetPlatforms)
    );

    if (filteredAnalytics.length > 0) {
      return {
        ...strategy,
        analytics: filteredAnalytics,
      };
    }

    const strategyTechniques = strategy.techniques || [];
    const hasEvidence = strategyTechniques.some(techId => coveredTechniques.has(techId.toUpperCase()));

    if (!hasEvidence) {
      return {
        ...strategy,
        analytics: filteredAnalytics,
      };
    }

    const hasMetadata = strategyTechniques.some(techId => metadataByTechnique.has(techId.toUpperCase()));
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
