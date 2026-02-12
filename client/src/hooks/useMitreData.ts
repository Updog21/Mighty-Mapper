import { useQuery } from "@tanstack/react-query";

export interface DataComponentLogSource {
  name: string;
  channel?: string;
}

export interface DataComponentDetectionStrategy {
  id: string;
  name: string;
  techniques: Array<{
    id: string;
    name: string;
  }>;
}

export interface DataComponent {
  id: string;
  name: string;
  dataSourceId?: string | null;
  dataSourceName?: string | null;
  description: string;
  shortDescription?: string;
  examples?: string[];
  platforms?: string[];
  domains?: string[];
  revoked?: boolean;
  deprecated?: boolean;
  logSources?: DataComponentLogSource[];
  detectionStrategies?: DataComponentDetectionStrategy[];
}

export interface DetectionStrategy {
  strategyId: string;
  name: string;
  description: string;
  techniques: Array<{
    id: string;
    name: string;
  }>;
  analytics: Array<{
    id: string;
    name: string;
    platforms: string[];
    dataComponents: Array<{
      id: string;
      name: string;
    }>;
  }>;
  dataComponents: Array<{
    id: string;
    name: string;
    dataSourceName: string;
  }>;
}

export interface MitreTechnique {
  id: string;
  name: string;
  description: string;
  platforms: string[];
  tactics: string[];
  dataSources: string[];
  detection: string;
  strategies: Array<{
    id: string;
    name: string;
  }>;
  analytics: Array<{
    id: string;
    name: string;
    platforms: string[];
  }>;
  dataComponents: Array<{
    id: string;
    name: string;
    dataSourceName: string;
  }>;
}

export interface MitreTechniqueDetail {
  id: string;
  name: string;
  description: string;
  platforms: string[];
  tactics: string[];
  subTechniques: Array<{
    id: string;
    name: string;
    description: string;
    platforms: string[];
    tactics: string[];
  }>;
  procedureExamples: Array<{
    sourceName: string;
    sourceType: string;
    description: string;
    url?: string;
  }>;
  detectionStrategies: Array<{
    id: string;
    name: string;
  }>;
  mitigations: Array<{
    id: string;
    name: string;
    description: string;
  }>;
}

