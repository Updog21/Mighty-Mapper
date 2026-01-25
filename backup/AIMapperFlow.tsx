import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { AnalyticRequirementsPanel, InlineRequirementHint, type EnrichedEvidence } from '@/components/AnalyticRequirementsPanel';
import { normalizePlatformList, platformMatchesAny } from '@shared/platforms';

interface AIMapperFlowProps {
  initialQuery?: string;
  existingProductId?: string;
  mode?: 'create' | 'evidence';
  onComplete: (productId: string) => void;
  onCancel: () => void;
}

type Step = 'details' | 'platforms' | 'platform-review' | 'review' | 'auto-results' | 'streams' | 'analyzing' | 'evidence' | 'guided-summary' | 'guided-results' | 'complete';

interface MitrePlatformsResponse {
  platforms: string[];
}

interface MitreDataComponent {
  id: string;
  name: string;
  description?: string;
  shortDescription?: string;
  examples?: string[];
  dataSourceId?: string;
  dataSourceName?: string;
  platforms?: string[];
  domains?: string[];
  revoked?: boolean;
  deprecated?: boolean;
  relevanceScore?: number;
}

interface MitreDataComponentsMeta {
  total: number;
  withPlatforms: number;
  matched: number;
  fallbackReason?: 'none' | 'no_platform_metadata' | 'no_platform_matches' | 'graph_unavailable';
  unscopedIncluded?: boolean;
}

interface MitreDataComponentsResponse {
  dataComponents: MitreDataComponent[];
  meta?: MitreDataComponentsMeta;
}

interface ResearchLogSource {
  name: string;
  channel?: string;
  requiredFields?: string[];
  missingFields?: string[];
  evidence?: string;
  sourceUrl?: string;
}

interface ResearchResultEntry {
  dcId: string;
  dcName: string;
  logSources: ResearchLogSource[];
  targetFields?: string[];
}

interface ResearchEnrichmentResponse {
  model: string;
  results: ResearchResultEntry[];
  platformSuggestions?: ResearchPlatformSuggestion[];
  sources?: Array<{ title?: string; url: string }>;
  note?: string;
}

interface PlatformValidationResult {
  platform: string;
  isSupported: boolean;
  reasoning?: string;
  evidence?: string;
  sourceUrl?: string;
}

interface PlatformAlternativeResult {
  platform: string;
  reason?: string;
  evidence?: string;
  sourceUrl?: string;
}

interface PlatformCheckResponse {
  model: string;
  validation?: PlatformValidationResult[];
  alternativePlatformsFound?: PlatformAlternativeResult[];
  sources?: Array<{ title?: string; url: string }>;
  note?: string;
}

interface ResearchPlatformSuggestion {
  platform: string;
  reason?: string;
  evidence?: string;
  sourceUrl?: string;
}

interface GeminiMappingDecision {
  id: string;
  selected: boolean;
  reason?: string;
  evidence?: string;
  sourceUrl?: string;
}

interface GeminiMappingResponse {
  suggestedIds?: string[];
  decisions?: GeminiMappingDecision[];
  evaluatedCount?: number;
  candidateCount?: number;
  sources?: Array<{ title?: string; url: string }>;
  notes?: string;
}

interface CreatedProduct {
  id: number;
  productId: string;
}

interface StreamDraft {
  name: string;
  streamType: 'log' | 'alert' | 'finding' | 'inventory';
  mappedDataComponents: string[];
  questionAnswers?: Record<string, boolean>;
  metadata?: Record<string, unknown>;
}

interface GuidedSummary {
  techniques: number;
  dataComponents: number;
  sources: string[];
  platforms: string[];
  streams: number;
  mappingsCreated: number;
  missingDataComponents?: string[];
}

const baseSteps: { id: Step; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'platforms', label: 'Platforms' },
  { id: 'platform-review', label: 'Platform Review' },
  { id: 'review', label: 'Review' },
  { id: 'auto-results', label: 'Auto Results' },
  { id: 'streams', label: 'Telemetry' },
  { id: 'guided-summary', label: 'Requirements' },
  { id: 'guided-results', label: 'Results' },
  { id: 'complete', label: 'Complete' },
];

const evidenceSteps: { id: Step; label: string }[] = [
  { id: 'evidence', label: 'Evidence Review' },
  { id: 'complete', label: 'Complete' },
];

const STEP_DESCRIPTIONS: Record<Step, string> = {
  details: 'Define the vendor, product name, aliases, and a short description.',
  platforms: 'Pick the MITRE platforms that apply to this product.',
  'platform-review': 'Review Gemini platform suggestions based on a quick documentation check.',
  'auto-results': 'Review the auto-mapper results before continuing to telemetry.',
  streams: 'Select the MITRE data components your telemetry provides (input step).',
  review: 'Confirm inputs and launch the auto mapping process.',
  evidence: 'Review evidence details when needed.',
  'guided-summary': 'Review derived analytic requirements based on your selections (output step).',
  'guided-results': 'Review the telemetry coverage inferred from your guided answers.',
  complete: 'Mapping is saved and ready to review on the product page.',
  analyzing: 'Auto mapping runs in the background and prepares evidence prompts.',
};

interface SsmMapping {
  id?: number;
  techniqueId: string;
  techniqueName: string;
  metadata?: Record<string, unknown> | null;
}

interface SsmCapability {
  id?: number;
  capabilityGroupId: string;
  name: string;
  description?: string | null;
  platform: string;
  source?: string;
  mappings: SsmMapping[];
}

interface TechniqueRequirement {
  strategyId: string;
  strategyName: string;
  analyticId: string;
  analyticName: string;
  dataComponentId: string;
  dataComponentName: string;
  dataSourceName: string;
}

interface TechniqueEvidenceEntry {
  name: string;
  channel: string;
  eventId: string;
  dataComponent: string;
}

const PLATFORM_DESCRIPTIONS: Record<string, string> = {
  'Windows': 'Windows desktops, servers, and endpoints.',
  'Linux': 'Linux servers and workloads.',
  'macOS': 'Apple macOS endpoints and laptops.',
  'Android': 'Android mobile devices and tablets.',
  'iOS': 'Apple iOS and iPadOS devices.',
  'None': 'Platform-agnostic or general techniques.',
  'PRE': 'Pre-ATT&CK and reconnaissance activities.',
  'IaaS': 'Cloud infrastructure workloads (AWS/Azure/GCP).',
  'SaaS': 'Cloud-hosted SaaS applications.',
  'Office 365': 'Microsoft 365 productivity suite.',
  'Office Suite': 'Productivity and collaboration suites.',
  'Identity Provider': 'Identity and access platforms (Azure AD, Okta, etc.).',
  'Google Workspace': 'Google Workspace productivity suite.',
  'Azure AD': 'Microsoft Entra ID and directory services.',
  'AWS': 'Amazon Web Services cloud infrastructure.',
  'Azure': 'Microsoft Azure cloud infrastructure.',
  'GCP': 'Google Cloud Platform infrastructure.',
  'Containers': 'Container runtime or Kubernetes.',
  'ESXi': 'VMware ESXi / vSphere environments.',
  'Network Devices': 'Network appliances, routers, switches, and sensors.',
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function buildProductId(vendor: string, product: string) {
  const base = `${slugify(vendor)}-${slugify(product)}` || 'custom-product';
  return `custom-${base}-${Date.now().toString(36)}`;
}

async function fetchPlatforms(): Promise<MitrePlatformsResponse> {
  const response = await fetch('/api/mitre-stix/platforms');
  if (!response.ok) {
    throw new Error('Failed to fetch MITRE platforms');
  }
  return response.json();
}

async function fetchProduct(productId: string) {
  const response = await fetch(`/api/products/${encodeURIComponent(productId)}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch product');
  }
  return response.json();
}

async function fetchDataComponents(
  platforms?: string[],
  includeUnscoped?: boolean
): Promise<MitreDataComponentsResponse> {
  const params = new URLSearchParams();
  if (platforms && platforms.length > 0) {
    params.set('platforms', platforms.join(','));
  }
  if (includeUnscoped) {
    params.set('include_unscoped', 'true');
  }
  const response = await fetch(`/api/mitre/data-components${params.toString() ? `?${params.toString()}` : ''}`);
  if (!response.ok) {
    throw new Error('Failed to fetch MITRE data components');
  }
  return response.json();
}

async function createProduct(payload: {
  productId: string;
  vendor: string;
  productName: string;
  description: string;
  platforms: string[];
  dataComponentIds: string[];
  source: 'custom';
}) {
  const response = await fetch('/api/admin/products?autoMap=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create product');
  }
  return response.json() as Promise<CreatedProduct>;
}

async function deleteProduct(productId: string) {
  const response = await fetch(`/api/admin/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { error?: string }).error || 'Failed to delete product');
  }
}

async function addAlias(productDbId: number, alias: string) {
  const response = await fetch('/api/admin/aliases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: productDbId, alias, confidence: 100 }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add alias');
  }
  return response.json();
}

async function saveProductStreams(productId: string, streams: StreamDraft[]) {
  const response = await fetch(`/api/products/${encodeURIComponent(productId)}/streams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streams }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save evidence sources');
  }
  return response.json();
}

async function saveWizardCoverage(
  productId: string,
  platforms: string[],
  streams: StreamDraft[]
): Promise<GuidedSummary> {
  const response = await fetch('/api/wizard/coverage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId,
      platforms,
      streams: streams.map(stream => ({
        name: stream.name,
        mappedDataComponents: stream.mappedDataComponents,
        metadata: stream.metadata,
      })),
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save guided coverage');
  }
  return response.json();
}

async function runAutoMapper(productId: string) {
  const response = await fetch(`/api/auto-mapper/run/${encodeURIComponent(productId)}`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to run auto-mapper');
  }
  return response.json();
}

type EnrichmentLogSource = {
  name: string;
  channel?: string;
  required_fields?: string[];
  missing_fields?: string[];
  evidence?: string;
  source_url?: string;
  verified_by_ai?: boolean;
};

type EnrichmentResult = {
  data_component_id: string;
  data_component_name?: string;
  target_fields?: string[];
  log_sources: EnrichmentLogSource[];
};

const normalizeString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeEnrichmentResults = (raw: unknown): EnrichmentResult[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any): EnrichmentResult | null => {
      const dcId = normalizeString(entry?.data_component_id)
        || normalizeString(entry?.dataComponentId)
        || normalizeString(entry?.dcId)
        || normalizeString(entry?.dc_id);
      if (!dcId) return null;
      const dcName = normalizeString(entry?.data_component_name)
        || normalizeString(entry?.dataComponentName)
        || normalizeString(entry?.dcName)
        || normalizeString(entry?.dc_name);
      const targetFieldsRaw = Array.isArray(entry?.target_fields)
        ? entry.target_fields
        : Array.isArray(entry?.targetFields) ? entry.targetFields : [];
      const targetFields = targetFieldsRaw
        .map((field: unknown) => normalizeString(field))
        .filter((field: string) => field.length > 0);
      const logSourcesRaw = Array.isArray(entry?.log_sources)
        ? entry.log_sources
        : Array.isArray(entry?.logSources) ? entry.logSources : [];
      const logSources = logSourcesRaw
        .map((source: any): EnrichmentLogSource | null => {
          const name = normalizeString(source?.name);
          if (!name) return null;
          const channel = normalizeString(source?.channel);
          const requiredFieldsRaw = Array.isArray(source?.required_fields)
            ? source.required_fields
            : Array.isArray(source?.requiredFields) ? source.requiredFields : [];
          const missingFieldsRaw = Array.isArray(source?.missing_fields)
            ? source.missing_fields
            : Array.isArray(source?.missingFields) ? source.missingFields : [];
          return {
            name,
            channel: channel || undefined,
            required_fields: requiredFieldsRaw
              .map((field: unknown) => normalizeString(field))
              .filter((field: string) => field.length > 0),
            missing_fields: missingFieldsRaw
              .map((field: unknown) => normalizeString(field))
              .filter((field: string) => field.length > 0),
            evidence: normalizeString(source?.evidence) || undefined,
            source_url: normalizeString(source?.source_url) || normalizeString(source?.sourceUrl) || undefined,
            verified_by_ai: source?.verified_by_ai === true || source?.verifiedByAi === true || undefined,
          };
        })
        .filter(Boolean) as EnrichmentLogSource[];
      return {
        data_component_id: dcId,
        data_component_name: dcName || undefined,
        target_fields: targetFields,
        log_sources: logSources,
      };
    })
    .filter(Boolean) as EnrichmentResult[];
};

const mergeEnrichmentResults = (
  existingRaw: unknown,
  incomingRaw: unknown
): EnrichmentResult[] => {
  const existing = normalizeEnrichmentResults(existingRaw);
  const incoming = normalizeEnrichmentResults(incomingRaw);
  const merged = new Map<string, EnrichmentResult>();

  const addLogSources = (target: EnrichmentResult, sources: EnrichmentLogSource[]) => {
    const seen = new Set(
      target.log_sources.map((source) =>
        `${source.name.toLowerCase()}|${(source.channel || '').toLowerCase()}|${(source.source_url || '').toLowerCase()}`
      )
    );
    sources.forEach((source) => {
      const key = `${source.name.toLowerCase()}|${(source.channel || '').toLowerCase()}|${(source.source_url || '').toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      target.log_sources.push(source);
    });
  };

  const mergeTargetFields = (target: EnrichmentResult, fields: string[]) => {
    if (!fields.length) return;
    const seen = new Set((target.target_fields || []).map((field) => field.toLowerCase()));
    const next = [...(target.target_fields || [])];
    fields.forEach((field) => {
      const normalized = field.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      next.push(field);
    });
    target.target_fields = next;
  };

  const insertEntry = (entry: EnrichmentResult) => {
    const key = entry.data_component_id.toLowerCase();
    const existingEntry = merged.get(key);
    if (!existingEntry) {
      merged.set(key, {
        data_component_id: entry.data_component_id,
        data_component_name: entry.data_component_name,
        target_fields: entry.target_fields ? [...entry.target_fields] : [],
        log_sources: entry.log_sources ? [...entry.log_sources] : [],
      });
      return;
    }
    if (!existingEntry.data_component_name && entry.data_component_name) {
      existingEntry.data_component_name = entry.data_component_name;
    }
    mergeTargetFields(existingEntry, entry.target_fields || []);
    addLogSources(existingEntry, entry.log_sources || []);
  };

  existing.forEach(insertEntry);
  incoming.forEach(insertEntry);

  return Array.from(merged.values());
};

