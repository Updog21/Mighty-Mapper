import { ResourceAdapter, NormalizedMapping, AnalyticMapping, DataComponentMapping } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import * as yaml from 'js-yaml';
import { fetchWithTimeout } from '../../utils/fetch';
import { productService } from '../../services';
import { mitreKnowledgeGraph } from '../../mitre-stix/knowledge-graph';
import { buildTechniqueContext, mergeTechniqueContexts } from '../graph-context';

const AZURE_API_URLS = [
  'https://api.github.com/repos/Azure/Azure-Sentinel/git/trees/master?recursive=1',
  'https://api.github.com/repos/Azure/Azure-Sentinel/git/trees/main?recursive=1',
];
const AZURE_RAW_BASE = 'https://raw.githubusercontent.com/Azure/Azure-Sentinel';

interface AzureRule {
  name: string;
  ruleId: string;
  description?: string;
  query?: string;
  connectorIds?: string[];
  dataTypes?: string[];
  relevantTechniques?: string[];
  columnNames?: string[];
  tactics?: string[];
  filePath?: string;
}

export class AzureAdapter implements ResourceAdapter {
  name: 'azure' = 'azure';
  private LOCAL_AZURE_PATH = path.resolve(process.cwd(), 'data', 'azure-sentinel');

  isApplicable(_productType: string, _platforms: string[]): boolean {
    return true;
  }

  async fetchMappings(productName: string, vendor: string): Promise<NormalizedMapping | null> {
    let searchTerms: string[];
    try {
      const resolved = await productService.resolveSearchTerms(`${vendor} ${productName}`);
      if (resolved) {
        searchTerms = resolved.allTerms.map(term => term.toLowerCase());
      } else {
        searchTerms = this.buildSearchTerms(productName, vendor);
      }
    } catch {
      searchTerms = this.buildSearchTerms(productName, vendor);
    }

    const rules = await this.searchRules(searchTerms);

    if (rules.length === 0) {
      return null;
    }

    await mitreKnowledgeGraph.ensureInitialized();
    return this.normalizeMappings(productName, rules);
  }

  private buildSearchTerms(productName: string, vendor: string): string[] {
    const combined = `${vendor} ${productName}`.trim().toLowerCase();
    return combined ? [combined] : [];
  }

  private async searchRules(searchTerms: string[]): Promise<AzureRule[]> {
    const localRules = await this.searchLocalRules(searchTerms);
    if (localRules.length > 0) return localRules;
    return this.searchRemoteRules(searchTerms);
  }

