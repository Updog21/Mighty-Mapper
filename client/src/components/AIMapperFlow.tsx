import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { AnalyticRequirementsPanel, InlineRequirementHint, type EnrichedEvidence } from '@/components/AnalyticRequirementsPanel';
import { normalizePlatformList } from '@shared/platforms';

interface AIMapperFlowProps {
  initialQuery?: string;
  existingProductId?: string;
  mode?: 'create' | 'evidence';
  onComplete: (productId: string) => void;
  onCancel: () => void;
}

type Step = 'details' | 'platforms' | 'platform-review' | 'review' | 'auto-results' | 'streams' | 'analyzing' | 'evidence' | 'guided-summary' | 'guided-results' | 'complete';
type AiProgressKey = 'platformCheck' | 'geminiSuggest' | 'research';

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
  detectionStrategies?: Array<{
    id: string;
    name: string;
    techniques?: Array<{ id: string; name: string }>;
  }>;
}

interface MitreDataComponentsMeta {
  total: number;
  withPlatforms: number;
  matched: number;
  fallbackReason?: 'none' | 'no_platform_metadata' | 'no_platform_matches' | 'no_detection_content' | 'graph_unavailable';
  unscopedIncluded?: boolean;
}

interface MitreDataComponentsResponse {
  dataComponents: MitreDataComponent[];
  meta?: MitreDataComponentsMeta;
}

interface ResearchLogSource {
  name: string;
  channel?: string[] | string;
  requiredFields?: string[];
  missingFields?: string[];
  evidence?: string;
  sourceUrl?: string;
  notes?: string;
  verifiedByAi?: boolean;
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
  suggestedPlatforms?: string[];
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
  sourceUrlVerified?: boolean;
  confidence?: "high" | "medium" | "low";
  scope?: "exact" | "suite-explicit" | "platform-explicit";
}

interface GeminiMappingDebug {
  platforms?: string[];
  candidateIds?: string[];
}

