import { ResourceAdapter, NormalizedMapping, AnalyticMapping, DataComponentMapping } from '../types';
import { fetchWithTimeout } from '../../utils/fetch';
import { mitreKnowledgeGraph } from '../../mitre-stix/knowledge-graph';
import { platformMatchesAny } from '../../../shared/platforms';

const MITRE_STIX_URL = 'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';

interface STIXObject {
  id: string;
  type: string;
  name?: string;
  description?: string;
  external_references?: Array<{
    source_name: string;
    external_id?: string;
    url?: string;
  }>;
  x_mitre_platforms?: string[];
  x_mitre_data_source_ref?: string;
  x_mitre_detection?: string;
}

export class MitreStixAdapter implements ResourceAdapter {
  name: 'mitre_stix' = 'mitre_stix';
  private stixCache: STIXObject[] | null = null;

  isApplicable(_productType: string, _platforms: string[]): boolean {
    return true;
  }

  async fetchMappings(productName: string, vendor: string, platforms?: string[]): Promise<NormalizedMapping | null> {
    const stixData = await this.getStixData();
    if (!stixData) return null;

    const relatedObjects = this.findRelatedObjects(stixData, productName, vendor, platforms);

    if (relatedObjects.length === 0) {
      return null;
    }

    await mitreKnowledgeGraph.ensureInitialized();
    return this.normalizeMappings(productName, relatedObjects, platforms);
  }

  private async getStixData(): Promise<STIXObject[] | null> {
    if (this.stixCache) return this.stixCache;

    try {
      const response = await fetchWithTimeout(MITRE_STIX_URL);
      if (!response.ok) return null;

      const data = await response.json();
      this.stixCache = data.objects || [];
      return this.stixCache;
    } catch {
      return null;
    }
  }

  private matchesPlatforms(objectPlatforms: string[] | undefined, targetPlatforms?: string[]): boolean {
    if (!targetPlatforms || targetPlatforms.length === 0) return true;
    if (!objectPlatforms || objectPlatforms.length === 0) return true;
    return platformMatchesAny(objectPlatforms, targetPlatforms);
  }

  private findRelatedObjects(stixData: STIXObject[], productName: string, vendor: string, targetPlatforms?: string[]): STIXObject[] {
    const searchTerms = [
      productName.toLowerCase(),
      vendor.toLowerCase(),
      ...productName.toLowerCase().split(/\s+/),
    ];

    const relatedTerms = new Set<string>(searchTerms);

    const dataComponents = stixData.filter(obj =>
      obj.type === 'x-mitre-data-component' &&
      this.matchesPlatforms(obj.x_mitre_platforms, targetPlatforms) &&
      obj.name &&
      Array.from(relatedTerms).some(term =>
        obj.name!.toLowerCase().includes(term) ||
        obj.description?.toLowerCase().includes(term)
      )
    );

    const dataSources = stixData.filter(obj =>
      obj.type === 'x-mitre-data-source' &&
      this.matchesPlatforms(obj.x_mitre_platforms, targetPlatforms) &&
      obj.name &&
      Array.from(relatedTerms).some(term =>
        obj.name!.toLowerCase().includes(term) ||
        obj.description?.toLowerCase().includes(term)
      )
    );

    const assets = stixData.filter(obj =>
      obj.type === 'x-mitre-asset' &&
      this.matchesPlatforms(obj.x_mitre_platforms, targetPlatforms) &&
      obj.name &&
      Array.from(relatedTerms).some(term =>
        obj.name!.toLowerCase().includes(term) ||
        obj.description?.toLowerCase().includes(term)
      )
    );

    return [...dataComponents, ...dataSources, ...assets];
  }

