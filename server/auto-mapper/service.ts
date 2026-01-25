import { CTIDAdapter } from './adapters/ctid';
import { SigmaAdapter } from './adapters/sigma';
import { ElasticAdapter } from './adapters/elastic';
import { SplunkAdapter } from './adapters/splunk';
import { AzureAdapter } from './adapters/azure';
import { MitreStixAdapter } from './adapters/mitre-stix';
import { ResourceAdapter, NormalizedMapping, ResourceType, AnalyticMapping } from './types';
import { db } from '../db';
import { products, productMappings, productStreams, ssmCapabilities, ssmMappings, techniques } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { validationService } from '../services';
import { isRuleRelevantToPlatform, normalizeTechniqueId, slugifyPlatform } from './utils';
import { mitreKnowledgeGraph } from '../mitre-stix/knowledge-graph';

const adapters: Record<ResourceType, ResourceAdapter> = {
  ctid: new CTIDAdapter(),
  sigma: new SigmaAdapter(),
  elastic: new ElasticAdapter(),
  splunk: new SplunkAdapter(),
  azure: new AzureAdapter(),
  mitre_stix: new MitreStixAdapter(),
};

const COMMUNITY_RESOURCE_ORDER: ResourceType[] = ['ctid', 'splunk', 'sigma', 'elastic', 'azure', 'mitre_stix'];
const AUTO_MAPPER_CONCURRENCY = 2;

const SSM_SOURCE_MAP: Record<ResourceType, string> = {
  ctid: 'ctid_import',
  sigma: 'sigma_inference',
  splunk: 'splunk_inference',
  elastic: 'elastic_inference',
  azure: 'azure_inference',
  mitre_stix: 'mitre_stix',
};

const WIZARD_TELEMETRY_SOURCE = 'wizard_telemetry';

const SOURCE_LABELS: Record<ResourceType, string> = {
  ctid: 'CTID',
  sigma: 'Sigma',
  splunk: 'Splunk',
  elastic: 'Elastic',
  azure: 'Azure',
  mitre_stix: 'MITRE STIX',
};

export interface MappingResult {
  productId: string;
  status: 'matched' | 'partial' | 'ai_pending' | 'not_found';
  source?: ResourceType;
  sources?: ResourceType[];
  confidence?: number;
  mapping?: NormalizedMapping;
  error?: string;
}

interface CTIDRawMapping {
  capability_id?: string;
  capability_description?: string;
  mapping_type?: string;
  attack_object_id?: string;
  attack_object_name?: string;
  score_category?: string;
  score_value?: string;
}

