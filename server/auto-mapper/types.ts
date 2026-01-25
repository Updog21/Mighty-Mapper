import type { ResourceType } from '@shared/schema';

export interface NormalizedMapping {
  productId: string;
  source: ResourceType;
  confidence: number;
  detectionStrategies: string[];
  analytics: AnalyticMapping[];
  dataComponents: DataComponentMapping[];
  rawData: unknown;
  techniqueSources?: Record<string, ResourceType[]>;
}

export interface AnalyticMapping {
  id: string;
  name: string;
  techniqueIds?: string[];
  platforms?: string[];
  description?: string;
  howToImplement?: string;
  logSources?: string[];
  query?: string;
  source?: ResourceType;
  sourceFile?: string;
  repoName?: string;
  ruleId?: string;
  rawSource?: string;
  streamStatus?: 'verified' | 'heuristic';
  metadata?: Record<string, unknown>;
  // AI Validation Fields
  validationStatus?: 'pending' | 'valid' | 'invalid' | 'uncertain';
  aiConfidence?: number;
  mutableElements?: string[];
}

export interface DataComponentMapping {
  id: string;
  name: string;
  dataSource?: string;
  eventIds?: string[];
}

export interface ResourceAdapter {
  name: ResourceType;
  fetchMappings(productName: string, vendor: string): Promise<NormalizedMapping | null>;
  isApplicable(productType: string, platforms: string[]): boolean;
}

export const RESOURCE_PRIORITY: Record<string, ResourceType[]> = {
  cloud: ['ctid', 'splunk', 'azure', 'sigma', 'mitre_stix'],
  network: ['sigma', 'splunk', 'ctid', 'mitre_stix'],
  endpoint: ['elastic', 'sigma', 'splunk', 'ctid', 'mitre_stix'],
  siem: ['splunk', 'azure', 'sigma', 'elastic', 'ctid', 'mitre_stix'],
  identity: ['ctid', 'sigma', 'splunk', 'azure', 'mitre_stix'],
  database: ['splunk', 'sigma', 'elastic', 'azure', 'mitre_stix'],
  web: ['sigma', 'splunk', 'elastic', 'azure', 'mitre_stix'],
  abstract: ['mitre_stix', 'ctid', 'splunk', 'sigma'],
  default: ['ctid', 'sigma', 'elastic', 'splunk', 'azure', 'mitre_stix'],
};
