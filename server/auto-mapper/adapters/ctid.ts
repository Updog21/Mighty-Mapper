import { ResourceAdapter, NormalizedMapping, AnalyticMapping, DataComponentMapping } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { fetchWithTimeout } from '../../utils/fetch';
import { mitreKnowledgeGraph } from '../../mitre-stix/knowledge-graph';
import { productService } from '../../services';
import { buildTechniqueContext, mergeTechniqueContexts } from '../graph-context';

const CTID_BASE_URL = 'https://raw.githubusercontent.com/center-for-threat-informed-defense/mappings-explorer/main/src/data';
const CTID_API_URLS = [
  'https://api.github.com/repos/center-for-threat-informed-defense/mappings-explorer/git/trees/main?recursive=1',
  'https://api.github.com/repos/center-for-threat-informed-defense/mappings-explorer/git/trees/master?recursive=1',
];
const LOCAL_CTID_PATH = path.resolve(process.cwd(), 'data', 'ctid-mappings-explorer', 'src', 'data');

interface CTIDMapping {
  capability_id: string;
  capability_description: string;
  mapping_type: string;
  attack_object_id: string;
  attack_object_name: string;
  score_category?: string;
}

export class CTIDAdapter implements ResourceAdapter {
  name: 'ctid' = 'ctid';

  isApplicable(_productType: string, _platforms: string[]): boolean {
    return true;
  }

  async fetchMappings(productName: string, vendor: string): Promise<NormalizedMapping | null> {
    const mappingFiles = await this.findMappingFiles(productName, vendor);
    
    if (mappingFiles.length === 0) {
      return null;
    }

    await mitreKnowledgeGraph.ensureInitialized();

    const allMappings: CTIDMapping[] = [];
    for (const file of mappingFiles) {
      const mappings = await this.fetchMappingFile(file);
      allMappings.push(...mappings);
    }

    if (allMappings.length === 0) {
      return null;
    }

    return this.normalizeMappings(productName, allMappings);
  }

  private async findMappingFiles(productName: string, vendor: string): Promise<string[]> {
    const searchTerms = await this.resolveSearchTerms(productName, vendor);
    const localFiles = await this.findLocalMappingFiles(searchTerms);
    if (localFiles.length > 0) {
      return localFiles;
    }

    return this.findRemoteMappingFiles(searchTerms);
  }

  private async resolveSearchTerms(productName: string, vendor: string): Promise<string[]> {
    try {
      const resolved = await productService.resolveSearchTerms(`${vendor} ${productName}`);
      if (resolved) {
        return this.expandSearchTerms(resolved.allTerms);
      }
    } catch {
      // fall back to basic terms
    }
    return this.expandSearchTerms(this.buildSearchTerms(productName, vendor));
  }

  private buildSearchTerms(productName: string, vendor: string): string[] {
    const combined = `${vendor} ${productName}`.trim().toLowerCase();
    return combined ? [combined] : [];
  }

  private expandSearchTerms(terms: string[]): string[] {
    const expanded = new Set<string>();
    for (const term of terms) {
      const normalized = term.trim().toLowerCase();
      if (!normalized) continue;
      expanded.add(normalized);
      expanded.add(normalized.replace(/\s+/g, '-'));
      expanded.add(normalized.replace(/\s+/g, '_'));
    }
    return Array.from(expanded);
  }

  private async findLocalMappingFiles(searchTerms: string[]): Promise<string[]> {
    try {
      const globPath = path.join(LOCAL_CTID_PATH, 'security-stack', '**/*.json');
      const files = await glob(globPath);
      if (files.length === 0) return [];
      const matches = this.filterMappingPaths(
        files.map(file => path.relative(LOCAL_CTID_PATH, file).replace(/\\/g, '/')),
        searchTerms
      );
      return matches;
    } catch {
      return [];
    }
  }

  private async findRemoteMappingFiles(searchTerms: string[]): Promise<string[]> {
    for (const apiUrl of CTID_API_URLS) {
      try {
        const response = await fetchWithTimeout(apiUrl, {
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        });
        if (!response.ok) continue;
        const data = await response.json();
        const jsonFiles = (data.tree || [])
          .filter((item: { path: string; type: string }) =>
            item.type === 'blob' &&
            item.path.endsWith('.json') &&
            item.path.includes('/security-stack/')
          )
          .map((item: { path: string }) => item.path);

        const matches = this.filterMappingPaths(jsonFiles, searchTerms);
        if (matches.length > 0) {
          return matches;
        }
      } catch {
        continue;
      }
    }
    return [];
  }

  private filterMappingPaths(paths: string[], searchTerms: string[]): string[] {
    if (searchTerms.length === 0) return [];
    const results = new Set<string>();
    for (const filePath of paths) {
      const lower = filePath.toLowerCase();
      if (searchTerms.some(term => term && lower.includes(term))) {
        results.add(filePath);
      }
    }
    return Array.from(results);
  }

