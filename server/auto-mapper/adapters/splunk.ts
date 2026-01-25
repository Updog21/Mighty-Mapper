import { ResourceAdapter, NormalizedMapping, AnalyticMapping, DataComponentMapping } from '../types';
import * as yaml from 'js-yaml';
import { productService } from '../../services';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { fetchWithTimeout } from '../../utils/fetch';
import { mitreKnowledgeGraph } from '../../mitre-stix/knowledge-graph';
import { buildTechniqueContext, mergeTechniqueContexts } from '../graph-context';

const SPLUNK_API_URL = 'https://api.github.com/repos/splunk/security_content/git/trees/develop?recursive=1';
const PLATFORM_LABELS = [
  'Windows Endpoint',
  'Linux Server/Endpoint',
  'macOS Endpoint',
  'Identity Provider',
  'Cloud Infrastructure',
  'SaaS Application',
  'Container/Kubernetes',
  'Network Devices',
  'Office Suite',
  'ESXi / VMware',
];

interface SplunkDetection {
  name: string;
  id: string;
  description?: string;
  search?: string;
  data_source?: string[];
  mitre_attack_id?: string[];
  security_domain?: string;
  how_to_implement?: string;
  filePath?: string;
  tags?: string[];
}

export class SplunkAdapter implements ResourceAdapter {
  name: 'splunk' = 'splunk';
  private LOCAL_SPLUNK_PATH = path.resolve(process.cwd(), 'data', 'splunk-security-content');

  isApplicable(_productType: string, _platforms: string[]): boolean {
    return true;
  }

  async fetchMappings(productName: string, vendor: string): Promise<NormalizedMapping | null> {
    let searchTerms: string[];
    try {
      const resolved = await productService.resolveSearchTerms(`${vendor} ${productName}`);
      if (resolved) {
        searchTerms = resolved.allTerms.map((term) => term.toLowerCase());
      } else {
        searchTerms = this.buildSearchTerms(productName, vendor);
      }
    } catch {
      searchTerms = this.buildSearchTerms(productName, vendor);
    }

    const detections = await this.searchDetections(searchTerms);

    if (detections.length === 0) {
      return null;
    }

    await mitreKnowledgeGraph.ensureInitialized();
    return this.normalizeMappings(productName, detections);
  }

  private buildSearchTerms(productName: string, vendor: string): string[] {
    const combined = `${vendor} ${productName}`.trim().toLowerCase();
    return combined ? [combined] : [];
  }

  private async searchDetections(searchTerms: string[]): Promise<SplunkDetection[]> {
    const localDetections = await this.searchLocalDetections(searchTerms);
    if (localDetections.length > 0) return localDetections;
    return this.searchRemoteDetections(searchTerms);
  }