  private async searchLocalRules(searchTerms: string[]): Promise<AzureRule[]> {
    try {
      const globPath = path.join(this.LOCAL_AZURE_PATH, 'Solutions', '**', 'Analytic* Rules', '**/*.{yml,yaml}');
      const files = await glob(globPath);
      if (files.length === 0) {
        return [];
      }

      const rules: AzureRule[] = [];
      const batchSize = 40;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (filePath) => {
            try {
              const raw = await fs.readFile(filePath, 'utf-8');
              const rule = this.parseYaml(raw, filePath);
              if (!rule) return null;
              return this.ruleMatches(rule, searchTerms) ? rule : null;
            } catch {
              return null;
            }
          })
        );
        rules.push(...results.filter((r): r is AzureRule => r !== null));
      }

      return rules;
    } catch {
      return [];
    }
  }

  private async searchRemoteRules(searchTerms: string[]): Promise<AzureRule[]> {
    for (const apiUrl of AZURE_API_URLS) {
      try {
        const response = await fetchWithTimeout(apiUrl, {
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        });

        if (!response.ok) {
          continue;
        }

        const data = await response.json();
        const yamlFiles = (data.tree || [])
          .filter((item: { path: string; type: string }) =>
            item.type === 'blob' &&
            (item.path.endsWith('.yml') || item.path.endsWith('.yaml')) &&
            item.path.includes('/Solutions/') &&
            (item.path.includes('/Analytic Rules/') || item.path.includes('/Analytics Rules/'))
          );

        const rules: AzureRule[] = [];
        const batchSize = 40;
        for (let i = 0; i < yamlFiles.length; i += batchSize) {
          const batch = yamlFiles.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map((file: { path: string }) => this.fetchRule(apiUrl, file.path, searchTerms))
          );
          rules.push(...results.filter((r): r is AzureRule => r !== null));
        }

        if (rules.length > 0) {
          return rules;
        }
      } catch {
        continue;
      }
    }

    return [];
  }

  private async fetchRule(apiUrl: string, filePath: string, searchTerms: string[]): Promise<AzureRule | null> {
    try {
      const branch = apiUrl.includes('/main?') ? 'main' : 'master';
      const response = await fetchWithTimeout(`${AZURE_RAW_BASE}/${branch}/${filePath}`);
      if (!response.ok) return null;

      const raw = await response.text();
      const rule = this.parseYaml(raw, filePath);
      if (!rule) return null;
      return this.ruleMatches(rule, searchTerms) ? rule : null;
    } catch {
      return null;
    }
  }

  private parseYaml(rawYaml: string, filePath?: string): AzureRule | null {
    try {
      const doc = yaml.load(rawYaml) as Record<string, any> | undefined;
      if (!doc) return null;

      const name = typeof doc.name === 'string' ? doc.name : undefined;
      const ruleId = typeof doc.id === 'string'
        ? doc.id
        : name || path.basename(filePath || 'rule', path.extname(filePath || ''));

      const connectorIds = collectValues(doc, 'connectorId');
      const dataTypes = collectValues(doc, 'dataTypes');
      const relevantTechniques = normalizeArray(doc.relevantTechniques);
      const columnNames = collectValues(doc, 'columnName');
      const tactics = Array.from(new Set([
        ...collectValues(doc, 'tactics'),
        ...collectValues(doc, 'tactic'),
      ]));

      return {
        name: name || ruleId,
        ruleId,
        description: typeof doc.description === 'string' ? doc.description : undefined,
        query: typeof doc.query === 'string' ? doc.query : undefined,
        connectorIds,
        dataTypes,
        relevantTechniques,
        columnNames,
        tactics,
        filePath,
      };
    } catch {
      return null;
    }
  }

  private ruleMatches(rule: AzureRule, searchTerms: string[]): boolean {
    const fileName = rule.filePath ? path.basename(rule.filePath) : undefined;
    const haystackParts = [
      fileName,
      rule.name,
      ...(rule.connectorIds || []),
      ...(rule.dataTypes || []),
    ]
      .filter(Boolean)
      .map(value => value?.toString().toLowerCase());

    return searchTerms.some(term =>
      haystackParts.some(value => value && value.includes(term))
    );
  }

  private normalizeMappings(productId: string, rules: AzureRule[]): NormalizedMapping {
    const techniqueIds = new Set<string>();
    const analytics: AnalyticMapping[] = [];
    const dataComponents: DataComponentMapping[] = [];
    const seenDataComponents = new Set<string>();

    for (const rule of rules) {
      const ruleTechniqueIds = new Set<string>();
      for (const id of rule.relevantTechniques || []) {
        const normalized = mitreKnowledgeGraph.normalizeTechniqueId(id);
        if (normalized) ruleTechniqueIds.add(normalized);
      }

      if (ruleTechniqueIds.size === 0) {
        const candidateSources = Array.from(new Set([
          ...(rule.dataTypes || []),
          ...(rule.connectorIds || []),
        ]));
        if (candidateSources.length > 0) {
          const inferred = mitreKnowledgeGraph.getTechniquesBySourceHints(
            candidateSources,
            this.extractTactics(rule.tactics)
          );
          inferred.forEach(tech => ruleTechniqueIds.add(tech.id));
        }
      }

      ruleTechniqueIds.forEach(tid => techniqueIds.add(tid));

      const rawSource = rule.dataTypes?.[0] || rule.connectorIds?.[0];

      analytics.push({
        id: `AZURE-${rule.ruleId}`,
        name: rule.name,
        techniqueIds: Array.from(ruleTechniqueIds),
        platforms: [],
        description: rule.description,
        source: 'azure',
        query: rule.query,
        logSources: rule.dataTypes,
        mutableElements: rule.columnNames,
        rawSource,
        sourceFile: rule.filePath ? rule.filePath.split('/').pop() : undefined,
        repoName: 'Azure',
        ruleId: rule.ruleId,
        metadata: {
          log_sources: rule.dataTypes,
          query: rule.query,
          mutable_elements: rule.columnNames,
        },
      });

      for (const dataType of rule.dataTypes || []) {
        if (seenDataComponents.has(dataType)) continue;
        seenDataComponents.add(dataType);
        dataComponents.push({
          id: `AZURE-DC-${dataType.replace(/[^a-zA-Z0-9]/g, '-')}`,
          name: dataType,
          dataSource: 'Azure Sentinel Data Type',
        });
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
      source: 'azure',
      confidence: 0,
      detectionStrategies: Array.from(techniqueIds).map(t => `DS-${t}`),
      analytics,
      dataComponents,
      rawData: rules,
    };
  }

  private extractTactics(tactics?: string[]): string[] {
    if (!tactics || tactics.length === 0) return [];
    const normalized = new Set<string>();
    for (const tactic of tactics) {
      const value = this.normalizeTacticValue(tactic);
      if (value) normalized.add(value);
    }
    return Array.from(normalized);
  }

  private normalizeTacticValue(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const withHyphens = trimmed
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/\s+/g, '-')
      .replace(/_/g, '-');
    return withHyphens.toLowerCase();
  }
}

function collectValues(obj: unknown, key: string): string[] {
  const values: string[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === key) {
        normalizeArray(v).forEach((item) => {
          const normalized = String(item).trim();
          if (!normalized || seen.has(normalized)) return;
          seen.add(normalized);
          values.push(normalized);
        });
      } else {
        visit(v);
      }
    }
  };

  visit(obj);
  return values;
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return [value];
  return [];
}