  private async fetchMappingFile(filePath: string): Promise<CTIDMapping[]> {
    const localMappings = await this.fetchLocalMappingFile(filePath);
    if (localMappings.length > 0) {
      return localMappings;
    }
    return this.fetchRemoteMappingFile(filePath);
  }

  private async fetchLocalMappingFile(filePath: string): Promise<CTIDMapping[]> {
    try {
      const fullPath = path.join(LOCAL_CTID_PATH, filePath);
      const raw = await fs.readFile(fullPath, 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : (data.mappings || []);
    } catch {
      return [];
    }
  }

  private async fetchRemoteMappingFile(filePath: string): Promise<CTIDMapping[]> {
    try {
      const response = await fetchWithTimeout(`${CTID_BASE_URL}/${filePath}`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return Array.isArray(data) ? data : (data.mappings || []);
    } catch {
      return [];
    }
  }

  private normalizeMappings(productId: string, mappings: CTIDMapping[]): NormalizedMapping {
    const techniqueIds = new Set<string>();
    const dataComponentsMap = new Map<string, DataComponentMapping>();
    const analytics: AnalyticMapping[] = [];

    // Extract technique IDs from CTID mappings
    const techniqueList = mappings
      .map(mapping => mitreKnowledgeGraph.normalizeTechniqueId(mapping.attack_object_id))
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    techniqueList.forEach(id => techniqueIds.add(id));

    // Build STIX context for all techniques (uses Knowledge Graph)
    const stixContext = buildTechniqueContext(techniqueList);

    // Process each CTID mapping into an analytic
    for (const mapping of mappings) {
      const techniqueId = mitreKnowledgeGraph.normalizeTechniqueId(mapping.attack_object_id);
      if (!techniqueId) continue;

      // Get raw CTID data
      const raw = mapping as any;
      const rawDataComponents = Array.isArray(raw.data_components) ? raw.data_components : [];
      const rawLogSources = Array.isArray(raw.log_sources) ? raw.log_sources : [];

      // Parse data components from raw CTID data
      const dataComponents = rawDataComponents.length > 0
        ? rawDataComponents
            .map((dc: any) =>
              typeof dc === 'string'
                ? dc
                : dc.name || dc.data_component || dc.data_component_name
            )
            .filter((dc: unknown): dc is string => typeof dc === 'string' && dc.length > 0)
        : [];

      // Enrich with STIX context
      const merged = mergeTechniqueContexts([techniqueId], stixContext);

      // Combine raw CTID data with STIX enrichment
      const enrichedDataComponents = new Set<string>(dataComponents);
      const enrichedLogSources = rawLogSources.length > 0
        ? rawLogSources
        : merged?.logSources || [];
      const enrichedMutableElements = merged?.mutableElements || [];

      // Add STIX-derived data components to the set
      if (merged?.dataComponents) {
        merged.dataComponents.forEach(dc => enrichedDataComponents.add(dc));
      }

      // Track all unique data components
      for (const dcName of enrichedDataComponents) {
        const id = `DC-${dcName.replace(/\s+/g, '-')}`;
        if (!dataComponentsMap.has(id)) {
          dataComponentsMap.set(id, {
            id,
            name: dcName,
            dataSource: 'Unknown',
          });
        }
      }

      // Extract log source names
      const logSourceNames = Array.isArray(enrichedLogSources)
        ? enrichedLogSources
            .map((entry: any) => (typeof entry === 'string' ? entry : entry?.name))
            .filter(Boolean)
        : [];

      // Extract mutable element fields
      const mutableElementFields = Array.isArray(enrichedMutableElements)
        ? enrichedMutableElements.map(entry => entry.field).filter(Boolean)
        : [];

      // Create analytic entry
      analytics.push({
        id: `CTID-${mapping.capability_id}-${techniqueId}`,
        name: `${mapping.capability_description} → ${mapping.attack_object_name || techniqueId}`,
        techniqueIds: [techniqueId],
        description: `Maps ${mapping.mapping_type} to ATT&CK technique ${techniqueId}`,
        source: 'ctid',
        repoName: 'CTID',
        ruleId: mapping.capability_id,
        logSources: logSourceNames,
        mutableElements: mutableElementFields,
        metadata: {
          data_components: Array.from(enrichedDataComponents),
          log_sources: enrichedLogSources,
          mutable_elements: enrichedMutableElements,
          stix_log_sources: merged?.logSources,
          stix_mutable_elements: merged?.mutableElements,
          stix_data_components: merged?.dataComponents,
        },
      });
    }

    return {
      productId,
      source: 'ctid',
      confidence: 0,
      detectionStrategies: Array.from(techniqueIds).map(t => `DS-${t}`),
      analytics,
      dataComponents: Array.from(dataComponentsMap.values()),
      rawData: mappings,
    };
  }
}
