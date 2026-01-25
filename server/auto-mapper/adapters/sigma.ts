/**
 * Sigma Adapter - Phase 2: Intelligence & Persistence
 *
 * Architecture:
 * 1. Sigma Adapter's Job: Find the KEYS (Technique IDs and Data Component Names). That's it.
 * 2. Workbench's Job: Use those Keys to "hydrate" the result with rich context.
 *
 * Two-Tier Logic:
 * - Tier 1 (90%): Rule has attack.tXXXX tags → Extract ID, STOP
 * - Tier 2 (10%): No ID, only category + tactic → Use map, query Workbench
 *
 * Phase 2 Enhancement:
 * - Now accepts injected search terms from ProductService for alias resolution
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { glob } from 'glob';
import { mitreKnowledgeGraph } from '../../mitre-stix/knowledge-graph';
import { ResourceAdapter, NormalizedMapping, AnalyticMapping, DataComponentMapping } from '../types';
import { productService } from '../../services';
import { fetchWithTimeout } from '../../utils/fetch';
import { buildTechniqueContext, mergeTechniqueContexts } from '../graph-context';

interface ScoredId {
  id: string;                          // T-Code or DC-Name
  type: 'technique' | 'data-component';
  source: string;                      // 'tag' or 'inference'
}

interface ExtractedRule {
  ruleId: string;
  title: string;
  description?: string;
  logsource: {
    category?: string;
    product?: string;
    service?: string;
  };
  detection?: Record<string, unknown>;
  falsepositives?: string[];
  tags?: string[];
  foundIds: ScoredId[];
  filePath?: string;
}

export class SigmaAdapter implements ResourceAdapter {
  name: 'sigma' = 'sigma';
  private dataComponentLookup: Map<string, string> | null = null;
  private dataComponentIndex: Array<{ normalized: string; name: string }> = [];

  // Relative path - works in both Docker (WORKDIR /app) and local dev
  private BASE_SIGMA_PATH = path.resolve(process.cwd(), 'data', 'sigma');
  private SIGMA_API_URLS = [
    'https://api.github.com/repos/SigmaHQ/sigma/git/trees/main?recursive=1',
    'https://api.github.com/repos/SigmaHQ/sigma/git/trees/master?recursive=1',
  ];
  private SIGMA_RAW_BASE = 'https://raw.githubusercontent.com/SigmaHQ/sigma';

  // Rule directories to scan
  private rulePaths = [
    'rules',
    'rules-emerging-threats',
    'rules-threat-hunting',
    'rules-compliance'
  ];

  isApplicable(_productType: string, _platforms: string[]): boolean {
    return true;
  }

  /**
   * Main Entry Point
   * Phase 2: Now uses ProductService for intelligent alias resolution
   */
  async fetchMappings(productName: string, vendor: string): Promise<NormalizedMapping | null> {
    console.log(`[Sigma] Starting ID Extraction for: "${productName}"`);
    await mitreKnowledgeGraph.ensureInitialized();

    // Phase 2: Try to resolve search terms via ProductService (alias-aware)
    let searchTerms: string[];
    try {
      const resolved = await productService.resolveSearchTerms(`${vendor} ${productName}`);
      if (resolved) {
        searchTerms = resolved.allTerms;
        console.log(`[Sigma] ProductService resolved "${productName}" → ${searchTerms.length} search terms`);
      } else {
        // Fall back to basic term building
        searchTerms = this.buildSearchTerms(productName, vendor);
        console.log(`[Sigma] No alias found, using basic terms: ${searchTerms.length} terms`);
      }
    } catch (e) {
      // ProductService not available (e.g., database not connected), use fallback
      searchTerms = this.buildSearchTerms(productName, vendor);
      console.log(`[Sigma] ProductService unavailable, using basic terms`);
    }

    // 1. Find Files (Local only)
    const allFiles = await this.findLocalFiles();

    if (allFiles.length === 0) {
      console.warn(`[Sigma] 0 files found. Check your ${this.BASE_SIGMA_PATH} folder.`);
      return null;
    }

    console.log(`[Sigma] Found ${allFiles.length} rules. Processing in batches...`);

    // 2. Process in Batches (Fixes the Hang)
    const BATCH_SIZE = 50;
    const extractedData: ExtractedRule[] = [];

    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const chunk = allFiles.slice(i, i + BATCH_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(file => {
          if (file.startsWith('http')) {
            return this.extractIdsFromRemote(file, searchTerms);
          }
          return this.extractIdsFromFile(file, searchTerms);
        })
      );
      extractedData.push(...chunkResults.filter((r): r is ExtractedRule => r !== null));

      // Heartbeat every 500 files
      if ((i + BATCH_SIZE) % 500 === 0) process.stdout.write('.');
    }
    console.log(`\n[Sigma] Extraction Complete. Matched ${extractedData.length} rules.`);

    if (extractedData.length === 0) {
      return null;
    }

    // 3. Hydrate with Workbench Data (The "End Goal")
    return this.hydrateFromWorkbench(productName, extractedData);
  }

  /**
   * CORE LOGIC: Find IDs and Stop
   */
  private async extractIdsFromFile(filePath: string, searchTerms: string[]): Promise<ExtractedRule | null> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return this.extractIdsFromContent(content, filePath, searchTerms);
    } catch {
      return null;
    }
  }

  private async extractIdsFromRemote(url: string, searchTerms: string[]): Promise<ExtractedRule | null> {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) return null;
      const content = await response.text();
      return this.extractIdsFromContent(content, url, searchTerms);
    } catch {
      return null;
    }
  }

  private extractIdsFromContent(content: string, filePath: string, searchTerms: string[]): ExtractedRule | null {
    try {
      const doc = yaml.load(content) as any;

      if (!doc || !doc.title) return null;

      // A. Match Product
      if (!this.ruleMatches(doc, searchTerms)) return null;

      const ids: ScoredId[] = [];

      // B. Tier 1: Direct Technique IDs (The Preferred Path)
      const tagIds = this.extractTagIds(doc.tags);
      if (tagIds.length > 0) {
        tagIds.forEach(tId => ids.push({
          id: tId,
          type: 'technique',
          source: 'tag'
        }));
      }
      // C. Tier 2: Inference (Map Category -> DC Name)
      else if (doc.logsource?.category) {
        const mitreDcName = this.getDataComponentForCategory(doc.logsource.category);

        if (mitreDcName) {
          // We found a Data Component Name.
          // Add it to the list. Hydration step will find Techniques.
          ids.push({
            id: mitreDcName,
            type: 'data-component',
            source: 'inference'
          });
        }
      }

      if (ids.length === 0) return null;

      return {
        ruleId: doc.id || doc.title,
        title: doc.title,
        description: doc.description,
        logsource: doc.logsource || {},
        detection: doc.detection || {},
        falsepositives: Array.isArray(doc.falsepositives) ? doc.falsepositives : [],
        tags: doc.tags,  // Preserve tags for tactic extraction in hydration
        foundIds: ids,
        filePath
      };

    } catch {
      return null;
    }
  }

  private async findLocalFiles(): Promise<string[]> {
    try {
      let allFiles: string[] = [];
      for (const subDir of this.rulePaths) {
        const searchPath = path.join(this.BASE_SIGMA_PATH, subDir, '**/*.yml');
        const files = await glob(searchPath);
        allFiles = allFiles.concat(files);
      }
      return allFiles;
    } catch (e) {
      console.error(`[Sigma] Error finding files at ${this.BASE_SIGMA_PATH}. Did you clone the repo?`, e);
      return [];
    }
  }

  private async findRemoteFiles(searchTerms: string[]): Promise<string[]> {
    for (const apiUrl of this.SIGMA_API_URLS) {
      try {
        const response = await fetchWithTimeout(apiUrl, {
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        });
        if (!response.ok) {
          continue;
        }
        const data = await response.json();
        const files = (data.tree || [])
          .filter((item: { path: string; type: string }) =>
            item.type === 'blob' &&
            item.path.endsWith('.yml') &&
            this.rulePaths.some(prefix => item.path.startsWith(`${prefix}/`))
          )
          .filter((item: { path: string }) =>
            searchTerms.some(term => item.path.toLowerCase().includes(term.toLowerCase()))
          )
          .map((item: { path: string }) => {
            const branch = apiUrl.includes('/main?') ? 'main' : 'master';
            return `${this.SIGMA_RAW_BASE}/${branch}/${item.path}`;
          });

        if (files.length > 0) {
          return files;
        }
      } catch {
        continue;
      }
    }
    return [];
  }

  /**
   * FINAL STEP: Use Workbench to determine everything else
   */
  private hydrateFromWorkbench(productName: string, extractedRules: ExtractedRule[]): NormalizedMapping {
    const techniquesSet = new Set<string>();
    const analytics: AnalyticMapping[] = [];
    const dcMap = new Set<string>();

    for (const item of extractedRules) {
      const ruleTechniqueIds = new Set<string>();

      // Resolve IDs using Workbench
      for (const idObj of item.foundIds) {

        if (idObj.type === 'technique') {
          // We have the T-ID directly. Just verify it exists in graph.
          const tech = mitreKnowledgeGraph.getTechnique(idObj.id);
          if (tech) {
            techniquesSet.add(tech.id);
            ruleTechniqueIds.add(tech.id);
          }
        }
        else if (idObj.type === 'data-component') {
          // We have the DC Name. Ask Workbench for the T-IDs.
          const tactic = this.extractTactic(item.tags); // Use tags from rule root
          const inferredTechs = mitreKnowledgeGraph.getTechniquesByTacticAndDataComponent(
            tactic || 'execution', // Default tactic if none found
            idObj.id               // The Data Component Name
          );

          inferredTechs.forEach(t => {
            techniquesSet.add(t.id);
            ruleTechniqueIds.add(t.id);
          });

          // Also track the Data Component itself for the UI
          dcMap.add(idObj.id);
        }
      }

      // Add Analytic (From Rule)
      analytics.push({
        id: `SIGMA-${item.ruleId}`,
        name: item.title,
        techniqueIds: Array.from(ruleTechniqueIds),
        platforms: this.extractPlatforms(item.tags),
        description: item.description,
        source: 'sigma',
        sourceFile: item.filePath ? item.filePath.split('/').pop() : undefined,
        repoName: 'Sigma',
        ruleId: item.ruleId,
        rawSource: this.getRawSource(item.logsource),
        metadata: {
          log_sources: this.formatLogSources(item.logsource),
          query: item.detection || undefined,
          caveats: item.falsepositives && item.falsepositives.length > 0 ? item.falsepositives : undefined,
        },
      });
    }

    const dataComponents: DataComponentMapping[] = Array.from(dcMap).map(name => ({
      id: `DC-${name.replace(/\s+/g, '-')}`,
      name,
      dataSource: 'Unknown' // UI will look up Source via Graph
    }));

    // Enrich analytics with STIX context (log sources, channels, mutable elements)
    const allTechniqueIds = Array.from(techniquesSet);
    const stixContext = buildTechniqueContext(allTechniqueIds);
    if (stixContext.size > 0) {
      for (const analytic of analytics) {
        if (!analytic.techniqueIds || analytic.techniqueIds.length === 0) continue;
        const merged = mergeTechniqueContexts(analytic.techniqueIds, stixContext);
        if (!merged) continue;

        const metadata = { ...(analytic.metadata || {}) } as Record<string, unknown>;

        // Add STIX-derived metadata only if not already present
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
      productId: productName,
      source: 'sigma',
      confidence: 0,
      detectionStrategies: allTechniqueIds.map(t => `DS-${t}`),
      analytics,
      dataComponents,
      rawData: { rules: extractedRules }
    };
  }

  // --- Helpers ---

  private buildSearchTerms(productName: string, vendor: string): string[] {
    const combined = `${vendor} ${productName}`.trim().toLowerCase();
    return combined ? [combined] : [];
  }

  private extractPlatforms(tags?: string[]): string[] {
    if (!tags || tags.length === 0) return [];
    const platforms = new Set<string>();
    for (const tag of tags) {
      const normalized = tag.toLowerCase();
      if (normalized.includes('os:windows') || normalized.includes('platform:windows')) {
        platforms.add('Windows');
      }
      if (normalized.includes('os:linux') || normalized.includes('platform:linux')) {
        platforms.add('Linux');
      }
      if (normalized.includes('os:macos') || normalized.includes('platform:macos') || normalized.includes('os:osx')) {
        platforms.add('macOS');
      }
    }
    return Array.from(platforms);
  }

  private formatLogSources(logsource: ExtractedRule['logsource']): string[] {
    const parts = [logsource.category, logsource.product, logsource.service].filter(Boolean);
    if (parts.length === 0) return [];
    return [parts.join(' / ')];
  }

  private getDataComponentForCategory(category: string): string | null {
    const normalized = this.normalizeCategory(category);
    if (!normalized) return null;
    const lookup = this.getDataComponentLookup();
    const direct = lookup.get(normalized);
    if (direct) return direct;

    let best: { name: string; score: number } | null = null;
    for (const entry of this.dataComponentIndex) {
      if (entry.normalized.includes(normalized) || normalized.includes(entry.normalized)) {
        const score = Math.abs(entry.normalized.length - normalized.length);
        if (!best || score < best.score) {
          best = { name: entry.name, score };
        }
      }
    }
    return best ? best.name : null;
  }

  private getDataComponentLookup(): Map<string, string> {
    if (this.dataComponentLookup) return this.dataComponentLookup;
    const lookup = new Map<string, string>();
    const index: Array<{ normalized: string; name: string }> = [];
    const components = mitreKnowledgeGraph.getAllDataComponents();
    for (const dc of components) {
      const normalized = this.normalizeCategory(dc.name);
      if (!normalized) continue;
      if (!lookup.has(normalized)) {
        lookup.set(normalized, dc.name);
      }
      index.push({ normalized, name: dc.name });
    }
    this.dataComponentLookup = lookup;
    this.dataComponentIndex = index;
    return lookup;
  }

  private normalizeCategory(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getRawSource(logsource: ExtractedRule['logsource']): string | undefined {
    if (logsource.product && logsource.service) {
      return `${logsource.product}:${logsource.service}`;
    }
    return logsource.service || logsource.category || logsource.product || undefined;
  }

  private ruleMatches(doc: any, terms: string[]): boolean {
    // Check product/service/category/description
    const corpus = [
      JSON.stringify(doc.logsource || {}),
      doc.description || '',
      doc.title || ''
    ].join(' ').toLowerCase();

    return terms.some(t => corpus.includes(t));
  }

  private extractTagIds(tags?: string[]): string[] {
    if (!tags) return [];
    return tags
      .filter(t => t.match(/^attack\.t\d{4}/i))
      .map(t => t.replace('attack.', '').toUpperCase());
  }

  private extractTactic(tags?: string[]): string | null {
    if (!tags) return null;
    // Find tags like 'attack.execution', 'attack.persistence' (not technique IDs)
    const tacticTag = tags.find(x =>
      x.startsWith('attack.') && !x.match(/^attack\.t\d{4}/i)
    );
    return tacticTag ? tacticTag.replace('attack.', '') : null;
  }

  private getRuleType(filePath: string): string {
    if (filePath.includes('emerging')) return 'emerging';
    if (filePath.includes('hunting')) return 'hunting';
    if (filePath.includes('compliance')) return 'compliance';
    return 'generic';
  }
}