export async function runAutoMapper(productId: string): Promise<MappingResult> {
  const product = await db.select().from(products).where(eq(products.productId, productId)).limit(1);
  
  if (!product[0]) {
    return { productId, status: 'not_found', error: 'Product not found' };
  }

  const { productName, vendor } = product[0];
  const productInternalId = product[0].id;
  const targetPlatforms = product[0].platforms || [];
  const ssmSources = [
    SSM_SOURCE_MAP.ctid,
    SSM_SOURCE_MAP.sigma,
    SSM_SOURCE_MAP.splunk,
    SSM_SOURCE_MAP.elastic,
    SSM_SOURCE_MAP.azure,
    SSM_SOURCE_MAP.mitre_stix,
    WIZARD_TELEMETRY_SOURCE,
  ];

  const techniqueRows = await db
    .select({ techniqueId: techniques.techniqueId, name: techniques.name })
    .from(techniques);
  const techniqueNameMap = new Map(techniqueRows.map(row => [row.techniqueId, row.name]));

  await mitreKnowledgeGraph.ensureInitialized();

  const streamRows = await db
    .select()
    .from(productStreams)
    .where(eq(productStreams.productId, productInternalId));

  const streamCache = new Map<string, typeof streamRows[number]>();
  const streamLooseCache = new Map<string, typeof streamRows[number]>();
  const streamLooseCollisions = new Set<string>();
  const normalizeStreamLooseKey = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const stream of streamRows) {
    if (!stream.name) continue;
    const normalized = stream.name.trim().toLowerCase();
    streamCache.set(normalized, stream);
    const looseKey = normalizeStreamLooseKey(stream.name);
    if (!looseKey) continue;
    if (streamLooseCollisions.has(looseKey)) continue;
    const existing = streamLooseCache.get(looseKey);
    if (existing && existing.id !== stream.id) {
      streamLooseCache.delete(looseKey);
      streamLooseCollisions.add(looseKey);
      continue;
    }
    streamLooseCache.set(looseKey, stream);
  }

  const pendingStreamStubs = new Map<string, string>();

  const resolveMappingStreams = (resourceType: ResourceType, mapping: NormalizedMapping) => {
    const isTrustedSource = resourceType === 'ctid' || resourceType === 'mitre_stix';
    const updatedAnalytics = mapping.analytics.flatMap((analytic) => {
      const candidate = analytic.rawSource || analytic.logSources?.[0];
      const rawSource = candidate?.trim();
      const hasTechniques = (analytic.techniqueIds || []).length > 0;

      if (!rawSource) {
        if (!hasTechniques && !isTrustedSource) {
          return [];
        }
        if (!isTrustedSource) {
          return [{
            ...analytic,
            streamStatus: 'heuristic',
            metadata: {
              ...(analytic.metadata || {}),
              stream_status: 'heuristic',
            },
          }];
        }
        return [analytic];
      }

      const lookupKey = rawSource.toLowerCase();
      const looseKey = normalizeStreamLooseKey(rawSource);
      let stream = streamCache.get(lookupKey);
      if (!stream && looseKey && !streamLooseCollisions.has(looseKey)) {
        stream = streamLooseCache.get(looseKey);
      }
      const mappedDataComponents = Array.isArray(stream?.mappedDataComponents)
        ? stream?.mappedDataComponents.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];

      if (stream && stream.isConfigured && mappedDataComponents.length > 0) {
        const inferredTechniques = new Set<string>();
        for (const component of mappedDataComponents) {
          const inferred = mitreKnowledgeGraph.getTechniquesByDataComponentName(component);
          inferred.forEach(tech => inferredTechniques.add(tech.id));
        }

        if (inferredTechniques.size > 0) {
          const inferredMetadata: Record<string, unknown> = {
            ...(analytic.metadata || {}),
            raw_source: rawSource,
            stream_status: 'verified',
            stream_ref: stream.id,
            mapped_data_components: mappedDataComponents,
          };

          // Fix: Preserve specific techniques if they exist (prevents dilution)
          const finalTechniqueIds = hasTechniques 
            ? analytic.techniqueIds 
            : Array.from(inferredTechniques);

          if (!hasTechniques) {
            inferredMetadata.coverage_type = 'telemetry';
          } else {
            inferredMetadata.stream_inferred_techniques = Array.from(inferredTechniques);
          }

          return [{
            ...analytic,
            rawSource,
            techniqueIds: finalTechniqueIds,
            streamStatus: 'verified',
            metadata: inferredMetadata,
          }];
        }
      }

      if (!stream && !pendingStreamStubs.has(lookupKey)) {
        pendingStreamStubs.set(lookupKey, rawSource);
      }

      return [{
        ...analytic,
        rawSource,
        streamStatus: isTrustedSource ? undefined : 'heuristic',
        metadata: {
          ...(analytic.metadata || {}),
          raw_source: rawSource,
          stream_status: isTrustedSource ? undefined : 'heuristic',
          stream_ref: stream?.id,
        },
      }];
    });

    const techniqueSet = new Set<string>();
    for (const analytic of updatedAnalytics) {
      for (const techId of analytic.techniqueIds || []) {
        techniqueSet.add(techId);
      }
    }

    mapping.analytics = updatedAnalytics;
    mapping.detectionStrategies = Array.from(techniqueSet).map(t => `DS-${t}`);
  };

  await db.delete(ssmMappings).where(
    inArray(
      ssmMappings.capabilityId,
      db
        .select({ id: ssmCapabilities.id })
        .from(ssmCapabilities)
        .where(
          and(
            eq(ssmCapabilities.productId, productId),
            inArray(ssmCapabilities.source, ssmSources)
          )
        )
    )
  );

  await db.delete(ssmCapabilities).where(
    and(
      eq(ssmCapabilities.productId, productId),
      inArray(ssmCapabilities.source, ssmSources)
    )
  );

  const allMappings: NormalizedMapping[] = [];
  const successfulSources: ResourceType[] = [];
  const results = await runWithConcurrency(
    COMMUNITY_RESOURCE_ORDER,
    AUTO_MAPPER_CONCURRENCY,
    async (resourceType) => {
      const adapter = adapters[resourceType];
      try {
        const cached = await getCachedMapping(productId, resourceType);
        if (cached) {
          resolveMappingStreams(resourceType, cached);
          if (cached.analytics.length > 0) {
            await saveMappingResult(productId, resourceType, 'matched', cached);
            return { resourceType, mapping: cached, matched: true };
          }
          await saveMappingResult(productId, resourceType, 'not_found', null);
          return { resourceType, mapping: null, matched: false };
        }

        const mapping = await adapter.fetchMappings(productName, vendor);

        if (mapping && mapping.analytics.length > 0) {
          resolveMappingStreams(resourceType, mapping);
          if (mapping.analytics.length === 0) {
            await saveMappingResult(productId, resourceType, 'not_found', null);
            return { resourceType, mapping: null, matched: false };
          }
          if (resourceType === 'sigma' || resourceType === 'splunk') {
            console.log(`[AutoMapper] Validating ${mapping.analytics.length} rules for ${resourceType}...`);
            await validateAnalytics(mapping.analytics, productName);
          }

          await saveMappingResult(productId, resourceType, 'matched', mapping);
          return { resourceType, mapping, matched: true };
        }

        await saveMappingResult(productId, resourceType, 'not_found', null);
        return { resourceType, mapping: null, matched: false };
      } catch (error) {
        console.error(`Error fetching from ${resourceType}:`, error);
        return { resourceType, mapping: null, matched: false };
      }
    }
  );

  const resultsByType = new Map(results.map(result => [result.resourceType, result]));
  for (const resourceType of COMMUNITY_RESOURCE_ORDER) {
    const result = resultsByType.get(resourceType);
    if (result?.mapping && result.matched) {
      allMappings.push(result.mapping);
      successfulSources.push(resourceType);
    }
  }

  if (pendingStreamStubs.size > 0) {
    const stubRows = Array.from(pendingStreamStubs.values()).map((name) => ({
      productId: productInternalId,
      name,
      streamType: 'log',
      isConfigured: false,
    }));
    await db.insert(productStreams).values(stubRows);
  }

  const writeCommunitySSM = async (
    resourceType: ResourceType,
    analytics: AnalyticMapping[]
  ) => {
    if (targetPlatforms.length === 0) return;
    const sourceLabel = SOURCE_LABELS[resourceType] || resourceType;
    const ssmSource = SSM_SOURCE_MAP[resourceType] || resourceType;

    for (const platform of targetPlatforms) {
      const relevantRules = analytics.filter(rule =>
        isRuleRelevantToPlatform(rule.platforms, platform)
        && (rule.techniqueIds || []).length > 0
      );
      if (relevantRules.length === 0) continue;

      const telemetryRules = relevantRules.filter(rule => (rule.metadata as any)?.coverage_type === 'telemetry');
      const detectionRules = relevantRules.filter(rule => (rule.metadata as any)?.coverage_type !== 'telemetry');

      if (detectionRules.length > 0) {
        const [capability] = await db.insert(ssmCapabilities).values({
          productId,
          capabilityGroupId: `${ssmSource}_${slugifyPlatform(platform)}_${productId}`,
          name: `Community Detections - ${sourceLabel} (${platform})`,
          description: `Auto-mapped ${detectionRules.length} rules from ${sourceLabel}.`,
          platform,
          source: ssmSource,
        }).returning();

        const mappingsToInsert = [];
        for (const rule of detectionRules) {
          const techniqueIds = rule.techniqueIds || [];
          const scoreValue = `Rule: ${rule.name || rule.sourceFile || rule.ruleId || 'Unknown Rule'}`;
          const commentsBase = `Repo: ${rule.repoName || sourceLabel}`;
          const comments = rule.ruleId ? `${commentsBase} | RuleID: ${rule.ruleId}` : commentsBase;
          const metadata = {
            log_sources: rule.logSources,
            mutable_elements: rule.mutableElements,
            query: rule.query,
            raw_source: rule.rawSource,
            stream_status: rule.streamStatus,
            ...(rule.metadata || {}),
          };

          for (const techId of techniqueIds) {
            const normalizedId = normalizeTechniqueId(techId);
            if (!normalizedId) continue;
            mappingsToInsert.push({
              capabilityId: capability.id,
              techniqueId: normalizedId,
              techniqueName: techniqueNameMap.get(normalizedId) || techId || normalizedId,
              mappingType: 'Detect',
              scoreCategory: 'Partial',
              scoreValue,
              comments,
              metadata,
            });
          }
        }

        if (mappingsToInsert.length > 0) {
          await db.insert(ssmMappings).values(mappingsToInsert);
        }
      }

      if (telemetryRules.length > 0) {
        const [capability] = await db.insert(ssmCapabilities).values({
          productId,
          capabilityGroupId: `${WIZARD_TELEMETRY_SOURCE}_${slugifyPlatform(platform)}_${productId}`,
          name: `Telemetry Visibility (${platform})`,
          description: `Telemetry-only visibility mappings inferred from configured streams.`,
          platform,
          source: WIZARD_TELEMETRY_SOURCE,
        }).returning();

        const mappingsToInsert = [];
        for (const rule of telemetryRules) {
          const techniqueIds = rule.techniqueIds || [];
          const streamLabel = rule.rawSource || rule.name || 'Telemetry Stream';
          const scoreValue = `Stream: ${streamLabel}`;
          const comments = `Stream: ${streamLabel}`;
          const metadata = {
            log_sources: rule.logSources,
            mutable_elements: rule.mutableElements,
            query: rule.query,
            raw_source: rule.rawSource,
            stream_status: rule.streamStatus,
            ...(rule.metadata || {}),
          };

          for (const techId of techniqueIds) {
            const normalizedId = normalizeTechniqueId(techId);
            if (!normalizedId) continue;
            mappingsToInsert.push({
              capabilityId: capability.id,
              techniqueId: normalizedId,
              techniqueName: techniqueNameMap.get(normalizedId) || techId || normalizedId,
              mappingType: 'Detect',
              scoreCategory: 'Minimal',
              scoreValue,
              comments,
              metadata,
            });
          }
        }

        if (mappingsToInsert.length > 0) {
          await db.insert(ssmMappings).values(mappingsToInsert);
        }
      }
    }
  };

  const writeCtidSSM = async (mapping: NormalizedMapping) => {
    if (targetPlatforms.length === 0) return;
    const ssmSource = SSM_SOURCE_MAP.ctid;
    const sourceLabel = SOURCE_LABELS.ctid;
    const rawMappings = Array.isArray(mapping.rawData)
      ? (mapping.rawData as CTIDRawMapping[])
      : ((mapping.rawData as { mappings?: CTIDRawMapping[] } | null)?.mappings || []);

    if (rawMappings.length === 0) return;

    const analyticsByTechnique = new Map<string, AnalyticMapping>();
    for (const analytic of mapping.analytics || []) {
      for (const techId of analytic.techniqueIds || []) {
        const normalizedId = normalizeTechniqueId(techId);
        if (!normalizedId) continue;
        if (!analyticsByTechnique.has(normalizedId)) {
          analyticsByTechnique.set(normalizedId, analytic);
        }
      }
    }

    for (const platform of targetPlatforms) {
      const [capability] = await db.insert(ssmCapabilities).values({
        productId,
        capabilityGroupId: `${ssmSource}_${slugifyPlatform(platform)}_${productId}`,
        name: `CTID Mappings (${platform})`,
        description: `Imported ${rawMappings.length} mappings from CTID.`,
        platform,
        source: ssmSource,
      }).returning();

      const mappingsToInsert = [];
      for (const rule of rawMappings) {
        const techId = normalizeTechniqueId(rule.attack_object_id);
        if (!techId) continue;
        const analytic = analyticsByTechnique.get(techId);
        const analyticMetadata = (analytic?.metadata || {}) as Record<string, unknown>;
        const scoreValue = rule.score_value || rule.attack_object_name || rule.capability_description || 'CTID Mapping';
        const comments = rule.capability_id
          ? `Repo: ${sourceLabel} | Capability: ${rule.capability_id}`
          : `Repo: ${sourceLabel}`;
        const metadata: Record<string, unknown> = { ...analyticMetadata };
        if (!('data_components' in metadata) && (rule as any).data_components) {
          metadata.data_components = (rule as any).data_components;
        }
        if (!('log_sources' in metadata) && (rule as any).log_sources) {
          metadata.log_sources = (rule as any).log_sources;
        }
        if (!('mutable_elements' in metadata) && (analyticMetadata as any).mutable_elements) {
          metadata.mutable_elements = (analyticMetadata as any).mutable_elements;
        }
        if (!('raw_source' in metadata) && analytic?.rawSource) {
          metadata.raw_source = analytic.rawSource;
        }
        if (!('stream_status' in metadata) && analytic?.streamStatus) {
          metadata.stream_status = analytic.streamStatus;
        }

        mappingsToInsert.push({
          capabilityId: capability.id,
          techniqueId: techId,
          techniqueName: techniqueNameMap.get(techId) || rule.attack_object_name || techId,
          mappingType: rule.mapping_type || 'Detect',
          scoreCategory: rule.score_category || 'Significant',
          scoreValue,
          comments,
          metadata,
        });
      }

      if (mappingsToInsert.length > 0) {
        await db.insert(ssmMappings).values(mappingsToInsert);
      }
    }
  };

  for (const resourceType of COMMUNITY_RESOURCE_ORDER) {
    const result = resultsByType.get(resourceType);
    if (!result?.mapping || !result.matched) continue;
    if (resourceType === 'ctid') {
      await writeCtidSSM(result.mapping);
    } else {
      await writeCommunitySSM(resourceType, result.mapping.analytics);
    }
  }

  if (allMappings.length === 0) {
    await saveMappingResult(productId, 'mitre_stix', 'ai_pending', null);
    
    return {
      productId,
      status: 'ai_pending',
      error: 'No mappings found in any resource. Marked for AI-assisted mapping.',
    };
  }

  const combinedMapping = combineAllMappings(productId, allMappings, successfulSources);
  
  return {
    productId,
    status: 'matched',
    source: successfulSources[0],
    sources: successfulSources,
    confidence: combinedMapping.confidence,
    mapping: combinedMapping,
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  });

  await Promise.allSettled(runners);
  return results;
}

