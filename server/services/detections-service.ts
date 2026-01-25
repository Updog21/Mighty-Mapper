import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import * as yaml from 'js-yaml';

export type DetectionSource = 'sigma' | 'elastic' | 'splunk' | 'azure';

export interface DetectionRecord {
  id: string;
  name: string;
  description?: string;
  techniqueIds?: string[];
  logSources?: string[];
  query?: string;
  howToImplement?: string;
  source: DetectionSource;
  sourceFile?: string;
}

const SIGMA_RULE_PATHS = [
  'rules',
  'rules-emerging-threats',
  'rules-threat-hunting',
  'rules-compliance'
];

const BASE_PATHS = {
  sigma: path.resolve(process.cwd(), 'data', 'sigma'),
  splunk: path.resolve(process.cwd(), 'data', 'splunk-security-content'),
  elastic: path.resolve(process.cwd(), 'data', 'elastic-detection-rules'),
  azure: path.resolve(process.cwd(), 'data', 'azure-sentinel'),
};

export async function getAllDetections(): Promise<DetectionRecord[]> {
  const [sigma, splunk, elastic, azure] = await Promise.all([
    getSigmaDetections(),
    getSplunkDetections(),
    getElasticDetections(),
    getAzureDetections(),
  ]);

  return [...sigma, ...splunk, ...elastic, ...azure];
}

async function getSigmaDetections(): Promise<DetectionRecord[]> {
  try {
    const basePath = BASE_PATHS.sigma;
    const globPaths = SIGMA_RULE_PATHS.map(rulePath =>
      path.join(basePath, rulePath, '**/*.yml')
    );
    const files = (await Promise.all(globPaths.map(p => glob(p)))).flat();
    if (files.length === 0) return [];

    return readInBatches(files, async (filePath) => {
      const raw = await fs.readFile(filePath, 'utf-8');
      const doc = yaml.load(raw) as Record<string, any> | undefined;
      if (!doc || (!doc.title && !doc.id)) return null;

      const tags = Array.isArray(doc.tags) ? doc.tags.map(String) : [];
      const techniqueIds = extractSigmaTechniqueIds(tags);
      const ruleId = doc.id || doc.title || path.basename(filePath, path.extname(filePath));

      return {
        id: `SIGMA-${ruleId}`,
        name: String(doc.title || doc.name || ruleId),
        description: typeof doc.description === 'string' ? doc.description : undefined,
        techniqueIds: techniqueIds.length > 0 ? techniqueIds : undefined,
        source: 'sigma',
        sourceFile: path.basename(filePath),
      } satisfies DetectionRecord;
    });
  } catch {
    return [];
  }
}

async function getSplunkDetections(): Promise<DetectionRecord[]> {
  try {
    const basePath = BASE_PATHS.splunk;
    const files = await glob(path.join(basePath, 'detections', '**/*.yml'));
    if (files.length === 0) return [];

    return readInBatches(files, async (filePath) => {
      const raw = await fs.readFile(filePath, 'utf-8');
      const doc = yaml.load(raw) as Record<string, any> | undefined;
      if (!doc || (!doc.name && !doc.id)) return null;

      const tags = typeof doc.tags === 'object' && doc.tags !== null ? doc.tags : {};
      const tagMitre = normalizeArray(tags.mitre_attack_id);
      const topMitre = normalizeArray(doc.mitre_attack_id);
      const techniqueIds = Array.from(new Set([...topMitre, ...tagMitre]));
      const tagDataSource = normalizeArray(tags.data_source);
      const topDataSource = normalizeArray(doc.data_source);
      const logSources = Array.from(new Set([...topDataSource, ...tagDataSource]));

      const howToImplement = typeof doc.how_to_implement === 'string'
        ? doc.how_to_implement
        : typeof (doc as any).how_to_impliment === 'string'
          ? (doc as any).how_to_impliment
          : undefined;

      return {
        id: `SPLUNK-${doc.id || doc.name}`,
        name: String(doc.name || doc.id),
        description: typeof doc.description === 'string' ? doc.description : undefined,
        techniqueIds: techniqueIds.length > 0 ? techniqueIds : undefined,
        logSources: logSources.length > 0 ? logSources : undefined,
        query: typeof doc.search === 'string' ? doc.search : undefined,
        howToImplement,
        source: 'splunk',
        sourceFile: path.basename(filePath),
      } satisfies DetectionRecord;
    });
  } catch {
    return [];
  }
}

