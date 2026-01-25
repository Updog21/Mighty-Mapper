import { ResourceAdapter, NormalizedMapping, AnalyticMapping, DataComponentMapping } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { fetchWithTimeout } from '../../utils/fetch';
import { productService } from '../../services';
import { mitreKnowledgeGraph } from '../../mitre-stix/knowledge-graph';
import { buildTechniqueContext, mergeTechniqueContexts } from '../graph-context';

const ELASTIC_API_URL = 'https://api.github.com/repos/elastic/detection-rules/git/trees/main?recursive=1';

interface ElasticRule {
  name: string;
  rule_id: string;
  description?: string;
  index?: string[];
  query?: string;
  tags?: string[];
  integration?: string[];
  setup?: string;
  investigationFields?: string[];
  techniqueIds?: string[];
  filePath?: string;
}

export class ElasticAdapter implements ResourceAdapter {
  name: 'elastic' = 'elastic';
  private LOCAL_ELASTIC_PATH = path.resolve(process.cwd(), 'data', 'elastic-detection-rules');

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

  private async searchRules(searchTerms: string[]): Promise<ElasticRule[]> {
    const localRules = await this.searchLocalRules(searchTerms);
    if (localRules.length > 0) return localRules;
    return this.searchRemoteRules(searchTerms);
  }