async function fetchDataComponents(platforms?: string[]): Promise<DataComponent[]> {
  const params = new URLSearchParams();
  if (Array.isArray(platforms) && platforms.length > 0) {
    params.set('platforms', platforms.join(','));
  }
  const query = params.toString();
  const response = await fetch(`/api/mitre/data-components${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw new Error('Failed to fetch data components');
  }
  const payload = await response.json();
  const rawComponents = Array.isArray(payload?.dataComponents) ? payload.dataComponents : [];
  return rawComponents
    .map((component: any): DataComponent | null => {
      const id = typeof component?.id === "string" ? component.id.trim() : "";
      if (!id) return null;
      const logSourcesRaw = Array.isArray(component?.logSources) ? component.logSources : [];
      const detectionStrategiesRaw = Array.isArray(component?.detectionStrategies)
        ? component.detectionStrategies
        : [];
      return {
        id,
        name: typeof component?.name === "string" ? component.name : id,
        dataSourceId: typeof component?.dataSourceId === "string" ? component.dataSourceId : null,
        dataSourceName: typeof component?.dataSourceName === "string" ? component.dataSourceName : null,
        description: typeof component?.description === "string" ? component.description : "",
        shortDescription: typeof component?.shortDescription === "string" ? component.shortDescription : undefined,
        examples: Array.isArray(component?.examples)
          ? component.examples.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
          : [],
        platforms: Array.isArray(component?.platforms)
          ? component.platforms.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
          : [],
        domains: Array.isArray(component?.domains)
          ? component.domains.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
          : [],
        revoked: Boolean(component?.revoked),
        deprecated: Boolean(component?.deprecated),
        logSources: logSourcesRaw
          .map((entry: any): DataComponentLogSource | null => {
            if (typeof entry === "string") {
              const name = entry.trim();
              return name ? { name } : null;
            }
            const name = typeof entry?.name === "string" ? entry.name.trim() : "";
            if (!name) return null;
            const channel = typeof entry?.channel === "string" ? entry.channel.trim() : undefined;
            return {
              name,
              channel: channel || undefined,
            };
          })
          .filter((entry: DataComponentLogSource | null): entry is DataComponentLogSource => Boolean(entry)),
        detectionStrategies: detectionStrategiesRaw
          .map((strategy: any): DataComponentDetectionStrategy | null => {
            const strategyId = typeof strategy?.id === "string" ? strategy.id.trim() : "";
            if (!strategyId) return null;
            const techniquesRaw = Array.isArray(strategy?.techniques) ? strategy.techniques : [];
            return {
              id: strategyId,
              name: typeof strategy?.name === "string" ? strategy.name : strategyId,
              techniques: techniquesRaw
                .map((technique: any) => {
                  if (typeof technique === "string") {
                    const techniqueId = technique.trim();
                    return techniqueId ? { id: techniqueId, name: techniqueId } : null;
                  }
                  const techniqueId = typeof technique?.id === "string" ? technique.id.trim() : "";
                  if (!techniqueId) return null;
                  return {
                    id: techniqueId,
                    name: typeof technique?.name === "string" ? technique.name : techniqueId,
                  };
                })
                .filter((technique: { id: string; name: string } | null): technique is { id: string; name: string } => Boolean(technique)),
            };
          })
          .filter((strategy: DataComponentDetectionStrategy | null): strategy is DataComponentDetectionStrategy => Boolean(strategy)),
      };
    })
    .filter((component: DataComponent | null): component is DataComponent => Boolean(component));
}

async function fetchDetectionStrategies(): Promise<DetectionStrategy[]> {
  const response = await fetch('/api/mitre/detection-strategies');
  if (!response.ok) {
    throw new Error('Failed to fetch detection strategies');
  }
  const payload = await response.json();
  const rawStrategies = Array.isArray(payload?.detectionStrategies)
    ? payload.detectionStrategies
    : Array.isArray(payload)
      ? payload
      : [];

  return rawStrategies
    .map((strategy: any): DetectionStrategy | null => {
      const strategyIdRaw = typeof strategy?.strategyId === "string" ? strategy.strategyId : strategy?.id;
      const strategyId = typeof strategyIdRaw === "string" ? strategyIdRaw.trim() : "";
      if (!strategyId) return null;

      const techniquesRaw = Array.isArray(strategy?.techniques) ? strategy.techniques : [];
      const analyticsRaw = Array.isArray(strategy?.analytics) ? strategy.analytics : [];
      const dataComponentsRaw = Array.isArray(strategy?.dataComponents) ? strategy.dataComponents : [];

      return {
        strategyId,
        name: typeof strategy?.name === "string" ? strategy.name : strategyId,
        description: typeof strategy?.description === "string" ? strategy.description : "",
        techniques: techniquesRaw
          .map((technique: any) => {
            if (typeof technique === "string") {
              const id = technique.trim().toUpperCase();
              return id ? { id, name: id } : null;
            }
            const id = typeof technique?.id === "string" ? technique.id.trim().toUpperCase() : "";
            if (!id) return null;
            return {
              id,
              name: typeof technique?.name === "string" ? technique.name : id,
            };
          })
          .filter((technique: { id: string; name: string } | null): technique is { id: string; name: string } => Boolean(technique)),
        analytics: analyticsRaw
          .map((analytic: any) => {
            const id = typeof analytic?.id === "string" ? analytic.id.trim() : "";
            if (!id) return null;
            const dataComponents = Array.isArray(analytic?.dataComponents) ? analytic.dataComponents : [];
            return {
              id,
              name: typeof analytic?.name === "string" ? analytic.name : id,
              platforms: Array.isArray(analytic?.platforms)
                ? analytic.platforms.filter((platform: unknown): platform is string => typeof platform === "string" && platform.trim().length > 0)
                : [],
              dataComponents: dataComponents
                .map((dc: any) => {
                  if (typeof dc === "string") {
                    const dcId = dc.trim();
                    return dcId ? { id: dcId, name: dcId } : null;
                  }
                  const dcId = typeof dc?.id === "string" ? dc.id.trim() : "";
                  if (!dcId) return null;
                  return {
                    id: dcId,
                    name: typeof dc?.name === "string" ? dc.name : dcId,
                  };
                })
                .filter((dc: { id: string; name: string } | null): dc is { id: string; name: string } => Boolean(dc)),
            };
          })
          .filter((analytic: DetectionStrategy["analytics"][number] | null): analytic is DetectionStrategy["analytics"][number] => Boolean(analytic)),
        dataComponents: dataComponentsRaw
          .map((dc: any) => {
            if (typeof dc === "string") {
              const dcId = dc.trim();
              return dcId ? { id: dcId, name: dcId, dataSourceName: "Uncategorized" } : null;
            }
            const id = typeof dc?.id === "string" ? dc.id.trim() : "";
            if (!id) return null;
            return {
              id,
              name: typeof dc?.name === "string" ? dc.name : id,
              dataSourceName: typeof dc?.dataSourceName === "string" && dc.dataSourceName.trim().length > 0
                ? dc.dataSourceName
                : "Uncategorized",
            };
          })
          .filter((dc: DetectionStrategy["dataComponents"][number] | null): dc is DetectionStrategy["dataComponents"][number] => Boolean(dc)),
      };
    })
    .filter((strategy: DetectionStrategy | null): strategy is DetectionStrategy => Boolean(strategy));
}

async function fetchMitreTechniques(platforms?: string[]): Promise<MitreTechnique[]> {
  const params = new URLSearchParams();
  if (Array.isArray(platforms) && platforms.length > 0) {
    params.set('platforms', platforms.join(','));
  }
  const query = params.toString();
  const response = await fetch(`/api/mitre/techniques${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw new Error('Failed to fetch MITRE techniques');
  }

  const payload = await response.json();
  const rawTechniques = Array.isArray(payload?.techniques) ? payload.techniques : [];

  return rawTechniques
    .map((technique: any): MitreTechnique | null => {
      const id = typeof technique?.id === "string" ? technique.id.trim().toUpperCase() : "";
      if (!id) return null;

      const strategiesRaw = Array.isArray(technique?.strategies) ? technique.strategies : [];
      const analyticsRaw = Array.isArray(technique?.analytics) ? technique.analytics : [];
      const componentsRaw = Array.isArray(technique?.dataComponents) ? technique.dataComponents : [];

      return {
        id,
        name: typeof technique?.name === "string" ? technique.name : id,
        description: typeof technique?.description === "string" ? technique.description : "",
        platforms: Array.isArray(technique?.platforms)
          ? technique.platforms.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
          : [],
        tactics: Array.isArray(technique?.tactics)
          ? technique.tactics.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
          : [],
        dataSources: Array.isArray(technique?.dataSources)
          ? technique.dataSources.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
          : [],
        detection: typeof technique?.detection === "string" ? technique.detection : "",
        strategies: strategiesRaw
          .map((strategy: any) => {
            const strategyId = typeof strategy?.id === "string" ? strategy.id.trim() : "";
            if (!strategyId) return null;
            return {
              id: strategyId,
              name: typeof strategy?.name === "string" ? strategy.name : strategyId,
            };
          })
          .filter((strategy: { id: string; name: string } | null): strategy is { id: string; name: string } => Boolean(strategy)),
        analytics: analyticsRaw
          .map((analytic: any) => {
            const analyticId = typeof analytic?.id === "string" ? analytic.id.trim() : "";
            if (!analyticId) return null;
            return {
              id: analyticId,
              name: typeof analytic?.name === "string" ? analytic.name : analyticId,
              platforms: Array.isArray(analytic?.platforms)
                ? analytic.platforms.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
                : [],
            };
          })
          .filter((analytic: { id: string; name: string; platforms: string[] } | null): analytic is { id: string; name: string; platforms: string[] } => Boolean(analytic)),
        dataComponents: componentsRaw
          .map((component: any) => {
            const componentId = typeof component?.id === "string" ? component.id.trim() : "";
            if (!componentId) return null;
            return {
              id: componentId,
              name: typeof component?.name === "string" ? component.name : componentId,
              dataSourceName: typeof component?.dataSourceName === "string" && component.dataSourceName.trim().length > 0
                ? component.dataSourceName
                : "Uncategorized",
            };
          })
          .filter((component: { id: string; name: string; dataSourceName: string } | null): component is { id: string; name: string; dataSourceName: string } => Boolean(component)),
      };
    })
    .filter((technique: MitreTechnique | null): technique is MitreTechnique => Boolean(technique));
}

async function fetchMitreTechniqueDetail(techniqueId: string): Promise<MitreTechniqueDetail> {
  const response = await fetch(`/api/mitre/techniques/${encodeURIComponent(techniqueId)}`);
  if (!response.ok) {
    throw new Error('Failed to fetch MITRE technique detail');
  }
  const payload = await response.json();
  const technique = payload?.technique;
  if (!technique || typeof technique !== 'object') {
    throw new Error('Technique detail not found');
  }

  return {
    id: typeof technique.id === 'string' ? technique.id : techniqueId,
    name: typeof technique.name === 'string' ? technique.name : techniqueId,
    description: typeof technique.description === 'string' ? technique.description : '',
    platforms: Array.isArray(technique.platforms)
      ? technique.platforms.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      : [],
    tactics: Array.isArray(technique.tactics)
      ? technique.tactics.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      : [],
    subTechniques: Array.isArray(technique.subTechniques)
      ? technique.subTechniques
        .map((subTechnique: any) => {
          const id = typeof subTechnique?.id === 'string' ? subTechnique.id.trim() : '';
          if (!id) return null;
          return {
            id,
            name: typeof subTechnique?.name === 'string' ? subTechnique.name : id,
            description: typeof subTechnique?.description === 'string' ? subTechnique.description : '',
            platforms: Array.isArray(subTechnique?.platforms)
              ? subTechnique.platforms.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
              : [],
            tactics: Array.isArray(subTechnique?.tactics)
              ? subTechnique.tactics.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
              : [],
          };
        })
        .filter((subTechnique: MitreTechniqueDetail['subTechniques'][number] | null): subTechnique is MitreTechniqueDetail['subTechniques'][number] => Boolean(subTechnique))
      : [],
    procedureExamples: Array.isArray(technique.procedureExamples)
      ? technique.procedureExamples
        .map((example: any) => {
          const sourceName = typeof example?.sourceName === 'string' ? example.sourceName.trim() : '';
          if (!sourceName) return null;
          return {
            sourceName,
            sourceType: typeof example?.sourceType === 'string' ? example.sourceType : 'unknown',
            description: typeof example?.description === 'string' ? example.description : '',
            url: typeof example?.url === 'string' && example.url.trim().length > 0 ? example.url : undefined,
          };
        })
        .filter((example: MitreTechniqueDetail['procedureExamples'][number] | null): example is MitreTechniqueDetail['procedureExamples'][number] => Boolean(example))
      : [],
    detectionStrategies: Array.isArray(technique.detectionStrategies)
      ? technique.detectionStrategies
        .map((strategy: any) => {
          const id = typeof strategy?.id === 'string' ? strategy.id.trim() : '';
          if (!id) return null;
          return {
            id,
            name: typeof strategy?.name === 'string' ? strategy.name : id,
          };
        })
        .filter((strategy: MitreTechniqueDetail['detectionStrategies'][number] | null): strategy is MitreTechniqueDetail['detectionStrategies'][number] => Boolean(strategy))
      : [],
    mitigations: Array.isArray(technique.mitigations)
      ? technique.mitigations
        .map((mitigation: any) => {
          const id = typeof mitigation?.id === 'string' ? mitigation.id.trim() : '';
          if (!id) return null;
          return {
            id,
            name: typeof mitigation?.name === 'string' ? mitigation.name : id,
            description: typeof mitigation?.description === 'string' ? mitigation.description : '',
          };
        })
        .filter((mitigation: MitreTechniqueDetail['mitigations'][number] | null): mitigation is MitreTechniqueDetail['mitigations'][number] => Boolean(mitigation))
      : [],
  };
}

export function useDataComponents(platforms?: string[]) {
  return useQuery({
    queryKey: ['mitre', 'data-components', ...(platforms || [])],
    queryFn: () => fetchDataComponents(platforms),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDetectionStrategies() {
  return useQuery({
    queryKey: ['mitre', 'detection-strategies'],
    queryFn: fetchDetectionStrategies,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMitreTechniques(platforms?: string[]) {
  return useQuery({
    queryKey: ['mitre', 'techniques', ...(platforms || [])],
    queryFn: () => fetchMitreTechniques(platforms),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMitreTechniqueDetail(techniqueId?: string) {
  return useQuery({
    queryKey: ['mitre', 'technique-detail', techniqueId || ''],
    queryFn: () => fetchMitreTechniqueDetail(techniqueId || ''),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(techniqueId),
  });
}