async function getElasticDetections(): Promise<DetectionRecord[]> {
  try {
    const basePath = BASE_PATHS.elastic;
    const files = await glob(path.join(basePath, 'rules', '**/*.toml'));
    if (files.length === 0) return [];

    return readInBatches(files, async (filePath) => {
      const toml = await fs.readFile(filePath, 'utf-8');
      const ruleSection = extractSection(toml, 'rule');
      const ruleId = extractStringValue(toml, 'rule_id') || extractStringValue(ruleSection, 'rule_id');
      const name = extractStringValue(ruleSection, 'name') || extractStringValue(toml, 'name');

      if (!ruleId && !name) return null;

      const description = extractStringValue(ruleSection, 'description') || extractStringValue(toml, 'description');
      const query = extractStringValue(ruleSection, 'query');
      const setup = extractStringValue(ruleSection, 'setup');
      const tags = extractArrayValue(ruleSection, 'tags');
      const techniqueIds = extractThreatIds(toml);
      const logSources = extractDataSourceTags(tags);

      return {
        id: `ELASTIC-${ruleId || name}`,
        name: String(name || ruleId),
        description: description || undefined,
        techniqueIds: techniqueIds.length > 0 ? techniqueIds : undefined,
        logSources: logSources.length > 0 ? logSources : undefined,
        query: query || undefined,
        howToImplement: setup || undefined,
        source: 'elastic',
        sourceFile: path.basename(filePath),
      } satisfies DetectionRecord;
    });
  } catch {
    return [];
  }
}

async function getAzureDetections(): Promise<DetectionRecord[]> {
  try {
    const basePath = BASE_PATHS.azure;
    const globPath = path.join(basePath, 'Solutions', '**', 'Analytic* Rules', '**/*.{yml,yaml}');
    const files = await glob(globPath);
    if (files.length === 0) return [];

    return readInBatches(files, async (filePath) => {
      const raw = await fs.readFile(filePath, 'utf-8');
      const doc = yaml.load(raw) as Record<string, any> | undefined;
      if (!doc) return null;

      const name = typeof doc.name === 'string' ? doc.name : undefined;
      const ruleId = typeof doc.id === 'string'
        ? doc.id
        : name || path.basename(filePath, path.extname(filePath));

      const connectorIds = collectValues(doc, 'connectorId');
      const dataTypes = collectValues(doc, 'dataTypes');
      const relevantTechniques = normalizeArray(doc.relevantTechniques);
      const columnNames = collectValues(doc, 'columnName');

      return {
        id: `AZURE-${ruleId}`,
        name: name || ruleId,
        description: typeof doc.description === 'string' ? doc.description : undefined,
        techniqueIds: relevantTechniques.length > 0 ? relevantTechniques : undefined,
        logSources: dataTypes.length > 0 ? dataTypes : undefined,
        query: typeof doc.query === 'string' ? doc.query : undefined,
        source: 'azure',
        sourceFile: path.basename(filePath),
        howToImplement: undefined,
      } satisfies DetectionRecord;
    });
  } catch {
    return [];
  }
}

async function readInBatches<T>(
  files: string[],
  worker: (filePath: string) => Promise<T | null>,
  batchSize = 50
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (filePath) => {
        try {
          return await worker(filePath);
        } catch {
          return null;
        }
      })
    );
    results.push(...batchResults.filter((item): item is T => item !== null));
  }
  return results;
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return [value];
  return [];
}

function extractSigmaTechniqueIds(tags: string[]): string[] {
  const ids = new Set<string>();
  tags.forEach((tag) => {
    const match = tag.match(/attack\.t(\d{4}(?:\.\d{3})?)/i);
    if (match) {
      ids.add(`T${match[1]}`.toUpperCase());
    }
  });
  return Array.from(ids);
}

function extractSection(toml: string, header: string): string | null {
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

function extractStringValue(section: string | null, key: string): string | undefined {
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

function extractArrayValue(section: string | null, key: string): string[] | undefined {
  if (!section) return undefined;
  const arrayMatch = section.match(new RegExp(`${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!arrayMatch) return undefined;
  const values = Array.from(arrayMatch[1].matchAll(/"([^"]+)"|'([^']+)'/g))
    .map(match => (match[1] || match[2] || '').trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function extractThreatIds(toml: string): string[] {
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

function extractDataSourceTags(tags?: string[]): string[] {
  if (!tags || tags.length === 0) return [];
  return tags
    .map(tag => tag.trim())
    .filter(tag => tag.toLowerCase().startsWith('data source:'))
    .map(tag => tag.split(':').slice(1).join(':').trim())
    .filter(Boolean);
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