  private async searchLocalRules(searchTerms: string[]): Promise<ElasticRule[]> {
    try {
      const globPath = path.join(this.LOCAL_ELASTIC_PATH, 'rules', '**/*.toml');
      const files = await glob(globPath);
      if (files.length === 0) {
        return [];
      }

      const rules: ElasticRule[] = [];
      const batchSize = 40;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (filePath) => {
            try {
              const toml = await fs.readFile(filePath, 'utf-8');
              const rule = this.parseToml(toml, filePath);
              if (!rule) return null;
              return this.ruleMatches(rule, searchTerms) ? rule : null;
            } catch {
              return null;
            }
          })
        );
        rules.push(...results.filter((r): r is ElasticRule => r !== null));
      }

      return rules;
    } catch {
      return [];
    }
  }

  private async searchRemoteRules(searchTerms: string[]): Promise<ElasticRule[]> {
    try {
      const response = await fetchWithTimeout(ELASTIC_API_URL, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const tomlFiles = data.tree
        .filter((item: { path: string; type: string }) => 
          item.type === 'blob' && 
          item.path.endsWith('.toml') &&
          item.path.startsWith('rules/')
        );

      const rules: ElasticRule[] = [];
      const batchSize = 40;
      for (let i = 0; i < tomlFiles.length; i += batchSize) {
        const batch = tomlFiles.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((file: { path: string }) => this.fetchRule(file.path, searchTerms))
        );
        rules.push(...results.filter((r): r is ElasticRule => r !== null));
      }

      return rules;
    } catch {
      return [];
    }
  }

  private async fetchRule(path: string, searchTerms: string[]): Promise<ElasticRule | null> {
    try {
      const response = await fetchWithTimeout(`https://raw.githubusercontent.com/elastic/detection-rules/main/${path}`);
      if (!response.ok) return null;

      const toml = await response.text();
      const rule = this.parseToml(toml, path);
      if (!rule) return null;
      return this.ruleMatches(rule, searchTerms) ? rule : null;
    } catch {
      return null;
    }
  }

  private parseToml(toml: string, filePath?: string): ElasticRule | null {
    try {
      const rule: Partial<ElasticRule> = {};
      const ruleSection = this.extractSection(toml, 'rule');
      const metadataSection = this.extractSection(toml, 'metadata');
      const investigationSection = this.extractSection(toml, 'rule.investigation_fields');

      rule.name = this.extractStringValue(ruleSection, 'name') || this.extractStringValue(toml, 'name');
      rule.rule_id = this.extractStringValue(toml, 'rule_id') || this.extractStringValue(ruleSection, 'rule_id');
      rule.description = this.extractStringValue(ruleSection, 'description') || this.extractStringValue(toml, 'description');
      rule.query = this.extractStringValue(ruleSection, 'query');
      rule.tags = this.extractArrayValue(ruleSection, 'tags');
      rule.integration = this.extractArrayValue(metadataSection, 'integration');
      rule.setup = this.extractStringValue(ruleSection, 'setup');
      rule.index = this.extractArrayValue(ruleSection, 'index');
      rule.investigationFields = this.extractArrayValue(investigationSection, 'field');
      rule.techniqueIds = this.extractThreatIds(toml);
      rule.filePath = filePath;

      if (!rule.name || !rule.rule_id) return null;
      return rule as ElasticRule;
    } catch {
      return null;
    }
  }

  private normalizeMappings(productId: string, rules: ElasticRule[]): NormalizedMapping {
    const techniqueIds = new Set<string>();
    const analytics: AnalyticMapping[] = [];
    const dataComponents: DataComponentMapping[] = [];
    const seenDataComponents = new Set<string>();

    for (const rule of rules) {
      const descriptionParts = [
        rule.description,
        rule.setup ? `How to implement: ${rule.setup}` : null,
      ].filter(Boolean);

      const logSources = this.extractDataSourceTags(rule.tags);
      const platforms = this.extractPlatformTags(rule.tags);
      const ruleTechniqueIds = new Set<string>();
      for (const id of rule.techniqueIds || []) {
        const normalized = mitreKnowledgeGraph.normalizeTechniqueId(id);
        if (normalized) ruleTechniqueIds.add(normalized);
      }

      if (ruleTechniqueIds.size === 0 && logSources && logSources.length > 0) {
        const inferred = mitreKnowledgeGraph.getTechniquesBySourceHints(
          logSources,
          this.extractTactics(rule.tags)
        );
        inferred.forEach(tech => ruleTechniqueIds.add(tech.id));
      }

      ruleTechniqueIds.forEach(tid => techniqueIds.add(tid));

      const rawSource = rule.integration?.[0] || rule.index?.[0];

      analytics.push({
        id: `ELASTIC-${rule.rule_id}`,
        name: rule.name,
        techniqueIds: Array.from(ruleTechniqueIds),
        platforms,
        description: descriptionParts.join('\n'),
        source: 'elastic',
        query: rule.query,
        howToImplement: rule.setup,
        logSources,
        mutableElements: rule.investigationFields,
        rawSource,
        sourceFile: rule.filePath ? rule.filePath.split('/').pop() : undefined,
        repoName: 'Elastic',
        ruleId: rule.rule_id,
        metadata: {
          log_sources: logSources,
          query: rule.query,
          setup: rule.setup,
          mutable_elements: rule.investigationFields,
        },
      });

      if (rule.index) {
        for (const idx of rule.index) {
          if (seenDataComponents.has(idx)) continue;
          seenDataComponents.add(idx);
          dataComponents.push({
            id: `ELASTIC-DC-${idx.replace(/[^a-zA-Z0-9]/g, '-')}`,
            name: idx,
            dataSource: 'Elastic Index',
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
      source: 'elastic',
      confidence: 0,
      detectionStrategies: Array.from(techniqueIds).map(t => `DS-${t}`),
      analytics,
      dataComponents: Array.from(new Map(dataComponents.map(dc => [dc.id, dc])).values()),
      rawData: rules,
    };
  }

  private ruleMatches(rule: ElasticRule, searchTerms: string[]): boolean {
    const fileName = rule.filePath ? path.basename(rule.filePath) : undefined;
    const haystackParts = [
      fileName,
      rule.name,
      rule.description,
      ...(rule.integration || []),
      ...(rule.tags || []),
    ]
      .filter(Boolean)
      .map(value => value?.toString().toLowerCase());

    return searchTerms.some(term =>
      haystackParts.some(value => value && value.includes(term))
    );
  }

  private extractSection(toml: string, header: string): string | null {
    const headerRegex = new RegExp(`^\\[${header.replace(/\./g, '\\.')}]\\s*$`, 'm');
    const headerMatch = headerRegex.exec(toml);
    if (!headerMatch) return null;
    const startIndex = headerMatch.index + headerMatch[0].length;
    const remainder = toml.slice(startIndex);
    const nextHeaderIndex = remainder.search(/^\s*\[+/m);
    if (nextHeaderIndex === -1) {
      return remainder;
    }
    return remainder.slice(0, nextHeaderIndex);
  }

  private extractStringValue(section: string | null, key: string): string | undefined {
    if (!section) return undefined;
    const tripleQuote = new RegExp(`${key}\\s*=\\s*\"\"\"([\\s\\S]*?)\"\"\"`);
    const tripleQuoteSingle = new RegExp(`${key}\\s*=\\s*'''([\\s\\S]*?)'''`);
    const doubleQuote = new RegExp(`${key}\\s*=\\s*\"([^\"]*)\"`);
    const singleQuote = new RegExp(`${key}\\s*=\\s*'([^']*)'`);

    const match = section.match(tripleQuote)
      || section.match(tripleQuoteSingle)
      || section.match(doubleQuote)
      || section.match(singleQuote);
    return match ? match[1].trim() : undefined;
  }

  private extractArrayValue(section: string | null, key: string): string[] | undefined {
    if (!section) return undefined;
    const arrayMatch = section.match(new RegExp(`${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
    if (!arrayMatch) return undefined;
    const values = Array.from(arrayMatch[1].matchAll(/"([^"]+)"|'([^']+)'/g))
      .map(match => (match[1] || match[2] || '').trim())
      .filter(Boolean);
    return values.length > 0 ? values : undefined;
  }

  private extractThreatIds(toml: string): string[] {
    const ids = new Set<string>();

    const threatBlocks = toml.split('[[rule.threat]]').slice(1);
    for (const block of threatBlocks) {
      const idMatch = block.match(/^\s*id\s*=\s*"([^"]+)"/m);
      if (idMatch) ids.add(idMatch[1]);
    }

    const techniqueRegex = /\[\[rule\.threat\.technique\]\]\s*[\s\S]*?\bid\s*=\s*"([^"]+)"/g;
    for (const match of toml.matchAll(techniqueRegex)) {
      ids.add(match[1]);
    }

    const subtechniqueRegex = /\[\[rule\.threat\.technique\.subtechnique\]\]\s*[\s\S]*?\bid\s*=\s*"([^"]+)"/g;
    for (const match of toml.matchAll(subtechniqueRegex)) {
      ids.add(match[1]);
    }

    return Array.from(ids);
  }

  private extractDataSourceTags(tags?: string[]): string[] | undefined {
    if (!tags || tags.length === 0) return undefined;
    const dataSources = tags
      .map(tag => tag.trim())
      .filter(tag => tag.toLowerCase().startsWith('data source:'))
      .map(tag => tag.split(':').slice(1).join(':').trim())
      .filter(Boolean);
    return dataSources.length > 0 ? dataSources : undefined;
  }

  private extractPlatformTags(tags?: string[]): string[] {
    if (!tags || tags.length === 0) return [];
    const platforms = new Set<string>();
    for (const tag of tags) {
      const normalized = tag.toLowerCase();
      if (normalized.includes('os: windows') || normalized.includes('platform: windows')) {
        platforms.add('Windows');
      }
      if (normalized.includes('os: linux') || normalized.includes('platform: linux')) {
        platforms.add('Linux');
      }
      if (normalized.includes('os: macos') || normalized.includes('platform: macos')) {
        platforms.add('macOS');
      }
    }
    return Array.from(platforms);
  }

  private extractTactics(tags?: string[]): string[] {
    if (!tags || tags.length === 0) return [];
    const tactics = new Set<string>();
    for (const tag of tags) {
      const normalized = tag.toLowerCase().trim();
      if (normalized.startsWith('tactic:')) {
        tactics.add(normalized.split(':').slice(1).join(':').trim());
        continue;
      }
      if (normalized.startsWith('attack.')) {
        const parts = normalized.split('.');
        if (parts[1]) tactics.add(parts[1].trim());
        continue;
      }
      if (normalized.startsWith('mitre attack:')) {
        tactics.add(normalized.split(':').slice(1).join(':').trim());
      }
    }
    return Array.from(tactics);
  }
}