/**
 * Validates a list of analytics using the ValidationService (AI)
 * Modifies the objects in place.
 */
async function validateAnalytics(analytics: AnalyticMapping[], productName: string) {
  const provider = await validationService.getProvider();
  if (!provider) return; // Skip if no AI configured

  // Validate only the first 5 to save tokens/time for now
  // In a production job queue, we would do all.
  const batch = analytics.slice(0, 5);

  for (const analytic of batch) {
    try {
      const ruleContent = `
        Product: ${productName}
        Rule Name: ${analytic.name}
        Description: ${analytic.description || 'N/A'}
        Query/Pseudocode: ${analytic.query || 'N/A'}
      `;
      
      const result = await validationService.validate(ruleContent);
      
      analytic.validationStatus = result.isValid ? 'valid' : 'invalid';
      analytic.aiConfidence = result.confidence;
      analytic.mutableElements = result.metadata.mutableElements;
      
      if (result.metadata.reasoning) {
        // Append reasoning to description or store separately
        // For now, simple append if space permits
        analytic.description = `${analytic.description || ''} \n[AI Validation]: ${result.metadata.reasoning}`.trim();
      }
    } catch (e) {
      console.warn(`[AutoMapper] Failed to validate analytic ${analytic.id}`, e);
    }
  }
}

