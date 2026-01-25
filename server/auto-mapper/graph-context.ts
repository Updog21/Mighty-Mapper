import { mitreKnowledgeGraph } from '../mitre-stix/knowledge-graph';

export interface TechniqueContextLogSource {
  name: string;
  channel?: string;
  satisfies_data_component?: string;
  dataComponent?: string;
}

export interface TechniqueContext {
  logSources: TechniqueContextLogSource[];
  mutableElements: Array<{ field: string; description: string }>;
  dataComponents: string[];
}

export function buildTechniqueContext(techniqueIds: string[]): Map<string, TechniqueContext> {
  const sanitized = techniqueIds
    .filter((id): id is string => typeof id === 'string')
    .map(id => id.trim())
    .filter(Boolean);

  if (sanitized.length === 0) {
    return new Map();
  }

  const graphContext = mitreKnowledgeGraph.getFullMappingForTechniques(sanitized);
  const dcNameById = new Map(graphContext.dataComponents.map(dc => [dc.id, dc.name]));
  const relevantTechniques = new Set(sanitized.map(id => id.toUpperCase()));

  const output = new Map<string, {
    logSources: TechniqueContextLogSource[];
    mutableElements: Array<{ field: string; description: string }>;
    dataComponents: string[];
    logSourceKeys: Set<string>;
    mutableKeys: Set<string>;
    dataComponentKeys: Set<string>;
  }>();

  const ensureEntry = (techniqueId: string) => {
    const existing = output.get(techniqueId);
    if (existing) return existing;
    const fresh = {
      logSources: [],
      mutableElements: [],
      dataComponents: [],
      logSourceKeys: new Set<string>(),
      mutableKeys: new Set<string>(),
      dataComponentKeys: new Set<string>(),
    };
    output.set(techniqueId, fresh);
    return fresh;
  };

  for (const strategy of graphContext.detectionStrategies) {
    for (const techniqueId of strategy.techniques) {
      if (!relevantTechniques.has(techniqueId.toUpperCase())) continue;
      const entry = ensureEntry(techniqueId);

      for (const analytic of strategy.analytics) {
        for (const logSource of analytic.logSources) {
          const key = `${logSource.dataComponentName}|${logSource.name}|${logSource.channel || ''}`;
          if (!entry.logSourceKeys.has(key)) {
            entry.logSourceKeys.add(key);
            entry.logSources.push({
              name: logSource.name,
              channel: logSource.channel,
              satisfies_data_component: logSource.dataComponentName,
              dataComponent: logSource.dataComponentName,
            });
          }
          if (logSource.dataComponentName && !entry.dataComponentKeys.has(logSource.dataComponentName)) {
            entry.dataComponentKeys.add(logSource.dataComponentName);
            entry.dataComponents.push(logSource.dataComponentName);
          }
        }

        for (const mutable of analytic.mutableElements) {
          const key = `${mutable.field}|${mutable.description}`;
          if (!entry.mutableKeys.has(key)) {
            entry.mutableKeys.add(key);
            entry.mutableElements.push(mutable);
          }
        }

        for (const dcId of analytic.dataComponents) {
          const dcName = dcNameById.get(dcId);
          if (dcName && !entry.dataComponentKeys.has(dcName)) {
            entry.dataComponentKeys.add(dcName);
            entry.dataComponents.push(dcName);
          }
        }
      }
    }
  }

  const result = new Map<string, TechniqueContext>();
  output.forEach((value, key) => {
    result.set(key, {
      logSources: value.logSources,
      mutableElements: value.mutableElements,
      dataComponents: value.dataComponents,
    });
  });

  return result;
}

export function mergeTechniqueContexts(
  techniqueIds: string[],
  contextMap: Map<string, TechniqueContext>
): TechniqueContext | null {
  if (!techniqueIds || techniqueIds.length === 0) return null;

  const logSources: TechniqueContextLogSource[] = [];
  const mutableElements: Array<{ field: string; description: string }> = [];
  const dataComponents: string[] = [];
  const logSourceKeys = new Set<string>();
  const mutableKeys = new Set<string>();
  const dataComponentKeys = new Set<string>();

  for (const techniqueId of techniqueIds) {
    const context = contextMap.get(techniqueId);
    if (!context) continue;

    for (const logSource of context.logSources) {
      const key = `${logSource.dataComponent || ''}|${logSource.name}|${logSource.channel || ''}`;
      if (!logSourceKeys.has(key)) {
        logSourceKeys.add(key);
        logSources.push(logSource);
      }
    }

    for (const mutable of context.mutableElements) {
      const key = `${mutable.field}|${mutable.description}`;
      if (!mutableKeys.has(key)) {
        mutableKeys.add(key);
        mutableElements.push(mutable);
      }
    }

    for (const dc of context.dataComponents) {
      if (!dataComponentKeys.has(dc)) {
        dataComponentKeys.add(dc);
        dataComponents.push(dc);
      }
    }
  }

  if (logSources.length === 0 && mutableElements.length === 0 && dataComponents.length === 0) {
    return null;
  }

  return { logSources, mutableElements, dataComponents };
}