  private async searchLocalDetections(searchTerms: string[]): Promise<SplunkDetection[]> {
    try {
      const globPath = path.join(this.LOCAL_SPLUNK_PATH, 'detections', '**/*.yml');
      const files = await glob(globPath);
      if (files.length === 0) {
        return [];
      }

      const detections: SplunkDetection[] = [];
      const batchSize = 40;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (filePath) => {
            try {
              const rawYaml = await fs.readFile(filePath, 'utf-8');
              const relPath = path.relative(this.LOCAL_SPLUNK_PATH, filePath).replace(/\\/g, '/');
              return this.parseYaml(rawYaml, relPath, searchTerms);
            } catch {
              return null;
            }
          })
        );
        detections.push(...results.filter((d): d is SplunkDetection => d !== null));
      }

      return detections;
    } catch {
      return [];
    }
  }

  private async searchRemoteDetections(searchTerms: string[]): Promise<SplunkDetection[]> {
    try {
      const response = await fetchWithTimeout(SPLUNK_API_URL, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const yamlFiles = data.tree
        .filter((item: { path: string; type: string }) =>
          item.type === 'blob' &&
          item.path.endsWith('.yml') &&
          item.path.startsWith('detections/')
        );

      const detections: SplunkDetection[] = [];
      const batchSize = 40;
      for (let i = 0; i < yamlFiles.length; i += batchSize) {
        const batch = yamlFiles.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((file: { path: string }) => this.fetchDetection(file.path, searchTerms))
        );
        detections.push(...results.filter((d): d is SplunkDetection => d !== null));
      }

      return detections;
    } catch {
      return [];
    }
  }

  private async fetchDetection(path: string, searchTerms: string[]): Promise<SplunkDetection | null> {
    try {
      const response = await fetchWithTimeout(`https://raw.githubusercontent.com/splunk/security_content/develop/${path}`);
      if (!response.ok) return null;

      const rawYaml = await response.text();
      return this.parseYaml(rawYaml, path, searchTerms);
    } catch {
      return null;
    }
  }

  private parseYaml(rawYaml: string, filePath: string, searchTerms: string[]): SplunkDetection | null {
    try {
      const doc = yaml.load(rawYaml) as Record<string, any> | undefined;
      if (!doc || !doc.name || !doc.id) return null;

      const normalizeArray = (value: unknown): string[] => {
        if (Array.isArray(value)) return value.map(String);
        if (typeof value === 'string') return [value];
        return [];
      };

      const tags = typeof doc.tags === 'object' && doc.tags !== null ? doc.tags : {};
      const tagValues: string[] = [];
      for (const value of Object.values(tags)) {
        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (item) tagValues.push(String(item));
          });
        } else if (value) {
          tagValues.push(String(value));
        }
      }

      const topLevelMitre = normalizeArray(doc.mitre_attack_id);
      const tagMitre = normalizeArray(tags.mitre_attack_id);
      const mitreAttackIds = Array.from(new Set([...topLevelMitre, ...tagMitre]));

      const topLevelDataSource = normalizeArray(doc.data_source);
      const tagDataSource = normalizeArray(tags.data_source);
      const dataSources = Array.from(new Set([...topLevelDataSource, ...tagDataSource]));

      const detection: SplunkDetection = {
        name: String(doc.name),
        id: String(doc.id),
        description: typeof doc.description === 'string' ? doc.description : undefined,
        search: typeof doc.search === 'string' ? doc.search : undefined,
        data_source: dataSources.length > 0 ? dataSources : undefined,
        mitre_attack_id: mitreAttackIds.length > 0 ? mitreAttackIds : undefined,
        security_domain: typeof doc.security_domain === 'string'
          ? doc.security_domain
          : typeof tags.security_domain === 'string'
            ? tags.security_domain
            : undefined,
        how_to_implement: typeof doc.how_to_implement === 'string'
          ? doc.how_to_implement
          : typeof (doc as any).how_to_impliment === 'string'
            ? (doc as any).how_to_impliment
            : undefined,
        filePath,
        tags: tagValues.length > 0 ? tagValues : undefined,
      };

      if (!this.detectionMatches(detection, searchTerms)) return null;
      return detection;
    } catch {
      return null;
    }
  }

  private normalizeMappings(productId: string, detections: SplunkDetection[]): NormalizedMapping {
    const techniqueIds = new Set<string>();
    const analytics: AnalyticMapping[] = [];
    const dataComponents: DataComponentMapping[] = [];
    const seenDataSources = new Set<string>();

    for (const detection of detections) {
      const ruleTechniqueIds = new Set<string>();
      for (const id of detection.mitre_attack_id || []) {
        const normalized = mitreKnowledgeGraph.normalizeTechniqueId(id);
        if (normalized) ruleTechniqueIds.add(normalized);
      }
      if (ruleTechniqueIds.size === 0 && detection.data_source && detection.data_source.length > 0) {
        const inferred = mitreKnowledgeGraph.getTechniquesBySourceHints(
          detection.data_source,
          this.extractTactics(detection.tags)
        );
        inferred.forEach(tech => ruleTechniqueIds.add(tech.id));
      }

      ruleTechniqueIds.forEach(tid => techniqueIds.add(tid));

      const rawSource = this.extractRawSource(detection);

      const descriptionParts = [
        detection.description,
        detection.how_to_implement
          ? `How to implement: ${detection.how_to_implement}`
          : null,
        detection.security_domain
          ? `Security domain: ${detection.security_domain}`
          : null,
      ].filter(Boolean);

      analytics.push({
        id: `SPLUNK-${detection.id}`,
        name: detection.name,
        techniqueIds: Array.from(ruleTechniqueIds),
        platforms: [],
        description: descriptionParts.join('\n'),
        howToImplement: detection.how_to_implement,
        source: 'splunk',
        query: detection.search,
        logSources: detection.data_source,
        rawSource,
        sourceFile: detection.filePath ? detection.filePath.split('/').pop() : undefined,
        repoName: 'Splunk',
        ruleId: detection.id,
        metadata: {
          log_sources: detection.data_source,
          query: detection.search,
          description: detection.description,
          author: detection.tags?.find(tag => tag.toLowerCase().startsWith('author:'))?.split(':').slice(1).join(':').trim(),
        },
      });

      for (const ds of detection.data_source || []) {
        if (!seenDataSources.has(ds)) {
          seenDataSources.add(ds);
          dataComponents.push({
            id: `SPLUNK-DC-${ds.replace(/[^a-zA-Z0-9]/g, '-')}`,
            name: ds,
            dataSource: 'Splunk Data Source',
          });
        }
      }
    }

    const stixContext = buildTechniqueContext(Array.from(techniqueIds));
    if (stixContext.size > 0) {
      for (const analytic of analytics) {
        if (!analytic.techniqueIds || analytic.techniqueIds.length === 0) continue;
        const merged = mergeTechniqueContexts(analytic.techniqueIds, stixContext);
        if (!merged) continue;
        const metadata = { ...(analytic.metadata || {}) } as Record<string, unknown>;
        if (!('stix_log_sources' in metadata) && merged.logSources.length > 0) {
          metadata.stix_log_sources = merged.logSources;
        }
        if (!('stix_mutable_elements' in metadata) && merged.mutableElements.length > 0) {
          metadata.stix_mutable_elements = merged.mutableElements;
        }
        if (!('stix_data_components' in metadata) && merged.dataComponents.length > 0) {
          metadata.stix_data_components = merged.dataComponents;
        }
        analytic.metadata = metadata;
      }
    }

    return {
      productId,
      source: 'splunk',
      confidence: 0,
      detectionStrategies: Array.from(techniqueIds).map(t => `DS-${t}`),
      analytics,
      dataComponents,
      rawData: detections,
    };
  }

  private detectionMatches(detection: SplunkDetection, searchTerms: string[]): boolean {
    const inferredPlatform = detection.security_domain
      ? this.inferPlatform(detection.security_domain)
      : null;
    const haystackParts = [
      detection.filePath?.split('/').pop(),
      detection.name,
      detection.description,
      detection.security_domain,
      inferredPlatform,
      ...(detection.data_source || []),
      ...(detection.tags || []),
    ]
      .filter(Boolean)
      .map((value) => value?.toString().toLowerCase());

    return searchTerms.some((term) =>
      haystackParts.some((value) => value && value.includes(term))
    );
  }

  private inferPlatform(securityDomain: string): string | null {
    const normalized = securityDomain.toLowerCase().trim();
    if (!normalized) return null;
    const match = PLATFORM_LABELS.find((label) =>
      label.toLowerCase().includes(normalized)
    );
    return match || null;
  }

  private extractTactics(tags?: string[]): string[] {
    if (!tags || tags.length === 0) return [];
    const tactics = new Set<string>();
    for (const tag of tags) {
      const normalized = tag.toLowerCase().trim();
      if (normalized.startsWith('mitre_attack_tactic:')) {
        tactics.add(normalized.split(':').slice(1).join(':').trim());
        continue;
      }
      if (normalized.startsWith('mitre_attack_tactics:')) {
        tactics.add(normalized.split(':').slice(1).join(':').trim());
        continue;
      }
      if (normalized.startsWith('tactic:')) {
        tactics.add(normalized.split(':').slice(1).join(':').trim());
        continue;
      }
      if (normalized.startsWith('attack.')) {
        const parts = normalized.split('.');
        if (parts[1]) tactics.add(parts[1].trim());
      }
    }
    return Array.from(tactics);
  }

  private extractRawSource(detection: SplunkDetection): string | undefined {
    const direct = detection.data_source?.[0];
    if (direct) return direct;

    const search = detection.search || '';
    const sourcetypeMatch = search.match(/\bsourcetype\s*=\s*("?)([^"\s]+)\1/i);
    if (sourcetypeMatch?.[2]) return sourcetypeMatch[2];

    const indexMatch = search.match(/\bindex\s*=\s*("?)([^"\s]+)\1/i);
    if (indexMatch?.[2]) return indexMatch[2];

    return undefined;
  }

}