function combineAllMappings(
  productId: string,
  mappings: NormalizedMapping[],
  sources: ResourceType[]
): NormalizedMapping {
  const techniqueSet = new Set<string>();
  const techniqueSources: Record<string, ResourceType[]> = {};
  const analyticsMap = new Map<string, NormalizedMapping['analytics'][0]>();
  const dataComponentsMap = new Map<string, NormalizedMapping['dataComponents'][0]>();
  const rawDataList: any[] = [];

  for (const mapping of mappings) {
    for (const ds of mapping.detectionStrategies) {
      techniqueSet.add(ds);
      const techId = ds.startsWith('DS-') ? ds.substring(3) : ds;
      if (!techniqueSources[techId]) {
        techniqueSources[techId] = [];
      }
      if (!techniqueSources[techId].includes(mapping.source)) {
        techniqueSources[techId].push(mapping.source);
      }
    }
    
    for (const analytic of mapping.analytics) {
      const existing = analyticsMap.get(analytic.id);
      if (!existing) {
        analyticsMap.set(analytic.id, analytic);
        continue;
      }
      if (analytic.techniqueIds && analytic.techniqueIds.length > 0) {
        const combined = Array.from(new Set([
          ...(existing.techniqueIds || []),
          ...analytic.techniqueIds,
        ]));
        analyticsMap.set(analytic.id, {
          ...existing,
          techniqueIds: combined,
        });
      }
    }
    
    for (const dc of mapping.dataComponents) {
      if (!dataComponentsMap.has(dc.id)) {
        dataComponentsMap.set(dc.id, dc);
      }
    }
    
    if (mapping.rawData) {
      rawDataList.push(...(Array.isArray(mapping.rawData) ? mapping.rawData : [mapping.rawData]));
    }
  }

  const totalAnalytics = Array.from(analyticsMap.values()).length;
  const confidence = Math.min(100, totalAnalytics * 5 + sources.length * 10);

  return {
    productId,
    source: sources.join('+') as any,
    confidence,
    detectionStrategies: Array.from(techniqueSet),
    analytics: Array.from(analyticsMap.values()),
    dataComponents: Array.from(dataComponentsMap.values()),
    rawData: rawDataList,
    techniqueSources,
  };
}