const mergePlatformSuggestions = (existingRaw: unknown, incomingRaw: unknown) => {
  const normalizeSuggestions = (raw: unknown) => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry: any) => ({
        platform: normalizeString(entry?.platform),
        reason: normalizeString(entry?.reason) || undefined,
        evidence: normalizeString(entry?.evidence) || undefined,
        source_url: normalizeString(entry?.source_url) || normalizeString(entry?.sourceUrl) || undefined,
      }))
      .filter((entry) => entry.platform.length > 0);
  };

  const existing = normalizeSuggestions(existingRaw);
  const incoming = normalizeSuggestions(incomingRaw);
  const merged = new Map<string, { platform: string; reason?: string; evidence?: string; source_url?: string }>();

  const insert = (entry: { platform: string; reason?: string; evidence?: string; source_url?: string }) => {
    const key = `${entry.platform.toLowerCase()}|${(entry.source_url || '').toLowerCase()}`;
    if (merged.has(key)) return;
    merged.set(key, entry);
  };

  existing.forEach(insert);
  incoming.forEach(insert);
  return Array.from(merged.values());
};

async function fetchProductSsm(productId: string): Promise<SsmCapability[]> {
  const response = await fetch(`/api/products/${productId}/ssm`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch SSM data');
  }
  return response.json();
}

async function fetchMappingStatus(productId: string) {
  const response = await fetch(`/api/auto-mapper/mappings/${encodeURIComponent(productId)}`);
  if (!response.ok) {
    return null;
  }
  return response.json();
}

async function fetchTechniqueRequirements(techniqueId: string): Promise<TechniqueRequirement[]> {
  const response = await fetch(`/api/mitre-stix/technique/${encodeURIComponent(techniqueId)}/requirements`);
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  return Array.isArray(data.requirements) ? data.requirements : [];
}