  private buildAnalyticPlatforms(objectPlatforms: string[] | undefined, techniquePlatforms: string[][]): string[] | undefined {
    const combined = new Set<string>();
    (objectPlatforms || []).forEach((platform) => combined.add(platform));
    techniquePlatforms.forEach((platforms) => {
      platforms.forEach((platform) => combined.add(platform));
    });
    return combined.size > 0
      ? Array.from(combined).sort((a, b) => a.localeCompare(b))
      : undefined;
  }

  private normalizeMappings(productId: string, objects: STIXObject[], targetPlatforms?: string[]): NormalizedMapping {
    const analytics: AnalyticMapping[] = [];
    const dataComponents: DataComponentMapping[] = [];

    for (const obj of objects) {
      if (obj.type === 'x-mitre-data-component') {
        const externalId = obj.external_references?.find(r => r.source_name === 'mitre-attack')?.external_id;

        dataComponents.push({
          id: externalId || obj.id,
          name: obj.name || 'Unknown',
          dataSource: obj.x_mitre_data_source_ref,
        });

        // Infer technique IDs from the matched data component via knowledge graph
        const dcName = obj.name || '';
        const inferredTechniques = dcName
          ? mitreKnowledgeGraph.getTechniquesByDataComponentName(dcName).filter((technique) =>
              this.matchesPlatforms(technique.platforms, targetPlatforms)
            )
          : [];
        const techniqueIds = inferredTechniques.map(t => t.id);
        const hasInferred = techniqueIds.length > 0;
        // Downgrade when a broad DC fans out to many techniques
        const isBroadFanOut = techniqueIds.length > 15;
        const analyticPlatforms = this.buildAnalyticPlatforms(
          obj.x_mitre_platforms,
          inferredTechniques.map((technique) => technique.platforms || [])
        );

        analytics.push({
          id: `MITRE-${externalId || obj.id}`,
          name: `Monitor ${obj.name}`,
          techniqueIds,
          platforms: analyticPlatforms,
          description: obj.description,
          source: 'mitre_stix',
          mappingMethod: hasInferred ? 'stream_data_component_inference' : 'mitre_keyword_match',
          evidenceTier: 'weak',
          coverageKind: hasInferred ? (isBroadFanOut ? 'candidate' : 'visibility') : 'candidate',
          requiresValidation: true,
          metadata: {
            mapping_method: hasInferred ? 'stream_data_component_inference' : 'mitre_keyword_match',
            evidence_tier: 'weak',
            coverage_kind: hasInferred ? (isBroadFanOut ? 'candidate' : 'visibility') : 'candidate',
            inferred_technique_count: techniqueIds.length,
          },
        });
      } else if (obj.type === 'x-mitre-data-source') {
        dataComponents.push({
          id: obj.id,
          name: obj.name || 'Unknown',
          dataSource: 'MITRE Data Source',
        });
      } else if (obj.type === 'x-mitre-asset') {
        const externalId = obj.external_references?.find(r => r.source_name === 'mitre-attack')?.external_id;

        analytics.push({
          id: `MITRE-ASSET-${externalId || obj.id}`,
          name: `Asset: ${obj.name}`,
          platforms: obj.x_mitre_platforms,
          description: obj.description,
          source: 'mitre_stix',
          mappingMethod: 'mitre_keyword_match',
          evidenceTier: 'weak',
          coverageKind: 'candidate',
          requiresValidation: true,
          metadata: {
            mapping_method: 'mitre_keyword_match',
            evidence_tier: 'weak',
            coverage_kind: 'candidate',
          },
        });
      }
    }

    // Collect all inferred technique IDs for detection strategies
    const techniqueSet = new Set<string>();
    for (const analytic of analytics) {
      for (const techId of analytic.techniqueIds || []) {
        techniqueSet.add(techId);
      }
    }

    return {
      productId,
      source: 'mitre_stix',
      confidence: 0,
      detectionStrategies: Array.from(techniqueSet),
      analytics,
      dataComponents: Array.from(new Map(dataComponents.map(dc => [dc.id, dc])).values()),
      rawData: objects,
    };
  }
}