async function getCachedMapping(productId: string, resourceType: ResourceType): Promise<NormalizedMapping | null> {
  const cached = await db.select()
    .from(productMappings)
    .where(
      and(
        eq(productMappings.productId, productId),
        eq(productMappings.resourceType, resourceType),
        eq(productMappings.status, 'matched')
      )
    )
    .limit(1);

  if (cached[0] && cached[0].rawMapping) {
    return cached[0].rawMapping as NormalizedMapping;
  }

  return null;
}

async function saveMappingResult(
  productId: string, 
  resourceType: ResourceType, 
  status: string, 
  mapping: NormalizedMapping | null
): Promise<void> {
  const existing = await db.select()
    .from(productMappings)
    .where(
      and(
        eq(productMappings.productId, productId),
        eq(productMappings.resourceType, resourceType)
      )
    )
    .limit(1);

  const mappingData = {
    productId,
    resourceType,
    status,
    confidence: mapping?.confidence || null,
    detectionStrategyIds: mapping?.detectionStrategies || [],
    analyticIds: mapping?.analytics.map(a => a.id) || [],
    dataComponentIds: mapping?.dataComponents.map(dc => dc.id) || [],
    rawMapping: mapping,
    updatedAt: new Date(),
  };

  if (existing[0]) {
    await db.update(productMappings)
      .set(mappingData)
      .where(eq(productMappings.id, existing[0].id));
  } else {
    await db.insert(productMappings).values(mappingData);
  }
}