interface GeminiMappingResponse {
  suggestedIds?: string[];
  decisions?: GeminiMappingDecision[];
  evaluatedCount?: number;
  candidateCount?: number;
  sources?: Array<{ title?: string; url: string }>;
  notes?: string;
  debug?: GeminiMappingDebug;
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

const PLATFORM_EXAMPLES: Record<string, string> = {
  'Windows': 'Event IDs 4624/4625, PowerShell logs, Sysmon process creation',
  'Linux': 'auth.log, auditd process execution, sudo command history',
  'macOS': 'Unified logs, EndpointSecurity process/file events',
  'Android': 'Mobile device management audit events, app install telemetry',
  'iOS': 'MDM compliance events, authentication/audit records',
  'PRE': 'Recon scanning, target profiling, social engineering prep',
  'IaaS': 'CloudTrail activity, Azure Activity Logs, GCP audit logs',
  'SaaS': 'Admin audit logs, sign-in telemetry, API activity records',
  'Office 365': 'Unified Audit Log, Exchange mailbox actions, Teams events',
  'Office Suite': 'Productivity app access patterns, document activity logs',
  'Identity Provider': 'Authentication events, token issuance, policy changes',
  'Google Workspace': 'Admin console audit, Drive activity, login events',
  'Azure AD': 'SignInLogs, AuditLogs, risky sign-in detections',
  'AWS': 'CloudTrail API calls, GuardDuty findings, Config changes',
  'Azure': 'Activity Logs, resource deployment changes, Sentinel telemetry',
  'GCP': 'Cloud Audit Logs, IAM policy changes, workload events',
  'Containers': 'Kubernetes audit logs, container runtime events',
  'ESXi': 'vSphere task logs, VM lifecycle and host audit events',
  'Network Devices': 'Firewall logs, router/switch config changes, NetFlow',
};

const PLATFORM_PRODUCT_EXAMPLES: Record<string, string> = {
  'Windows': 'Microsoft Defender for Endpoint, CrowdStrike Falcon',
  'Linux': 'GitLab Enterprise (self-managed), Wazuh, self-managed API gateways',
  'macOS': 'Jamf Protect, Kandji, SentinelOne',
  'Android': 'Intune MDM, Workspace ONE UEM',
  'iOS': 'Intune MDM, Jamf Pro',
  'PRE': 'Attack surface management, external recon platforms',
  'IaaS': 'Wiz Security (CSPM/CNAPP), Prisma Cloud, Orca Security',
  'SaaS': 'ServiceNow (SaaS), Datadog Cloud, Snowflake (SaaS)',
  'Office 365': 'Microsoft Defender for Office 365, Purview audit',
  'Office Suite': 'Microsoft 365 apps, Google Workspace apps',
  'Identity Provider': 'Okta, Ping Identity, Auth0',
  'Google Workspace': 'Google Workspace Admin, Chronicle integrations',
  'Azure AD': 'Microsoft Entra ID, Defender for Identity signals',
  'AWS': 'AWS Security Lake, GuardDuty, CloudTrail',
  'Azure': 'Microsoft Sentinel, Defender for Cloud',
  'GCP': 'Security Command Center, Cloud Audit Logs',
  'Containers': 'Kubernetes audit, Falco, Aqua Security',
  'ESXi': 'VMware vSphere/ESXi, vCenter audit',
  'Network Devices': 'Palo Alto, Cisco ASA/FTD, Fortinet, F5',
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
  channel?: string[];
  required_fields?: string[];
  missing_fields?: string[];
  evidence?: string;
  notes?: string;
  source_url?: string;
  unverified_source_url?: string;
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

const normalizeChannelArray = (value: unknown): string[] => {
  const normalizeEntry = (entry: unknown): string => {
    if (typeof entry === 'string') return entry.trim();
    if (typeof entry === 'number' && Number.isFinite(entry)) return String(entry);
    return '';
  };
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => normalizeEntry(item))
      .filter((item) => item.length > 0);
    return Array.from(new Set(cleaned));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const cleaned = trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return Array.from(new Set(cleaned));
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [String(value)];
  }
  return [];
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
          const channel = normalizeChannelArray(source?.channel);
          const requiredFieldsRaw = Array.isArray(source?.required_fields)
            ? source.required_fields
            : Array.isArray(source?.requiredFields) ? source.requiredFields : [];
          const missingFieldsRaw = Array.isArray(source?.missing_fields)
            ? source.missing_fields
            : Array.isArray(source?.missingFields) ? source.missingFields : [];
          return {
            name,
            channel: channel.length > 0 ? channel : undefined,
            required_fields: requiredFieldsRaw
              .map((field: unknown) => normalizeString(field))
              .filter((field: string) => field.length > 0),
            missing_fields: missingFieldsRaw
              .map((field: unknown) => normalizeString(field))
              .filter((field: string) => field.length > 0),
            evidence: normalizeString(source?.evidence) || undefined,
            notes: normalizeString(source?.notes) || normalizeString(source?.note) || undefined,
            source_url: normalizeString(source?.source_url) || normalizeString(source?.sourceUrl) || undefined,
            unverified_source_url: normalizeString(source?.unverified_source_url)
              || normalizeString(source?.unverifiedSourceUrl)
              || undefined,
            verified_by_ai: source?.verified_by_ai === true || source?.verifiedByAi === true
              ? true
              : source?.verified_by_ai === false || source?.verifiedByAi === false
                ? false
                : undefined,
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
    const byKey = new Map<string, EnrichmentLogSource>();
    target.log_sources.forEach((source) => {
      const key = `${source.name.toLowerCase()}|${(source.source_url || '').toLowerCase()}|${(source.unverified_source_url || '').toLowerCase()}`;
      byKey.set(key, source);
    });
    sources.forEach((source) => {
      const key = `${source.name.toLowerCase()}|${(source.source_url || '').toLowerCase()}|${(source.unverified_source_url || '').toLowerCase()}`;
      const existing = byKey.get(key);
      if (existing) {
        const existingChannels = existing.channel || [];
        const incomingChannels = source.channel || [];
        const mergedChannels = Array.from(new Set([...existingChannels, ...incomingChannels]));
        existing.channel = mergedChannels.length > 0 ? mergedChannels : existing.channel;
        const existingRequired = existing.required_fields || [];
        const incomingRequired = source.required_fields || [];
        const mergedRequired = Array.from(new Set([...existingRequired, ...incomingRequired]));
        existing.required_fields = mergedRequired.length > 0 ? mergedRequired : existing.required_fields;
        const existingMissing = existing.missing_fields || [];
        const incomingMissing = source.missing_fields || [];
        const mergedMissing = Array.from(new Set([...existingMissing, ...incomingMissing]));
        existing.missing_fields = mergedMissing.length > 0 ? mergedMissing : existing.missing_fields;
        if (!existing.evidence && source.evidence) {
          existing.evidence = source.evidence;
        }
        if (!existing.notes && source.notes) {
          existing.notes = source.notes;
        }
        if (!existing.source_url && source.source_url) {
          existing.source_url = source.source_url;
        }
        if (!existing.unverified_source_url && source.unverified_source_url) {
          existing.unverified_source_url = source.unverified_source_url;
        }
        if (existing.verified_by_ai === undefined && source.verified_by_ai !== undefined) {
          existing.verified_by_ai = source.verified_by_ai;
        }
        return;
      }
      byKey.set(key, source);
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
  const [suggestionsAppliedForInput, setSuggestionsAppliedForInput] = useState('');
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
  const [geminiDebug, setGeminiDebug] = useState<GeminiMappingDebug | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResults, setResearchResults] = useState<ResearchEnrichmentResponse | null>(null);
  const [researchConfirming, setResearchConfirming] = useState(false);
  const [platformCheckLoading, setPlatformCheckLoading] = useState(false);
  const [platformCheckResults, setPlatformCheckResults] = useState<PlatformCheckResponse | null>(null);
  const [platformCheckHasRun, setPlatformCheckHasRun] = useState(false);
  const [platformCheckEnabled, setPlatformCheckEnabled] = useState(true);
  const [autoResultsNextStep, setAutoResultsNextStep] = useState<Step>('streams');
  const [includeUnscopedDataComponents, setIncludeUnscopedDataComponents] = useState(false);
  const [aiProgress, setAiProgress] = useState<Record<AiProgressKey, number>>({
    platformCheck: 0,
    geminiSuggest: 0,
    research: 0,
  });
  const aiProgressTimersRef = useRef<Record<AiProgressKey, {
    intervalId: ReturnType<typeof setInterval> | null;
    timeoutId: ReturnType<typeof setTimeout> | null;
  }>>({
    platformCheck: { intervalId: null, timeoutId: null },
    geminiSuggest: { intervalId: null, timeoutId: null },
    research: { intervalId: null, timeoutId: null },
  });

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
    || dataComponentsFallbackReason === 'no_detection_content'
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
  const visibleDataComponents = useMemo(() => {
    return [...dataComponents].sort((a, b) => a.name.localeCompare(b.name));
  }, [dataComponents]);
  const wizardContextOptions = useMemo(
    () => (visibleDataComponents.length > 0 ? ['all'] : []),
    [visibleDataComponents.length]
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

  const baseStepItems = baseSteps;
  const stepItems = isEvidenceOnly ? evidenceSteps : baseStepItems;

  const startAiProgress = (key: AiProgressKey) => {
    const timerState = aiProgressTimersRef.current[key];
    if (timerState.intervalId) clearInterval(timerState.intervalId);
    if (timerState.timeoutId) clearTimeout(timerState.timeoutId);
    setAiProgress((prev) => ({ ...prev, [key]: 0 }));
    timerState.intervalId = setInterval(() => {
      setAiProgress((prev) => {
        const current = prev[key];
        if (current >= 95) return prev;
        const increment = Math.max(1, Math.round((100 - current) / 16));
        return { ...prev, [key]: Math.min(95, current + increment) };
      });
    }, 220);
  };

  const completeAiProgress = (key: AiProgressKey) => {
    const timerState = aiProgressTimersRef.current[key];
    if (timerState.intervalId) {
      clearInterval(timerState.intervalId);
      timerState.intervalId = null;
    }
    setAiProgress((prev) => ({ ...prev, [key]: 100 }));
    if (timerState.timeoutId) clearTimeout(timerState.timeoutId);
    timerState.timeoutId = setTimeout(() => {
      setAiProgress((prev) => ({ ...prev, [key]: 0 }));
      timerState.timeoutId = null;
    }, 1000);
  };

  useEffect(() => {
    return () => {
      (Object.keys(aiProgressTimersRef.current) as AiProgressKey[]).forEach((key) => {
        const timerState = aiProgressTimersRef.current[key];
        if (timerState.intervalId) clearInterval(timerState.intervalId);
        if (timerState.timeoutId) clearTimeout(timerState.timeoutId);
      });
    };
  }, []);

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
    setSuggestionsAppliedForInput(suggestionInput);
  }, [step, heuristicSuggestedPlatforms, selectedPlatforms.size, suggestionsApplied]);

  useEffect(() => {
    if (!suggestionsApplied) return;
    if (suggestionInput !== suggestionsAppliedForInput) {
      setSuggestionsApplied(false);
    }
  }, [suggestionInput, suggestionsApplied, suggestionsAppliedForInput]);

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
    if (target === 'platform-review') return true;
    if (target === 'auto-results') return Boolean(mappingSummary);
    if (target === 'review') return true;
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

  const renderFixedFooter = (content: ReactNode) => (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-3 sm:px-6">
        {content}
      </div>
    </div>
  );

  const renderFooterSpacer = () => <div className="h-24" aria-hidden />;

  const renderStepper = () => (
    <div className="w-full mb-4 overflow-x-auto pb-1">
      <div className="flex min-w-max items-center gap-2 pr-2">
        {stepItems.map((item, index) => {
          const isActive = item.id === step;
          const stepIndex = stepItems.findIndex(s => s.id === step);
          const isComplete = stepIndex > index;
          return (
            <div key={item.id} className="flex items-center gap-2">
              <div className="relative group">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'flex items-center gap-2 whitespace-nowrap px-2 py-1.5 text-sm',
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
                      'h-8 w-8 rounded-full border text-sm flex items-center justify-center',
                      isActive && 'border-primary text-primary',
                      isComplete && 'bg-primary text-primary-foreground border-primary',
                      !isActive && !isComplete && 'border-border text-muted-foreground'
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium">{item.label}</span>
                </Button>
                <div className="pointer-events-none absolute left-1/2 top-full z-10 w-48 -translate-x-1/2 translate-y-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground opacity-0 shadow-sm transition group-hover:opacity-100">
                  {STEP_DESCRIPTIONS[item.id]}
                </div>
              </div>
              {index < stepItems.length - 1 && (
                <div className={cn('h-px w-6', isComplete ? 'bg-primary' : 'bg-border')} />
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
        ? logSources.map((source: any) => {
          const channelArray = normalizeChannelArray(source?.channel);
          return {
            name: typeof source?.name === 'string' ? source.name : '',
            channel: channelArray.length > 0 ? channelArray : undefined,
            requiredFields: Array.isArray(source?.requiredFields)
              ? source.requiredFields
              : Array.isArray(source?.required_fields) ? source.required_fields : [],
            missingFields: Array.isArray(source?.missingFields)
              ? source.missingFields
              : Array.isArray(source?.missing_fields) ? source.missing_fields : [],
            evidence: typeof source?.evidence === 'string' ? source.evidence : undefined,
            sourceUrl: typeof source?.sourceUrl === 'string'
              ? source.sourceUrl
              : typeof source?.source_url === 'string'
                ? source.source_url
                : typeof source?.unverified_source_url === 'string'
                  ? source.unverified_source_url
                  : undefined,
            notes: normalizeString(source?.notes) || undefined,
            verifiedByAi: source?.verifiedByAi === true || source?.verified_by_ai === true
              ? true
              : source?.verifiedByAi === false || source?.verified_by_ai === false
                ? false
                : typeof source?.unverified_source_url === 'string' && source.unverified_source_url.trim().length > 0
                  ? false
                : undefined,
          };
        }).filter((source: { name: string }) => source.name.trim().length > 0)
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

  const researchSuggestedPlatforms = useMemo(() => {
    const suggestions = researchResults?.platformSuggestions;
    if (!Array.isArray(suggestions)) return [];
    const normalizedPlatforms = suggestions
      .map((entry) => (typeof entry?.platform === 'string' ? entry.platform.trim() : ''))
      .filter((platform) => platform.length > 0);
    return normalizePlatformList(normalizedPlatforms);
  }, [researchResults]);

  const platformCheckValidation = useMemo((): PlatformValidationResult[] => {
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
    }).filter(Boolean) as PlatformValidationResult[];
  }, [platformCheckResults]);

  const platformCheckAlternatives = useMemo((): PlatformAlternativeResult[] => {
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
    }).filter(Boolean) as PlatformAlternativeResult[];
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
    const supported: string[] = [];
    const unsupported: string[] = [];
    const noEvidence: string[] = [];
    selectedPlatformsList.forEach((platform) => {
      const match = platformCheckValidation.find(
        (entry) => entry.platform.toLowerCase() === platform.toLowerCase()
      );
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
    setStep('platform-review');
  };

  const handleBackStreams = () => {
    if (guidedContextIndex > 0) {
      setGuidedContextIndex(prev => Math.max(0, prev - 1));
      return;
    }
    setStep('auto-results');
  };

  const runPlatformCheck = async () => {
    if (platformCheckLoading) return;
    if (!platformCheckEnabled) return;
    if (!vendor.trim() && !product.trim() && aliases.length === 0) {
      toast({
        title: 'Missing product info',
        description: 'Add a vendor, product, or alias before running the platform check.',
        variant: 'destructive',
      });
      return;
    }

    let didAttempt = false;
    try {
      setPlatformCheckLoading(true);
      didAttempt = true;
      setPlatformCheckResults(null);
      startAiProgress('platformCheck');
      const response = await fetch('/api/ai/research/platforms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor,
          product,
          description,
          aliases,
          platforms: selectedPlatformsList,
        }),
      });
      let payload: any = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        throw new Error(payload?.error || `Failed to run platform check (${response.status})`);
      }
      const rawSuggestedPlatforms = Array.isArray((payload as { suggestedPlatforms?: unknown }).suggestedPlatforms)
        ? (payload as { suggestedPlatforms?: string[] }).suggestedPlatforms || []
        : Array.isArray((payload as { suggested_platforms?: unknown }).suggested_platforms)
          ? (payload as { suggested_platforms?: string[] }).suggested_platforms || []
          : [];
      const suggestedPlatforms = normalizePlatformList(
        rawSuggestedPlatforms.filter((platform): platform is string => typeof platform === 'string' && platform.trim().length > 0)
      );
      setPlatformCheckResults({
        ...payload,
        suggestedPlatforms,
      });
      
      // Auto-select suggested platforms
      if (suggestedPlatforms.length > 0) {
        const newSelection = new Set(selectedPlatforms);
        suggestedPlatforms.forEach((platform: string) => newSelection.add(platform));
        setSelectedPlatforms(newSelection);
      }
      
      const validationCount = Array.isArray(payload.validation)
        ? payload.validation.length
        : 0;
      const alternativeCount = Array.isArray(payload.alternativePlatformsFound)
        ? payload.alternativePlatformsFound.length
        : 0;
      
      toast({
        title: 'Platform check complete',
        description: suggestedPlatforms.length > 0
          ? `Suggested and selected ${suggestedPlatforms.length} platform${suggestedPlatforms.length === 1 ? '' : 's'} based on product documentation.`
          : validationCount > 0
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
      completeAiProgress('platformCheck');
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
      startAiProgress('geminiSuggest');
      setGeminiSuggestionCount(null);
      setGeminiEvaluationCount(null);
      setGeminiDecisionMap({});
      setGeminiSources([]);
      setGeminiNotes(null);
      setGeminiDebug(null);
      const response = await fetch('/api/ai/gemini/data-components', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor,
          product,
          description,
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
          sourceUrlVerified: (decision as { sourceUrlVerified?: unknown; source_url_verified?: unknown }).sourceUrlVerified === true
            || (decision as { sourceUrlVerified?: unknown; source_url_verified?: unknown }).source_url_verified === true
            ? true
            : (decision as { sourceUrlVerified?: unknown; source_url_verified?: unknown }).sourceUrlVerified === false
              || (decision as { sourceUrlVerified?: unknown; source_url_verified?: unknown }).source_url_verified === false
              ? false
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
      setGeminiDebug(mappingPayload.debug || null);
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
      completeAiProgress('geminiSuggest');
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
      startAiProgress('research');
      setResearchResults(null);
      const response = await fetch('/api/ai/research/log-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor,
          product,
          description,
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
      completeAiProgress('research');
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
          ...(source.verifiedByAi === false && source.sourceUrl
            ? { notes: `${source.notes ? `${source.notes} ` : ''}Unverified source URL stored separately.`.trim() }
            : { notes: source.notes }),
          name: source.name,
          channel: (() => {
            const channels = normalizeChannelArray(source.channel);
            return channels.length > 0 ? channels : undefined;
          })(),
          required_fields: source.requiredFields || [],
          missing_fields: source.missingFields || [],
          evidence: source.evidence,
          source_url: source.verifiedByAi === false ? undefined : source.sourceUrl,
          unverified_source_url: source.verifiedByAi === false ? source.sourceUrl : undefined,
          verified_by_ai: source.verifiedByAi === true ? true : source.verifiedByAi === false ? false : undefined,
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

  const handleNextStreams = () => {
    if (wizardContextOptions.length === 0) {
      const description = dataComponentsFallbackReason === 'no_platform_metadata'
        ? 'MITRE data components in this dataset have no platform metadata. Use "Show unscoped data components" to continue.'
        : dataComponentsFallbackReason === 'no_detection_content'
          ? 'No data components matched the selected platforms from MITRE detection content. Adjust platform selection or show unscoped data components.'
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

            {renderFooterSpacer()}
            {renderFixedFooter(
              <div className="flex gap-3">
                <Button variant="secondary" onClick={onCancel} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={handleNextDetails} className="flex-1">
                  Continue
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
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
                  const examples = PLATFORM_EXAMPLES[platform];
                  const productExamples = PLATFORM_PRODUCT_EXAMPLES[platform];
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
                      {examples && (
                        <div className={cn(
                          'text-[11px] mt-2 leading-snug',
                          isSelected ? 'text-primary/70' : 'text-muted-foreground/90'
                        )}>
                          Examples: {examples}
                        </div>
                      )}
                      {productExamples && (
                        <div className={cn(
                          'text-[11px] mt-1 leading-snug',
                          isSelected ? 'text-primary/70' : 'text-muted-foreground/90'
                        )}>
                          Product examples: {productExamples}
                        </div>
                      )}
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

            <div className="space-y-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPlatformCheckEnabled(true);
                  void runPlatformCheck();
                }}
                disabled={platformCheckLoading}
              >
                {platformCheckLoading ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin mr-2" />
                    {selectedPlatforms.size === 0 ? 'Finding platforms...' : 'Validating platforms...'}
                  </>
                ) : platformCheckHasRun ? (
                  'Re-run platform check'
                ) : (
                  selectedPlatforms.size === 0 ? 'Auto-select platforms with Gemini' : 'Validate platforms with Gemini'
                )}
              </Button>
              {(platformCheckLoading || aiProgress.platformCheck > 0) && (
                <div className="max-w-sm space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{platformCheckLoading ? 'Gemini platform check in progress' : 'Gemini platform check complete'}</span>
                    <span>{Math.round(aiProgress.platformCheck)}%</span>
                  </div>
                  <Progress value={aiProgress.platformCheck} className="h-2" />
                </div>
              )}
              
              {platformCheckHasRun && (
                <div className="rounded-lg border border-border/60 bg-background/60 p-4 space-y-3">
                  <div className="text-xs font-semibold text-foreground">Platform check results</div>
                  {platformCheckResults?.note && (
                    <div className="text-xs text-muted-foreground">{platformCheckResults.note}</div>
                  )}
                  {platformCheckResults?.suggestedPlatforms && platformCheckResults.suggestedPlatforms.length > 0 && (
                    <div className="text-xs text-blue-600">
                      ✓ Suggested and auto-selected: {platformCheckResults.suggestedPlatforms.join(', ')}
                    </div>
                  )}
                  {platformCheckSummary?.supported && platformCheckSummary.supported.length > 0 && (
                    <div className="text-xs text-emerald-600">
                      ✓ Supported: {platformCheckSummary.supported.join(', ')}
                    </div>
                  )}
                  {platformCheckSummary?.unsupported && platformCheckSummary.unsupported.length > 0 && (
                    <div className="text-xs text-amber-600">
                      ⚠ Not supported by evidence: {platformCheckSummary.unsupported.join(', ')}
                    </div>
                  )}
              {platformCheckSummary?.noEvidence && platformCheckSummary.noEvidence.length > 0 && (
                <div className="text-xs text-amber-600">
                  ? No evidence found for: {platformCheckSummary.noEvidence.join(', ')}
                </div>
              )}
              {platformCheckResults?.suggestedPlatforms && platformCheckResults.suggestedPlatforms.length > 0 && (
                <div className="text-xs text-blue-600">
                  Suggested platforms: {platformCheckResults.suggestedPlatforms.join(', ')}
                </div>
              )}
              {platformCheckAlternatives.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Alternative platform variants found: {platformCheckAlternatives.map((entry) => entry.platform).join(', ')}
                </div>
              )}
                  
                  {(platformCheckValidation.length > 0 || platformCheckAlternatives.length > 0) && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer font-semibold text-foreground">View evidence details</summary>
                      <div className="mt-2 space-y-2">
                        {platformCheckValidation.map((entry) => (
                          <div key={`${entry.platform}-${entry.sourceUrl || entry.reasoning}`} className="space-y-1 pl-2 border-l-2 border-border">
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
                            <div className="font-semibold text-foreground">Alternative platforms</div>
                            {platformCheckAlternatives.map((entry) => (
                              <div key={`${entry.platform}-${entry.sourceUrl || entry.reason}`} className="space-y-1 pl-2 border-l-2 border-border">
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
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{selectedPlatforms.size} selected</span>
            </div>

            {renderFooterSpacer()}
            {renderFixedFooter(
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep('details')} className="flex-1">
                  Back
                </Button>
                <Button onClick={handleNextPlatforms} className="flex-1">
                  Continue
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  if (step === 'streams') {
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
                A Data Component is ATT&CK's definition of a telemetry element that is used for detections to identify
                specific techniques and sub-techniques of an attack (Usually its a log entry for e.g., Process Creation,
                Network Connection Creation, User Account Authentication).
              </p>
              <p>
                Select the components the data source can generate (usually a log) that can be collected.
              </p>
              <p>
                Use the description and examples in each entry to decide; if you can't collect it, leave it unchecked.
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
              {(geminiLoading || aiProgress.geminiSuggest > 0) && (
                <div className="max-w-sm space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{geminiLoading ? 'Gemini mapping in progress' : 'Gemini mapping complete'}</span>
                    <span>{Math.round(aiProgress.geminiSuggest)}%</span>
                  </div>
                  <Progress value={aiProgress.geminiSuggest} className="h-2" />
                </div>
              )}
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
                {geminiDebug && (
                  <details className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                    <summary className="cursor-pointer text-foreground">Debug: candidate set</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                      {JSON.stringify(geminiDebug, null, 2)}
                    </pre>
                  </details>
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
            
            {(dataComponentsFallbackReason === 'no_platform_matches' || dataComponentsFallbackReason === 'no_detection_content') && !dataComponentsLoading && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                No data components matched the selected platforms. Adjust your platform selection to continue.
              </div>
            )}
            
            {dataComponentsMeta?.unscopedIncluded && (
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                Showing unscoped data components because platform metadata is unavailable.
              </div>
            )}
            
            <div className="space-y-6">
              {visibleDataComponents.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  {dataComponentsFallbackReason === 'no_platform_metadata'
                    ? 'No platform metadata found for data components.'
                    : dataComponentsFallbackReason === 'no_detection_content'
                      ? 'No data components matched the selected platforms from MITRE detection content.'
                    : dataComponentsFallbackReason === 'graph_unavailable'
                      ? 'MITRE graph is unavailable, so data components cannot be filtered.'
                      : dataComponentsFallbackReason === 'no_platform_matches'
                        ? 'No data components match the selected platforms.'
                        : 'No data components available for the selected platforms.'}
                </div>
              ) : (
                <div className="border border-border rounded-lg p-4 bg-background/40">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {visibleDataComponents.map(component => {
                      const streamIndex = 0;
                      const stream = streams[streamIndex];
                      const isChecked = Boolean(stream?.questionAnswers?.[component.id]);
                      const description = component.shortDescription || component.description || '';
                      const aiDecision = geminiDecisionMap[component.id];
                      const aiSelected = Boolean(aiDecision?.selected);
                      const platformBadges = normalizePlatformList(
                        Array.isArray(component.platforms)
                          ? component.platforms.filter((platform) => typeof platform === 'string' && platform.trim().length > 0)
                          : []
                      );

                      return (
                        <label
                          key={component.id}
                          className={cn(
                            'flex flex-col gap-2 rounded-lg p-3 text-xs sm:text-sm cursor-pointer transition-colors shadow-sm ring-1 ring-black/5 dark:ring-white/10',
                            isChecked
                              ? 'bg-primary/10 ring-primary/40 shadow-md'
                              : component.relevanceScore
                                ? 'bg-primary/5 ring-primary/20'
                                : 'bg-muted/20 hover:bg-muted/30 hover:shadow-md'
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold text-foreground">
                                  Do the product/service generate a log for {component.name}?
                                </div>
                                <Badge variant="secondary" className="text-[10px] font-mono">
                                  {component.id}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {platformBadges.length > 0 ? platformBadges.map((platform) => (
                                  <Badge key={`${component.id}-platform-${platform}`} variant="outline" className="text-[10px]">
                                    {platform}
                                  </Badge>
                                )) : (
                                  <Badge variant="outline" className="text-[10px]">Unspecified Platform</Badge>
                                )}
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
                                const nextAnswers = { ...(stream?.questionAnswers || {}) };
                                if (checked === true) {
                                  nextAnswers[component.id] = true;
                                } else {
                                  delete nextAnswers[component.id];
                                }
                                updateStreamGuided(streamIndex, { questionAnswers: nextAnswers });
                                applyGuidedMapping(streamIndex, nextAnswers);
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
                                  <div className="space-y-1">
                                    <a
                                      href={aiDecision.sourceUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline underline-offset-2 text-primary"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      {aiDecision.sourceUrl}
                                    </a>
                                    {aiDecision?.sourceUrlVerified === false && (
                                      <div className="text-amber-700">
                                        Citation not grounding-verified. Review manually.
                                      </div>
                                    )}
                                  </div>
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
                  </div>
                </div>
              )}
            </div>
            
            {renderFooterSpacer()}
            {renderFixedFooter(
              <div className="space-y-3">
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
                  <Button variant="secondary" onClick={() => setStep('auto-results')} className="flex-1">
                    Back
                  </Button>
                  <Button
                    onClick={() => {
                      if (!hasConfiguredStreams) {
                        toast({
                          title: 'Select at least one data component',
                          description: 'Choose at least one data component so we can map coverage.',
                          variant: 'destructive',
                        });
                        return;
                      }
                      setStep('guided-summary');
                    }}
                    className="flex-1"
                    disabled={isSubmitting || wizardContextOptions.length === 0}
                  >
                    Review requirements
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}
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
            {(researchLoading || aiProgress.research > 0) && (
              <div className="max-w-sm space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{researchLoading ? 'Gemini research in progress' : 'Gemini research complete'}</span>
                  <span>{Math.round(aiProgress.research)}%</span>
                </div>
                <Progress value={aiProgress.research} className="h-2" />
              </div>
            )}
          </div>

          {researchResults && (
            <div className="flex flex-wrap items-center gap-3 pt-3">
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

          {renderFooterSpacer()}
          {renderFixedFooter(
            <div className="flex gap-3">
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
          )}
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
              {platformCheckResults?.suggestedPlatforms && platformCheckResults.suggestedPlatforms.length > 0 && (
                <div className="text-xs text-blue-600">
                  Suggested platforms: {platformCheckResults.suggestedPlatforms.join(', ')}
                </div>
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

            {renderFooterSpacer()}
            {renderFixedFooter(
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setStep('platforms')}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button onClick={() => setStep('review')} className="flex-1">
                  Continue
                </Button>
              </div>
            )}
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
                {selectedPlatformsList.length === 0 ? (
                  <span className="text-sm text-muted-foreground">None selected</span>
                ) : (
                  selectedPlatformsList.map(platform => (
                    <Badge key={platform} variant="secondary">
                      {platform}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            {platformCheckResults?.suggestedPlatforms && platformCheckResults.suggestedPlatforms.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Platform check suggestions</div>
                <div className="flex flex-wrap gap-2">
                  {platformCheckResults.suggestedPlatforms.map(platform => (
                    <Badge key={`suggested-${platform}`} variant="secondary" className="text-blue-600">
                      {platform}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
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

            {renderFooterSpacer()}
            {renderFixedFooter(
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep('platform-review')} className="flex-1">
                  Back
                </Button>
                <Button onClick={handleAutoMap} className="flex-1" disabled={isSubmitting}>
                  Auto Map
                </Button>
              </div>
            )}
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

            {renderFooterSpacer()}
            {renderFixedFooter(
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep('review')} className="flex-1">
                  Back
                </Button>
                <Button onClick={() => setStep(autoResultsNextStep)} className="flex-1">
                  {autoResultsNextStep === 'streams' ? 'Continue to Telemetry' : 'Finish'}
                </Button>
              </div>
            )}
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
              <>
                {renderFooterSpacer()}
                {renderFixedFooter(
                  <div className="flex gap-3">
                    <Button variant="secondary" onClick={() => setStep('complete')} className="flex-1">
                      Skip for now
                    </Button>
                    <Button onClick={handleSaveEvidence} className="flex-1" disabled={isSubmitting}>
                      {isSubmitting ? 'Saving...' : 'Save & Continue'}
                    </Button>
                  </div>
                )}
              </>
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

            {renderFooterSpacer()}
            {renderFixedFooter(
              <div className="flex gap-3">
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
            )}
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