async function updateMappingMetadata(mappingId: number, metadata: Record<string, unknown>) {
  const response = await fetch(`/api/ssm/mappings/${mappingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update mapping metadata');
  }
  return response.json();
}

async function waitForMapping(productId: string, maxAttempts = 30, delayMs = 2000) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(`/api/auto-mapper/mappings/${encodeURIComponent(productId)}`);
    if (response.status === 404) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch mapping status');
    }
    return response.json();
  }
  throw new Error('Auto mapping is still running. Try again in a moment.');
}

function getSuggestedPlatforms(
  platforms: string[],
  input: string
): string[] {
  if (!platforms.length || !input.trim()) return [];
  const normalizedInput = input.toLowerCase();
  const platformMap = new Map(platforms.map(platform => [platform.toLowerCase(), platform]));
  const suggestions = new Set<string>();

  platforms.forEach(platform => {
    const normalizedPlatform = platform.toLowerCase();
    if (normalizedInput.includes(normalizedPlatform)) {
      suggestions.add(platform);
    }
  });

  const keywordMap: Record<string, string[]> = {
    'windows': ['Windows'],
    'linux': ['Linux'],
    'mac': ['macOS'],
    'macos': ['macOS'],
    'osx': ['macOS'],
    'android': ['Android'],
    'ios': ['iOS'],
    'iphone': ['iOS'],
    'ipad': ['iOS'],
    'mobile': ['Android', 'iOS'],
    'azure ad': ['Azure AD', 'Identity Provider'],
    'entra': ['Azure AD', 'Identity Provider'],
    'active directory': ['Identity Provider'],
    'okta': ['Identity Provider'],
    'idp': ['Identity Provider'],
    'identity': ['Identity Provider'],
    'aws': ['AWS', 'IaaS'],
    'amazon web services': ['AWS', 'IaaS'],
    'azure': ['Azure', 'IaaS'],
    'gcp': ['GCP', 'IaaS'],
    'google cloud': ['GCP', 'IaaS'],
    'office 365': ['Office 365', 'Office Suite'],
    'm365': ['Office 365'],
    'office suite': ['Office Suite'],
    'google workspace': ['Google Workspace', 'Office Suite'],
    'gsuite': ['Google Workspace', 'Office Suite'],
    'saas': ['SaaS'],
    'iaas': ['IaaS'],
    'cloud': ['IaaS'],
    'container': ['Containers'],
    'containers': ['Containers'],
    'kubernetes': ['Containers'],
    'docker': ['Containers'],
    'network': ['Network Devices'],
    'firewall': ['Network Devices'],
    'router': ['Network Devices'],
    'switch': ['Network Devices'],
    'proxy': ['Network Devices'],
    'vmware': ['ESXi'],
    'esxi': ['ESXi'],
    'pre': ['PRE'],
    'pre-attack': ['PRE'],
    'reconnaissance': ['PRE'],
    'none': ['None'],
    'edr': ['Windows', 'Linux', 'macOS'],
    'endpoint': ['Windows', 'Linux', 'macOS'],
  };

  Object.entries(keywordMap).forEach(([keyword, candidates]) => {
    if (!normalizedInput.includes(keyword)) return;
    candidates.forEach(candidate => {
      const match = platformMap.get(candidate.toLowerCase());
      if (match) suggestions.add(match);
    });
  });

  return Array.from(suggestions);
}

export function AIMapperFlow({ initialQuery, existingProductId, mode = 'create', onComplete, onCancel }: AIMapperFlowProps) {
  const { toast } = useToast();
  const isEvidenceOnly = mode === 'evidence' && Boolean(existingProductId);
  const [step, setStep] = useState<Step>(isEvidenceOnly ? 'evidence' : 'details');
  const [vendor, setVendor] = useState('');
  const [product, setProduct] = useState(initialQuery || '');
  const [description, setDescription] = useState('');
  const [aliasInput, setAliasInput] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [streams, setStreams] = useState<StreamDraft[]>([
    {
      name: '',
      streamType: 'log',
      mappedDataComponents: [],
      questionAnswers: {},
      metadata: {},
    }
  ]);
  const [wantsEvidence, setWantsEvidence] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdProductId, setCreatedProductId] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState('Preparing mapping...');
  const [suggestionsApplied, setSuggestionsApplied] = useState(false);
  const [ssmCapabilities, setSsmCapabilities] = useState<SsmCapability[]>([]);
  const [techniqueRequirements, setTechniqueRequirements] = useState<Record<string, TechniqueRequirement[]>>({});
  const [evidenceEntries, setEvidenceEntries] = useState<Record<string, TechniqueEvidenceEntry[]>>({});
  const [evidenceFormExpanded, setEvidenceFormExpanded] = useState(true);
  const [evidenceFormInitialized, setEvidenceFormInitialized] = useState(false);
  const [mappingSummary, setMappingSummary] = useState<{
    techniques: number;
    analytics: number;
    dataComponents: number;
    sources: string[];
  } | null>(null);
  const [guidedSummary, setGuidedSummary] = useState<GuidedSummary | null>(null);
  const [guidedContextIndex, setGuidedContextIndex] = useState(0);
  const [geminiSuggestionCount, setGeminiSuggestionCount] = useState<number | null>(null);
  const [geminiEvaluationCount, setGeminiEvaluationCount] = useState<number | null>(null);
  const [geminiDecisionMap, setGeminiDecisionMap] = useState<Record<string, GeminiMappingDecision>>({});
  const [geminiSources, setGeminiSources] = useState<Array<{ title?: string; url: string }>>([]);
  const [geminiNotes, setGeminiNotes] = useState<string | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResults, setResearchResults] = useState<ResearchEnrichmentResponse | null>(null);
  const [researchConfirming, setResearchConfirming] = useState(false);
  const [platformCheckLoading, setPlatformCheckLoading] = useState(false);
  const [platformCheckResults, setPlatformCheckResults] = useState<PlatformCheckResponse | null>(null);
  const [platformCheckHasRun, setPlatformCheckHasRun] = useState(false);
  const [platformCheckEnabled, setPlatformCheckEnabled] = useState(false);
  const [autoResultsNextStep, setAutoResultsNextStep] = useState<Step>('streams');
  const [platformSuggestionDismissed, setPlatformSuggestionDismissed] = useState(false);
  const [includeUnscopedDataComponents, setIncludeUnscopedDataComponents] = useState(false);

  const { data: platformData, isLoading: platformsLoading } = useQuery({
    queryKey: ['mitre-platforms'],
    queryFn: fetchPlatforms,
    staleTime: 10 * 60 * 1000,
  });

  const platforms = platformData?.platforms || [];
  const selectedPlatformsList = useMemo(
    () => normalizePlatformList(Array.from(selectedPlatforms)),
    [selectedPlatforms]
  );
  const dataComponentPlatformsKey = useMemo(
    () => [...selectedPlatformsList].sort().join(','),
    [selectedPlatformsList]
  );

  const { data: dataComponentsData, error: dataComponentsError, isLoading: dataComponentsLoading } = useQuery({
    queryKey: ['mitre-data-components', dataComponentPlatformsKey, includeUnscopedDataComponents ? 'unscoped' : 'strict'],
    queryFn: () => fetchDataComponents(selectedPlatformsList, includeUnscopedDataComponents),
    enabled: selectedPlatformsList.length > 0,
    staleTime: 10 * 60 * 1000,
  });
  const dataComponentsMeta = dataComponentsData?.meta;
  const dataComponentsFallbackReason = dataComponentsMeta?.fallbackReason ?? 'none';
  const canShowUnscopedToggle = dataComponentsFallbackReason === 'no_platform_metadata'
    || dataComponentsFallbackReason === 'graph_unavailable';

  const suggestionInput = useMemo(
    () => [vendor, product, description, ...aliases].join(' ').trim(),
    [vendor, product, description, aliases]
  );
  const heuristicSuggestedPlatforms = useMemo(
    () => getSuggestedPlatforms(platforms, suggestionInput),
    [platforms, suggestionInput]
  );

  const defaultEvidenceSourceName = useMemo(() => {
    const trimmedVendor = vendor.trim();
    const trimmedProduct = product.trim();
    return [trimmedVendor, trimmedProduct].filter(Boolean).join(' ').trim();
  }, [vendor, product]);

  const dataComponents = dataComponentsData?.dataComponents || [];
  const dataComponentById = useMemo(() => {
    return new Map(dataComponents.map(component => [component.id.toLowerCase(), component]));
  }, [dataComponents]);
  const formatDataComponentLabel = (id: string) => {
    const component = dataComponentById.get(id.toLowerCase());
    if (!component) return id;
    return `${component.id} - ${component.name}`;
  };
  const groupedDataComponents = useMemo(() => {
    const groups = new Map<string, MitreDataComponent[]>();
    const normalizedSelected = normalizePlatformList(selectedPlatformsList);

    dataComponents.forEach(component => {
      const componentPlatforms = (component.platforms || []).map((platform) => platform.trim()).filter(Boolean);
      let groupName = normalizedSelected.find((platform) =>
        platformMatchesAny(componentPlatforms, [platform])
      );

      if (!groupName) {
        const resolvedComponent = normalizePlatformList(componentPlatforms);
        groupName = resolvedComponent[0] || normalizedSelected[0] || 'Unspecified Platform';
      }

      const existing = groups.get(groupName) || [];
      existing.push(component);
      groups.set(groupName, existing);
    });

    const orderedGroups = [
      ...normalizedSelected,
      ...Array.from(groups.keys()).filter((key) => !normalizedSelected.includes(key)).sort(),
    ];

    return orderedGroups
      .map((group) => ({
        group,
        components: (groups.get(group) || []).sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((group) => group.components.length > 0);
  }, [dataComponents, selectedPlatformsList]);
  const wizardContextOptions = useMemo(
    () => groupedDataComponents.map(group => group.group),
    [groupedDataComponents]
  );

  useEffect(() => {
    if (wizardContextOptions.length === 0) {
      if (guidedContextIndex !== 0) setGuidedContextIndex(0);
      return;
    }
    if (guidedContextIndex >= wizardContextOptions.length) {
      setGuidedContextIndex(0);
    }
  }, [wizardContextOptions, guidedContextIndex]);

  const evidenceTechniqueCount = useMemo(() => {
    const set = new Set<string>();
    ssmCapabilities.forEach(cap => {
      cap.mappings.forEach(mapping => set.add(mapping.techniqueId));
    });
    return set.size;
  }, [ssmCapabilities]);

  const EVIDENCE_AUTO_THRESHOLD = 5;

  const shouldRecommendEvidence = useMemo(() => {
    return Boolean(mappingSummary) && evidenceTechniqueCount < EVIDENCE_AUTO_THRESHOLD;
  }, [mappingSummary, evidenceTechniqueCount, EVIDENCE_AUTO_THRESHOLD]);

  const baseStepItems = platformCheckEnabled
    ? baseSteps
    : baseSteps.filter((stepItem) => stepItem.id !== 'platform-review');
  const stepItems = isEvidenceOnly ? evidenceSteps : baseStepItems;

  useEffect(() => {
    setIncludeUnscopedDataComponents(false);
  }, [dataComponentPlatformsKey]);

  useEffect(() => {
    if (!isEvidenceOnly || !existingProductId) return;
    let isMounted = true;

    const loadEvidence = async () => {
      try {
        setProgressMessage('Loading product details...');
        const productData = await fetchProduct(existingProductId);
        if (!isMounted) return;
        setVendor(productData.vendor || '');
        setProduct(productData.productName || '');
        setDescription(productData.description || '');
        if (Array.isArray(productData.platforms)) {
          setSelectedPlatforms(new Set(normalizePlatformList(productData.platforms)));
        }
        setCreatedProductId(existingProductId);
        setStep('evidence');
        setProgressMessage('Preparing evidence prompts...');
        const ssm = await fetchProductSsm(existingProductId);
        if (!isMounted) return;
        setSsmCapabilities(ssm);

        const techniqueIds = Array.from(
          new Set(ssm.flatMap(cap => cap.mappings.map(mapping => mapping.techniqueId)))
        );
        const requirementsEntries = await Promise.all(
          techniqueIds.map(async (techId) => ({
            techId,
            requirements: await fetchTechniqueRequirements(techId),
          }))
        );
        const requirementsMap: Record<string, TechniqueRequirement[]> = {};
        requirementsEntries.forEach(entry => {
          requirementsMap[entry.techId] = entry.requirements;
        });
        setTechniqueRequirements(requirementsMap);

        const defaultEvidence: Record<string, TechniqueEvidenceEntry[]> = {};
        techniqueIds.forEach((techId) => {
          const firstRequirement = requirementsMap[techId]?.[0];
          defaultEvidence[techId] = [{
            name: '',
            channel: '',
            eventId: '',
            dataComponent: firstRequirement?.dataComponentName || '',
          }];
        });
        setEvidenceEntries(defaultEvidence);
        setEvidenceFormExpanded(techniqueIds.length < EVIDENCE_AUTO_THRESHOLD);
        setEvidenceFormInitialized(true);

        const mappingResult = await fetchMappingStatus(existingProductId);
        setMappingSummary({
          techniques: techniqueIds.length,
          analytics: mappingResult?.mapping?.analytics?.length || 0,
          dataComponents: mappingResult?.mapping?.dataComponents?.length || 0,
          sources: mappingResult?.sources || (mappingResult?.source ? [mappingResult.source] : []),
        });
      } catch (error) {
        console.error(error);
        toast({
          title: 'Failed to load evidence wizard',
          description: error instanceof Error ? error.message : 'Unexpected error',
          variant: 'destructive',
        });
        onCancel();
      }
    };

    loadEvidence();

    return () => {
      isMounted = false;
    };
  }, [existingProductId, isEvidenceOnly, onCancel, toast]);

  useEffect(() => {
    if (step !== 'platforms') return;
    if (suggestionsApplied) return;
    if (selectedPlatforms.size > 0) return;
    if (heuristicSuggestedPlatforms.length === 0) return;
    setSelectedPlatforms(new Set(heuristicSuggestedPlatforms));
    setSuggestionsApplied(true);
  }, [step, heuristicSuggestedPlatforms, selectedPlatforms.size, suggestionsApplied]);

  useEffect(() => {
    if (selectedPlatforms.size === 0) {
      setSuggestionsApplied(false);
    }
  }, [suggestionInput, selectedPlatforms.size]);

  useEffect(() => {
    if (step !== 'evidence') return;
    if (evidenceFormInitialized) return;
    setEvidenceFormExpanded(evidenceTechniqueCount < EVIDENCE_AUTO_THRESHOLD);
    setEvidenceFormInitialized(true);
  }, [step, evidenceTechniqueCount, evidenceFormInitialized, EVIDENCE_AUTO_THRESHOLD]);

  const canNavigateTo = (target: Step) => {
    if (target === step) return true;
    if (step === 'analyzing') return false;
    if (step === 'complete') return target === 'complete';
    if (target === 'platforms') return (vendor || product) && description;
    if (target === 'platform-review') return platformCheckEnabled && selectedPlatforms.size > 0;
    if (target === 'auto-results') return Boolean(mappingSummary);
    if (target === 'review') return selectedPlatforms.size > 0;
    if (target === 'streams') return createdProductId !== null;
    if (target === 'guided-summary') {
      if (!hasConfiguredStreams) return false;
      if (wizardContextOptions.length === 0) return false;
      return guidedContextIndex >= wizardContextOptions.length - 1;
    }
    if (target === 'guided-results') return guidedSummary !== null;
    if (target === 'evidence') return createdProductId !== null;
    return true;
  };

  const renderStepper = () => (
    <div className="w-full mb-8">
      <div className="flex items-center gap-6">
        {stepItems.map((item, index) => {
          const isActive = item.id === step;
          const stepIndex = stepItems.findIndex(s => s.id === step);
          const isComplete = stepIndex > index;
          return (
            <div key={item.id} className="flex items-center gap-3">
              <div className="relative group">
                <Button
                  variant="ghost"
                  size="lg"
                  className={cn(
                    'flex items-center gap-4 px-4 py-3 text-lg',
                    isActive && 'text-primary',
                    !canNavigateTo(item.id) && 'opacity-50 cursor-not-allowed'
                  )}
                  onClick={() => {
                    if (!canNavigateTo(item.id)) return;
                    setStep(item.id);
                  }}
                >
                  <span
                    className={cn(
                      'w-12 h-12 rounded-full border text-lg flex items-center justify-center',
                      isActive && 'border-primary text-primary',
                      isComplete && 'bg-primary text-primary-foreground border-primary',
                      !isActive && !isComplete && 'border-border text-muted-foreground'
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="text-lg font-semibold">{item.label}</span>
                </Button>
                <div className="pointer-events-none absolute left-1/2 top-full z-10 w-60 -translate-x-1/2 translate-y-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground opacity-0 shadow-sm transition group-hover:opacity-100">
                  {STEP_DESCRIPTIONS[item.id]}
                </div>
              </div>
              {index < stepItems.length - 1 && (
                <div className={cn('h-px w-12', isComplete ? 'bg-primary' : 'bg-border')} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const handleAddAlias = () => {
    const nextAlias = aliasInput.trim();
    if (!nextAlias) return;
    if (aliases.some(alias => alias.toLowerCase() === nextAlias.toLowerCase())) {
      toast({
        title: 'Alias already added',
        description: 'That alias is already in the list.',
        variant: 'destructive',
      });
      return;
    }
    setAliases(prev => [...prev, nextAlias]);
    setAliasInput('');
  };

  const handleRemoveAlias = (alias: string) => {
    setAliases(prev => prev.filter(item => item !== alias));
  };

  const updateStreamGuided = (index: number, updates: Partial<StreamDraft>) => {
    setStreams(prev => {
      const next = [...prev];
      const target = { ...next[index], ...updates };
      next[index] = target;
      return next;
    });
  };

  const resetStreamGuided = () => {
    setStreams(prev => prev.map((stream, idx) => {
      if (idx === 0) {
        return {
          ...stream,
          mappedDataComponents: [],
          questionAnswers: {},
          metadata: {
            ...(stream.metadata || {}),
            guided_mode: true,
            question_ids: [],
            resolved_dc_ids: [],
            resolved_dc_names: [],
          },
        };
      }
      return stream;
    }));
    if (guidedSummary) {
      setGuidedSummary(null);
    }
    if (geminiSuggestionCount !== null) {
      setGeminiSuggestionCount(null);
    }
    if (researchResults) {
      setResearchResults(null);
    }
    if (platformSuggestionDismissed) {
      setPlatformSuggestionDismissed(false);
    }
  };

  const applyGuidedMapping = (index: number, answers: Record<string, boolean>) => {
    const selectedIds = Object.keys(answers).filter(key => answers[key]);
    const resolvedNames = selectedIds
      .map((id) => dataComponentById.get(id.toLowerCase())?.name || id);
    const nextName = streams[index]?.name?.trim() || defaultEvidenceSourceName;
    const nextType = streams[index]?.streamType || 'log';
    updateStreamGuided(index, {
      mappedDataComponents: selectedIds,
      questionAnswers: answers,
      name: nextName,
      streamType: nextType,
      metadata: {
        ...(streams[index]?.metadata || {}),
        guided_mode: true,
        question_ids: selectedIds,
        resolved_dc_ids: selectedIds,
        resolved_dc_names: Array.from(new Set(resolvedNames)),
      },
    });
    if (guidedSummary) {
      setGuidedSummary(null);
    }
    if (researchResults) {
      setResearchResults(null);
    }
    if (platformSuggestionDismissed) {
      setPlatformSuggestionDismissed(false);
    }
  };


  const hasConfiguredStreams = useMemo(() => {
    return streams.some(stream => stream.mappedDataComponents.length > 0);
  }, [streams]);

  const selectedGuidedComponents = useMemo(() => {
    const set = new Set<string>();
    streams.forEach(stream => {
      stream.mappedDataComponents.forEach(component => set.add(component));
    });
    return Array.from(set);
  }, [streams]);

  const enrichmentByDcId = useMemo(() => {
    const map: Record<string, EnrichedEvidence> = {};
    const streamMeta = streams[0]?.metadata as Record<string, unknown> | undefined;
    const stored = streamMeta?.ai_enrichment || streamMeta?.aiEnrichment;
    const storedResults = stored && typeof stored === 'object'
      ? (stored as { results?: unknown }).results
      : undefined;
    const results = researchResults?.results && researchResults.results.length > 0
      ? researchResults.results
      : Array.isArray(storedResults) ? storedResults : [];

    results.forEach((entry: any) => {
      const dcId = typeof entry?.dcId === 'string'
        ? entry.dcId
        : typeof entry?.dataComponentId === 'string'
          ? entry.dataComponentId
          : entry?.data_component_id || entry?.dc_id;
      const dcName = typeof entry?.dcName === 'string'
        ? entry.dcName
        : typeof entry?.dataComponentName === 'string'
          ? entry.dataComponentName
          : entry?.data_component_name || entry?.dc_name || dcId;
      if (!dcId) return;
      const logSources = Array.isArray(entry?.logSources)
        ? entry.logSources
        : Array.isArray(entry?.log_sources) ? entry.log_sources : [];
      const normalizedSources = Array.isArray(logSources)
        ? logSources.map((source: any) => ({
          name: typeof source?.name === 'string' ? source.name : '',
          channel: typeof source?.channel === 'string' ? source.channel : undefined,
          requiredFields: Array.isArray(source?.requiredFields)
            ? source.requiredFields
            : Array.isArray(source?.required_fields) ? source.required_fields : [],
          missingFields: Array.isArray(source?.missingFields)
            ? source.missingFields
            : Array.isArray(source?.missing_fields) ? source.missing_fields : [],
          evidence: typeof source?.evidence === 'string' ? source.evidence : undefined,
          sourceUrl: typeof source?.sourceUrl === 'string'
            ? source.sourceUrl
            : typeof source?.source_url === 'string' ? source.source_url : undefined,
        })).filter((source: { name: string }) => source.name.trim().length > 0)
        : [];
      const targetFields = Array.isArray(entry?.targetFields)
        ? entry.targetFields
        : Array.isArray(entry?.target_fields) ? entry.target_fields : [];

      map[String(dcId).toLowerCase()] = {
        dcId: String(dcId),
        dcName: String(dcName || dcId),
        logSources: normalizedSources,
        targetFields,
      };
    });

    return map;
  }, [researchResults, streams]);

  const platformSuggestionDetails = useMemo(() => {
    const streamMeta = streams[0]?.metadata as Record<string, unknown> | undefined;
    const stored = streamMeta?.ai_enrichment || streamMeta?.aiEnrichment;
    const storedSuggestions = stored && typeof stored === 'object'
      ? (stored as { platform_suggestions?: unknown; platformSuggestions?: unknown }).platform_suggestions
        || (stored as { platformSuggestions?: unknown }).platformSuggestions
      : undefined;
    const suggestionGroups: unknown[] = [];
    if (researchResults?.platformSuggestions && researchResults.platformSuggestions.length > 0) {
      suggestionGroups.push(researchResults.platformSuggestions);
    }
    if (Array.isArray(storedSuggestions)) {
      suggestionGroups.push(storedSuggestions);
    }

    const combined = suggestionGroups.flat();
    if (!Array.isArray(combined)) return [];
    const seen = new Set<string>();
    return combined.map((entry: any) => {
      const platform = typeof entry?.platform === 'string' ? entry.platform : '';
      const sourceUrl = typeof entry?.sourceUrl === 'string'
        ? entry.sourceUrl
        : typeof entry?.source_url === 'string' ? entry.source_url : undefined;
      const key = `${platform.toLowerCase()}::${sourceUrl || ''}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        platform,
        reason: typeof entry?.reason === 'string' ? entry.reason : undefined,
        evidence: typeof entry?.evidence === 'string' ? entry.evidence : undefined,
        sourceUrl,
      };
    }).filter((entry: { platform: string } | null): entry is { platform: string; reason?: string; evidence?: string; sourceUrl?: string } => {
      if (!entry) return false;
      return entry.platform.trim().length > 0;
    });
  }, [researchResults, streams]);

  const platformCheckValidation = useMemo(() => {
    const validationRaw = platformCheckResults?.validation
      ?? (platformCheckResults as { validation?: unknown } | null)?.validation
      ?? [];
    if (!Array.isArray(validationRaw)) return [];
    const seen = new Set<string>();
    return validationRaw.map((entry: any) => {
      const platform = typeof entry?.platform === 'string' ? entry.platform : '';
      const rawSupported = entry?.isSupported ?? entry?.is_supported;
      let isSupported: boolean | null = null;
      if (typeof rawSupported === 'boolean') {
        isSupported = rawSupported;
      } else if (typeof rawSupported === 'string') {
        const normalized = rawSupported.trim().toLowerCase();
        if (normalized === 'true' || normalized === 'yes') isSupported = true;
        if (normalized === 'false' || normalized === 'no') isSupported = false;
      }
      if (!platform || isSupported === null) return null;
      const key = platform.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        platform,
        isSupported,
        reasoning: typeof entry?.reasoning === 'string'
          ? entry.reasoning
          : typeof entry?.reason === 'string' ? entry.reason : undefined,
        evidence: typeof entry?.evidence === 'string' ? entry.evidence : undefined,
        sourceUrl: typeof entry?.sourceUrl === 'string'
          ? entry.sourceUrl
          : typeof entry?.source_url === 'string' ? entry.source_url : undefined,
      };
    }).filter((entry: PlatformValidationResult | null): entry is PlatformValidationResult => Boolean(entry));
  }, [platformCheckResults]);

  const platformCheckAlternatives = useMemo(() => {
    const alternativesRaw = platformCheckResults?.alternativePlatformsFound
      ?? (platformCheckResults as { alternative_platforms_found?: unknown } | null)?.alternative_platforms_found
      ?? [];
    if (!Array.isArray(alternativesRaw)) return [];
    const seen = new Set<string>();
    return alternativesRaw.map((entry: any) => {
      const platform = typeof entry?.platform === 'string' ? entry.platform : '';
      if (!platform) return null;
      const key = platform.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        platform,
        reason: typeof entry?.reason === 'string' ? entry.reason : undefined,
        evidence: typeof entry?.evidence === 'string' ? entry.evidence : undefined,
        sourceUrl: typeof entry?.sourceUrl === 'string'
          ? entry.sourceUrl
          : typeof entry?.source_url === 'string' ? entry.source_url : undefined,
      };
    }).filter((entry: PlatformAlternativeResult | null): entry is PlatformAlternativeResult => Boolean(entry));
  }, [platformCheckResults]);

  const platformCheckSummary = useMemo(() => {
    if (platformCheckValidation.length === 0) {
      if (!platformCheckHasRun || selectedPlatformsList.length === 0) return null;
      return {
        supported: [],
        unsupported: [],
        noEvidence: [...selectedPlatformsList],
      };
    }
    const validationMap = new Map(
      platformCheckValidation.map((entry) => [entry.platform.toLowerCase(), entry])
    );
    const supported: string[] = [];
    const unsupported: string[] = [];
    const noEvidence: string[] = [];
    selectedPlatformsList.forEach((platform) => {
      const match = validationMap.get(platform.toLowerCase());
      if (!match) {
        noEvidence.push(platform);
        return;
      }
      if (match.isSupported) {
        supported.push(platform);
      } else {
        unsupported.push(platform);
      }
    });
    return {
      supported,
      unsupported,
      noEvidence,
    };
  }, [platformCheckValidation, platformCheckHasRun, selectedPlatformsList]);

  const researchSuggestedPlatforms = useMemo(() => {
    const raw = platformSuggestionDetails
      .map((entry) => entry.platform)
      .filter((platform): platform is string => typeof platform === 'string' && platform.trim().length > 0);
    return normalizePlatformList(raw);
  }, [platformSuggestionDetails]);

  const stixPlatformsByDcId = useMemo(() => {
    const map: Record<string, string[]> = {};
    dataComponents.forEach((component) => {
      if (!component.id) return;
      const rawPlatforms = Array.isArray(component.platforms)
        ? component.platforms.filter((platform) => typeof platform === 'string' && platform.trim().length > 0)
        : [];
      map[component.id.toLowerCase()] = normalizePlatformList(rawPlatforms);
    });
    return map;
  }, [dataComponents]);

  const handleTogglePlatform = (platform: string) => {
    setSelectedPlatforms(prev => {
      const next = new Set(prev);
      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }
      return next;
    });
  };

  const handleNextDetails = () => {
    const vendorTrimmed = vendor.trim();
    const productTrimmed = product.trim();
    if (!vendorTrimmed && !productTrimmed) {
      toast({
        title: 'Missing details',
        description: 'Enter a vendor or product name to continue.',
        variant: 'destructive',
      });
      return;
    }
    if (!description.trim()) {
      toast({
        title: 'Missing description',
        description: 'Add a short description to continue.',
        variant: 'destructive',
      });
      return;
    }
    const nextVendor = vendorTrimmed || productTrimmed;
    const nextProduct = productTrimmed || vendorTrimmed;
    setVendor(nextVendor);
    setProduct(nextProduct);
    setStep('platforms');
  };

  const handleNextPlatforms = () => {
    if (selectedPlatforms.size === 0) {
      toast({
        title: 'Select platforms',
        description: 'Choose at least one MITRE platform to continue.',
        variant: 'destructive',
      });
      return;
    }
    setStep(platformCheckEnabled ? 'platform-review' : 'review');
  };

  const handleBackStreams = () => {
    if (guidedContextIndex > 0) {
      setGuidedContextIndex(prev => Math.max(0, prev - 1));
      return;
    }
    setStep('auto-results');
  };

  const runPlatformCheck = async () => {
    if (platformCheckLoading || platformCheckHasRun) return;
    if (!platformCheckEnabled) return;
    if (!vendor.trim() && !product.trim()) {
      toast({
        title: 'Missing product info',
        description: 'Add a vendor or product name before running the platform check.',
        variant: 'destructive',
      });
      return;
    }

    let didAttempt = false;
    try {
      setPlatformCheckLoading(true);
      didAttempt = true;
      const response = await fetch('/api/ai/research/platforms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor,
          product,
          description,
          platforms: selectedPlatformsList,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to run platform check');
      }
      setPlatformCheckResults(payload);
      const validationCount = Array.isArray(payload.validation)
        ? payload.validation.length
        : 0;
      const alternativeCount = Array.isArray(payload.alternativePlatformsFound)
        ? payload.alternativePlatformsFound.length
        : 0;
      toast({
        title: 'Platform check complete',
        description: validationCount > 0
          ? `Validated ${validationCount} platform${validationCount === 1 ? '' : 's'} with evidence.`
          : alternativeCount > 0
            ? `Found ${alternativeCount} alternative platform${alternativeCount === 1 ? '' : 's'} outside the selected focus.`
            : 'No platform evidence was returned.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      toast({
        title: 'Platform check failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setPlatformCheckLoading(false);
      if (didAttempt) {
        setPlatformCheckHasRun(true);
      }
    }
  };

  useEffect(() => {
    if (step !== 'platform-review') return;
    if (platformCheckHasRun || platformCheckLoading) return;
    void runPlatformCheck();
  }, [step, platformCheckHasRun, platformCheckLoading]);

  useEffect(() => {
    if (!platformCheckEnabled && step === 'platform-review') {
      setStep('review');
    }
  }, [platformCheckEnabled, step]);

  const handleGeminiSuggest = async () => {
    if (geminiLoading) return;
    if (selectedPlatformsList.length === 0) {
      toast({
        title: 'Select platforms first',
        description: 'Choose at least one platform before running Gemini mapping.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setGeminiLoading(true);
      setGeminiSuggestionCount(null);
      setGeminiEvaluationCount(null);
      setGeminiDecisionMap({});
      setGeminiSources([]);
      setGeminiNotes(null);
      const response = await fetch('/api/ai/gemini/data-components', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor,
          product,
          aliases,
          platforms: selectedPlatformsList,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to generate Gemini suggestions');
      }

      const mappingPayload = payload as GeminiMappingResponse;
      const decisions = Array.isArray(mappingPayload.decisions) ? mappingPayload.decisions : [];
      const decisionMap: Record<string, GeminiMappingDecision> = {};
      decisions.forEach((decision) => {
        if (!decision || typeof decision.id !== 'string') return;
        decisionMap[decision.id] = {
          id: decision.id,
          selected: Boolean(decision.selected),
          reason: typeof decision.reason === 'string' ? decision.reason : undefined,
          evidence: typeof decision.evidence === 'string' ? decision.evidence : undefined,
          sourceUrl: typeof decision.sourceUrl === 'string'
            ? decision.sourceUrl
            : typeof (decision as { source_url?: string }).source_url === 'string'
              ? (decision as { source_url?: string }).source_url
              : undefined,
        };
      });
      const selectedFromDecisions = decisions
        .filter((decision) => decision?.selected && typeof decision.id === 'string')
        .map((decision) => decision.id);
      const suggestedIds = Array.from(new Set(
        Array.isArray(mappingPayload.suggestedIds)
          ? mappingPayload.suggestedIds
          : selectedFromDecisions
      ));
      if (suggestedIds.length === 0) {
        toast({
          title: 'No suggestions returned',
          description: 'Gemini did not return any data components for this product.',
        });
        return;
      }

      const streamIndex = 0;
      const nextAnswers = { ...(streams[streamIndex]?.questionAnswers || {}) };
      suggestedIds.forEach((id: string) => {
        nextAnswers[id] = true;
      });

      updateStreamGuided(streamIndex, { questionAnswers: nextAnswers });
      applyGuidedMapping(streamIndex, nextAnswers);
      setGeminiSuggestionCount(suggestedIds.length);
      setGeminiEvaluationCount(
        typeof mappingPayload.evaluatedCount === 'number'
          ? mappingPayload.evaluatedCount
          : decisions.length > 0
            ? decisions.length
            : typeof mappingPayload.candidateCount === 'number'
              ? mappingPayload.candidateCount
              : null
      );
      setGeminiDecisionMap(decisionMap);
      setGeminiSources(Array.isArray(mappingPayload.sources) ? mappingPayload.sources : []);
      setGeminiNotes(typeof mappingPayload.notes === 'string' ? mappingPayload.notes : null);
      toast({
        title: 'Gemini suggestions applied',
        description: `Selected ${suggestedIds.length} data components.`,
      });
      if (typeof mappingPayload.notes === 'string' && mappingPayload.notes.trim().length > 0) {
        toast({
          title: 'Gemini note',
          description: mappingPayload.notes.trim(),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      toast({
        title: 'Gemini mapping failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setGeminiLoading(false);
    }
  };

  const handleResearchEnrichment = async () => {
    if (researchLoading) return;
    if (selectedGuidedComponents.length === 0) {
      toast({
        title: 'Select data components',
        description: 'Choose at least one data component before running experimental research.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setResearchLoading(true);
      setResearchResults(null);
      setPlatformSuggestionDismissed(false);
      const response = await fetch('/api/ai/research/log-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor,
          product,
          aliases,
          platforms: selectedPlatformsList,
          dataComponentIds: selectedGuidedComponents,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to run experimental research');
      }

      setResearchResults(payload);
      const populated = Array.isArray(payload.results)
        ? payload.results.filter((entry: ResearchResultEntry) => entry.logSources?.length > 0).length
        : 0;
      toast({
        title: 'Research enrichment complete',
        description: populated > 0
          ? `Found log source details for ${populated} data component${populated === 1 ? '' : 's'}.`
          : 'No log source details were found. Try adjusting the product description.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      toast({
        title: 'Experimental research failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setResearchLoading(false);
    }
  };

  const handleConfirmResearchResults = async () => {
    if (!researchResults) {
      toast({
        title: 'No research results',
        description: 'Run experimental research before confirming.',
        variant: 'destructive',
      });
      return;
    }
    if (!createdProductId) {
      toast({
        title: 'Product not ready',
        description: 'Create the product before confirming research results.',
        variant: 'destructive',
      });
      return;
    }
    if (researchConfirming) return;

    try {
      setResearchConfirming(true);
      const now = new Date().toISOString();
      const enrichedResults = researchResults.results.map((entry) => ({
        data_component_id: entry.dcId,
        data_component_name: entry.dcName,
        target_fields: entry.targetFields || [],
        log_sources: entry.logSources.map((source) => ({
          name: source.name,
          channel: source.channel,
          required_fields: source.requiredFields || [],
          missing_fields: source.missingFields || [],
          evidence: source.evidence,
          source_url: source.sourceUrl,
          verified_by_ai: true,
        })),
      }));
      const platformSuggestions = (researchResults.platformSuggestions || []).map((entry) => ({
        platform: entry.platform,
        reason: entry.reason,
        evidence: entry.evidence,
        source_url: entry.sourceUrl,
      }));
      const existingEnrichment = streams[0]?.metadata
        ? (streams[0].metadata as { ai_enrichment?: unknown; aiEnrichment?: unknown }).ai_enrichment
          ?? (streams[0].metadata as { ai_enrichment?: unknown; aiEnrichment?: unknown }).aiEnrichment
        : undefined;
      const mergedResults = mergeEnrichmentResults(
        existingEnrichment && typeof existingEnrichment === 'object'
          ? (existingEnrichment as { results?: unknown }).results
          : [],
        enrichedResults
      );
      const mergedPlatformSuggestions = mergePlatformSuggestions(
        existingEnrichment && typeof existingEnrichment === 'object'
          ? (existingEnrichment as { platform_suggestions?: unknown; platformSuggestions?: unknown }).platform_suggestions
            ?? (existingEnrichment as { platformSuggestions?: unknown }).platformSuggestions
          : [],
        platformSuggestions
      );
      const requiredFields = mergedResults
        .flatMap((entry) => entry.log_sources.flatMap((source) => source.required_fields || []))
        .map((field) => field.trim())
        .filter((field) => field.length > 0);
      const uniqueFields = Array.from(new Set(requiredFields));

      const normalizedStreams = streams.map((stream, index) => {
        if (index !== 0) return stream;
        const streamName = stream.name.trim() || defaultEvidenceSourceName;
        const nextMetadata = {
          ...(stream.metadata || {}),
          ai_enrichment: {
            confirmed: true,
            confirmed_at: now,
            model: researchResults.model,
            note: researchResults.note || (existingEnrichment as { note?: string })?.note,
            results: mergedResults,
            platform_suggestions: mergedPlatformSuggestions,
          },
          fields: uniqueFields,
        };
        return {
          ...stream,
          name: streamName,
          metadata: nextMetadata,
        };
      });

      setStreams(normalizedStreams);
      await saveProductStreams(createdProductId, normalizedStreams);
      toast({
        title: 'Evidence confirmed',
        description: 'Research evidence saved to product telemetry metadata.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      toast({
        title: 'Failed to confirm evidence',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setResearchConfirming(false);
    }
  };

  const suggestedPlatformsToAdd = useMemo(() => {
    return researchSuggestedPlatforms.filter((platform) => !selectedPlatforms.has(platform));
  }, [researchSuggestedPlatforms, selectedPlatforms]);

  const handleApplyPlatformSuggestions = () => {
    if (suggestedPlatformsToAdd.length === 0) {
      setPlatformSuggestionDismissed(true);
      return;
    }
    setSelectedPlatforms(prev => {
      const next = new Set(prev);
      suggestedPlatformsToAdd.forEach((platform) => next.add(platform));
      return next;
    });
    setGuidedContextIndex(0);
    setPlatformSuggestionDismissed(true);
    toast({
      title: 'Platforms updated',
      description: `Added ${suggestedPlatformsToAdd.length} suggested platform${suggestedPlatformsToAdd.length === 1 ? '' : 's'}.`,
    });
  };

  const handleDismissPlatformSuggestions = () => {
    setPlatformSuggestionDismissed(true);
  };

  const handleNextStreams = () => {
    if (wizardContextOptions.length === 0) {
      const description = dataComponentsFallbackReason === 'no_platform_metadata'
        ? 'MITRE data components in this dataset have no platform metadata. Use "Show unscoped data components" to continue.'
        : dataComponentsFallbackReason === 'graph_unavailable'
          ? 'The MITRE graph is unavailable. Initialize the dataset or show unscoped data components to continue.'
          : dataComponentsFallbackReason === 'no_platform_matches'
            ? 'No data components match the selected platforms. Adjust your platform selection.'
            : 'Adjust the platform selection to load data components.';
      toast({
        title: 'No data components found',
        description,
        variant: 'destructive',
      });
      return;
    }
    if (guidedContextIndex < wizardContextOptions.length - 1) {
      setGuidedContextIndex(prev => Math.min(prev + 1, wizardContextOptions.length - 1));
      return;
    }
    if (!hasConfiguredStreams) {
      toast({
        title: 'Select at least one data component',
        description: 'Choose at least one data component so we can map coverage.',
        variant: 'destructive',
      });
      return;
    }
    setStep('guided-summary');
  };

  const handleSaveGuidedCoverage = async () => {
    if (!hasConfiguredStreams) {
      toast({
        title: 'Select at least one data component',
        description: 'Choose at least one data component so we can map coverage.',
        variant: 'destructive',
      });
      return;
    }
    if (!createdProductId) {
      toast({
        title: 'Missing product ID',
        description: 'Create the product before saving guided coverage.',
        variant: 'destructive',
      });
      return;
    }
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);
      const normalizedStreams = streams.map(stream => ({
        ...stream,
        name: stream.name.trim() || defaultEvidenceSourceName,
      }));
      setStreams(normalizedStreams);
      await saveProductStreams(createdProductId, normalizedStreams);

      const configuredStreams = normalizedStreams.filter(stream => stream.mappedDataComponents.length > 0);
      const summary = await saveWizardCoverage(
        createdProductId,
        selectedPlatformsList,
        configuredStreams
      );

      setGuidedSummary(summary);
      toast({
        title: 'Guided coverage saved',
        description: `Inferred ${summary.techniques} technique${summary.techniques === 1 ? '' : 's'} from guided telemetry.`,
      });
      setStep('guided-results');
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failed to save guided coverage',
        description: error instanceof Error ? error.message : 'Unexpected error',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAutoMap = async () => {
    if (isSubmitting) return;
    if (platformCheckEnabled) {
      void runPlatformCheck();
    }
    setIsSubmitting(true);
    setStep('analyzing');
    let created: CreatedProduct | null = null;

    try {
      setProgressMessage('Creating product...');
      const vendorTrimmed = vendor.trim();
      const productTrimmed = product.trim();
      const finalVendor = vendorTrimmed || productTrimmed;
      const finalProduct = productTrimmed || vendorTrimmed;
      const productId = buildProductId(finalVendor, finalProduct);
      const createdProduct = await createProduct({
        productId,
        vendor: finalVendor,
        productName: finalProduct,
        description: description.trim(),
        platforms: selectedPlatformsList,
        dataComponentIds: [],
        source: 'custom',
      });
      created = createdProduct;

      if (aliases.length > 0) {
        setProgressMessage('Saving aliases...');
        await Promise.all(aliases.map(alias => addAlias(createdProduct.id, alias)));
      }

      setProgressMessage('Saving evidence sources...');
      const normalizedStreams = streams.map(stream => ({
        ...stream,
        name: stream.name.trim() || defaultEvidenceSourceName,
      }));
      await saveProductStreams(createdProduct.productId, normalizedStreams);

      setProgressMessage('Running auto mapper...');
      await runAutoMapper(createdProduct.productId);
      setProgressMessage('Finalizing mapping...');
      const mappingResult = await waitForMapping(createdProduct.productId);

      setCreatedProductId(createdProduct.productId);
      setProgressMessage('Preparing evidence prompts...');
      const ssm = await fetchProductSsm(createdProduct.productId);
      setSsmCapabilities(ssm);

      const techniqueIds = Array.from(
        new Set(ssm.flatMap(cap => cap.mappings.map(mapping => mapping.techniqueId)))
      );
      const requirementsEntries = await Promise.all(
        techniqueIds.map(async (techId) => ({
          techId,
          requirements: await fetchTechniqueRequirements(techId),
        }))
      );
      const requirementsMap: Record<string, TechniqueRequirement[]> = {};
      requirementsEntries.forEach(entry => {
        requirementsMap[entry.techId] = entry.requirements;
      });
      setTechniqueRequirements(requirementsMap);

      const defaultEvidence: Record<string, TechniqueEvidenceEntry[]> = {};
      techniqueIds.forEach((techId) => {
        const firstRequirement = requirementsMap[techId]?.[0];
        defaultEvidence[techId] = [{
          name: '',
          channel: '',
          eventId: '',
          dataComponent: firstRequirement?.dataComponentName || '',
        }];
      });
      setEvidenceEntries(defaultEvidence);
      setMappingSummary({
        techniques: techniqueIds.length,
        analytics: mappingResult?.mapping?.analytics?.length || 0,
        dataComponents: mappingResult?.mapping?.dataComponents?.length || 0,
        sources: mappingResult?.sources || (mappingResult?.source ? [mappingResult.source] : []),
      });

      toast({
        title: 'Auto mapping complete',
        description: `${product} has been created and mapped.`,
      });
      const nextStep: Step = (techniqueIds.length < EVIDENCE_AUTO_THRESHOLD || wantsEvidence)
        ? 'streams'
        : 'complete';
      setAutoResultsNextStep(nextStep);
      setStep('auto-results');
    } catch (error) {
      console.error(error);
      if (created?.productId) {
        try {
          await deleteProduct(created.productId);
        } catch (cleanupError) {
          console.error('Failed to delete product after auto-map failure', cleanupError);
        }
      }
      toast({
        title: 'Auto mapping failed',
        description: error instanceof Error ? error.message : 'Unexpected error',
        variant: 'destructive',
      });
      setStep('review');
    } finally {
      setIsSubmitting(false);
    }
  };

  const techniqueList = useMemo(() => {
    const map = new Map<string, { id: string; name: string; mappingIds: number[] }>();
    ssmCapabilities.forEach(cap => {
      cap.mappings.forEach(mapping => {
        if (!mapping.id) return;
        const existing = map.get(mapping.techniqueId) || {
          id: mapping.techniqueId,
          name: mapping.techniqueName,
          mappingIds: [],
        };
        existing.mappingIds.push(mapping.id);
        map.set(mapping.techniqueId, existing);
      });
    });
    return Array.from(map.values());
  }, [ssmCapabilities]);

  const updateEvidenceEntry = (
    techniqueId: string,
    index: number,
    field: keyof TechniqueEvidenceEntry,
    value: string
  ) => {
    setEvidenceEntries(prev => {
      const next = { ...prev };
      const entries = [...(next[techniqueId] || [])];
      const target = { ...(entries[index] || { name: '', channel: '', eventId: '', dataComponent: '' }) };
      target[field] = value;
      entries[index] = target;
      next[techniqueId] = entries;
      return next;
    });
  };

  const addEvidenceEntry = (techniqueId: string) => {
    setEvidenceEntries(prev => {
      const next = { ...prev };
      const entries = [...(next[techniqueId] || [])];
      entries.push({ name: '', channel: '', eventId: '', dataComponent: '' });
      next[techniqueId] = entries;
      return next;
    });
  };

  const handleSaveEvidence = async () => {
    if (!createdProductId) return;
    try {
      setIsSubmitting(true);
      setProgressMessage('Saving evidence metadata...');
      const updates: Promise<unknown>[] = [];
      let savedTechniques = 0;

      techniqueList.forEach((technique) => {
        const entries = (evidenceEntries[technique.id] || []).filter(entry => entry.name.trim().length > 0);
        if (entries.length === 0) return;
        savedTechniques += 1;
        const metadata = {
          log_sources: entries.map(entry => ({
            name: entry.name,
            channel: entry.channel || undefined,
            event_id: entry.eventId || undefined,
            satisfies_data_component: entry.dataComponent || undefined,
            dataComponent: entry.dataComponent || undefined,
          })),
        };
        technique.mappingIds.forEach(mappingId => {
          updates.push(updateMappingMetadata(mappingId, metadata));
        });
      });

      if (updates.length === 0) {
        toast({
          title: 'No evidence provided',
          description: 'No log sources were added. You can add them later.',
        });
        setStep('complete');
        setTimeout(() => {
          onComplete(createdProductId);
        }, 300);
        return;
      }

      await Promise.all(updates);
      toast({
        title: 'Evidence saved',
        description: `Saved evidence for ${savedTechniques} technique${savedTechniques === 1 ? '' : 's'}.`,
      });
      setStep('complete');
      setTimeout(() => {
        onComplete(createdProductId);
      }, 300);
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failed to save evidence',
        description: error instanceof Error ? error.message : 'Unexpected error',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === 'details') {
    return (
      <>
        {renderStepper()}
        <Card className="bg-transparent border-none shadow-none w-full">
          <CardHeader>
            <CardTitle>Product details</CardTitle>
            <CardDescription>
              Add the vendor, product, aliases, and description. If the vendor and product are the same, you can fill just one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendor">Vendor</Label>
                <Input
                  id="vendor"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="e.g., Microsoft"
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product">Product</Label>
                <Input
                  id="product"
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  placeholder="e.g., Defender for Endpoint"
                  className="bg-background"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a short description of the product and telemetry."
                className="bg-background min-h-[80px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="aliases">Aliases</Label>
              <div className="flex gap-2">
                <Input
                  id="aliases"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  placeholder="Add alias and press plus"
                  className="bg-background"
                />
                <Button type="button" variant="secondary" onClick={handleAddAlias}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {aliases.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {aliases.map(alias => (
                    <Badge key={alias} variant="secondary" className="flex items-center gap-1">
                      {alias}
                      <button
                        type="button"
                        onClick={() => handleRemoveAlias(alias)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <Button variant="secondary" onClick={onCancel} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleNextDetails} className="flex-1">
                Continue
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (step === 'platforms') {
    return (
      <>
        {renderStepper()}
        <Card className="bg-transparent border-none shadow-none w-full">
          <CardHeader>
            <CardTitle>Select MITRE platforms</CardTitle>
            <CardDescription>
              Choose the platforms this product applies to so the mapping is scoped correctly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {platformsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading platforms...
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {platforms.map(platform => {
                  const isSelected = selectedPlatforms.has(platform);
                  const description = PLATFORM_DESCRIPTIONS[platform] || 'General MITRE platform coverage.';
                  return (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => handleTogglePlatform(platform)}
                      className={cn(
                        'rounded-lg border px-3 py-3 text-left text-sm transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background/60 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <div className="text-sm font-semibold">{platform}</div>
                      <div className={cn(
                        'text-xs mt-1 leading-snug',
                        isSelected ? 'text-primary/80' : 'text-muted-foreground'
                      )}>
                        {description}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {heuristicSuggestedPlatforms.length > 0 && (
              <div className="rounded-lg border border-dashed border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Suggested based on your details:
                <div className="flex flex-wrap gap-2 mt-2">
                  {heuristicSuggestedPlatforms.map(platform => (
                    <Badge key={platform} variant="secondary">
                      {platform}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={platformCheckEnabled}
                  onCheckedChange={(checked) => setPlatformCheckEnabled(checked === true)}
                />
                <span className="text-foreground">Run Gemini platform check</span>
              </div>
              <div>
                Optional: verify your selected platforms against vendor documentation before moving forward.
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{selectedPlatforms.size} selected</span>
            </div>

            <div className="flex gap-3 pt-4">
              <Button variant="secondary" onClick={() => setStep('details')} className="flex-1">
                Back
              </Button>
              <Button onClick={handleNextPlatforms} className="flex-1">
                Continue
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (step === 'streams') {
    const currentGroup = groupedDataComponents[guidedContextIndex];
    const currentContext = currentGroup?.group;
    const totalQuestions = currentGroup ? currentGroup.components.length : 0;
    const isLastContext = wizardContextOptions.length > 0
      && guidedContextIndex === wizardContextOptions.length - 1;
    const nextLabel = isLastContext ? 'Review requirements' : 'Next platform';

    return (
      <>
        {renderStepper()}
        <Card className="bg-transparent border-none shadow-none w-full">
          <CardHeader>
            <CardTitle>Data component wizard</CardTitle>
            <CardDescription>
              For each platform, select the tiles that match telemetry you can collect.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-32">
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-2">
              <p>
                A Data Component is ATT&CK’s definition of a telemetry element that is used for detections to identify
                specific techniques and sub-techniques of an attack (Usually its a log entry for e.g., Process Creation,
                Network Connection Creation, User Account Authentication).
              </p>
              <p>
                Select the components the data source can generate (usually a log) that can be collected.
              </p>
              <p>
                Use the description and examples in each entry to decide; if you can’t collect it, leave it unchecked.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleGeminiSuggest}
                disabled={geminiLoading || selectedPlatformsList.length === 0}
                title="Use Gemini to suggest which data components to select based on the product details and platforms."
              >
                {geminiLoading ? 'Mapping with Gemini...' : 'Auto-select with Gemini'}
              </Button>
            </div>
            {geminiSuggestionCount !== null && (
              <div className="text-xs text-muted-foreground">
                {`Gemini evaluated ${geminiEvaluationCount ?? dataComponents.length} of ${dataComponents.length} data components and selected ${geminiSuggestionCount}. Review before continuing.`}
              </div>
            )}
            {geminiSuggestionCount !== null && (
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground space-y-2">
                <div className="font-semibold text-foreground">Gemini mapping summary</div>
                {geminiNotes && (
                  <div>Notes: {geminiNotes}</div>
                )}
                {geminiSources.length > 0 && (
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">Sources</div>
                    <div className="flex flex-wrap gap-2">
                      {geminiSources.map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2 text-primary"
                        >
                          {source.title || source.url}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {dataComponentsLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading MITRE data components...
              </div>
            )}
            {dataComponentsError && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                Unable to load MITRE data components. Ensure the MITRE graph is initialized.
              </div>
            )}
            {canShowUnscopedToggle && !includeUnscopedDataComponents && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 space-y-2">
                <div>
                  {dataComponentsFallbackReason === 'graph_unavailable'
                    ? 'The MITRE graph is unavailable, so strict platform filtering returned no data components.'
                    : 'This dataset does not include platform metadata for data components, so strict filtering returned no results.'}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIncludeUnscopedDataComponents(true)}
                >
                  Show unscoped data components
                </Button>
              </div>
            )}
            {dataComponentsFallbackReason === 'no_platform_matches' && !dataComponentsLoading && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                No data components matched the selected platforms. Adjust your platform selection to continue.
              </div>
            )}
            {dataComponentsMeta?.unscopedIncluded && (
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                Showing unscoped data components because platform metadata is unavailable.
              </div>
            )}
            <div className="space-y-4">
              {streams.slice(0, 1).map((stream, index) => (
                <div key={`stream-${index}`} className="border border-border rounded-lg p-4 space-y-4 bg-background/40">
                  {currentGroup ? (
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-xs uppercase text-primary font-semibold tracking-wide">
                            {currentGroup.group}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Platform {guidedContextIndex + 1} of {wizardContextOptions.length}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {totalQuestions} data components
                        </Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {currentGroup.components.map(component => {
                          const isChecked = Boolean(stream.questionAnswers?.[component.id]);
                          const description = component.shortDescription || component.description || '';
                          const aiDecision = geminiDecisionMap[component.id];
                          const aiSelected = Boolean(aiDecision?.selected);
                          return (
                            <label
                              key={`${component.id}-${index}-${currentContext}`}
                              className={cn(
                                'flex flex-col gap-2 rounded-lg border p-3 text-xs sm:text-sm cursor-pointer transition-colors',
                                isChecked
                                  ? 'border-primary bg-primary/10 shadow-sm'
                                  : component.relevanceScore
                                    ? 'border-primary/30 bg-primary/5'
                                    : 'border-border/60 bg-background/40 hover:bg-muted/30'
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-semibold text-foreground">
                                      Do the product/service generate a log for {component.name}?
                                    </div>
                                    <Badge variant="outline" className="text-[10px]">
                                      {component.id}
                                    </Badge>
                                  </div>
                                  {aiSelected && (
                                    <Badge variant="secondary" className="text-[10px] w-fit">
                                      AI Selected
                                    </Badge>
                                  )}
                                </div>
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={(checked) => {
                                    const nextAnswers = { ...(stream.questionAnswers || {}) };
                                    if (checked === true) {
                                      nextAnswers[component.id] = true;
                                    } else {
                                      delete nextAnswers[component.id];
                                    }
                                    updateStreamGuided(index, { questionAnswers: nextAnswers });
                                    applyGuidedMapping(index, nextAnswers);
                                  }}
                                />
                              </div>
                              {description && (
                                <div className="text-xs text-muted-foreground">
                                  {description}
                                </div>
                              )}
                              {component.examples && component.examples.length > 0 && (
                                <div className="text-xs text-muted-foreground">
                                  <span className="font-semibold text-foreground">Common examples:</span>{' '}
                                  {component.examples.join('; ')}
                                </div>
                              )}
                              {aiSelected && (aiDecision?.reason || aiDecision?.evidence || aiDecision?.sourceUrl) && (
                                <details className="rounded-md border border-primary/30 bg-primary/5 px-2 py-2 text-xs">
                                  <summary
                                    className="cursor-pointer font-semibold text-primary"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    AI evidence
                                  </summary>
                                  <div className="mt-2 space-y-1 text-muted-foreground">
                                    {aiDecision?.reason && (
                                      <div>
                                        <span className="font-semibold text-foreground">Reason:</span> {aiDecision.reason}
                                      </div>
                                    )}
                                    {aiDecision?.evidence && (
                                      <div>
                                        <span className="font-semibold text-foreground">Evidence:</span> {aiDecision.evidence}
                                      </div>
                                    )}
                                    {aiDecision?.sourceUrl && (
                                      <a
                                        href={aiDecision.sourceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="underline underline-offset-2 text-primary"
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        {aiDecision.sourceUrl}
                                      </a>
                                    )}
                                  </div>
                                </details>
                              )}
                              {isChecked && (
                                <InlineRequirementHint
                                  dcNames={[component.name]}
                                  enrichment={enrichmentByDcId[component.id.toLowerCase()]}
                                />
                              )}
                            </label>
                          );
                        })}
                        {currentGroup.components.length === 0 && (
                          <div className="text-xs text-muted-foreground">
                            {dataComponentsFallbackReason === 'no_platform_metadata'
                              ? 'No platform metadata found for data components.'
                              : dataComponentsFallbackReason === 'graph_unavailable'
                                ? 'MITRE graph is unavailable, so data components cannot be filtered.'
                                : dataComponentsFallbackReason === 'no_platform_matches'
                                  ? 'No data components match the selected platforms.'
                                  : 'No data components available for the selected platforms.'}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {dataComponentsFallbackReason === 'no_platform_metadata'
                        ? 'No platform metadata found for data components.'
                        : dataComponentsFallbackReason === 'graph_unavailable'
                          ? 'MITRE graph is unavailable, so data components cannot be filtered.'
                          : dataComponentsFallbackReason === 'no_platform_matches'
                            ? 'No data components match the selected platforms.'
                            : 'No data components match the selected platforms yet.'}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="sticky bottom-0 z-10 -mx-6 border-t border-border bg-background/95 px-6 py-4 backdrop-blur space-y-3">
              <div className="text-xs text-muted-foreground">Selected data components</div>
              {streams[0]?.mappedDataComponents.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {streams[0].mappedDataComponents.map(component => (
                    <Badge key={`selected-${component}`} variant="secondary">
                      {formatDataComponentLabel(component)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">None selected yet.</div>
              )}
              <div className="flex gap-3">
                <Button variant="secondary" onClick={handleBackStreams} className="flex-1">
                  {guidedContextIndex > 0 ? 'Previous platform' : 'Back'}
                </Button>
                <Button
                  onClick={handleNextStreams}
                  className="flex-1"
                  disabled={isSubmitting || wizardContextOptions.length === 0}
                >
                  {nextLabel}
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (step === 'guided-summary') {
    return (
      <>
        {renderStepper()}
        <div className="flex flex-col gap-6 min-h-[70vh]">
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold text-foreground">Derived Analytic Requirements</h2>
            <p className="text-sm text-muted-foreground">
              This is the review step. The Data Component page is where you select what the product can generate; this page
              expands those selections into what MITRE analytics require so you can verify coverage before mapping.
            </p>
            <div className="rounded-lg border border-border/60 bg-background/60 p-3 text-xs text-muted-foreground space-y-2">
              <div>
                <span className="font-semibold text-foreground">Expected Core Fields</span> - baseline field checklist
                derived from MITRE data component semantics in our requirements catalog.
              </div>
              <div>
                <span className="font-semibold text-foreground">Mutable Elements (STIX)</span> - tunable analytic parameters
                that you adjust per environment (for example thresholds or allowlists).
              </div>
              <div>
                <span className="font-semibold text-foreground">Log Sources to Look For</span> - common telemetry streams
                that provide the data component when no vendor evidence is present.
              </div>
              <div>
                <span className="font-semibold text-foreground">Data Source</span> - MITRE data source family tied to the
                data component.
              </div>
              <div>
                <span className="font-semibold text-foreground">Field match</span> - compares the STIX mutable-element
                checklist to fields Gemini found in vendor logs.
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Log source names and channels shown below come from Gemini evidence when available; otherwise, they remain
              MITRE expectations.
            </p>
          </div>

          {selectedGuidedComponents.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedGuidedComponents.map(component => (
                <Badge key={component} variant="secondary">
                  {formatDataComponentLabel(component)}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No data components selected yet.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResearchEnrichment}
              disabled={researchLoading || selectedGuidedComponents.length === 0}
              title="Use Gemini web search to find vendor log source names, channels, and fields for the selected data components."
            >
              {researchLoading ? 'Researching online sources...' : 'Experimental: Research log sources'}
            </Button>
          </div>

          {researchResults && (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Experimental enrichment</div>
                  <div className="text-sm font-semibold text-foreground">Vendor log source research</div>
                </div>
                <Badge variant="outline" className="text-xs">Experimental</Badge>
              </div>
              {researchResults.note && (
                <div className="text-xs text-muted-foreground">{researchResults.note}</div>
              )}
              {platformSuggestionDetails.length > 0 && suggestedPlatformsToAdd.length > 0 && !platformSuggestionDismissed && (
                <div className="rounded-lg border border-border/60 bg-background/60 p-3 space-y-2">
                  <div className="text-xs font-semibold text-foreground">
                    Suggested platforms
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Gemini found additional platform evidence. Add them or keep your current selection.
                  </div>
                  <div className="space-y-2">
                    {platformSuggestionDetails.map((entry) => (
                      <div key={`${entry.platform}-${entry.sourceUrl || entry.reason}`} className="text-xs text-muted-foreground space-y-1">
                        <div className="font-medium text-foreground">{entry.platform}</div>
                        {entry.reason && (
                          <div>Reason: {entry.reason}</div>
                        )}
                        {entry.evidence && (
                          <div>Evidence: {entry.evidence}</div>
                        )}
                        {entry.sourceUrl && (
                          <a
                            href={entry.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline underline-offset-2"
                          >
                            {entry.sourceUrl}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleApplyPlatformSuggestions}
                      disabled={suggestedPlatformsToAdd.length === 0}
                    >
                      {suggestedPlatformsToAdd.length > 0
                        ? `Add ${suggestedPlatformsToAdd.length} platform${suggestedPlatformsToAdd.length === 1 ? '' : 's'}`
                        : 'No new platforms'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleDismissPlatformSuggestions}
                    >
                      Keep current platforms
                    </Button>
                  </div>
                </div>
              )}
              <ScrollArea className="max-h-[420px]">
                <div className="space-y-3">
                  {researchResults.results.map((entry) => {
                    const targetFields = entry.targetFields || [];
                    const requiredFields = entry.logSources
                      ? Array.from(new Set(entry.logSources.flatMap((source) => source.requiredFields || [])))
                      : [];
                    const matchedCount = targetFields.length > 0
                      ? requiredFields.filter((field) =>
                        targetFields.some((target) => target.toLowerCase() === field.toLowerCase())
                      ).length
                      : 0;
                    const missingFromTargets = targetFields.length > 0
                      ? targetFields.filter((field) =>
                        !requiredFields.some((required) => required.toLowerCase() === field.toLowerCase())
                      )
                      : [];
                    const missingFromSources = entry.logSources
                      ? entry.logSources.flatMap((source) => source.missingFields || [])
                      : [];
                    const missingFields = Array.from(new Set([...missingFromTargets, ...missingFromSources]));

                    return (
                      <div key={entry.dcId} className="rounded-lg border border-border/60 bg-background/40 p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Data component</div>
                            <div className="text-sm font-semibold text-foreground">{entry.dcName}</div>
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {entry.dcId}
                          </Badge>
                        </div>
                        {targetFields.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs font-semibold text-foreground">Mutable elements (STIX)</div>
                            <div className="flex flex-wrap gap-1">
                              {targetFields.map((field) => (
                                <Badge key={`${entry.dcId}-target-${field}`} variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                                  {field}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        {targetFields.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">Field match:</span> {matchedCount}/{targetFields.length}
                            <span className="text-muted-foreground"> (STIX vs evidence fields)</span>
                          </div>
                        )}
                        {missingFields.length > 0 && (
                          <div className="text-xs text-amber-600">
                            <span className="font-semibold">Missing fields:</span> {missingFields.join(', ')}
                          </div>
                        )}
                        {entry.logSources.length > 0 ? (
                          <div className="space-y-2">
                            {entry.logSources.map((source, idx) => (
                              <div key={`${entry.dcId}-${idx}`} className="rounded-md border border-border/60 bg-background/60 p-2 text-xs text-muted-foreground space-y-1">
                                <div className="flex items-center gap-2">
                                  <div className="font-semibold text-foreground">{source.name}</div>
                                  <Badge variant="secondary" className="text-[10px]">Verified by AI</Badge>
                                </div>
                                {source.channel && (
                                  <div>
                                    <span className="font-semibold text-foreground">Channel:</span> {source.channel}
                                  </div>
                                )}
                                {source.requiredFields && source.requiredFields.length > 0 && (
                                  <div className="space-y-1">
                                    <div className="font-semibold text-foreground">Fields:</div>
                                    <div className="flex flex-wrap gap-1">
                                      {source.requiredFields.map((field) => (
                                        <Badge key={`${entry.dcId}-${idx}-${field}`} variant="outline" className="text-[10px]">
                                          {field}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {source.missingFields && source.missingFields.length > 0 && (
                                  <div className="space-y-1 text-amber-600">
                                    <div className="font-semibold">Missing fields:</div>
                                    <div className="flex flex-wrap gap-1">
                                      {source.missingFields.map((field) => (
                                        <Badge key={`${entry.dcId}-${idx}-missing-${field}`} variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                                          {field}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {source.evidence && (
                                  <div>
                                    <span className="font-semibold text-foreground">Evidence:</span> {source.evidence}
                                  </div>
                                )}
                                {source.sourceUrl && (
                                  <a
                                    href={source.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary underline underline-offset-2"
                                  >
                                    {source.sourceUrl}
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            No log source details found for this component.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
              {researchResults.sources && researchResults.sources.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="font-medium text-foreground">Sources used</div>
                  <div className="flex flex-wrap gap-2">
                    {researchResults.sources.map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 text-primary"
                      >
                        {source.title || source.url}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleConfirmResearchResults}
                  disabled={researchConfirming || !createdProductId}
                >
                  {researchConfirming ? 'Saving...' : 'Confirm evidence'}
                </Button>
                {!createdProductId && (
                  <span className="text-xs text-muted-foreground">
                    Create the product before confirming evidence.
                  </span>
                )}
              </div>
            </div>
          )}

          {selectedGuidedComponents.length > 0 && (
            <div className="flex-1">
              <AnalyticRequirementsPanel
                selectedDCNames={selectedGuidedComponents}
                platform={selectedPlatformsList[0]}
                enrichmentByDcId={enrichmentByDcId}
                suggestedPlatforms={researchSuggestedPlatforms}
                stixPlatformsByDcId={stixPlatformsByDcId}
                showHeader={false}
                showMutableHelp={false}
                fullHeight
              />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => setStep('streams')} className="flex-1">
              Back
            </Button>
            <Button
              onClick={handleSaveGuidedCoverage}
              className="flex-1"
              disabled={isSubmitting || !hasConfiguredStreams}
            >
              {isSubmitting ? 'Mapping...' : 'Continue & Map'}
            </Button>
          </div>
        </div>
      </>
    );
  }

  if (step === 'platform-review') {
    const hasValidation = platformCheckValidation.length > 0;
    const hasAlternatives = platformCheckAlternatives.length > 0;
    return (
      <div className="space-y-6">
        {renderStepper()}
        <Card className="bg-transparent border-none shadow-none w-full">
          <CardHeader>
            <CardTitle>Platform review</CardTitle>
            <CardDescription>
              Gemini runs a quick documentation check to validate platform coverage. This check runs once per wizard and
              will not re-run if you change selections.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Selected platforms</div>
              <div className="flex flex-wrap gap-2">
                {selectedPlatformsList.length === 0 ? (
                  <span className="text-sm text-muted-foreground">None</span>
                ) : (
                  selectedPlatformsList.map(platform => (
                    <Badge key={platform} variant="secondary">
                      {platform}
                    </Badge>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-background/60 p-4 space-y-3">
              <div className="text-xs font-semibold text-foreground">Platform check</div>
              {platformCheckLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Running the platform check in the background.
                </div>
              )}
              {!platformCheckLoading && platformCheckResults?.note && (
                <div className="text-xs text-muted-foreground">{platformCheckResults.note}</div>
              )}
              {platformCheckSummary?.supported.length ? (
                <div className="text-xs text-emerald-600">
                  Supported: {platformCheckSummary.supported.join(', ')}
                </div>
              ) : null}
              {platformCheckSummary?.unsupported.length ? (
                <div className="text-xs text-amber-600">
                  Not supported by evidence: {platformCheckSummary.unsupported.join(', ')}
                </div>
              ) : null}
              {platformCheckSummary?.noEvidence.length ? (
                <div className="text-xs text-amber-600">
                  No evidence found for: {platformCheckSummary.noEvidence.join(', ')}
                </div>
              ) : null}
              {platformCheckAlternatives.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Alternative platform variants found: {platformCheckAlternatives.map((entry) => entry.platform).join(', ')}
                </div>
              )}
              {hasValidation && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-semibold text-foreground">Evidence details</summary>
                  <div className="mt-2 space-y-2">
                    {platformCheckValidation.map((entry) => (
                      <div key={`${entry.platform}-${entry.sourceUrl || entry.reasoning}`} className="space-y-1">
                        <div className="font-medium text-foreground">
                          {entry.platform} — {entry.isSupported ? 'Supported' : 'Not supported'}
                        </div>
                        {entry.reasoning && <div>Reason: {entry.reasoning}</div>}
                        {entry.evidence && <div>Evidence: {entry.evidence}</div>}
                        {entry.sourceUrl && (
                          <a
                            href={entry.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline underline-offset-2"
                          >
                            {entry.sourceUrl}
                          </a>
                        )}
                      </div>
                    ))}
                    {platformCheckAlternatives.length > 0 && (
                      <div className="pt-2 space-y-2">
                        <div className="font-semibold text-foreground">Alternative platforms (outside focus)</div>
                        {platformCheckAlternatives.map((entry) => (
                          <div key={`${entry.platform}-${entry.sourceUrl || entry.reason}`} className="space-y-1">
                            <div className="font-medium text-foreground">{entry.platform}</div>
                            {entry.reason && <div>Reason: {entry.reason}</div>}
                            {entry.evidence && <div>Evidence: {entry.evidence}</div>}
                            {entry.sourceUrl && (
                              <a
                                href={entry.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary underline underline-offset-2"
                              >
                                {entry.sourceUrl}
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              )}
              {!platformCheckLoading && platformCheckHasRun && !platformCheckSummary && !hasAlternatives ? (
                <div className="text-xs text-muted-foreground">
                  No additional platform evidence was found for this product.
                </div>
              ) : null}
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="secondary"
                onClick={() => setStep(platformCheckEnabled ? 'platform-review' : 'platforms')}
                className="flex-1"
              >
                Back
              </Button>
              <Button onClick={() => setStep('review')} className="flex-1">
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div className="space-y-6">
        {renderStepper()}
        <Card className="bg-transparent border-none shadow-none w-full">
          <CardHeader>
            <CardTitle>Review details</CardTitle>
            <CardDescription>Confirm the details before running Auto Map.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Vendor</div>
              <div className="text-sm font-medium text-foreground">{vendor}</div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Product</div>
              <div className="text-sm font-medium text-foreground">{product}</div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Description</div>
              <div className="text-sm text-foreground whitespace-pre-wrap">{description}</div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Aliases</div>
              <div className="flex flex-wrap gap-2">
                {aliases.length === 0 ? (
                  <span className="text-sm text-muted-foreground">None</span>
                ) : (
                  aliases.map(alias => (
                    <Badge key={alias} variant="secondary">
                      {alias}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Platforms</div>
              <div className="flex flex-wrap gap-2">
                {selectedPlatformsList.map(platform => (
                  <Badge key={platform} variant="secondary">
                    {platform}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Data components selected</div>
              <div className="text-sm text-foreground">
                {streams.reduce((total, stream) => total + stream.mappedDataComponents.length, 0)} total
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={wantsEvidence}
                onCheckedChange={(checked) => setWantsEvidence(checked === true)}
              />
              <span className="text-foreground">Run evidence review after Auto Map</span>
            </div>

            <div className="flex gap-3 pt-4">
              <Button variant="secondary" onClick={() => setStep('platforms')} className="flex-1">
                Back
              </Button>
              <Button onClick={handleAutoMap} className="flex-1" disabled={isSubmitting}>
                Auto Map
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'auto-results') {
    const capabilityGroups = Array.from(
      new Set(ssmCapabilities.map((capability) => capability.name).filter(Boolean))
    );
    return (
      <>
        {renderStepper()}
        <Card className="bg-transparent border-none shadow-none w-full">
          <CardHeader>
            <CardTitle>Auto-Mapper results</CardTitle>
            <CardDescription>
              Review what Auto Mapper found before continuing to telemetry.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {mappingSummary ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="text-center p-3 rounded bg-background/40">
                    <div className="text-xl font-semibold text-foreground">{mappingSummary.techniques}</div>
                    <div className="text-xs text-muted-foreground">Techniques</div>
                    <div className="text-[10px] text-muted-foreground mt-1">Unique ATT&CK techniques mapped.</div>
                  </div>
                  <div className="text-center p-3 rounded bg-background/40">
                    <div className="text-xl font-semibold text-foreground">{mappingSummary.analytics}</div>
                    <div className="text-xs text-muted-foreground">Analytics</div>
                    <div className="text-[10px] text-muted-foreground mt-1">Detection analytics linked to those techniques.</div>
                  </div>
                  <div className="text-center p-3 rounded bg-background/40">
                    <div className="text-xl font-semibold text-foreground">{mappingSummary.dataComponents}</div>
                    <div className="text-xs text-muted-foreground">Data Components</div>
                    <div className="text-[10px] text-muted-foreground mt-1">Distinct DCs referenced by analytics.</div>
                  </div>
                  <div className="text-center p-3 rounded bg-background/40">
                    <div className="text-xl font-semibold text-foreground">
                      {mappingSummary.sources.length > 0 ? mappingSummary.sources.length : 1}
                    </div>
                    <div className="text-xs text-muted-foreground">Sources</div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {mappingSummary.sources.length > 0 ? mappingSummary.sources.join(', ') : 'Custom input'}
                    </div>
                  </div>
                </div>

                {capabilityGroups.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Capability groups</div>
                    <div className="flex flex-wrap gap-2">
                      {capabilityGroups.map((group) => (
                        <Badge key={group} variant="secondary">
                          {group}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {techniqueList.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">
                      Mapped techniques ({techniqueList.length})
                    </div>
                    <ScrollArea className="max-h-[260px]">
                      <div className="flex flex-wrap gap-2">
                        {techniqueList.map((technique) => (
                          <Badge key={technique.id} variant="outline">
                            {technique.id} — {technique.name}
                          </Badge>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                Auto-Mapper results are not available yet.
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={() => setStep('review')} className="flex-1">
                Back
              </Button>
              <Button onClick={() => setStep(autoResultsNextStep)} className="flex-1">
                {autoResultsNextStep === 'streams' ? 'Continue to Telemetry' : 'Finish'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (step === 'analyzing') {
    return (
      <>
        {renderStepper()}
        <Card className="bg-transparent border-none shadow-none w-full">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4 animate-pulse">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">Auto mapping {product}...</h3>
            <p className="text-muted-foreground text-sm">
              Building coverage from community resources and MITRE mappings.
            </p>
            <div className="text-xs text-muted-foreground mt-3">{progressMessage}</div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (step === 'evidence') {
    return (
      <div className="space-y-6">
        {renderStepper()}
        <Card className="bg-transparent border-none shadow-none w-full">
          <CardHeader>
            <CardTitle>Evidence review</CardTitle>
            <CardDescription>
              Use MITRE recommendations as a guide and add product-specific evidence when needed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
              Add evidence sources that satisfy the required data components for each technique. Use the
              <span className="text-foreground font-medium"> Add Log Source </span>
              button to attach evidence. You can also skip this step and add evidence later from the product page.
            </div>
            {shouldRecommendEvidence && (
              <div className="rounded-lg border border-border bg-primary/10 px-3 py-2 text-xs text-foreground">
                Auto Mapper returned fewer than 5 techniques. We recommend completing evidence now for best results.
              </div>
            )}
            {mappingSummary && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-center">
                  <div className="text-lg font-semibold text-foreground">{mappingSummary.techniques}</div>
                  <div className="text-xs text-muted-foreground">Techniques</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-center">
                  <div className="text-lg font-semibold text-foreground">{mappingSummary.analytics}</div>
                  <div className="text-xs text-muted-foreground">Analytics</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-center">
                  <div className="text-lg font-semibold text-foreground">{mappingSummary.dataComponents}</div>
                  <div className="text-xs text-muted-foreground">Data Components</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-center">
                  <div className="text-xs text-muted-foreground">Sources</div>
                  <div className="text-sm text-foreground">
                    {mappingSummary.sources.length > 0 ? mappingSummary.sources.join(', ') : 'Unknown'}
                  </div>
                </div>
              </div>
            )}
            {techniqueList.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No techniques were returned by Auto Mapper, so there is nothing to attach evidence to yet.
                You can skip for now and add evidence later after techniques are mapped.
              </div>
            )}
            {!evidenceFormExpanded && techniqueList.length > 0 && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                Evidence entry is optional when 5 or more techniques are mapped. You can start now or skip and add evidence later.
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setEvidenceFormExpanded(true)} className="flex-1">
                    Start evidence entry
                  </Button>
                  <Button variant="outline" onClick={() => setStep('complete')} className="flex-1">
                    Skip for now
                  </Button>
                </div>
              </div>
            )}

            {evidenceFormExpanded && techniqueList.map((technique) => {
              const requirements = techniqueRequirements[technique.id] || [];
              const entries = evidenceEntries[technique.id] || [];
              return (
                <div key={technique.id} className="border border-border rounded-lg p-4 bg-background/60">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {technique.id} — {technique.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Recommended data components: {requirements.length > 0
                          ? Array.from(new Set(requirements.map(req => req.dataComponentName))).join(', ')
                          : 'None provided by MITRE'}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => addEvidenceEntry(technique.id)}
                    >
                      Add Log Source
                    </Button>
                  </div>

                  {entries.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {entries.map((entry, idx) => (
                        <div key={`${technique.id}-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <Input
                            value={entry.name}
                            onChange={(event) => updateEvidenceEntry(technique.id, idx, 'name', event.target.value)}
                            placeholder="Log source name"
                            className="bg-background"
                          />
                          <Input
                            value={entry.channel}
                            onChange={(event) => updateEvidenceEntry(technique.id, idx, 'channel', event.target.value)}
                            placeholder="Channel"
                            className="bg-background"
                          />
                          <Input
                            value={entry.eventId}
                            onChange={(event) => updateEvidenceEntry(technique.id, idx, 'eventId', event.target.value)}
                            placeholder="Event ID"
                            className="bg-background"
                          />
                          <Input
                            value={entry.dataComponent}
                            onChange={(event) => updateEvidenceEntry(technique.id, idx, 'dataComponent', event.target.value)}
                            placeholder="Data component"
                            className="bg-background"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {evidenceFormExpanded && (
              <div className="flex gap-3 pt-4">
                <Button variant="secondary" onClick={() => setStep('complete')} className="flex-1">
                  Skip for now
                </Button>
                <Button onClick={handleSaveEvidence} className="flex-1" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save & Continue'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'guided-results') {
    const summary = guidedSummary;
    return (
      <>
        {renderStepper()}
        <Card className="bg-transparent border-none shadow-none w-full">
          <CardHeader>
            <CardTitle>Guided mapping results</CardTitle>
            <CardDescription>
              Telemetry coverage inferred from your data component selections.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center p-3 rounded bg-background/40">
                <div className="text-xl font-semibold text-foreground">{summary?.techniques ?? 0}</div>
                <div className="text-xs text-muted-foreground">Techniques</div>
              </div>
              <div className="text-center p-3 rounded bg-background/40">
                <div className="text-xl font-semibold text-foreground">{summary?.dataComponents ?? 0}</div>
                <div className="text-xs text-muted-foreground">Data Components</div>
              </div>
              <div className="text-center p-3 rounded bg-background/40">
                <div className="text-xl font-semibold text-foreground">{summary?.streams ?? 0}</div>
                <div className="text-xs text-muted-foreground">Streams</div>
              </div>
              <div className="text-center p-3 rounded bg-background/40">
                <div className="text-xs text-muted-foreground mb-1">Sources</div>
                <div className="text-xs text-foreground">
                  {summary?.sources?.length ? summary.sources.join(', ') : 'Guided telemetry'}
                </div>
              </div>
            </div>

            {summary?.platforms?.length ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Platforms</div>
                <div className="flex flex-wrap gap-2">
                  {summary.platforms.map(platform => (
                    <Badge key={platform} variant="secondary">
                      {platform}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {summary?.missingDataComponents && summary.missingDataComponents.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                Not in MITRE bundle: {summary.missingDataComponents.join(', ')}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={() => setStep('streams')} className="flex-1">
                Back
              </Button>
              <Button
                onClick={() => createdProductId && onComplete(createdProductId)}
                className="flex-1"
                disabled={!createdProductId}
              >
                View product
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (step === 'complete') {
    return (
      <>
        {renderStepper()}
        <Card className="bg-transparent border-none shadow-none w-full">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-400" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">Mapping ready</h3>
            <p className="text-muted-foreground text-sm">
              {product} has been created and is ready to review.
            </p>
            {createdProductId && (
              <div className="text-xs text-muted-foreground mt-2">{createdProductId}</div>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  return null;
}