export async function getMappingStatus(productId: string): Promise<MappingResult | null> {
  const allMappings = await db.select()
    .from(productMappings)
    .where(eq(productMappings.productId, productId));

  if (allMappings.length === 0) {
    return null;
  }

  const matchedMappings = allMappings.filter(m => m.status === 'matched' && m.rawMapping);
  
  if (matchedMappings.length === 0) {
    const firstMapping = allMappings[0];
    return {
      productId,
      status: firstMapping.status as MappingResult['status'],
      source: firstMapping.resourceType as ResourceType,
    };
  }

  const sources = matchedMappings.map(m => m.resourceType as ResourceType);
  const normalizedMappings = matchedMappings.map(m => m.rawMapping as NormalizedMapping);
  const combinedMapping = combineAllMappings(productId, normalizedMappings, sources);

  return {
    productId,
    status: 'matched',
    source: sources[0],
    sources,
    confidence: combinedMapping.confidence,
    mapping: combinedMapping,
  };
}

export async function getAllProductMappings(): Promise<MappingResult[]> {
  const allProducts = await db.select().from(products);
  const allMappings = await db.select().from(productMappings);

  const mappingsByProduct = new Map<string, (typeof allMappings)[0][]>();
  for (const m of allMappings) {
    const existing = mappingsByProduct.get(m.productId) || [];
    existing.push(m);
    mappingsByProduct.set(m.productId, existing);
  }

  return allProducts.map(product => {
    const productMaps = mappingsByProduct.get(product.productId) || [];
    const matched = productMaps.filter(m => m.status === 'matched');
    
    if (matched.length > 0) {
      return {
        productId: product.productId,
        status: 'matched' as const,
        source: matched[0].resourceType as ResourceType,
        sources: matched.map(m => m.resourceType as ResourceType),
        confidence: matched[0].confidence || undefined,
      };
    }
    
    if (productMaps.length > 0) {
      return {
        productId: product.productId,
        status: productMaps[0].status as MappingResult['status'],
        source: productMaps[0].resourceType as ResourceType,
      };
    }
    
    return {
      productId: product.productId,
      status: 'not_found' as const,
    };
  });
}
