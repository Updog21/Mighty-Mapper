import { useState, useMemo, useEffect, useRef } from 'react';
import type { JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { dataComponents, techniques, DetectionStrategy, AnalyticItem, DataComponentRef, detectionStrategies, Technique } from '@/lib/mitreData';
import { getDetectionStrategiesForProduct } from '@/lib/mitreDataHelpers';
import type { Asset } from '@/lib/products';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { 
  ChevronRight,
  ExternalLink,
  Database,
  Layers,
  Terminal,
  Monitor,
  Cloud,
  ArrowLeft,
  Shield,
  X,
  Info,
  Zap,
  Loader2,
  AlertCircle,
  Globe,
  Network,
  Box,
  Server,
  Filter,
  FileText,
  FileDown,
  Trash2,
} from 'lucide-react';
import { cn, subjectIdPillClass } from '@/lib/utils';
import { useAutoMappingWithAutoRun, RESOURCE_LABELS, ResourceType, StixDataComponent, StixAnalytic, StixDetectionStrategy, AnalyticMapping } from '@/hooks/useAutoMapper';
import { useProductSsm } from '@/hooks/useProductSsm';
import { getAggregateCoverage } from '@/lib/ssm-utils';
import { buildMappingIdsByTechnique, buildMetadataByTechnique, getHybridStrategies } from '@/lib/ssm-hybrid';
import { toMarkdownTable } from '@/lib/stix-export';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDeleteProduct } from '@/hooks/useProducts';
import { useToast } from '@/hooks/use-toast';
import { normalizePlatformList, platformMatchesAny, type PlatformValue } from '@shared/platforms';
import type { SsmMapping } from '@shared/schemas/ssm';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { StixExportControls } from '@/components/StixExportControls';

interface ProductViewProps {
  product: Asset & { productId?: string; source?: string };
  onBack: () => void;
}

const PLATFORM_ICON_MAP: Record<string, React.ReactNode> = {
  'Windows': <Monitor className="w-4 h-4" />,
  'macOS': <Monitor className="w-4 h-4" />,
  'Linux': <Terminal className="w-4 h-4" />,
  'Android': <Monitor className="w-4 h-4" />,
  'iOS': <Monitor className="w-4 h-4" />,
  'None': <Info className="w-4 h-4" />,
  'PRE': <Shield className="w-4 h-4" />,
  'Office Suite': <Database className="w-4 h-4" />,
  'Office 365': <Database className="w-4 h-4" />,
  'Identity Provider': <Shield className="w-4 h-4" />,
  'Google Workspace': <Database className="w-4 h-4" />,
  'Azure AD': <Shield className="w-4 h-4" />,
  'AWS': <Cloud className="w-4 h-4" />,
  'Azure': <Cloud className="w-4 h-4" />,
  'GCP': <Cloud className="w-4 h-4" />,
  'SaaS': <Globe className="w-4 h-4" />,
  'IaaS': <Cloud className="w-4 h-4" />,
  'Network Devices': <Network className="w-4 h-4" />,
  'Containers': <Box className="w-4 h-4" />,
  'ESXi': <Server className="w-4 h-4" />,
};

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  'Windows': 'Windows',
  'Linux': 'Linux',
  'macOS': 'macOS',
  'Android': 'Android',
  'iOS': 'iOS',
  'None': 'None',
  'PRE': 'PRE',
  'Identity Provider': 'Identity Provider',
  'IaaS': 'IaaS',
  'SaaS': 'SaaS',
  'Office 365': 'Office 365',
  'Office Suite': 'Office Suite',
  'Containers': 'Containers',
  'Network Devices': 'Network Devices',
  'ESXi': 'ESXi',
  'Azure AD': 'Identity Provider',
  'Google Workspace': 'Google Workspace',
  'AWS': 'AWS',
  'Azure': 'Azure',
  'GCP': 'GCP',
};

function getPlatformIcon(platform: string) {
  const canonical = normalizePlatformList([platform])[0] || platform;
  return PLATFORM_ICON_MAP[canonical] || <Monitor className="w-4 h-4" />;
}

function getPlatformDisplayName(platform: string) {
  const canonical = normalizePlatformList([platform])[0] || platform;
  return PLATFORM_DISPLAY_NAMES[canonical] || canonical;
}


function normalizeTechniqueId(value: string): string {
  const match = value.toUpperCase().match(/T\d{4}(?:\.\d{3})?/);
  return match ? match[0] : value.toUpperCase();
}

function normalizeDataComponentId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getPrimaryTactic(technique?: { tactic?: string; tactics?: string[] }): string | undefined {
  if (!technique) return undefined;
  if (Array.isArray(technique.tactics) && technique.tactics.length > 0) {
    return technique.tactics[0];
  }
  return technique.tactic;
}

type ScenarioQuestionKey =
  | 'processVisibility'
  | 'dataAtRest'
  | 'userInteraction'
  | 'internetExposed'
  | 'managesCredentials'
  | 'highImpact'
  | 'sensitiveData';

type ScenarioDropReason = 'processVisibility' | 'dataAtRest' | 'userInteraction';

interface ScenarioAnswers {
  processVisibility: boolean;
  dataAtRest: boolean;
  userInteraction: boolean;
  internetExposed: boolean;
  managesCredentials: boolean;
  highImpact: boolean;
  sensitiveData: boolean;
}

const DEFAULT_SCENARIO_ANSWERS: ScenarioAnswers = {
  processVisibility: true,
  dataAtRest: true,
  userInteraction: true,
  internetExposed: false,
  managesCredentials: false,
  highImpact: false,
  sensitiveData: false,
};

const SCENARIO_QUESTION_LABELS: Record<ScenarioQuestionKey, string> = {
  processVisibility: 'You can see running processes, files, and OS activity on this product',
  dataAtRest: 'This product stores or has access to stored data',
  userInteraction: 'End users open this product in a browser, email client, or desktop app',
  internetExposed: 'This product is directly reachable from the internet',
  managesCredentials: 'This product stores or manages passwords, keys, tokens, or sessions',
  highImpact: 'If this product goes down, it seriously disrupts the business',
  sensitiveData: 'This product stores sensitive data like PII, financial records, or health data',
};

const SCENARIO_QUESTION_COUNT = Object.keys(SCENARIO_QUESTION_LABELS).length;

const SCENARIO_QUESTION_HELP: Record<ScenarioQuestionKey, string> = {
  processVisibility: 'YES for servers, workstations, or laptops where you have an EDR agent, Sysmon, or OS-level logging installed. NO for cloud services, SaaS apps, or network appliances where you can only see external behavior.',
  dataAtRest: 'YES for databases, file servers, endpoints, or any system that stores files, logs, or records. NO for firewalls, proxies, load balancers, or gateways that only inspect traffic passing through.',
  userInteraction: 'YES if real people (not just admins) use this product day-to-day — opening emails, browsing a portal, editing documents. NO for headless infrastructure, APIs, or backend services with no direct user interaction.',
  internetExposed: 'YES if this product has a public IP, listens on a public port, or is accessible without a VPN. Includes web apps, email gateways, VPN concentrators, and public APIs.',
  managesCredentials: 'YES for identity providers (Okta, Entra ID), SSO gateways, Active Directory, password vaults, or any system that issues or validates login credentials.',
  highImpact: 'YES if taking this product offline would halt critical business operations, affect customers, or trigger incident response. Think domain controllers, payment processing, core databases.',
  sensitiveData: 'YES if this product stores or processes personal information, financial records, health data, trade secrets, or anything subject to regulatory requirements (GDPR, HIPAA, PCI-DSS).',
};

const SCENARIO_QUESTION_WHY: Record<ScenarioQuestionKey, string> = {
  processVisibility: 'Without OS-level access, techniques like process injection, registry persistence, and privilege escalation cannot be observed — they are removed from the ranking.',
  dataAtRest: 'If the product only sees traffic in transit, data collection and staged exfiltration happening on endpoints behind it are invisible — those techniques are removed.',
  userInteraction: 'Without real users, phishing (T1566), drive-by compromise (T1189), user execution (T1204), and session theft (T1539) are impossible — those techniques are removed.',
  internetExposed: 'Internet exposure makes Initial Access techniques far more likely — exploit of public-facing applications and external phishing require internet reachability. C2 traffic and lateral movement are also more visible on internet-facing products.',
  managesCredentials: 'Products that manage credentials are prime targets for brute force, credential stuffing, token theft, and session hijacking — Credential Access techniques are ranked higher.',
  highImpact: 'Business-critical assets warrant deeper coverage of Impact techniques — data destruction, ransomware encryption, and service disruption are ranked higher.',
  sensitiveData: 'When sensitive data is present, adversaries are more likely to pursue Collection and Exfiltration techniques to steal it — those techniques are ranked higher.',
};

const SCENARIO_REFERENCE_LINKS: Array<{ label: string; url: string }> = [
  { label: 'MITRE ATT&CK STIX', url: 'https://github.com/mitre-attack/attack-stix-data' },
  { label: 'MITRE ATT&CK Data Sources', url: 'https://github.com/mitre-attack/attack-datasources' },
  { label: 'MITRE ATT&CK', url: 'https://attack.mitre.org/' },
  { label: 'ASD Event Logging Best Practices', url: 'https://www.cyber.gov.au/sites/default/files/2024-08/best-practices-for-event-logging-and-threat-detection.pdf' },
  { label: 'ASD Essential Eight Blueprint', url: 'https://blueprint.asd.gov.au/security-and-governance/essential-eight/' },
  { label: 'NSA/CISA ATT&CK Defenses', url: 'https://www.nsa.gov/Press-Room/Press-Releases-Statements/Press-Release-View/Article/2716870/nsa-cisa-release-cybersecurity-technical-report-mitre-attck-defenses' },
  { label: 'CISA RVA ATT&CK Mapping', url: 'https://industrialcyber.co/cisa/cisa-report-detects-risk-and-vulnerability-assessments-plotted-to-mitre-attck-framework/' },
  { label: 'SpecterOps Prioritization', url: 'https://posts.specterops.io/prioritization-of-the-detection-engineering-backlog-dcb18a896981' },
  { label: 'Kaspersky Prioritization', url: 'https://securelist.com/detection-engineering-backlog-prioritization/113099/' },
  { label: 'DeTT&CT Visibility Scoring', url: 'https://github.com/rabobank-cdc/DeTTECT/wiki/Visibility-scoring' },
  { label: 'Red Canary Techniques', url: 'https://redcanary.com/threat-detection-report/techniques/' },
  { label: 'Lockheed Cyber Kill Chain (PDF)', url: 'https://www.lockheedmartin.com/content/dam/lockheed-martin/rms/documents/cyber/Gaining_the_Advantage_Cyber_Kill_Chain.pdf' },
];

const NO_PROCESS_VISIBILITY_DROP_TACTICS = new Set([
  'execution',
  'persistence',
  'privilege escalation',
  'defense evasion',
]);

const NO_DATA_AT_REST_DROP_TACTICS = new Set([
  'collection',
  'exfiltration',
]);

const USER_INTERACTION_DENYLIST = [
  'T1566',  // Phishing — requires a user to receive and act on a message
  'T1189',  // Drive-by Compromise — requires a user browsing to a malicious site
  'T1204',  // User Execution — requires a user to run a malicious file/link
  'T1539',  // Steal Web Session Cookie — requires an active user browser session
  'T1622',  // Debugger Evasion — requires a user-facing process context
];

const TACTIC_WEIGHTS: Record<string, number> = {
  'initial access': 3.0,
  'execution': 3.0,
  'credential access': 3.0,
  'persistence': 2.5,
  'privilege escalation': 2.5,
  'defense evasion': 2.0,
  'lateral movement': 2.0,
  'command and control': 2.0,
  'discovery': 1.5,
  'collection': 1.5,
  'exfiltration': 1.0,
  'impact': 1.0,
  'resource development': 0.5,
  'reconnaissance': 0.5,
};

function getTacticWeight(tactic: string): number {
  return TACTIC_WEIGHTS[normalizeTacticKey(tactic)] ?? 1.0;
}

function normalizeTacticKey(value?: string | null): string {
  if (!value) return '';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function techniqueMatchesPrefix(techniqueId: string, prefix: string): boolean {
  const normalized = normalizeTechniqueId(techniqueId);
  return normalized === prefix || normalized.startsWith(`${prefix}.`);
}

function inferScenarioAnswersFromPlatforms(platforms: string[]): ScenarioAnswers {
  const normalizedPlatforms = normalizePlatformList(platforms);
  if (normalizedPlatforms.length === 0) {
    return DEFAULT_SCENARIO_ANSWERS;
  }

  const platformSet = new Set(normalizedPlatforms);
  const endpointPlatforms: PlatformValue[] = ['Windows', 'Linux', 'macOS', 'Android', 'iOS'];
  const userSurfacePlatforms: PlatformValue[] = ['Office 365', 'Office Suite', 'Google Workspace'];
  const publicFacingPlatforms: PlatformValue[] = ['SaaS', 'IaaS', 'AWS', 'Azure', 'GCP', 'Network Devices'];
  const credentialPlatforms: PlatformValue[] = ['Identity Provider', 'Azure AD', 'Office 365', 'Google Workspace'];
  const highImpactPlatforms: PlatformValue[] = ['Identity Provider', 'Azure AD', 'Network Devices', 'ESXi', 'IaaS', 'AWS', 'Azure', 'GCP'];
  const storedDataPlatforms: PlatformValue[] = ['SaaS', 'IaaS', 'AWS', 'Azure', 'GCP', 'Office 365', 'Office Suite', 'Google Workspace', 'Identity Provider', 'Azure AD', 'Containers', 'ESXi'];

  const hasEndpointVisibility = endpointPlatforms.some((platform) => platformSet.has(platform));
  const hasUserSurface = hasEndpointVisibility || userSurfacePlatforms.some((platform) => platformSet.has(platform));
  const hasPublicSurface = publicFacingPlatforms.some((platform) => platformSet.has(platform));
  const managesCredentials = credentialPlatforms.some((platform) => platformSet.has(platform));
  const hasStoredData = storedDataPlatforms.some((platform) => platformSet.has(platform));
  const isPassThroughOnly = platformSet.size > 0 && Array.from(platformSet).every((platform) => platform === 'Network Devices');

  return {
    processVisibility: hasEndpointVisibility || platformSet.has('ESXi'),
    dataAtRest: hasStoredData || !isPassThroughOnly,
    userInteraction: hasUserSurface,
    internetExposed: hasPublicSurface,
    managesCredentials,
    highImpact: managesCredentials || highImpactPlatforms.some((platform) => platformSet.has(platform)),
    sensitiveData: userSurfacePlatforms.some((platform) => platformSet.has(platform)),
  };
}

function getSsmMappingRankingScore(mapping: SsmMapping): number {
  const scoreCategory = (mapping.scoreCategory || '').toLowerCase();
  const baseScoreMap: Record<string, number> = {
    significant: 1.0,
    partial: 0.6,
    minimal: 0.3,
  };
  const baseScore = baseScoreMap[scoreCategory];
  if (!baseScore) return 0;

  const metadata = (mapping.metadata || {}) as Record<string, unknown>;
  const validationStatus = typeof mapping.validationStatus === 'string'
    ? mapping.validationStatus.toLowerCase()
    : typeof metadata.validation_status === 'string'
      ? String(metadata.validation_status).toLowerCase()
      : '';
  if (validationStatus === 'invalid') {
    return 0;
  }

  const normalizedCoverageKind = typeof mapping.coverageKind === 'string'
    ? mapping.coverageKind.toLowerCase()
    : typeof metadata.coverage_kind === 'string'
      ? String(metadata.coverage_kind).toLowerCase()
      : '';
  const normalizedMappingType = typeof mapping.mappingType === 'string'
    ? mapping.mappingType.toLowerCase()
    : '';
  const coverageKind = normalizedCoverageKind || (normalizedMappingType === 'observe' ? 'visibility' : 'detect');

  const coverageKindWeight: Record<string, number> = {
    detect: 1,
    visibility: 0.7,
    candidate: 0.35,
  };
  const validationWeight: Record<string, number> = {
    valid: 1,
    uncertain: 0.6,
    pending: 0.85,
  };

  const techniqueStatus = typeof metadata.technique_status === 'string'
    ? String(metadata.technique_status).toLowerCase()
    : '';
  const techniqueStatusWeight = techniqueStatus === 'candidate'
    ? 0.6
    : 1;

  const kindWeight = coverageKindWeight[coverageKind] ?? 0.8;
  const qualityWeight = validationWeight[validationStatus] ?? 0.85;

  return baseScore * kindWeight * qualityWeight * techniqueStatusWeight;
}

function getScenarioDropReasons(
  techniqueId: string,
  tactics: string[],
  answers: ScenarioAnswers
): ScenarioDropReason[] {
  const reasons: ScenarioDropReason[] = [];
  const normalizedTactics = tactics.map(normalizeTacticKey);
  // Drop when capability is OFF and ALL tactics require it
  if (!answers.processVisibility && normalizedTactics.length > 0 && normalizedTactics.every(t => NO_PROCESS_VISIBILITY_DROP_TACTICS.has(t))) {
    reasons.push('processVisibility');
  }
  if (!answers.dataAtRest && normalizedTactics.length > 0 && normalizedTactics.every(t => NO_DATA_AT_REST_DROP_TACTICS.has(t))) {
    reasons.push('dataAtRest');
  }
  if (!answers.userInteraction && USER_INTERACTION_DENYLIST.some((prefix) => techniqueMatchesPrefix(techniqueId, prefix))) {
    reasons.push('userInteraction');
  }
  return reasons;
}

function getScenarioBoostMultiplier(tactics: string[], answers: ScenarioAnswers): number {
  let multiplier = 1;
  const normalizedTactics = new Set(tactics.map(normalizeTacticKey));
  if (answers.internetExposed) {
    if (normalizedTactics.has('initial access')) multiplier *= 2.0;
    // Internet-exposed products see C2 and lateral movement traffic
    if (normalizedTactics.has('command and control')) multiplier *= 1.5;
    if (normalizedTactics.has('lateral movement')) multiplier *= 1.5;
  }
  if (answers.managesCredentials && normalizedTactics.has('credential access')) {
    multiplier *= 2.0;
  }
  if (answers.highImpact && normalizedTactics.has('impact')) {
    multiplier *= 1.5;
  }
  if (answers.sensitiveData && (normalizedTactics.has('collection') || normalizedTactics.has('exfiltration'))) {
    multiplier *= 1.5;
  }
  return multiplier;
}

interface LogSourceRow {
  dataComponentId: string;
  dataComponentName: string;
  logSourceName: string;
  channel?: string[];
}

interface MutableElementValueEntry {
  analyticId: string;
  field: string;
  value: string;
  sourceUrl?: string;
  note?: string;
}

interface MutableElementRow {
  field: string;
  description: string;
  value?: string;
  sourceUrl?: string;
  note?: string;
}

interface CoveragePathRow {
  techniqueId: string;
  techniqueName: string;
  originProductId: string;
  path: string[];
}

interface CoverageRow {
  techniqueId: string;
  techniqueName: string;
  coverageCount: number;
  tactics?: string[];
  techniqueDescription?: string;
}

function getPlatformPrefixes(platform: string): string[] {
  const canonical = normalizePlatformList([platform])[0] || platform;
  switch (canonical) {
    case 'Windows': return ['WinEventLog:', 'windows:'];
    case 'Linux': return ['auditd:', 'linux:', 'ebpf:'];
    case 'macOS': return ['macos:'];
    case 'ESXi': return ['esxi:'];
    case 'Identity Provider': return ['azuread:', 'okta:', 'idp:'];
    case 'Azure AD': return ['azuread:', 'okta:', 'idp:'];
    case 'IaaS': return ['aws:', 'azure:', 'gcp:', 'cloudtrail:', 'cloud:'];
    case 'AWS': return ['aws:', 'cloudtrail:'];
    case 'Azure': return ['azure:', 'azuread:', 'activity:'];
    case 'GCP': return ['gcp:', 'gcloud:'];
    case 'SaaS': return ['saas:', 'office365:', 'm365:', 'gsuite:', 'workspace:'];
    case 'Office 365': return ['office365:', 'm365:'];
    case 'Office Suite': return ['office365:', 'm365:', 'workspace:', 'gsuite:'];
    case 'Google Workspace': return ['workspace:', 'gsuite:', 'googleworkspace:'];
    case 'Network Devices': return ['zeek:', 'suricata:', 'network:', 'firewall:', 'proxy:'];
    case 'Containers': return ['kubernetes:', 'container:', 'docker:'];
    case 'Android': return ['android:'];
    case 'iOS': return ['ios:'];
    default: return [];
  }
}

function DataComponentDetail({
  dc,
  platform,
  onClose,
  vendorEvidence,
}: {
  dc: DataComponentRef;
  platform: string;
  onClose: () => void;
  vendorEvidence?: AiEvidenceEntry;
}) {
  const [isVendorLogSourcesExpanded, setIsVendorLogSourcesExpanded] = useState(false);
  const prefixes = getPlatformPrefixes(platform);
  const formatVendorChannel = (value?: string[] | null) => {
    if (!value || value.length === 0) return '-';
    return value.join(', ');
  };
  
  const filteredLogSources = (dc as any).logSources?.filter((ls: any) =>
    prefixes.some(prefix => ls.name.toLowerCase().startsWith(prefix.toLowerCase()))
  ) || [];

  const platformMeasure = (dc as any).dataCollectionMeasures?.find((m: any) => platformMatchesAny([m.platform], [platform]));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-background rounded-lg max-w-3xl w-full max-h-[85vh] overflow-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <code className="text-sm text-primary font-mono">{dc.id}</code>
              <Badge variant="secondary" className="text-xs">{platform}</Badge>
            </div>
            <h2 className="text-xl font-semibold text-foreground">{dc.name}</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-md transition-colors"
            data-testid="button-close-dc-detail"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          <div>
            <p className="text-foreground leading-relaxed">{dc.description}</p>
          </div>

          {platformMeasure && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                Data Collection Measures ({platform})
              </h3>
              <div className="bg-muted/30 rounded-md p-4">
                <p className="text-sm text-foreground">{platformMeasure.description}</p>
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              Log Sources ({platform})
            </h3>
            {filteredLogSources.length > 0 ? (
              <div className="rounded-md overflow-hidden border border-border keep-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Channel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredLogSources.map((ls: any, idx: any) => (
                      <tr key={idx}>
                        <td className="px-4 py-2 font-mono text-foreground">{ls.name}</td>
                        <td className="px-4 py-2 text-muted-foreground">{ls.channel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground rounded-md p-4 text-center">
                No log sources defined for {platform} in this data component.
              </div>
            )}
          </div>

          {vendorEvidence && vendorEvidence.logSources.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setIsVendorLogSourcesExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between rounded-md border border-border/60 bg-background/60 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Vendor Log Sources</span>
                </div>
                <ChevronRight
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform",
                    isVendorLogSourcesExpanded && "rotate-90"
                  )}
                />
              </button>
              {isVendorLogSourcesExpanded && (
                <div className="mt-3 rounded-md overflow-hidden border border-border keep-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Name</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Channel</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Notes</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {vendorEvidence.logSources.map((source, idx) => (
                        <tr key={`${dc.id}-vendor-${idx}`}>
                          <td className="px-4 py-2 font-mono text-foreground">{source.name}</td>
                          <td className="px-4 py-2 text-muted-foreground">{formatVendorChannel(source.channel)}</td>
                          <td className="px-4 py-2 text-muted-foreground">{source.notes || '-'}</td>
                          <td className="px-4 py-2">
                            {source.sourceUrl ? (
                              <a
                                href={source.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center rounded-md border border-border/60 bg-background px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted"
                              >
                                Reference
                              </a>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="pt-4">
            <a
              href={`https://attack.mitre.org/datasources/${dc.dataSource.replace(/\s+/g, '%20')}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              View on MITRE ATT&CK
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ProductData {
  id: number;
  productId: string;
  hybridSelectorType: 'platform' | null;
  hybridSelectorValues: string[] | null;
}

interface ProductAlias {
  id: number;
  alias: string;
  confidence: number | null;
  createdAt: string;
}

interface ProductStreamRow {
  id: number;
  name: string;
  metadata?: Record<string, unknown> | null;
}

interface AiEvidenceLogSource {
  name: string;
  channel?: string[];
  notes?: string;
  sourceUrl?: string;
}

interface AiEvidenceEntry {
  dataComponentId: string;
  dataComponentName: string;
  logSources: AiEvidenceLogSource[];
}

export function ProductView({ product, onBack }: ProductViewProps) {
  const [, setLocation] = useLocation();
  const [expandedStrategies, setExpandedStrategies] = useState<Set<string>>(new Set());
  const [expandedAnalytics, setExpandedAnalytics] = useState<Set<string>>(new Set());
  const [expandedTactics, setExpandedTactics] = useState<Set<string>>(new Set());
  const [expandedTechniques, setExpandedTechniques] = useState<Set<string>>(new Set());
  const [expandedSubtechniques, setExpandedSubtechniques] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState('overview');
  const [selectedDataComponent, setSelectedDataComponent] = useState<DataComponentRef | null>(null);
  const [selectedTechniqueIds, setSelectedTechniqueIds] = useState<Set<string>>(new Set());
  const [selectedDataComponentIds, setSelectedDataComponentIds] = useState<Set<string>>(new Set());
  const [scenarioFilterEnabled, setScenarioFilterEnabled] = useState(false);
  const [scenarioAnswers, setScenarioAnswers] = useState<ScenarioAnswers>(DEFAULT_SCENARIO_ANSWERS);
  const [scenarioMaxTechniques, setScenarioMaxTechniques] = useState(12);
  const [scenarioShowAll, setScenarioShowAll] = useState(false);
  const [scenarioOverrideTechniqueIds, setScenarioOverrideTechniqueIds] = useState<Set<string>>(new Set());
  const [sourceFilters, setSourceFilters] = useState<Set<ResourceType>>(() => new Set<ResourceType>(['ctid', 'sigma', 'elastic', 'splunk', 'azure']));
  const [showSourceFilter, setShowSourceFilter] = useState(false);
  const [showAllTechniques, setShowAllTechniques] = useState(false);
  const [showAllDataComponents, setShowAllDataComponents] = useState(false);
  const [isVendorLogSourcesExpanded, setIsVendorLogSourcesExpanded] = useState(false);
  const [exportNotes, setExportNotes] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [isEvidenceDialogOpen, setIsEvidenceDialogOpen] = useState(false);
  const [evidenceTechniqueId, setEvidenceTechniqueId] = useState('');
  const [evidenceTechniqueName, setEvidenceTechniqueName] = useState('');
  const [evidenceEntries, setEvidenceEntries] = useState<Array<{ name: string; channel: string; eventId: string; dataComponent: string }>>([]);
  const [evidenceQuery, setEvidenceQuery] = useState('');
  const [evidenceCaveats, setEvidenceCaveats] = useState('');
  const scenarioDefaultsKeyRef = useRef<string>('');
  const queryClient = useQueryClient();
  const deleteProductMutation = useDeleteProduct();
  const { toast } = useToast();
  
  const platform = normalizePlatformList(product.platforms || [])[0] || product.platforms[0];
  const productTitle = `${product.vendor} ${product.productName}`.trim();
  const productKey = String(product.productId ?? product.id);
  
  const { data: productData, refetch: refetchProduct } = useQuery<ProductData>({
    queryKey: ['product', productKey],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productKey}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch product');
      return res.json();
    },
    staleTime: 30 * 1000,
  });

  const { data: productAliases = [] } = useQuery<ProductAlias[]>({
    queryKey: ['product-aliases', productKey],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productKey}/aliases`, { credentials: 'include' });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error('Failed to fetch product aliases');
      return res.json();
    },
    staleTime: 30 * 1000,
  });

  const productStreamId = product.productId || productData?.productId || productKey;
  const { data: productStreams = [] } = useQuery<ProductStreamRow[]>({
    queryKey: ['product-streams', productStreamId],
    queryFn: async () => {
      const res = await fetch(`/api/products/${encodeURIComponent(String(productStreamId))}/streams`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch product streams');
      const payload = await res.json();
      return Array.isArray(payload?.streams) ? payload.streams : [];
    },
    enabled: Boolean(productStreamId),
    staleTime: 30 * 1000,
  });

  const ssmProductId = product.productId || productData?.productId || productKey;
  const { data: ssmCapabilities = [] } = useProductSsm(ssmProductId);

  const ssmCoverage = useMemo(() => {
    return getAggregateCoverage(ssmCapabilities, 'detect');
  }, [ssmCapabilities]);

  const ssmVisibilityCoverage = useMemo(() => {
    return getAggregateCoverage(ssmCapabilities, 'visibility');
  }, [ssmCapabilities]);

  const techniqueIndex = useMemo(() => {
    const map = new Map<string, Technique>();
    techniques.forEach(tech => map.set(tech.id.toUpperCase(), tech));
    return map;
  }, []);

  const techniqueTacticMap = useMemo(() => {
    const map = new Map<string, string>();
    techniques.forEach((technique) => {
      const tactic = getPrimaryTactic(technique);
      if (tactic) {
        map.set(technique.id.toUpperCase(), tactic);
      }
    });
    return map;
  }, []);

  const ssmTechniqueNames = useMemo(() => {
    const map = new Map<string, string>();
    ssmCapabilities.forEach(cap => {
      cap.mappings.forEach(mapping => {
        const normalized = normalizeTechniqueId(mapping.techniqueId);
        if (!map.has(normalized)) {
          map.set(normalized, mapping.techniqueName);
        }
      });
    });
    return map;
  }, [ssmCapabilities]);

  const ssmMetadataByTechnique = useMemo(
    () => buildMetadataByTechnique(ssmCapabilities),
    [ssmCapabilities]
  );

  const ssmMappingIdsByTechnique = useMemo(
    () => buildMappingIdsByTechnique(ssmCapabilities),
    [ssmCapabilities]
  );

  const getMetadataForTechniques = (techniqueIds: string[]): Record<string, unknown> | null => {
    for (const techId of techniqueIds) {
      const metadata = ssmMetadataByTechnique.get(normalizeTechniqueId(techId));
      if (metadata) return metadata;
    }
    return null;
  };

  const normalizeMetadata = (value: unknown): Record<string, unknown> => {
    if (!value) return {};
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }
      return {};
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  };

  const extractMappedDataComponentsFromMetadata = (metadata: Record<string, unknown> | null): string[] => {
    if (!metadata) return [];
    const mapped = metadata.mapped_data_components ?? metadata.mappedDataComponents;
    if (!Array.isArray(mapped)) return [];

    const values = new Set<string>();
    const push = (value: unknown) => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed) return;
      values.add(trimmed);

      const dcIdMatch = trimmed.toUpperCase().match(/DC\d{4}/);
      if (dcIdMatch) values.add(dcIdMatch[0]);

      const parts = trimmed.split(' - ');
      if (parts.length > 1) {
        const suffix = parts.slice(1).join(' - ').trim();
        if (suffix) values.add(suffix);
      }
    };

    mapped.forEach((entry) => {
      if (typeof entry === 'string') {
        push(entry);
        return;
      }
      if (!entry || typeof entry !== 'object') return;
      const obj = entry as {
        id?: unknown;
        name?: unknown;
        dataComponentId?: unknown;
        dataComponentName?: unknown;
      };
      push(obj.id);
      push(obj.name);
      push(obj.dataComponentId);
      push(obj.dataComponentName);
    });

    return Array.from(values);
  };

  const verifiedEvidence = useMemo(() => {
    const map = new Map<string, AiEvidenceEntry>();

    const normalizeChannelList = (value: unknown): string[] => {
      const normalizeEntry = (entry: unknown) => {
        if (typeof entry === 'string') return entry.trim();
        if (typeof entry === 'number' && Number.isFinite(entry)) return String(entry);
        return '';
      };
      if (Array.isArray(value)) {
        return value
          .map((item) => normalizeEntry(item))
          .filter((item) => item.length > 0);
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return [String(value)];
      }
      return [];
    };

    const normalizeLogSources = (sources: any[]): AiEvidenceLogSource[] => {
      if (!Array.isArray(sources)) return [];
      return sources
        .map((source) => {
          const name = typeof source?.name === 'string' ? source.name.trim() : '';
          if (!name) return null;
          const channel = normalizeChannelList(source?.channel);
          const notes = typeof source?.notes === 'string'
            ? source.notes
            : typeof source?.note === 'string' ? source.note : undefined;
          return {
            name,
            channel: channel.length > 0 ? channel : undefined,
            notes,
            sourceUrl: typeof source?.source_url === 'string'
              ? source.source_url
              : typeof source?.sourceUrl === 'string' ? source.sourceUrl : undefined,
          } as AiEvidenceLogSource;
        })
        .filter(Boolean) as AiEvidenceLogSource[];
    };

    const mergeLogSources = (existingSources: AiEvidenceLogSource[], incomingSources: AiEvidenceLogSource[]) => {
      const byKey = new Map<string, AiEvidenceLogSource>();
      const keyFor = (source: AiEvidenceLogSource) =>
        `${source.name.toLowerCase()}|${(source.sourceUrl || '').toLowerCase()}`;

      const addSource = (source: AiEvidenceLogSource) => {
        const key = keyFor(source);
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, { ...source });
          return;
        }
        const existingChannels = existing.channel || [];
        const incomingChannels = source.channel || [];
        const mergedChannels = Array.from(new Set([...existingChannels, ...incomingChannels]));
        existing.channel = mergedChannels.length > 0 ? mergedChannels : undefined;
        if (!existing.notes && source.notes) {
          existing.notes = source.notes;
        }
        if (!existing.sourceUrl && source.sourceUrl) {
          existing.sourceUrl = source.sourceUrl;
        }
      };

      existingSources.forEach(addSource);
      incomingSources.forEach(addSource);
      return Array.from(byKey.values());
    };

    productStreams.forEach((stream) => {
      const metadata = normalizeMetadata(stream?.metadata);
      const enrichment = (metadata as any).ai_enrichment || (metadata as any).aiEnrichment;
      if (!enrichment || typeof enrichment !== 'object') return;
      const confirmed = (enrichment as any).confirmed === true
        || Boolean((enrichment as any).confirmed_at || (enrichment as any).confirmedAt);
      if (!confirmed) return;
      const results = Array.isArray((enrichment as any).results) ? (enrichment as any).results : [];
      results.forEach((entry: any) => {
        const dcId = typeof entry?.data_component_id === 'string'
          ? entry.data_component_id
          : typeof entry?.dataComponentId === 'string'
            ? entry.dataComponentId
            : typeof entry?.dcId === 'string'
              ? entry.dcId
              : entry?.dc_id;
        if (!dcId) return;
        const dcName = typeof entry?.data_component_name === 'string'
          ? entry.data_component_name
          : typeof entry?.dataComponentName === 'string'
            ? entry.dataComponentName
            : typeof entry?.dcName === 'string'
              ? entry.dcName
              : entry?.dc_name || dcId;
        const logSources = normalizeLogSources(
          Array.isArray(entry?.log_sources) ? entry.log_sources : entry?.logSources
        );
        if (logSources.length === 0) return;

        const key = String(dcId).toLowerCase();
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            dataComponentId: String(dcId),
            dataComponentName: String(dcName || dcId),
            logSources,
          });
          return;
        }

        if (!existing.dataComponentName && dcName) {
          existing.dataComponentName = String(dcName);
        }
        existing.logSources = mergeLogSources(existing.logSources, logSources);
      });
    });

    return Array.from(map.values());
  }, [productStreams]);

  const verifiedEvidenceByDcId = useMemo(() => {
    const map = new Map<string, AiEvidenceEntry>();
    verifiedEvidence.forEach((entry) => {
      map.set(entry.dataComponentId.toLowerCase(), entry);
    });
    return map;
  }, [verifiedEvidence]);

  const verifiedEvidenceByName = useMemo(() => {
    const map = new Map<string, AiEvidenceEntry>();
    verifiedEvidence.forEach((entry) => {
      if (!entry.dataComponentName) return;
      map.set(entry.dataComponentName.toLowerCase(), entry);
    });
    return map;
  }, [verifiedEvidence]);

  const mutableElementValuesByAnalytic = useMemo(() => {
    const map = new Map<string, Map<string, MutableElementValueEntry>>();
    productStreams.forEach((stream) => {
      const metadata = normalizeMetadata(stream?.metadata);
      const valuesRaw = (metadata as any).mutable_element_values || (metadata as any).mutableElementValues;
      if (!Array.isArray(valuesRaw)) return;
      valuesRaw.forEach((entry: any) => {
        const analyticId = typeof entry?.analytic_id === 'string'
          ? entry.analytic_id
          : typeof entry?.analyticId === 'string' ? entry.analyticId : '';
        const field = typeof entry?.field === 'string' ? entry.field : '';
        const valueRaw = entry?.value;
        if (!analyticId || !field || valueRaw === undefined || valueRaw === null) return;
        const value = typeof valueRaw === 'string' ? valueRaw : String(valueRaw);
        const sourceUrl = typeof entry?.source_url === 'string'
          ? entry.source_url
          : typeof entry?.sourceUrl === 'string' ? entry.sourceUrl : undefined;
        const note = typeof entry?.note === 'string' ? entry.note : undefined;
        if (!map.has(analyticId)) {
          map.set(analyticId, new Map());
        }
        const fieldKey = field.toLowerCase();
        const existing = map.get(analyticId)!.get(fieldKey);
        if (!existing || !existing.value) {
          map.get(analyticId)!.set(fieldKey, {
            analyticId,
            field,
            value,
            sourceUrl,
            note,
          });
        }
      });
    });
    return map;
  }, [productStreams]);

  const openEvidenceDialog = (techniqueId: string, techniqueName: string) => {
    const metadata = ssmMetadataByTechnique.get(techniqueId) || {};
    const logSources = (metadata.log_sources || metadata.logSources) as unknown;
    const caveats = (metadata.caveats || []) as unknown;

    const entries = Array.isArray(logSources)
      ? logSources.map((entry) => {
        if (typeof entry === 'string') {
          return { name: entry, channel: '', eventId: '', dataComponent: '' };
        }
        if (entry && typeof entry === 'object') {
          const obj = entry as { name?: string; channel?: string; event_id?: string; satisfies_data_component?: string };
          return {
            name: obj.name || '',
            channel: obj.channel || '',
            eventId: obj.event_id || '',
            dataComponent: obj.satisfies_data_component || '',
          };
        }
        return { name: '', channel: '', eventId: '', dataComponent: '' };
      })
      : [];

    setEvidenceTechniqueId(techniqueId);
    setEvidenceTechniqueName(techniqueName);
    setEvidenceEntries(entries.length > 0 ? entries : [{ name: '', channel: '', eventId: '', dataComponent: '' }]);
    setEvidenceQuery(typeof metadata.query === 'string' ? metadata.query : '');
    setEvidenceCaveats(Array.isArray(caveats) ? caveats.join('\n') : '');
    setIsEvidenceDialogOpen(true);
  };

  const updateEvidenceEntry = (
    index: number,
    field: 'name' | 'channel' | 'eventId' | 'dataComponent',
    value: string
  ) => {
    setEvidenceEntries((prev) => {
      const next = [...prev];
      const target = { ...(next[index] || { name: '', channel: '', eventId: '', dataComponent: '' }) };
      target[field] = value;
      next[index] = target;
      return next;
    });
  };

  const addEvidenceEntry = () => {
    setEvidenceEntries((prev) => [...prev, { name: '', channel: '', eventId: '', dataComponent: '' }]);
  };

  const removeEvidenceEntry = (index: number) => {
    setEvidenceEntries((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveEvidenceOverrides = async () => {
    const mappingIds = ssmMappingIdsByTechnique.get(evidenceTechniqueId) || [];
    if (mappingIds.length === 0) return;

    const logSources = evidenceEntries
      .filter(entry => entry.name.trim().length > 0)
      .map(entry => ({
        name: entry.name.trim(),
        channel: entry.channel.trim() || undefined,
        event_id: entry.eventId.trim() || undefined,
        satisfies_data_component: entry.dataComponent.trim() || undefined,
      }));

    const caveats = evidenceCaveats
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const metadata = {
      log_sources: logSources.length > 0 ? logSources : undefined,
      query: evidenceQuery.trim() || undefined,
      caveats: caveats.length > 0 ? caveats : undefined,
    };

    await Promise.all(
      mappingIds.map(mappingId =>
        fetch(`/api/ssm/mappings/${mappingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata }),
        })
      )
    );

    queryClient.invalidateQueries({ queryKey: ['product-ssm', ssmProductId] });
    setIsEvidenceDialogOpen(false);
  };

  const allPlatforms = useMemo(() => {
    const combined = [
      ...(product.platforms || []),
      ...(productData?.hybridSelectorValues || []),
    ];
    return normalizePlatformList(combined);
  }, [product.platforms, productData?.hybridSelectorValues]);

  const mappedPlatforms = useMemo(() => {
    const set = new Set<string>();
    allPlatforms.forEach((platformValue) => set.add(platformValue));

    ssmCapabilities.forEach((capability) => {
      if (!capability.platform) return;
      const normalized = normalizePlatformList([capability.platform]);
      if (normalized.length > 0) {
        normalized.forEach((platformValue) => set.add(platformValue));
      } else {
        set.add(capability.platform);
      }
    });

    return Array.from(set);
  }, [allPlatforms, ssmCapabilities]);

  useEffect(() => {
    const scenarioKey = `${productKey}|${productTitle}|${allPlatforms.join(',')}`;
    if (scenarioDefaultsKeyRef.current === scenarioKey) return;
    setScenarioAnswers(inferScenarioAnswersFromPlatforms(allPlatforms));
    setScenarioFilterEnabled(false);
    setScenarioShowAll(false);
    setScenarioMaxTechniques(12);
    setScenarioOverrideTechniqueIds(new Set());
    scenarioDefaultsKeyRef.current = scenarioKey;
  }, [allPlatforms, productKey, productTitle]);

  useEffect(() => {
    setIsVendorLogSourcesExpanded(false);
  }, [productKey]);

  const hasWizardGuidedCoverage = useMemo(
    () => ssmCapabilities.some((capability) => {
      const source = (capability.source || '').toLowerCase();
      return source === 'wizard_questions' || source === 'wizard_telemetry';
    }),
    [ssmCapabilities]
  );

  const stixScopedCapabilities = useMemo(() => {
    if (!hasWizardGuidedCoverage) return ssmCapabilities;
    return ssmCapabilities.filter((capability) => {
      const source = (capability.source || '').toLowerCase();
      return source === 'wizard_questions' || source === 'wizard_telemetry';
    });
  }, [hasWizardGuidedCoverage, ssmCapabilities]);

  const stixTechniqueIds = useMemo(() => {
    const set = new Set<string>();
    stixScopedCapabilities.forEach(cap => {
      cap.mappings.forEach(mapping => set.add(mapping.techniqueId));
    });
    return Array.from(set);
  }, [stixScopedCapabilities]);

  // Always pass platforms for proper scoping. Analytics without platform metadata
  // (e.g. wizard-sourced) are treated as platform-agnostic by the hybrid strategy builder.
  const stixMappingPlatforms = allPlatforms;

  const { data: ssmStixMapping } = useQuery<{
    detectionStrategies: StixDetectionStrategy[];
    dataComponents: StixDataComponent[];
    techniqueNames: Record<string, string>;
    techniqueDataComponents?: Record<string, Array<{ id: string; name: string }>>;
  }>({
    queryKey: ['ssm-stix-mapping', productKey, stixTechniqueIds.join('|'), stixMappingPlatforms.join('|')],
    queryFn: async () => {
      const res = await fetch('/api/mitre-stix/techniques/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          techniqueIds: stixTechniqueIds,
          platforms: stixMappingPlatforms.length > 0 ? stixMappingPlatforms : undefined,
        }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch SSM technique mapping');
      return res.json();
    },
    enabled: stixTechniqueIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const addAliasMutation = useMutation({
    mutationFn: async (alias: string) => {
      const res = await fetch(`/api/products/${productKey}/aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias }),
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to add alias');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-aliases', productKey] });
      setNewAlias('');
    },
  });

  const deleteAliasMutation = useMutation({
    mutationFn: async (aliasId: number) => {
      const res = await fetch(`/api/products/${productKey}/aliases/${aliasId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to remove alias');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-aliases', productKey] });
    },
  });

  const handleAddAlias = () => {
    const trimmed = newAlias.trim();
    if (!trimmed) return;
    addAliasMutation.mutate(trimmed);
  };

  const handleDeleteProduct = () => {
    if (!productKey) return;
    const confirmed = window.confirm(`Delete ${productTitle}? This cannot be undone.`);
    if (!confirmed) return;
    deleteProductMutation.mutate(productKey, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['products'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'status'] });
        onBack();
      },
      onError: (error) => {
        toast({
          title: 'Failed to delete product',
          description: error instanceof Error ? error.message : 'Unexpected error',
          variant: 'destructive',
        });
      },
    });
  };

  const { data: coveragePathsData } = useQuery<{ paths: CoveragePathRow[] }>({
    queryKey: ['graph-coverage-paths'],
    queryFn: async () => {
      const res = await fetch('/api/graph/coverage/paths?limit=8');
      if (!res.ok) throw new Error('Failed to fetch coverage paths');
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const { data: coverageData } = useQuery<{ coverage: CoverageRow[] }>({
    queryKey: ['graph-coverage', productKey, allPlatforms.join('|'), 'detection'],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('productId', productKey);
      params.set('scope', 'detection');
      if (allPlatforms.length > 0) {
        params.set('platforms', allPlatforms.join(','));
      }
      const res = await fetch(`/api/graph/coverage?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch coverage');
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const { data: visibilityCoverageData } = useQuery<{ coverage: CoverageRow[] }>({
    queryKey: ['graph-coverage', productKey, allPlatforms.join('|'), 'visibility'],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('productId', productKey);
      params.set('scope', 'visibility');
      if (allPlatforms.length > 0) {
        params.set('platforms', allPlatforms.join(','));
      }
      const res = await fetch(`/api/graph/coverage?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch coverage');
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const coverageTacticMap = useMemo(() => {
    const map = new Map<string, string>();
    const rows = [
      ...(coverageData?.coverage || []),
      ...(visibilityCoverageData?.coverage || []),
    ];
    rows.forEach((row) => {
      if (Array.isArray(row.tactics) && row.tactics.length > 0) {
        map.set(normalizeTechniqueId(row.techniqueId), row.tactics[0]);
      }
    });
    return map;
  }, [coverageData?.coverage, visibilityCoverageData?.coverage]);

  const coverageDescriptionMap = useMemo(() => {
    const map = new Map<string, string>();
    const rows = [
      ...(coverageData?.coverage || []),
      ...(visibilityCoverageData?.coverage || []),
    ];
    rows.forEach((row) => {
      if (row.techniqueDescription) {
        map.set(normalizeTechniqueId(row.techniqueId), row.techniqueDescription);
      }
    });
    return map;
  }, [coverageData?.coverage, visibilityCoverageData?.coverage]);

  const [remoteTacticMap, setRemoteTacticMap] = useState<Map<string, string[]>>(
    () => new Map()
  );
  const pendingTacticRequests = useRef(new Set<string>());

  const resolveTacticName = useMemo(() => {
    return (techniqueId: string, tactics?: string[]) => {
      if (Array.isArray(tactics) && tactics.length > 0) return tactics[0];
      const normalized = normalizeTechniqueId(techniqueId);
      const remote = remoteTacticMap.get(normalized);
      if (remote && remote.length > 0) return remote[0];
      const direct = coverageTacticMap.get(normalized)
        || getPrimaryTactic(techniqueIndex.get(normalized))
        || techniqueTacticMap.get(normalized);
      if (direct) return direct;
      if (normalized.includes('.')) {
        const parentId = normalized.split('.')[0];
        return coverageTacticMap.get(parentId)
          || getPrimaryTactic(techniqueIndex.get(parentId))
          || techniqueTacticMap.get(parentId)
          || 'Unknown';
      }
      return 'Unknown';
    };
  }, [coverageTacticMap, techniqueIndex, techniqueTacticMap, remoteTacticMap]);

  const resolveAllTactics = useMemo(() => {
    return (techniqueId: string, tactics?: string[]): string[] => {
      if (Array.isArray(tactics) && tactics.length > 0) return tactics;
      const normalized = normalizeTechniqueId(techniqueId);
      const remote = remoteTacticMap.get(normalized);
      if (remote && remote.length > 0) return remote;
      const indexed = techniqueIndex.get(normalized);
      if (indexed?.tactics && indexed.tactics.length > 0) return indexed.tactics;
      // Fall back to single tactic resolution
      const single = resolveTacticName(normalized);
      return single && single !== 'Unknown' ? [single] : [];
    };
  }, [resolveTacticName, techniqueIndex, remoteTacticMap]);

  const resolveTechniqueDescription = useMemo(() => {
    return (techniqueId: string, description?: string) => {
      if (description) return description;
      const normalized = normalizeTechniqueId(techniqueId);
      const direct = techniqueIndex.get(normalized);
      if (direct?.description) return direct.description;
      if (normalized.includes('.')) {
        const parentId = normalized.split('.')[0];
        const parent = techniqueIndex.get(parentId);
        if (parent?.description) return parent.description;
      }
      return coverageDescriptionMap.get(normalized) || '';
    };
  }, [techniqueIndex, coverageDescriptionMap]);

  const getFirstSentence = useMemo(() => {
    return (value?: string | null) => {
      const trimmed = (value || '').trim();
      if (!trimmed) return '';
      const match = trimmed.match(/^[^.!?]+[.!?]/);
      if (match) return match[0].trim();
      const firstLine = trimmed.split(/\r?\n/).find((line) => line.trim().length > 0);
      if (firstLine) return firstLine.trim();
      return trimmed;
    };
  }, []);

  const { data: mitreStats } = useQuery<{ techniques: number }>({
    queryKey: ['mitre-stix-stats'],
    queryFn: async () => {
      const res = await fetch('/api/mitre-stix/stats');
      if (!res.ok) throw new Error('Failed to fetch MITRE stats');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const autoMapping = useAutoMappingWithAutoRun(
    productKey,
    platform,
    allPlatforms.length > 0 ? allPlatforms : null
  );
  
  useEffect(() => {
    if (autoMapping.shouldAutoRun) {
      autoMapping.triggerAutoRun();
    }
  }, [autoMapping.shouldAutoRun, autoMapping.triggerAutoRun]);
  
  const strategies = useMemo(() => {
    return getHybridStrategies(
      stixScopedCapabilities,
      ssmStixMapping?.detectionStrategies,
      getDetectionStrategiesForProduct(productKey),
      stixMappingPlatforms,
      ssmStixMapping?.techniqueDataComponents,
      {
        strictPlatformScopeForUnknownAnalytics: hasWizardGuidedCoverage,
      }
    );
  }, [
    stixScopedCapabilities,
    ssmStixMapping?.detectionStrategies,
    productKey,
    stixMappingPlatforms,
    ssmStixMapping?.techniqueDataComponents,
    hasWizardGuidedCoverage,
  ]);
  const analyticById = useMemo(() => {
    const map = new Map<string, AnalyticItem>();
    strategies.forEach(strategy => {
      strategy.analytics.forEach(analytic => {
        if (!map.has(analytic.id)) {
          map.set(analytic.id, analytic);
        }
      });
    });
    return map;
  }, [strategies]);

  const normalizeChannelList = (value: unknown): string[] | undefined => {
    const normalizeEntry = (entry: unknown) => {
      if (typeof entry === 'string') return entry.trim();
      if (typeof entry === 'number' && Number.isFinite(entry)) return String(entry);
      return '';
    };
    if (Array.isArray(value)) {
      const cleaned = value
        .map((item) => normalizeEntry(item))
        .filter((item) => item.length > 0);
      return cleaned.length > 0 ? cleaned : undefined;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const parts = trimmed.split(',').map((item) => item.trim()).filter(Boolean);
      return parts.length > 0 ? parts : undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return [String(value)];
    }
    return undefined;
  };

  const formatChannel = (value?: string[] | null) => {
    if (!value || value.length === 0) return '-';
    return value.join(', ');
  };

  const resolveEvidenceForKey = (key: string): AiEvidenceEntry | null => {
    if (!key) return null;
    const normalized = key.toLowerCase();
    return verifiedEvidenceByDcId.get(normalized)
      || verifiedEvidenceByName.get(normalized)
      || null;
  };

  const getEnablementNotes = (dataComponentIds?: string[], rows?: LogSourceRow[]) => {
    if (verifiedEvidenceByDcId.size === 0) return [];
    const targets = new Set<string>();
    if (Array.isArray(dataComponentIds)) {
      dataComponentIds.forEach((id) => {
        if (id) targets.add(id);
      });
    }
    if (Array.isArray(rows)) {
      rows.forEach((row) => {
        if (row.dataComponentId) targets.add(row.dataComponentId);
        if (row.dataComponentName) targets.add(row.dataComponentName);
      });
    }
    const notes: Array<{ dataComponentName: string; logSourceName: string; note: string }> = [];
    const seen = new Set<string>();
    targets.forEach((target) => {
      const evidence = resolveEvidenceForKey(target);
      if (!evidence) return;
      const dcName = evidence.dataComponentName
        || (dataComponents as Record<string, any>)[evidence.dataComponentId]?.name
        || target;
      evidence.logSources.forEach((source) => {
        if (!source.notes) return;
        const key = `${evidence.dataComponentId.toLowerCase()}|${source.name.toLowerCase()}|${source.notes}`;
        if (seen.has(key)) return;
        seen.add(key);
        notes.push({
          dataComponentName: dcName,
          logSourceName: source.name,
          note: source.notes,
        });
      });
    });
    return notes;
  };

  const mergeVendorLogSources = (rows: LogSourceRow[], dataComponentIds?: string[]) => {
    const rowsByKey = new Map<string, LogSourceRow>();
    const addRow = (row: LogSourceRow) => {
      const key = `${row.dataComponentId.toLowerCase()}|${row.logSourceName.toLowerCase()}`;
      const existing = rowsByKey.get(key);
      if (!existing) {
        rowsByKey.set(key, row);
        return;
      }
      const existingChannels = existing.channel || [];
      const incomingChannels = row.channel || [];
      const merged = Array.from(new Set([...existingChannels, ...incomingChannels]));
      existing.channel = merged.length > 0 ? merged : undefined;
    };

    rows.forEach(addRow);
    if (verifiedEvidenceByDcId.size === 0) {
      return Array.from(rowsByKey.values());
    }

    const targets = new Set<string>();
    if (Array.isArray(dataComponentIds)) {
      dataComponentIds.forEach((dcId) => {
        if (dcId) targets.add(dcId);
      });
    }
    rows.forEach((row) => {
      if (row.dataComponentId) targets.add(row.dataComponentId);
      if (row.dataComponentName) targets.add(row.dataComponentName);
    });
    if (targets.size === 0) {
      return Array.from(rowsByKey.values());
    }

    targets.forEach((dcKey) => {
      const evidence = resolveEvidenceForKey(dcKey);
      if (!evidence) return;
      const dcName = evidence.dataComponentName
        || (dataComponents as Record<string, any>)[evidence.dataComponentId]?.name
        || dcKey;
      evidence.logSources.forEach((source) => {
        if (!source.name) return;
        addRow({
          dataComponentId: evidence.dataComponentId || dcKey,
          dataComponentName: dcName,
          logSourceName: source.name,
          channel: normalizeChannelList(source.channel),
        });
      });
    });

    return Array.from(rowsByKey.values());
  };

  const getLogSourcesForAnalytic = (analytic: AnalyticItem, targetPlatforms?: string[]): LogSourceRow[] => {
    const rows: LogSourceRow[] = [];
    const platformsToUse = targetPlatforms && targetPlatforms.length > 0 ? targetPlatforms : [platform];
    const allPrefixes = platformsToUse.flatMap(p => getPlatformPrefixes(p));

    analytic.dataComponents.forEach((dcId: string) => {
      const dc = (dataComponents as Record<string, any>)[dcId];
      if (!dc) return;

      if (dc.logSources && dc.logSources.length > 0) {
        const filteredSources = dc.logSources.filter((ls: any) =>
          allPrefixes.some(prefix => ls.name.toLowerCase().startsWith(prefix.toLowerCase()))
        );
        filteredSources.forEach((ls: any) => {
          rows.push({
            dataComponentId: dc.id,
            dataComponentName: dc.name,
            logSourceName: ls.name,
            channel: normalizeChannelList(ls.channel),
          });
        });
      } else {
        const platformMappings = dc.platforms.filter((p: any) => platformMatchesAny([p.platform], platformsToUse));
        platformMappings.forEach((mapping: any) => {
          rows.push({
            dataComponentId: dc.id,
            dataComponentName: dc.name,
            logSourceName: mapping.logSourceName,
            channel: normalizeChannelList(mapping.logChannel),
          });
        });
      }
    });

    return mergeVendorLogSources(rows, analytic.dataComponents);
  };

  const getLogSourcesForStixAnalytic = (analytic: StixAnalytic): LogSourceRow[] => {
    if (!analytic) {
      return [];
    }

    const rows: LogSourceRow[] = [];
    const stixLogSources = Array.isArray(analytic.logSources) ? analytic.logSources : [];

    stixLogSources
      .filter((ls) => ls && ls.dataComponentId && ls.dataComponentName && ls.name)
      .forEach((ls) => {
        rows.push({
          dataComponentId: ls.dataComponentId,
          dataComponentName: ls.dataComponentName,
          logSourceName: ls.name,
          channel: normalizeChannelList(ls.channel),
        });
      });
    return mergeVendorLogSources(rows, analytic.dataComponents);
  };

  const isStixAnalytic = (analytic: AnalyticItem | StixAnalytic): analytic is StixAnalytic => {
    return Array.isArray((analytic as StixAnalytic).logSources) ||
      Array.isArray((analytic as StixAnalytic).mutableElements);
  };

  const getMutableElementsForAnalytic = (analytic: AnalyticItem): MutableElementRow[] => {
    const seen = new Set<string>();
    const rows: MutableElementRow[] = [];

    analytic.dataComponents.forEach((dcId: string) => {
      const dc = (dataComponents as Record<string, any>)[dcId];
      if (!dc) return;

      dc.mutableElements.forEach((me: any) => {
        if (!seen.has(me.name)) {
          seen.add(me.name);
          rows.push({
            field: me.name,
            description: me.description,
          });
        }
      });
    });

    return rows;
  };

  const getMutableElementsForStixAnalytic = (analytic: StixAnalytic): MutableElementRow[] => {
    if (!analytic || !Array.isArray(analytic.mutableElements)) {
      return [];
    }

    const valuesForAnalytic = mutableElementValuesByAnalytic.get(analytic.id);

    return analytic.mutableElements
      .filter((me) => me && me.field)
      .map(me => {
        const valueEntry = valuesForAnalytic?.get(me.field.toLowerCase());
        return {
          field: me.field,
          description: me.description,
          value: valueEntry?.value,
          sourceUrl: valueEntry?.sourceUrl,
          note: valueEntry?.note,
        };
      });
  };

  const getLogSourcesFromMetadata = (metadata: Record<string, unknown> | null): LogSourceRow[] => {
    if (!metadata) return [];
    const logSources = (metadata.log_sources || metadata.logSources) as unknown;
    if (!Array.isArray(logSources)) return [];
    return logSources
      .map((entry) => {
        if (typeof entry === 'string') {
          return {
            dataComponentId: 'custom',
            dataComponentName: 'Custom Log Source',
            logSourceName: entry,
            channel: undefined,
          };
        }
        if (entry && typeof entry === 'object') {
          const obj = entry as { name?: string; channel?: string; dataComponent?: string };
          return {
            dataComponentId: 'custom',
            dataComponentName: obj.dataComponent || 'Custom Log Source',
            logSourceName: obj.name || 'Log Source',
            channel: normalizeChannelList(obj.channel),
          };
        }
        return null;
      })
      .filter(Boolean) as LogSourceRow[];
  };

  const getMutableElementsFromMetadata = (metadata: Record<string, unknown> | null): MutableElementRow[] => {
    if (!metadata) return [];
    const elements = (metadata.mutable_elements || metadata.mutableElements) as unknown;
    if (!Array.isArray(elements)) return [];
    return elements
      .map((entry) => {
        if (typeof entry === 'string') {
          return { field: entry, description: '' };
        }
        if (entry && typeof entry === 'object') {
          const obj = entry as { field?: string; description?: string; name?: string };
          return {
            field: obj.field || obj.name || '',
            description: obj.description || '',
          };
        }
        return null;
      })
      .filter((row): row is MutableElementRow => Boolean(row && row.field));
  };

  const getQueryFromMetadata = (metadata: Record<string, unknown> | null): string | null => {
    if (!metadata) return null;
    const query = metadata.query || metadata.analytic_logic;
    if (!query) return null;
    if (typeof query === 'string') return query;
    try {
      return JSON.stringify(query, null, 2);
    } catch {
      return null;
    }
  };

  const getCommunityMutableElements = (analytics: AnalyticMapping[], sourceLabel: string): MutableElementRow[] => {
    const seen = new Set<string>();
    const rows: MutableElementRow[] = [];

    analytics.forEach(analytic => {
      (analytic.mutableElements || []).forEach(field => {
        const normalized = typeof field === 'string' ? field.trim() : '';
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) return;
        seen.add(key);
        rows.push({
          field: normalized,
          description: `${sourceLabel} investigation field`,
        });
      });
    });

    return rows;
  };

  const extractHowToImplement = (description?: string): string | null => {
    if (!description) return null;
    const marker = 'How to implement:';
    const index = description.indexOf(marker);
    if (index === -1) return null;
    const value = description.slice(index + marker.length).trim();
    return value.length > 0 ? value : null;
  };

  const renderMarkdown = (markdown: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className="text-foreground"
      components={{
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes('language-');
          if (isBlock) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
          return (
            <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono" {...props}>
              {children}
            </code>
          );
        },
        a: ({ href, children, ...props }) => (
          <a href={href} className="text-primary underline" target="_blank" rel="noreferrer" {...props}>
            {children}
          </a>
        ),
        ul: ({ children, ...props }) => (
          <ul className="list-disc pl-6 space-y-1" {...props}>
            {children}
          </ul>
        ),
        ol: ({ children, ...props }) => (
          <ol className="list-decimal pl-6 space-y-1" {...props}>
            {children}
          </ol>
        ),
        li: ({ children, ...props }) => (
          <li className="ml-1" {...props}>
            {children}
          </li>
        ),
        blockquote: ({ children, ...props }) => (
          <blockquote className="border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground" {...props}>
            {children}
          </blockquote>
        ),
        h1: ({ children, ...props }) => (
          <h1 className="text-base font-semibold text-foreground mt-4 mb-2" {...props}>
            {children}
          </h1>
        ),
        h2: ({ children, ...props }) => (
          <h2 className="text-sm font-semibold text-foreground mt-4 mb-2" {...props}>
            {children}
          </h2>
        ),
        h3: ({ children, ...props }) => (
          <h3 className="text-sm font-medium text-foreground mt-3 mb-2" {...props}>
            {children}
          </h3>
        ),
        p: ({ children, ...props }) => (
          <p className="text-sm text-foreground leading-relaxed mb-2" {...props}>
            {children}
          </p>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );

  const renderHowToSection = (label: string, markdown: string) => {
    return (
      <details className="bg-background p-3 rounded">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground select-none">
          {label}
        </summary>
        <div className="mt-3">{renderMarkdown(markdown)}</div>
      </details>
    );
  };

  const getCommunitySource = useMemo(() => {
    return (analytic: { id?: string; source?: ResourceType }): ResourceType | null => {
      if (analytic.source) return analytic.source;
      if (analytic.id?.startsWith('SPLUNK-')) return 'splunk';
      if (analytic.id?.startsWith('SIGMA-')) return 'sigma';
      if (analytic.id?.startsWith('ELASTIC-')) return 'elastic';
      if (analytic.id?.startsWith('AZURE-')) return 'azure';
      return null;
    };
  }, []);

  const hasTechniqueOverlap = useMemo(() => {
    return (ruleTechniques: string[] | undefined, strategyTechniques: string[]): boolean => {
      if (!ruleTechniques || ruleTechniques.length === 0) return false;
      const strategySet = new Set(strategyTechniques.map(t => t.toUpperCase()));
      return ruleTechniques.some(t => strategySet.has(t.toUpperCase()));
    };
  }, []);

  const communityProductMatchTerms = useMemo(() => {
    const terms = new Set<string>();
    const add = (value?: string | null) => {
      if (!value) return;
      const normalized = normalizeSearchText(value);
      if (!normalized || normalized.length < 4) return;
      terms.add(normalized);
    };

    add(productTitle);
    add(product.productName);
    add(`${product.vendor} ${product.productName}`);
    productAliases.forEach((alias) => add(alias.alias));

    return Array.from(terms);
  }, [product.productName, product.vendor, productAliases, productTitle]);

  const communityAnalyticMentionsProduct = useMemo(() => {
    return (analytic: AnalyticMapping): boolean => {
      if (communityProductMatchTerms.length === 0) return false;
      const logSourcesText = Array.isArray(analytic.logSources) ? analytic.logSources.join(' ') : '';
      const haystack = normalizeSearchText([
        analytic.name,
        analytic.description,
        analytic.howToImplement,
        analytic.query,
        analytic.sourceFile,
        logSourcesText,
      ].filter(Boolean).join(' '));

      if (!haystack) return false;
      return communityProductMatchTerms.some((term) => haystack.includes(term));
    };
  }, [communityProductMatchTerms]);

  const vendorMatchedCommunityAnalytics = useMemo(() => {
    const analytics = autoMapping.enrichedMapping?.communityAnalytics || [];
    return analytics.filter((analytic) => communityAnalyticMentionsProduct(analytic));
  }, [autoMapping.enrichedMapping?.communityAnalytics, communityAnalyticMentionsProduct]);

  const dataComponentsByName = useMemo(() => {
    const map = new Map<string, DataComponentRef[]>();
    Object.values(dataComponents).forEach(dc => {
      const key = dc.name.toLowerCase();
      const existing = map.get(key) || [];
      existing.push(dc);
      map.set(key, existing);
    });
    return map;
  }, []);

  const expandDataComponentMatchKeys = useMemo(() => {
    const stixById = new Map<string, { id: string; name: string }>();
    const stixByName = new Map<string, { id: string; name: string }>();
    (ssmStixMapping?.dataComponents || []).forEach((dc) => {
      stixById.set(normalizeDataComponentId(dc.id), { id: dc.id, name: dc.name });
      stixByName.set(normalizeDataComponentId(dc.name), { id: dc.id, name: dc.name });
    });

    return (value: string): Set<string> => {
      const out = new Set<string>();
      const push = (raw?: string | null) => {
        if (!raw) return;
        const normalized = normalizeDataComponentId(raw);
        if (normalized) out.add(normalized);
      };

      const trimmed = value.trim();
      if (!trimmed) return out;
      push(trimmed);

      const dcIdMatch = trimmed.toUpperCase().match(/DC\d{4}/)?.[0];
      if (dcIdMatch) {
        push(dcIdMatch);
        const staticDc = (dataComponents as Record<string, any>)[dcIdMatch];
        if (staticDc?.name) push(staticDc.name);
        const stixDc = stixById.get(normalizeDataComponentId(dcIdMatch));
        if (stixDc) {
          push(stixDc.id);
          push(stixDc.name);
        }
      }

      if (trimmed.includes(' - ')) {
        const [prefix, ...rest] = trimmed.split(' - ');
        const suffix = rest.join(' - ').trim();
        if (prefix) push(prefix);
        if (suffix) push(suffix);
      }

      const byName = dataComponentsByName.get(normalizeDataComponentId(trimmed)) || [];
      byName.forEach((dc) => {
        push(dc.id);
        push(dc.name);
      });

      const stixByNameHit = stixByName.get(normalizeDataComponentId(trimmed));
      if (stixByNameHit) {
        push(stixByNameHit.id);
        push(stixByNameHit.name);
      }

      return out;
    };
  }, [dataComponentsByName, ssmStixMapping?.dataComponents]);

  const getMutableElementsForCommunityAnalytic = (
    analytic: AnalyticItem,
    stixDataComponents: StixDataComponent[]
  ): MutableElementRow[] => {
    const seen = new Set<string>();
    const rows: MutableElementRow[] = [];

    analytic.dataComponents.forEach((dcId: string) => {
      let dc = (dataComponents as Record<string, any>)[dcId];
      if (!dc) {
        const stixDc = stixDataComponents.find(item =>
          item.id === dcId || item.name.toLowerCase() === dcId.toLowerCase()
        );
        if (stixDc) {
          const candidates = dataComponentsByName.get(stixDc.name.toLowerCase()) || [];
          dc = candidates.find(candidate =>
            candidate.dataSource.toLowerCase() === stixDc.dataSource.toLowerCase()
          ) || candidates[0];
        }
      }
      if (!dc) {
        const byNameCandidates = dataComponentsByName.get(dcId.toLowerCase()) || [];
        dc = byNameCandidates[0];
      }

      if (!dc) return;

      dc.mutableElements.forEach((me: any) => {
        if (!seen.has(me.name)) {
          seen.add(me.name);
          rows.push({
            field: me.name,
            description: me.description,
          });
        }
      });
    });

    return rows;
  };

  const getMappedDataComponentsFromMetadata = (metadata: Record<string, unknown> | null): string[] => {
    if (!metadata) return [];
    const mapped = metadata.mapped_data_components ?? metadata.mappedDataComponents;
    if (!Array.isArray(mapped)) return [];

    const values = new Set<string>();
    mapped.forEach((entry) => {
      if (typeof entry !== 'string') return;
      const raw = entry.trim();
      if (!raw) return;
      const idPrefix = raw.split(' - ')[0]?.trim();
      const normalizedId = idPrefix?.toUpperCase();

      if (normalizedId && (dataComponents as Record<string, any>)[normalizedId]) {
        values.add(normalizedId);
        return;
      }
      if ((dataComponents as Record<string, any>)[raw]) {
        values.add(raw);
        return;
      }

      const byName = dataComponentsByName.get(raw.toLowerCase()) || [];
      if (byName.length > 0) {
        byName.forEach((candidate) => values.add(candidate.id));
        return;
      }

      values.add(raw);
    });

    return Array.from(values);
  };

  const resolveAnalyticDataComponents = (
    analytic: AnalyticItem | StixAnalytic,
    metadata: Record<string, unknown> | null
  ): string[] => {
    const fromAnalytic = Array.isArray((analytic as AnalyticItem).dataComponents)
      ? ((analytic as AnalyticItem).dataComponents || [])
      : Array.isArray((analytic as StixAnalytic).dataComponents)
        ? ((analytic as StixAnalytic).dataComponents || [])
        : [];

    const merged = new Set<string>();
    fromAnalytic.forEach((value) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        merged.add(value.trim());
      }
    });

    getMappedDataComponentsFromMetadata(metadata).forEach((value) => {
      if (value.trim().length > 0) merged.add(value.trim());
    });

    return Array.from(merged);
  };

  const selectedTechniqueFilter = useMemo(() => {
    const set = new Set<string>();
    selectedTechniqueIds.forEach((id) => {
      const normalized = normalizeTechniqueId(id);
      if (normalized) set.add(normalized);
    });
    return set;
  }, [selectedTechniqueIds]);

  const selectedDataComponentFilter = useMemo(() => {
    const set = new Set<string>();
    selectedDataComponentIds.forEach((id) => {
      const normalized = normalizeDataComponentId(id);
      if (normalized) set.add(normalized);
    });
    return set;
  }, [selectedDataComponentIds]);

  const hasTechniqueFilter = selectedTechniqueFilter.size > 0;
  const hasDataComponentFilter = selectedDataComponentFilter.size > 0;

  const mappedDataComponentsByTechnique = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (techniqueId: string, value: string) => {
      const normalizedTechnique = normalizeTechniqueId(techniqueId);
      if (!normalizedTechnique || !value) return;
      const existing = map.get(normalizedTechnique) || new Set<string>();
      expandDataComponentMatchKeys(value).forEach((key) => existing.add(key));
      map.set(normalizedTechnique, existing);
    };

    Object.entries(ssmStixMapping?.techniqueDataComponents || {}).forEach(([techniqueId, refs]) => {
      refs.forEach((ref) => {
        if (ref.id) add(techniqueId, ref.id);
        if (ref.name) add(techniqueId, ref.name);
      });
    });

    ssmMetadataByTechnique.forEach((metadata, techniqueId) => {
      extractMappedDataComponentsFromMetadata(metadata).forEach((value) => add(techniqueId, value));
    });

    return map;
  }, [expandDataComponentMatchKeys, ssmMetadataByTechnique, ssmStixMapping?.techniqueDataComponents]);

  const vendorSupportedDataComponentSet = useMemo(() => {
    const set = new Set<string>();

    (product.dataComponentIds || []).forEach((dcId) => {
      expandDataComponentMatchKeys(dcId).forEach((key) => set.add(key));
      const staticDc = (dataComponents as Record<string, any>)[dcId];
      if (staticDc?.name) {
        expandDataComponentMatchKeys(staticDc.name).forEach((key) => set.add(key));
      }
    });

    ssmMetadataByTechnique.forEach((metadata) => {
      extractMappedDataComponentsFromMetadata(metadata).forEach((value) => {
        expandDataComponentMatchKeys(value).forEach((key) => set.add(key));
      });
    });

    verifiedEvidence.forEach((entry) => {
      if (entry.dataComponentId) {
        expandDataComponentMatchKeys(entry.dataComponentId).forEach((key) => set.add(key));
      }
      if (entry.dataComponentName) {
        expandDataComponentMatchKeys(entry.dataComponentName).forEach((key) => set.add(key));
      }
    });

    return set;
  }, [expandDataComponentMatchKeys, product.dataComponentIds, ssmMetadataByTechnique, verifiedEvidence]);

  const hasVendorScopedAnalytics = vendorSupportedDataComponentSet.size > 0;

  const toggleTechniqueFilter = (id: string) => {
    const normalized = normalizeTechniqueId(id);
    setSelectedTechniqueIds((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
  };

  const toggleDataComponentFilter = (id: string) => {
    const normalized = normalizeDataComponentId(id);
    setSelectedDataComponentIds((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
  };

  const clearTechniqueFilters = () => {
    setSelectedTechniqueIds(new Set());
  };

  const clearDataComponentFilters = () => {
    setSelectedDataComponentIds(new Set());
  };

  const scenarioTechniqueInsights = useMemo(() => {
    type Metric = {
      strategyCount: number;
      analyticCount: number;
      dataComponents: Set<string>;
      communityHits: number;
      ssmScore: number; // 0–1 from wizard/SSM/graph coverage evidence
    };

    const metrics = new Map<string, Metric>();
    const candidateTechniqueIds = new Set<string>();
    const addCandidateTechnique = (techniqueId?: string | null) => {
      if (!techniqueId) return;
      const normalized = normalizeTechniqueId(techniqueId);
      if (!/^T\d{4}(?:\.\d{3})?$/.test(normalized)) return;
      candidateTechniqueIds.add(normalized);
    };

    const upsertMetric = (techniqueId: string): Metric => {
      const normalized = normalizeTechniqueId(techniqueId);
      const existing = metrics.get(normalized);
      if (existing) return existing;
      const created: Metric = {
        strategyCount: 0,
        analyticCount: 0,
        dataComponents: new Set<string>(),
        communityHits: 0,
        ssmScore: 0,
      };
      metrics.set(normalized, created);
      return created;
    };

    const ingestStrategies = (
      strategyList: Array<{ techniques?: string[]; analytics?: Array<{ platforms?: string[]; dataComponents?: string[] }> }>,
      isCommunity: boolean
    ) => {
      strategyList.forEach((strategy) => {
        const techniquesForStrategy = Array.isArray(strategy.techniques) ? strategy.techniques : [];
        if (techniquesForStrategy.length === 0) return;
        const allAnalytics = Array.isArray(strategy.analytics) ? strategy.analytics : [];
        const scopedAnalytics = allPlatforms.length > 0
          ? allAnalytics.filter((analytic) => platformMatchesAny(analytic.platforms || [], allPlatforms))
          : allAnalytics;
        const scopedDataComponents = new Set<string>();
        scopedAnalytics.forEach((analytic) => {
          const dcList = Array.isArray(analytic.dataComponents) ? analytic.dataComponents : [];
          dcList.forEach((dcId) => {
            const normalized = normalizeDataComponentId(dcId);
            if (normalized) scopedDataComponents.add(normalized);
          });
        });

        techniquesForStrategy.forEach((techId) => {
          addCandidateTechnique(techId);
          const metric = upsertMetric(techId);
          metric.strategyCount += 1;
          metric.analyticCount += scopedAnalytics.length;
          scopedDataComponents.forEach((dc) => metric.dataComponents.add(dc));
          if (isCommunity) {
            metric.communityHits += 1;
          }
        });
      });
    };

    // Build a complete technique candidate pool first so weak strategy links do not
    // exclude valid mapped techniques before scoring.
    stixTechniqueIds.forEach(addCandidateTechnique);
    Object.keys(ssmVisibilityCoverage).forEach(addCandidateTechnique);
    (coverageData?.coverage || []).forEach((row) => addCandidateTechnique(row.techniqueId));
    (visibilityCoverageData?.coverage || []).forEach((row) => addCandidateTechnique(row.techniqueId));
    autoMapping.enrichedMapping?.techniqueIds?.forEach(addCandidateTechnique);

    candidateTechniqueIds.forEach((techniqueId) => {
      upsertMetric(techniqueId);
    });

    ingestStrategies(
      strategies.map((strategy) => ({
        techniques: strategy.techniques || [],
        analytics: strategy.analytics || [],
      })),
      false
    );

    if (autoMapping.enrichedMapping?.detectionStrategies) {
      ingestStrategies(
        autoMapping.enrichedMapping.detectionStrategies.map((strategy) => ({
          techniques: strategy.techniques || [],
          analytics: strategy.analytics || [],
        })),
        true
      );
    }

    // Ingest SSM/wizard coverage as scoring evidence, but weight it by
    // mapping kind and validation quality so weak or rejected mappings do
    // not rank the same as confirmed detection coverage.
    ssmCapabilities.forEach((cap) => {
      cap.mappings.forEach((mapping) => {
        const normalized = normalizeTechniqueId(mapping.techniqueId);
        const metric = upsertMetric(normalized);
        const score = getSsmMappingRankingScore(mapping);
        if (score <= 0) return;
        metric.ssmScore = Math.max(metric.ssmScore, score);
      });
    });

    const metricValues = Array.from(metrics.values());
    const maxStrategyCount = Math.max(1, ...metricValues.map((metric) => metric.strategyCount));
    const maxAnalyticCount = Math.max(1, ...metricValues.map((metric) => metric.analyticCount));
    const maxDataComponents = Math.max(1, ...metricValues.map((metric) => metric.dataComponents.size));

    // Build set of DC IDs with verified evidence for fidelity multiplier (Spec §6.3)
    const verifiedDcIdSet = new Set<string>();
    verifiedEvidence.forEach((entry) => {
      verifiedDcIdSet.add(entry.dataComponentId.toLowerCase());
      if (entry.dataComponentName) verifiedDcIdSet.add(entry.dataComponentName.toLowerCase());
    });

    const excludedByReason: Record<ScenarioDropReason, string[]> = {
      processVisibility: [],
      dataAtRest: [],
      userInteraction: [],
    };

    // Check if we have any strategy data — if not, use community-score fallback
    const hasAnyStrategies = Array.from(metrics.values()).some(m => m.strategyCount > 0);

    const scoredEntries = Array.from(metrics.entries())
      .map(([techniqueId, metric]) => {
        const normalizedTechniqueId = normalizeTechniqueId(techniqueId);
        const allTactics = resolveAllTactics(normalizedTechniqueId);
        const tactic = allTactics[0] || resolveTacticName(normalizedTechniqueId);
        let dropReasons = getScenarioDropReasons(normalizedTechniqueId, allTactics.length > 0 ? allTactics : [tactic], scenarioAnswers);
        if (dropReasons.length > 0 && scenarioOverrideTechniqueIds.has(normalizedTechniqueId)) {
          dropReasons = [];
        }
        dropReasons.forEach((reason) => excludedByReason[reason].push(techniqueId));

        const strategyNorm = metric.strategyCount / maxStrategyCount;
        const analyticNorm = metric.analyticCount / maxAnalyticCount;
        const dcNorm = metric.dataComponents.size / maxDataComponents;
        // Combine strategy/analytic/DC evidence with SSM/wizard coverage.
        // SSM score lets guided/validated product coverage contribute to ranking
        // even when community adapters found no direct rules for the technique.
        const hasStrategyEvidence = strategyNorm > 0 || analyticNorm > 0 || dcNorm > 0;
        const communityBase = hasAnyStrategies
          ? (0.4 * strategyNorm) + (0.3 * analyticNorm) + (0.3 * dcNorm)
          : (0.5 * analyticNorm) + (0.5 * dcNorm);
        const rawBase = hasStrategyEvidence
          ? Math.max(communityBase, metric.ssmScore * 0.8)
          : metric.ssmScore;

        // Mutable-field fidelity: 0.5–1.0 based on verified DC overlap (Spec §6.3)
        let fidelity = 1.0;
        if (metric.dataComponents.size > 0 && verifiedDcIdSet.size > 0) {
          let verifiedCount = 0;
          metric.dataComponents.forEach((dc) => { if (verifiedDcIdSet.has(dc)) verifiedCount++; });
          fidelity = 0.5 + 0.5 * (verifiedCount / metric.dataComponents.size);
        }

        const baseScore = rawBase * fidelity;
        // Use max tactic weight across all tactics for this technique
        const killWeight = allTactics.length > 0
          ? Math.max(...allTactics.map(getTacticWeight))
          : getTacticWeight(tactic);
        const dnaBoost = getScenarioBoostMultiplier(allTactics.length > 0 ? allTactics : [tactic], scenarioAnswers);
        const finalScore = baseScore * killWeight * dnaBoost;

        return {
          techniqueId,
          tactic,
          baseScore,
          killWeight,
          dnaBoost,
          finalScore,
          dropped: dropReasons,
        };
      });

    const ranked = [...scoredEntries]
      .filter((entry) => (scenarioFilterEnabled ? entry.dropped.length === 0 : true))
      .sort((a, b) => {
        if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
        return a.techniqueId.localeCompare(b.techniqueId);
      });

    const rankedTechniqueIds = ranked.map((entry) => entry.techniqueId);
    const limitedTechniqueIds = scenarioFilterEnabled && !scenarioShowAll
      ? rankedTechniqueIds.slice(0, Math.max(1, scenarioMaxTechniques))
      : rankedTechniqueIds;
    // If filtering drops everything, bypass to avoid a blank view
    const effectiveIds = scenarioFilterEnabled ? limitedTechniqueIds : rankedTechniqueIds;
    const allowedSet = new Set<string>(effectiveIds.length > 0 ? effectiveIds : rankedTechniqueIds);
    const rankByTechnique = new Map<string, number>();
    rankedTechniqueIds.forEach((id, index) => rankByTechnique.set(id, index));

    return {
      allowedSet,
      rankByTechnique,
      excludedByReason,
      totalCandidates: metrics.size,
      scoredEntries: [...scoredEntries].sort((a, b) => {
        if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
        return a.techniqueId.localeCompare(b.techniqueId);
      }),
    };
  }, [
    autoMapping.enrichedMapping?.techniqueIds,
    allPlatforms,
    autoMapping.enrichedMapping?.detectionStrategies,
    coverageData?.coverage,
    resolveTacticName,
    resolveAllTactics,
    scenarioAnswers,
    scenarioFilterEnabled,
    verifiedEvidence,
    scenarioMaxTechniques,
    scenarioOverrideTechniqueIds,
    scenarioShowAll,
    ssmCapabilities,
    ssmVisibilityCoverage,
    strategies,
    stixTechniqueIds,
    visibilityCoverageData?.coverage,
  ]);

  const scenarioExcludedCounts = useMemo(() => ({
    processVisibility: scenarioTechniqueInsights.excludedByReason.processVisibility.length,
    dataAtRest: scenarioTechniqueInsights.excludedByReason.dataAtRest.length,
    userInteraction: scenarioTechniqueInsights.excludedByReason.userInteraction.length,
  }), [scenarioTechniqueInsights.excludedByReason]);

  const totalScenarioExcluded = useMemo(() => {
    const all = new Set<string>();
    Object.values(scenarioTechniqueInsights.excludedByReason).forEach((list) =>
      list.forEach((id) => all.add(id))
    );
    return all.size;
  }, [scenarioTechniqueInsights.excludedByReason]);

  // Tactic diversity warning (Spec §9.4)
  const tacticDiversityWarning = useMemo(() => {
    if (!scenarioFilterEnabled) return null;
    const allowed = scenarioTechniqueInsights.allowedSet;
    if (allowed.size < 3) return null;
    const tacticCounts = new Map<string, number>();
    scenarioTechniqueInsights.scoredEntries.forEach((entry) => {
      if (!allowed.has(entry.techniqueId)) return;
      const tactic = entry.tactic || 'Unknown';
      tacticCounts.set(tactic, (tacticCounts.get(tactic) || 0) + 1);
    });
    let maxTactic = '';
    let maxCount = 0;
    tacticCounts.forEach((count, tactic) => {
      if (count > maxCount) { maxCount = count; maxTactic = tactic; }
    });
    if (maxCount / allowed.size > 0.6) {
      return `${Math.round(100 * maxCount / allowed.size)}% of visible techniques are in ${maxTactic}. Consider broadening tactic coverage.`;
    }
    return null;
  }, [scenarioFilterEnabled, scenarioTechniqueInsights.allowedSet, scenarioTechniqueInsights.scoredEntries]);

  const updateScenarioAnswer = (key: ScenarioQuestionKey, checked: boolean) => {
    setScenarioAnswers((prev) => ({ ...prev, [key]: checked }));
  };

  const toggleScenarioOverrideTechnique = (techniqueId: string) => {
    const normalized = normalizeTechniqueId(techniqueId);
    setScenarioOverrideTechniqueIds((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) {
        next.delete(normalized);
      } else {
        next.add(normalized);
      }
      return next;
    });
  };

  const clearScenarioOverrides = () => {
    setScenarioOverrideTechniqueIds(new Set());
  };

  const excludedTechniquesByReason = useMemo(() => {
    const result: Record<ScenarioDropReason, string[]> = {
      processVisibility: [...scenarioTechniqueInsights.excludedByReason.processVisibility].sort((a, b) => a.localeCompare(b)),
      dataAtRest: [...scenarioTechniqueInsights.excludedByReason.dataAtRest].sort((a, b) => a.localeCompare(b)),
      userInteraction: [...scenarioTechniqueInsights.excludedByReason.userInteraction].sort((a, b) => a.localeCompare(b)),
    };
    return result;
  }, [scenarioTechniqueInsights.excludedByReason]);

  const filteredVerifiedEvidence = useMemo(() => {
    if (!hasDataComponentFilter) return verifiedEvidence;
    return verifiedEvidence.filter((entry) => {
      const idMatch = selectedDataComponentFilter.has(entry.dataComponentId.toLowerCase());
      const nameMatch = entry.dataComponentName
        ? selectedDataComponentFilter.has(entry.dataComponentName.toLowerCase())
        : false;
      return idMatch || nameMatch;
    });
  }, [verifiedEvidence, hasDataComponentFilter, selectedDataComponentFilter]);

  const focusTechnique = (techniqueId: string, tacticHint?: string) => {
    const tacticValue = tacticHint || resolveTacticName(techniqueId);
    if (!tacticValue || tacticValue === 'Unknown') return;
    const tactic = tacticValue.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const element = document.getElementById(`ctid-tactic-${tactic}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      setExpandedTactics(prev => new Set(prev).add(`ctid-tactic-${tactic}`));
      setExpandedTechniques(prev => new Set(prev).add(`ctid-tech-${techniqueId}`));
    }
  };

  const filteredStrategies = useMemo(() => {
    if (!scenarioFilterEnabled && !hasTechniqueFilter && !hasDataComponentFilter && !hasVendorScopedAnalytics) {
      return strategies;
    }
    return strategies
      .map((strategy) => {
        const strategyTechniques = Array.isArray(strategy.techniques) ? strategy.techniques : [];
        const strategyAnalytics = Array.isArray(strategy.analytics) ? strategy.analytics : [];
        const vendorScopedAnalytics = hasVendorScopedAnalytics
          ? strategyAnalytics.filter((analytic) => (
              Array.isArray(analytic.dataComponents)
                && analytic.dataComponents.some((dcId) =>
                  vendorSupportedDataComponentSet.has(normalizeDataComponentId(dcId))
                )
            ))
          : strategyAnalytics;
        const scenarioTechniques = scenarioFilterEnabled
          ? strategyTechniques.filter((techId) => scenarioTechniqueInsights.allowedSet.has(normalizeTechniqueId(techId)))
          : strategyTechniques;
        const filteredTechniques = hasTechniqueFilter
          ? scenarioTechniques.filter((techId) => selectedTechniqueFilter.has(normalizeTechniqueId(techId)))
          : scenarioTechniques;
        const selectedTechniqueDcSet = new Set<string>();
        if (hasTechniqueFilter) {
          filteredTechniques.forEach((techId) => {
            const dcSet = mappedDataComponentsByTechnique.get(normalizeTechniqueId(techId));
            if (!dcSet) return;
            dcSet.forEach((dcId) => selectedTechniqueDcSet.add(dcId));
          });
        }

        let filteredAnalytics = vendorScopedAnalytics;
        if (hasTechniqueFilter) {
          if (selectedTechniqueDcSet.size === 0) {
            filteredAnalytics = [];
          } else {
            filteredAnalytics = filteredAnalytics.filter((analytic) => (
              Array.isArray(analytic.dataComponents)
              && analytic.dataComponents.some((dcId) => selectedTechniqueDcSet.has(normalizeDataComponentId(dcId)))
            ));
          }
        }
        if (hasDataComponentFilter) {
          filteredAnalytics = filteredAnalytics.filter((analytic) => (
            Array.isArray(analytic.dataComponents)
              && analytic.dataComponents.some((dcId) => selectedDataComponentFilter.has(normalizeDataComponentId(dcId)))
          ));
        }
        if (scenarioFilterEnabled && filteredTechniques.length === 0) return null;
        if (hasTechniqueFilter && filteredTechniques.length === 0) return null;
        if (hasDataComponentFilter && filteredAnalytics.length === 0) return null;
        if (hasVendorScopedAnalytics && filteredAnalytics.length === 0) return null;
        // Cross-dimensional: drop if both dimensions are empty after filtering
        if (filteredTechniques.length === 0 && filteredAnalytics.length === 0) return null;
        return { ...strategy, techniques: filteredTechniques, analytics: filteredAnalytics };
      })
      .filter(Boolean) as DetectionStrategy[];
  }, [
    hasDataComponentFilter,
    hasTechniqueFilter,
    hasVendorScopedAnalytics,
    mappedDataComponentsByTechnique,
    scenarioFilterEnabled,
    scenarioTechniqueInsights.allowedSet,
    selectedDataComponentFilter,
    selectedTechniqueFilter,
    strategies,
    vendorSupportedDataComponentSet,
  ]);

  const totalAnalytics = useMemo(() => {
    return filteredStrategies.reduce((sum, s) => sum + s.analytics.length, 0);
  }, [filteredStrategies]);
  
  const techniqueSources = useMemo(() => {
    const raw = autoMapping.enrichedMapping?.techniqueSources || {};
    const normalized: Record<string, ResourceType[]> = {};
    Object.entries(raw).forEach(([id, sources]) => {
      normalized[id.toUpperCase()] = sources;
    });
    return normalized;
  }, [autoMapping.enrichedMapping?.techniqueSources]);

  const communitySources = useMemo(() => {
    const sources = new Set<ResourceType>();
    vendorMatchedCommunityAnalytics.forEach(ca => {
      const source = getCommunitySource(ca);
      if (source) sources.add(source);
    });
    return Array.from(sources);
  }, [vendorMatchedCommunityAnalytics, getCommunitySource]);

  const availableSources = useMemo(() => {
    const sources = new Set<ResourceType>();
    Object.values(techniqueSources).forEach(srcList => {
      srcList.forEach(src => sources.add(src));
    });

    communitySources.forEach(src => sources.add(src));

    return Array.from(sources).filter(s => s !== 'mitre_stix') as ResourceType[];
  }, [techniqueSources, communitySources]);

  const communityRuleTechniqueCount = useMemo(() => {
    const communitySet = new Set<ResourceType>(['sigma', 'splunk', 'elastic', 'azure']);
    return Object.values(techniqueSources).reduce((count, sources) => {
      return sources.some(source => communitySet.has(source)) ? count + 1 : count;
    }, 0);
  }, [techniqueSources]);

  const techniqueNameIndex = useMemo(() => {
    const map = new Map<string, string>();
    techniques.forEach(tech => map.set(tech.id.toUpperCase(), tech.name));
    if (autoMapping.enrichedMapping?.techniqueNames) {
      Object.entries(autoMapping.enrichedMapping.techniqueNames).forEach(([id, name]) => {
        if (name) map.set(id.toUpperCase(), name);
      });
    }
    ssmTechniqueNames.forEach((name, id) => {
      if (name) map.set(id.toUpperCase(), name);
    });
    return map;
  }, [autoMapping.enrichedMapping?.techniqueNames, ssmTechniqueNames]);

  const getTechniqueName = useMemo(() => {
    return (techniqueId: string) => {
      const normalized = normalizeTechniqueId(techniqueId);
      return techniqueNameIndex.get(normalized) || techniqueId;
    };
  }, [techniqueNameIndex]);

  const getTechniqueTactic = useMemo(() => {
    return (techniqueId: string) => {
      return resolveTacticName(techniqueId);
    };
  }, [resolveTacticName]);

  const detectionTechniques = useMemo(() => {
    const coverageRows = coverageData?.coverage || [];
    if (coverageRows.length > 0) {
      return coverageRows.map((row) => ({
        id: row.techniqueId,
        name: row.techniqueName,
        tactic: resolveTacticName(row.techniqueId, row.tactics),
        description: resolveTechniqueDescription(row.techniqueId, row.techniqueDescription),
        usedByGroups: [],
        detectionStrategies: []
      })).sort((a, b) => {
        const parseId = (id: string) => {
          const cleanId = id.toUpperCase().replace('T', '');
          const [main, sub] = cleanId.split('.').map(part => parseInt(part, 10));
          return { main: isNaN(main) ? 0 : main, sub: isNaN(sub) ? 0 : sub };
        };

        const parsedA = parseId(a.id);
        const parsedB = parseId(b.id);

        if (parsedB.main !== parsedA.main) {
          return parsedB.main - parsedA.main;
        }

        return parsedB.sub - parsedA.sub;
      });
    }

    const fallbackIds = new Set<string>();
    Object.entries(ssmCoverage)
      .filter(([, status]) => status === 'partial' || status === 'significant')
      .forEach(([techId]) => fallbackIds.add(techId.toUpperCase()));
    
    if (autoMapping.enrichedMapping?.detectTechniqueIds) {
      autoMapping.enrichedMapping.detectTechniqueIds.forEach(id => fallbackIds.add(id.toUpperCase()));
    }

    return Array.from(fallbackIds).map(id => ({
      id,
      name: getTechniqueName(id),
      tactic: resolveTacticName(id),
      description: resolveTechniqueDescription(id),
      usedByGroups: [],
      detectionStrategies: []
    })).sort((a, b) => a.id.localeCompare(b.id));
  }, [coverageData?.coverage, ssmCoverage, autoMapping.enrichedMapping?.detectTechniqueIds, getTechniqueName, resolveTacticName, resolveTechniqueDescription]);

  const visibilityTechniques = useMemo(() => {
    const coverageRows = visibilityCoverageData?.coverage || [];
    if (coverageRows.length > 0) {
      return coverageRows.map((row) => ({
        id: row.techniqueId,
        name: row.techniqueName,
        tactic: resolveTacticName(row.techniqueId, row.tactics),
        description: resolveTechniqueDescription(row.techniqueId, row.techniqueDescription),
        usedByGroups: [],
        detectionStrategies: []
      }));
    }

    const fallbackIds = new Set<string>();
    Object.keys(ssmVisibilityCoverage).forEach(id => fallbackIds.add(id.toUpperCase()));
    if (autoMapping.enrichedMapping?.visibilityTechniqueIds) {
      autoMapping.enrichedMapping.visibilityTechniqueIds.forEach(id => fallbackIds.add(id.toUpperCase()));
    }
    if (autoMapping.enrichedMapping?.detectTechniqueIds) {
      autoMapping.enrichedMapping.detectTechniqueIds.forEach(id => fallbackIds.add(id.toUpperCase()));
    }

    return Array.from(fallbackIds).map(id => ({
      id,
      name: getTechniqueName(id),
      tactic: getTechniqueTactic(id),
      description: resolveTechniqueDescription(id),
      usedByGroups: [],
      detectionStrategies: []
    })).sort((a, b) => a.id.localeCompare(b.id));
  }, [visibilityCoverageData?.coverage, ssmVisibilityCoverage, autoMapping.enrichedMapping?.visibilityTechniqueIds, autoMapping.enrichedMapping?.detectTechniqueIds, getTechniqueName, getTechniqueTactic, resolveTechniqueDescription, resolveTacticName]);

  const visibleTechniqueChips = useMemo(() => {
    let filtered = visibilityTechniques;
    if (scenarioFilterEnabled) {
      filtered = filtered.filter((tech) => scenarioTechniqueInsights.allowedSet.has(normalizeTechniqueId(tech.id)));
    }
    if (!scenarioFilterEnabled) {
      return filtered;
    }
    return [...filtered].sort((a, b) => {
      const aRank = scenarioTechniqueInsights.rankByTechnique.get(normalizeTechniqueId(a.id));
      const bRank = scenarioTechniqueInsights.rankByTechnique.get(normalizeTechniqueId(b.id));
      if (aRank !== undefined && bRank !== undefined && aRank !== bRank) return aRank - bRank;
      if (aRank !== undefined && bRank === undefined) return -1;
      if (aRank === undefined && bRank !== undefined) return 1;
      return a.id.localeCompare(b.id);
    });
  }, [
    scenarioFilterEnabled,
    scenarioTechniqueInsights.allowedSet,
    scenarioTechniqueInsights.rankByTechnique,
    visibilityTechniques,
  ]);

  const mappedTechniqueStats = useMemo(() => {
    const mappedIds = new Set<string>();
    if (scenarioFilterEnabled) {
      scenarioTechniqueInsights.allowedSet.forEach((id) => mappedIds.add(id));
    } else if (stixTechniqueIds.length > 0) {
      stixTechniqueIds.forEach(id => mappedIds.add(id));
    } else if (visibilityTechniques.length > 0) {
      visibilityTechniques.forEach(tech => mappedIds.add(tech.id));
    } else if (detectionTechniques.length > 0) {
      detectionTechniques.forEach(tech => mappedIds.add(tech.id));
    } else {
      Object.keys(techniqueSources).forEach(id => mappedIds.add(id));
    }

    const communitySet = new Set<ResourceType>(['sigma', 'splunk', 'elastic', 'azure']);
    let withCommunity = 0;
    mappedIds.forEach(id => {
      const sources = techniqueSources[id] || [];
      if (sources.some(source => communitySet.has(source))) {
        withCommunity += 1;
      }
    });

    return { total: mappedIds.size, withCommunity };
  }, [
    detectionTechniques,
    scenarioFilterEnabled,
    scenarioTechniqueInsights.allowedSet,
    stixTechniqueIds,
    techniqueSources,
    visibilityTechniques,
  ]);

  const getSourcesForStrategy = useMemo(() => {
    return (strategy: { techniques: string[] }): ResourceType[] => {
      const sources = new Set<ResourceType>();
      strategy.techniques.forEach(techId => {
        const techSources = techniqueSources[techId] || [];
        techSources.forEach(src => {
          if (src !== 'mitre_stix') sources.add(src);
        });
      });
      if (sources.size > 0) {
        return Array.from(sources);
      }
      return communitySources.length > 0 ? communitySources : availableSources;
    };
  }, [techniqueSources, communitySources, availableSources]);

  const filteredCommunityStrategies = useMemo(() => {
    if (!autoMapping.enrichedMapping?.detectionStrategies) return [];
    const vendorMatchedTechniqueSet = new Set<string>();
    vendorMatchedCommunityAnalytics.forEach((analytic) => {
      (analytic.techniqueIds || []).forEach((techniqueId) => {
        vendorMatchedTechniqueSet.add(normalizeTechniqueId(techniqueId));
      });
    });
    if (vendorMatchedTechniqueSet.size === 0) return [];

    return autoMapping.enrichedMapping.detectionStrategies
      .map(strategy => {
        const platformScopedAnalytics = strategy.analytics.filter(a =>
          platformMatchesAny(a.platforms, allPlatforms)
        );
        const scenarioScopedTechniques = scenarioFilterEnabled
          ? strategy.techniques.filter((techId) => scenarioTechniqueInsights.allowedSet.has(normalizeTechniqueId(techId)))
          : strategy.techniques;
        const productMatchedTechniques = scenarioScopedTechniques.filter((techId) =>
          vendorMatchedTechniqueSet.has(normalizeTechniqueId(techId))
        );
        const filteredTechniques = hasTechniqueFilter
          ? productMatchedTechniques.filter((techId) => selectedTechniqueFilter.has(normalizeTechniqueId(techId)))
          : productMatchedTechniques;

        let filteredAnalytics = platformScopedAnalytics;
        if (hasDataComponentFilter) {
          filteredAnalytics = filteredAnalytics.filter((analytic) => (
            Array.isArray(analytic.dataComponents)
              && analytic.dataComponents.some((dcId) => selectedDataComponentFilter.has(normalizeDataComponentId(dcId)))
          ));
        }
        return {
          ...strategy,
          techniques: filteredTechniques,
          analytics: filteredAnalytics,
        };
      })
      .filter(s => {
        if (scenarioFilterEnabled && s.techniques.length === 0) return false;
        if (hasTechniqueFilter && s.techniques.length === 0) return false;
        if (hasDataComponentFilter && s.analytics.length === 0) return false;
        const strategyCommunityAnalytics = vendorMatchedCommunityAnalytics.filter((analytic) =>
          hasTechniqueOverlap(analytic.techniqueIds, s.techniques)
        );
        if (strategyCommunityAnalytics.length === 0) return false;
        const strategySources = Array.from(new Set(
          strategyCommunityAnalytics
            .map((analytic) => getCommunitySource(analytic))
            .filter((source): source is ResourceType => Boolean(source))
        ));
        if (strategySources.length === 0) return true;
        return strategySources.some(src => sourceFilters.has(src));
      });
  }, [
    autoMapping.enrichedMapping?.detectionStrategies,
    allPlatforms,
    sourceFilters,
    getCommunitySource,
    hasTechniqueFilter,
    hasDataComponentFilter,
    scenarioFilterEnabled,
    scenarioTechniqueInsights.allowedSet,
    selectedTechniqueFilter,
    selectedDataComponentFilter,
    hasTechniqueOverlap,
    vendorMatchedCommunityAnalytics,
  ]);

  const tacticCandidateIds = useMemo(() => {
    const ids = new Set<string>();
    const add = (id?: string) => {
      if (!id) return;
      const normalized = normalizeTechniqueId(id);
      if (!/^T\d{4}(?:\.\d{3})?$/.test(normalized)) return;
      ids.add(normalized);
    };

    detectionTechniques.forEach((tech) => add(tech.id));
    visibilityTechniques.forEach((tech) => add(tech.id));
    filteredStrategies.forEach((strategy) => strategy.techniques.forEach(add));
    filteredCommunityStrategies.forEach((strategy) => strategy.techniques.forEach(add));
    autoMapping.enrichedMapping?.techniqueIds?.forEach(add);

    return Array.from(ids);
  }, [
    detectionTechniques,
    visibilityTechniques,
    filteredStrategies,
    filteredCommunityStrategies,
    autoMapping.enrichedMapping?.techniqueIds,
  ]);

  const missingTacticIds = useMemo(() => {
    const missing: string[] = [];
    const hasKnownTactic = (id: string) => {
      const direct = coverageTacticMap.get(id)
        || getPrimaryTactic(techniqueIndex.get(id))
        || techniqueTacticMap.get(id)
        || remoteTacticMap.get(id)?.[0];
      if (direct) return true;
      if (!id.includes('.')) return false;
      const parentId = id.split('.')[0];
      return Boolean(
        coverageTacticMap.get(parentId)
          || getPrimaryTactic(techniqueIndex.get(parentId))
          || techniqueTacticMap.get(parentId)
          || remoteTacticMap.get(parentId)?.[0]
      );
    };

    tacticCandidateIds.forEach((id) => {
      if (!remoteTacticMap.has(id) && !hasKnownTactic(id)) {
        missing.push(id);
      }
    });

    return missing;
  }, [coverageTacticMap, techniqueIndex, techniqueTacticMap, remoteTacticMap, tacticCandidateIds]);

  useEffect(() => {
    if (missingTacticIds.length === 0) return;
    const pending = missingTacticIds.filter(id => !pendingTacticRequests.current.has(id));
    if (pending.length === 0) return;
    pending.forEach(id => pendingTacticRequests.current.add(id));

    let cancelled = false;
    const loadTactics = async () => {
      try {
        const res = await fetch("/api/mitre-stix/techniques/tactics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ techniqueIds: pending }),
        });
        if (!res.ok) throw new Error("Failed to fetch tactics");
        const payload = await res.json();
        if (cancelled || !payload?.tacticsByTechnique) return;
        setRemoteTacticMap((prev) => {
          const next = new Map(prev);
          Object.entries(payload.tacticsByTechnique).forEach(([id, tactics]) => {
            if (Array.isArray(tactics) && tactics.length > 0) {
              next.set(normalizeTechniqueId(id), tactics);
            }
          });
          return next;
        });
      } catch {
        pending.forEach(id => pendingTacticRequests.current.delete(id));
      }
    };

    loadTactics();
    return () => {
      cancelled = true;
    };
  }, [missingTacticIds]);

  const communityStrategiesCount = useMemo(() => {
    return filteredCommunityStrategies.length;
  }, [filteredCommunityStrategies]);

  const communityAnalyticsCount = useMemo(() => {
    return filteredCommunityStrategies.reduce(
      (sum, s) => sum + s.analytics.length, 0
    );
  }, [filteredCommunityStrategies]);

  const communityMappingSummary = useMemo(() => {
    return vendorMatchedCommunityAnalytics.reduce((summary, analytic) => {
      const kind = analytic.coverageKind || 'candidate';
      if (kind === 'detect') summary.detect += 1;
      else if (kind === 'visibility') summary.visibility += 1;
      else summary.candidate += 1;
      return summary;
    }, { detect: 0, visibility: 0, candidate: 0 });
  }, [vendorMatchedCommunityAnalytics]);

  const detectionCoverageScore = useMemo(() => {
    const totalTechniques = mitreStats?.techniques || techniques.length || 1;
    const score = Math.round((detectionTechniques.length / totalTechniques) * 100);
    return Math.min(100, Math.max(0, score));
  }, [detectionTechniques.length, mitreStats?.techniques]);

  const overviewTechniqueCount = useMemo(() => {
    return visibleTechniqueChips.length;
  }, [visibleTechniqueChips.length]);

  const visibilityCoverageScore = useMemo(() => {
    const totalTechniques = mitreStats?.techniques || techniques.length || 1;
    const score = Math.round((visibilityTechniques.length / totalTechniques) * 100);
    return Math.min(100, Math.max(0, score));
  }, [visibilityTechniques.length, mitreStats?.techniques]);

  const ssmCounts = useMemo(() => {
    const counts = { significant: 0, partial: 0, minimal: 0 };
    Object.values(ssmCoverage).forEach((status) => {
      if (status === 'significant') counts.significant += 1;
      if (status === 'partial') counts.partial += 1;
      if (status === 'minimal') counts.minimal += 1;
    });
    return counts;
  }, [ssmCoverage]);

  const toggleStrategy = (id: string) => {
    setExpandedStrategies(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAnalytic = (id: string) => {
    setExpandedAnalytics(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTactic = (id: string) => {
    setExpandedTactics(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTechnique = (id: string) => {
    setExpandedTechniques(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSubtechnique = (id: string) => {
    setExpandedSubtechniques(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildAttackTree = useMemo(() => {
    return <T extends { id: string; name: string; description: string; techniques: string[]; analytics: AnalyticItem[] | StixAnalytic[] }>(
      strategiesToRender: T[]
    ) => {
      const tacticMap = new Map<string, Map<string, {
        id: string;
        name: string;
        description?: string;
        strategies: Map<string, T>;
        subtechniques: Map<string, { id: string; name: string; description?: string; strategies: Map<string, T> }>;
      }>>();

      strategiesToRender.forEach((strategy) => {
        const techniquesList = (strategy.techniques || []).filter(Boolean);
        if (techniquesList.length === 0) return;
        techniquesList.forEach((techIdRaw) => {
          const techId = normalizeTechniqueId(techIdRaw);
          const isSubtechnique = techId.includes('.');
          const parentId = isSubtechnique ? techId.split('.')[0] : techId;
          const tactic = getTechniqueTactic(techId);
          const parentName = getTechniqueName(parentId);
          const techName = getTechniqueName(techId);

          if (!tacticMap.has(tactic)) {
            tacticMap.set(tactic, new Map());
          }
          const techniqueMap = tacticMap.get(tactic)!;
          if (!techniqueMap.has(parentId)) {
            techniqueMap.set(parentId, {
              id: parentId,
              name: parentName,
              description: resolveTechniqueDescription(parentId),
              strategies: new Map(),
              subtechniques: new Map(),
            });
          }
          const parentNode = techniqueMap.get(parentId)!;

          if (isSubtechnique) {
            if (!parentNode.subtechniques.has(techId)) {
              parentNode.subtechniques.set(techId, {
                id: techId,
                name: techName,
                description: resolveTechniqueDescription(techId),
                strategies: new Map(),
              });
            }
            parentNode.subtechniques.get(techId)!.strategies.set(strategy.id, strategy);
          } else {
            parentNode.strategies.set(strategy.id, strategy);
          }
        });
      });

      const tacticNodes = Array.from(tacticMap.entries()).map(([tacticName, techniqueMap]) => {
        const techniqueNodes = Array.from(techniqueMap.values()).map(node => ({
          id: node.id,
          name: node.name,
          description: node.description,
          strategies: Array.from(node.strategies.values()),
          subtechniques: Array.from(node.subtechniques.values()).map(sub => ({
            id: sub.id,
            name: sub.name,
            description: sub.description,
            strategies: Array.from(sub.strategies.values()),
          })),
        })).sort((a, b) => a.id.localeCompare(b.id));

        return {
          name: tacticName,
          techniques: techniqueNodes,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      return tacticNodes;
    };
  }, [getTechniqueTactic, getTechniqueName, resolveTechniqueDescription]);

  const scopeStrategiesToTechnique = useMemo(() => {
    return <T extends {
      id: string;
      name: string;
      description: string;
      techniques: string[];
      analytics: AnalyticItem[] | StixAnalytic[];
    }>(
      strategiesToScope: T[],
      techniqueId?: string,
      options?: { enforceDcScope?: boolean }
    ): T[] => {
      if (!techniqueId) return strategiesToScope;
      const enforceDcScope = options?.enforceDcScope !== false;
      const normalizedTechniqueId = normalizeTechniqueId(techniqueId);
      const parentTechniqueId = normalizedTechniqueId.includes('.')
        ? normalizedTechniqueId.split('.')[0]
        : normalizedTechniqueId;

      const mappedDcSet = mappedDataComponentsByTechnique.get(normalizedTechniqueId)
        || mappedDataComponentsByTechnique.get(parentTechniqueId)
        || new Set<string>();

      return strategiesToScope
        .map((strategy) => {
          const scopedTechniques = (strategy.techniques || []).filter((techId) => {
            const normalized = normalizeTechniqueId(techId);
            if (normalized === normalizedTechniqueId) return true;
            if (normalizedTechniqueId.includes('.') && normalized === parentTechniqueId) return true;
            return false;
          });
          if (scopedTechniques.length === 0) return null;

          let scopedAnalytics = Array.isArray(strategy.analytics) ? strategy.analytics : [];
          if (enforceDcScope) {
            if (mappedDcSet.size === 0) {
              scopedAnalytics = [];
            } else {
              scopedAnalytics = scopedAnalytics.filter((analytic) => (
                Array.isArray(analytic.dataComponents)
                  && analytic.dataComponents.some((dcId) => mappedDcSet.has(normalizeDataComponentId(dcId)))
              ));
            }
          }

          return {
            ...strategy,
            techniques: scopedTechniques,
            analytics: scopedAnalytics,
          };
        })
        .filter(Boolean) as T[];
    };
  }, [mappedDataComponentsByTechnique]);

  const renderStrategyList = (
    strategiesToRender: Array<{ id: string; name: string; description: string; techniques: string[]; analytics: AnalyticItem[] | StixAnalytic[] }>,
    sectionKey: string,
    scopedTechniqueId?: string
  ) => {
    const scopedStrategies = scopeStrategiesToTechnique(strategiesToRender, scopedTechniqueId, { enforceDcScope: true });
    return (
      <div className="space-y-3">
      {scopedStrategies.map((strategy) => {
        const strategyKey = `${sectionKey}-strategy-${strategy.id}`;
        const isStrategyExpanded = expandedStrategies.has(strategyKey);
        return (
          <div key={strategyKey} className="rounded-lg overflow-hidden bg-card">
            <button
              onClick={() => toggleStrategy(strategyKey)}
              className="w-full px-4 py-4 text-left flex items-center gap-4 hover:bg-muted/50 transition-colors"
              data-testid={`button-expand-strategy-${strategyKey}`}
            >
              <ChevronRight className={cn(
                "w-5 h-5 text-muted-foreground transition-transform flex-shrink-0",
                isStrategyExpanded && "rotate-90"
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-xs text-primary font-mono">{strategy.id}</code>
                  <span className="font-semibold text-foreground">{strategy.name}</span>
                </div>
              </div>
              {!isStrategyExpanded && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="secondary" className="text-xs">
                    {strategy.analytics.length} Analytics
                  </Badge>
                </div>
              )}
            </button>

            {isStrategyExpanded && (
              <div>
                <div className="px-6 py-4 bg-muted/20">
                  <p className="text-sm text-muted-foreground mb-4">{strategy.description}</p>

                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    Analytics ({strategy.analytics.length})
                  </h4>

                  <div className="space-y-3">
                    {strategy.analytics.map((analytic) => {
                      const analyticKey = `${sectionKey}-analytic-${analytic.id}`;
                      const isAnalyticExpanded = expandedAnalytics.has(analyticKey);
                      const analyticPlatforms = normalizePlatformList(
                        Array.isArray((analytic as { platforms?: string[] }).platforms)
                          ? ((analytic as { platforms?: string[] }).platforms || [])
                          : []
                      );
                      const strategyMetadata = getMetadataForTechniques(strategy.techniques);
                      const overrideLogSources = getLogSourcesFromMetadata(strategyMetadata);
                      const overrideMutableElements = getMutableElementsFromMetadata(strategyMetadata);
                      const metadataQuery = getQueryFromMetadata(strategyMetadata);
                      const analyticDcIds = resolveAnalyticDataComponents(analytic, strategyMetadata);
                      const logSources = overrideLogSources.length > 0
                        ? mergeVendorLogSources(overrideLogSources, analyticDcIds)
                        : (isStixAnalytic(analytic)
                          ? (() => {
                              const stixRows = getLogSourcesForStixAnalytic(analytic);
                              if (stixRows.length > 0) return stixRows;
                              return mergeVendorLogSources([], analyticDcIds);
                            })()
                          : getLogSourcesForAnalytic(analytic));
                      const enablementNotes = getEnablementNotes(analyticDcIds, logSources);
                      const mutableElementsFromAnalytic = overrideMutableElements.length > 0
                        ? overrideMutableElements
                        : (isStixAnalytic(analytic)
                          ? getMutableElementsForStixAnalytic(analytic)
                          : getMutableElementsForAnalytic(analytic));
                      const mutableElements = mutableElementsFromAnalytic.length > 0
                        ? mutableElementsFromAnalytic
                        : getMutableElementsForCommunityAnalytic(
                            {
                              id: analytic.id,
                              name: analytic.name,
                              description: analytic.description,
                              dataComponents: analyticDcIds,
                              platforms: Array.isArray((analytic as StixAnalytic).platforms)
                                ? (analytic as StixAnalytic).platforms
                                : [],
                            } as AnalyticItem,
                            ssmStixMapping?.dataComponents || []
                          );
                      const showMutableValues = mutableElements.some((element) =>
                        typeof element.value === 'string' && element.value.trim().length > 0
                      );

                      return (
                        <div key={analyticKey} className="rounded-md overflow-hidden bg-background">
                          <button
                            onClick={() => toggleAnalytic(analyticKey)}
                            className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-muted/30 transition-colors"
                            data-testid={`button-expand-analytic-${analyticKey}`}
                          >
                            <ChevronRight className={cn(
                              "w-4 h-4 text-muted-foreground transition-transform flex-shrink-0",
                              isAnalyticExpanded && "rotate-90"
                            )} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <code className="text-xs text-primary font-mono">{analytic.id}</code>
                                <span className="font-medium text-foreground">{analytic.name}</span>
                              </div>
                              {analyticPlatforms.length > 0 && (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  {analyticPlatforms.map((platformValue) => (
                                    <Badge
                                      key={`${analytic.id}-platform-${platformValue}`}
                                      variant="outline"
                                      className="text-[10px] flex items-center gap-1"
                                    >
                                      {getPlatformIcon(platformValue)}
                                      <span>{getPlatformDisplayName(platformValue)}</span>
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </button>

                          {isAnalyticExpanded && (
                            <div className="px-4 pb-4 pt-2 space-y-5">
                              <div>
                                <h5 className="text-sm font-medium text-muted-foreground mb-2">Description</h5>
                                <p className="text-sm text-foreground">
                                  {getFirstSentence(analytic.description)}
                                </p>
                              </div>

                              {strategy.techniques.length > 0 && (
                                <div>
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">Techniques</h5>
                                  <div className="flex flex-wrap gap-2">
                                    {strategy.techniques.map(techId => {
                                      const mappingIds = ssmMappingIdsByTechnique.get(techId) || [];
                                      const techName = ssmTechniqueNames.get(techId.toUpperCase()) || techId;
                                      const techniqueDescription = resolveTechniqueDescription(techId);
                                      return (
                                        <div key={techId} className="flex flex-col gap-1">
                                          <div className="flex items-center gap-2">
                                            <a
                                              href={`https://attack.mitre.org/techniques/${techId.replace('.', '/')}/`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              title={techniqueDescription || undefined}
                                            >
                                              <Badge variant="outline" className={`text-xs hover:bg-muted/70 transition-colors ${subjectIdPillClass('technique')}`}>
                                                <span className="mr-1">{techId}</span>
                                                <ExternalLink className="w-3 h-3 text-muted-foreground" />
                                              </Badge>
                                            </a>
                                            {mappingIds.length > 0 && (
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => openEvidenceDialog(techId, techName)}
                                                className="h-6 px-2 text-xs"
                                              >
                                                Edit Evidence
                                              </Button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              <div>
                                <h5 className="text-sm font-medium text-muted-foreground mb-2">Log Sources</h5>
                                {logSources.length > 0 ? (
                                  <div className="rounded-md overflow-hidden border border-border keep-border">
                                    <table className="w-full text-sm">
                                      <thead className="bg-muted/50">
                                        <tr>
                                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Data Component</th>
                                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Channel</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-border">
                                        {logSources.map((row, idx) => (
                                          <tr key={`${row.dataComponentId}-${idx}`}>
                                            <td className="px-3 py-2">
                                              <button
                                                onClick={() => {
                                                  const dc = (dataComponents as Record<string, any>)[row.dataComponentId];
                                                  if (dc) setSelectedDataComponent(dc);
                                                }}
                                                className="text-primary hover:underline text-left"
                                                data-testid={`button-view-dc-${row.dataComponentId}`}
                                              >
                                                {row.dataComponentName}
                                                <span className="text-muted-foreground ml-1">({row.dataComponentId})</span>
                                              </button>
                                            </td>
                                            <td className="px-3 py-2 font-mono text-foreground">{row.logSourceName}</td>
                                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{formatChannel(row.channel)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <div className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-muted-foreground">
                                    No log sources found for this analytic yet.
                                  </div>
                                )}
                                {enablementNotes.length > 0 && (
                                  <details className="mt-3 rounded-md bg-background/60 p-3 text-xs">
                                    <summary className="cursor-pointer font-medium text-muted-foreground select-none">
                                      Enablement notes
                                    </summary>
                                    <div className="mt-2 space-y-2 text-muted-foreground">
                                      {enablementNotes.map((entry) => (
                                        <div key={`${entry.dataComponentName}-${entry.logSourceName}-${entry.note}`}>
                                          <div className="font-semibold text-foreground">
                                            {entry.dataComponentName} — {entry.logSourceName}
                                          </div>
                                          <div>{entry.note}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </div>

                              <div>
                                <h5 className="text-sm font-medium text-muted-foreground mb-2">Mutable Elements</h5>
                                {mutableElements.length > 0 ? (
                                  <div className="rounded-md overflow-hidden border border-border keep-border">
                                    <table className="w-full text-sm">
                                      <thead className="bg-muted/50">
                                        <tr>
                                          <th className="text-left px-3 py-2 font-medium text-muted-foreground w-48">Field</th>
                                          {showMutableValues && (
                                            <th className="text-left px-3 py-2 font-medium text-muted-foreground w-40">Value</th>
                                          )}
                                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Description</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-border">
                                        {mutableElements.map(me => (
                                          <tr key={me.field}>
                                            <td className="px-3 py-2 font-mono text-primary">{me.field}</td>
                                            {showMutableValues && (
                                              <td className="px-3 py-2 font-mono text-foreground">
                                                {me.value ? me.value : <span className="text-muted-foreground">-</span>}
                                              </td>
                                            )}
                                            <td className="px-3 py-2 text-foreground">{me.description}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <div className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-muted-foreground">
                                    No mutable elements found for this analytic yet.
                                  </div>
                                )}
                              </div>

                              {metadataQuery && (
                                <div>
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">Analytic Logic</h5>
                                  <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto">
                                    <code className="font-mono text-foreground">{metadataQuery}</code>
                                  </pre>
                                </div>
                              )}

                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {scopedStrategies.length === 0 && (
        <div className="text-sm text-muted-foreground">
          No product-scoped analytics are mapped for this technique.
        </div>
      )}
    </div>
  );
  };

  const renderCommunityStrategyList = (
    strategiesToRender: Array<{ id: string; name: string; description: string; techniques: string[]; analytics: AnalyticItem[] | StixAnalytic[] }>,
    sectionKey: string,
    scopedTechniqueId?: string
  ) => {
    const scopedStrategies = scopeStrategiesToTechnique(strategiesToRender, scopedTechniqueId, { enforceDcScope: false });
    return (
      <div className="space-y-3">
      {scopedStrategies.map((strategy) => {
        const analytics = strategy.analytics as StixAnalytic[];
        const strategyKey = `${sectionKey}-strategy-${strategy.id}`;
        const isStrategyExpanded = expandedStrategies.has(strategyKey);
        const communityAnalytics = vendorMatchedCommunityAnalytics;
        const visibleCommunityAnalytics = communityAnalytics.filter(ca =>
          hasTechniqueOverlap(ca.techniqueIds, strategy.techniques)
        );
        const splunkAnalytics = visibleCommunityAnalytics.filter(ca => getCommunitySource(ca) === 'splunk');
        const sigmaAnalytics = visibleCommunityAnalytics.filter(ca => getCommunitySource(ca) === 'sigma');
        const elasticAnalytics = visibleCommunityAnalytics.filter(ca => getCommunitySource(ca) === 'elastic');
        const azureAnalytics = visibleCommunityAnalytics.filter(ca => getCommunitySource(ca) === 'azure');
        const ctidAnalytics = visibleCommunityAnalytics.filter(ca => getCommunitySource(ca) === 'ctid');
        const strategyCommunitySources = new Set<ResourceType>();
        communityAnalytics.forEach(ca => {
          const source = getCommunitySource(ca);
          if (!source) return;
          if (hasTechniqueOverlap(ca.techniqueIds, strategy.techniques)) {
            strategyCommunitySources.add(source);
          }
        });
        const strategySources = Array.from(new Set([
          ...getSourcesForStrategy(strategy),
          ...Array.from(strategyCommunitySources),
        ]));

        return (
          <div key={strategyKey} className="rounded-lg overflow-hidden bg-card">
            <button
              onClick={() => toggleStrategy(strategyKey)}
              className="w-full px-4 py-4 text-left flex items-center gap-4 hover:bg-muted/50 transition-colors"
              data-testid={`button-expand-community-strategy-${strategyKey}`}
            >
              <ChevronRight className={cn(
                "w-5 h-5 text-muted-foreground transition-transform flex-shrink-0",
                isStrategyExpanded && "rotate-90"
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-xs text-primary font-mono">{strategy.id}</code>
                  <span className="font-semibold text-foreground">{strategy.name}</span>
                </div>
              </div>
              {!isStrategyExpanded && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="secondary" className="text-xs">
                    {analytics.length} Analytics
                  </Badge>
                  {strategySources.map(source => (
                    <Badge
                      key={source}
                      className={cn(
                        "text-xs text-white",
                        source === 'sigma' && "bg-purple-600",
                        source === 'elastic' && "bg-orange-600",
                        source === 'splunk' && "bg-green-600",
                        source === 'azure' && "bg-sky-600",
                        source === 'ctid' && "bg-blue-600"
                      )}
                    >
                      {source === 'sigma' ? 'Sigma' : source === 'elastic' ? 'Elastic' : source === 'splunk' ? 'Splunk' : source === 'azure' ? 'Azure' : 'CTID'}
                    </Badge>
                  ))}
                </div>
              )}
            </button>

            {isStrategyExpanded && (
              <div>
                <div className="px-6 py-4 bg-muted/20">
                  <p className="text-sm text-muted-foreground mb-4">{strategy.description}</p>

                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    Analytics ({analytics.length})
                  </h4>

                  <div className="space-y-3">
                    {analytics.map((analytic) => {
                      const analyticKey = `${sectionKey}-analytic-${analytic.id}`;
                      const isAnalyticExpanded = expandedAnalytics.has(analyticKey);
                      const analyticPlatforms = normalizePlatformList(
                        Array.isArray((analytic as { platforms?: string[] }).platforms)
                          ? ((analytic as { platforms?: string[] }).platforms || [])
                          : []
                      );
                      const uniqueLogSources = isStixAnalytic(analytic)
                        ? getLogSourcesForStixAnalytic(analytic)
                        : getLogSourcesForAnalytic(analytic as AnalyticItem);
                      const analyticDcIds = Array.isArray((analytic as StixAnalytic).dataComponents)
                        ? (analytic as StixAnalytic).dataComponents
                        : Array.isArray((analytic as AnalyticItem).dataComponents)
                          ? (analytic as AnalyticItem).dataComponents
                          : [];
                      const enablementNotes = getEnablementNotes(analyticDcIds, uniqueLogSources);
                      const uniqueMutableElements = isStixAnalytic(analytic)
                        ? getMutableElementsForStixAnalytic(analytic)
                        : getMutableElementsForAnalytic(analytic as AnalyticItem);
                      const combinedMutableElements = (() => {
                        const combined = new Map<string, MutableElementRow>();
                        uniqueMutableElements.forEach((element) => {
                          combined.set(element.field.toLowerCase(), element);
                        });
                        const communityElements = [
                          ...getCommunityMutableElements(splunkAnalytics, 'Splunk'),
                          ...getCommunityMutableElements(sigmaAnalytics, 'Sigma'),
                          ...getCommunityMutableElements(elasticAnalytics, 'Elastic'),
                          ...getCommunityMutableElements(azureAnalytics, 'Azure'),
                          ...getCommunityMutableElements(ctidAnalytics, 'CTID'),
                        ];
                        communityElements.forEach((element) => {
                          const key = element.field.toLowerCase();
                          if (!combined.has(key)) {
                            combined.set(key, element);
                          }
                        });
                        return Array.from(combined.values());
                      })();
                      const hasMitreEnrichment = uniqueLogSources.length > 0 || uniqueMutableElements.length > 0;
                      const hasSplunkData = splunkAnalytics.length > 0;
                      const hasElasticData = elasticAnalytics.length > 0;
                      const hasAzureData = azureAnalytics.length > 0;
                      const hasSigmaData = sigmaAnalytics.length > 0;
                      const hasCtidData = ctidAnalytics.length > 0;

                      return (
                        <div key={analyticKey} className="rounded-md overflow-hidden bg-background">
                          <button
                            onClick={() => toggleAnalytic(analyticKey)}
                            className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-muted/30 transition-colors"
                            data-testid={`button-expand-community-analytic-${analyticKey}`}
                          >
                            <ChevronRight className={cn(
                              "w-4 h-4 text-muted-foreground transition-transform flex-shrink-0",
                              isAnalyticExpanded && "rotate-90"
                            )} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <code className="text-xs text-primary font-mono">{analytic.id}</code>
                                <span className="font-medium text-foreground">{analytic.name}</span>
                              </div>
                              {analyticPlatforms.length > 0 && (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  {analyticPlatforms.map((platformValue) => (
                                    <Badge
                                      key={`${analytic.id}-community-platform-${platformValue}`}
                                      variant="outline"
                                      className="text-[10px] flex items-center gap-1"
                                    >
                                      {getPlatformIcon(platformValue)}
                                      <span>{getPlatformDisplayName(platformValue)}</span>
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {hasMitreEnrichment && (
                                <Badge className="text-xs bg-blue-600 text-white">MITRE</Badge>
                              )}
                              {hasSplunkData && (
                                <Badge className="text-xs bg-green-600 text-white">Splunk</Badge>
                              )}
                              {hasElasticData && (
                                <Badge className="text-xs bg-orange-600 text-white">Elastic</Badge>
                              )}
                              {hasAzureData && (
                                <Badge className="text-xs bg-sky-600 text-white">Azure</Badge>
                              )}
                              {hasSigmaData && (
                                <Badge className="text-xs bg-purple-600 text-white">Sigma</Badge>
                              )}
                              {hasCtidData && (
                                <Badge className="text-xs bg-blue-600 text-white">CTID</Badge>
                              )}
                            </div>
                          </button>

                          {isAnalyticExpanded && (
                            <div className="px-4 pb-4 pt-2 space-y-5">
                              <div>
                                <h5 className="text-sm font-medium text-muted-foreground mb-2">Description</h5>
                                <p className="text-sm text-foreground">
                                  {getFirstSentence(analytic.description)}
                                </p>
                              </div>

                              {strategy.techniques.length > 0 && (
                                <div>
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">Techniques</h5>
                                  <div className="flex flex-wrap gap-1">
                                    {strategy.techniques.map(techId => {
                                      const techniqueDescription = resolveTechniqueDescription(techId);
                                      return (
                                      <div key={techId} className="flex flex-col gap-1">
                                        <a
                                          href={`https://attack.mitre.org/techniques/${techId.replace('.', '/')}/`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title={techniqueDescription || undefined}
                                        >
                                          <Badge variant="outline" className={`text-xs hover:bg-muted/70 transition-colors ${subjectIdPillClass('technique')}`}>
                                            <span className="mr-1">{techId}</span>
                                            <ExternalLink className="w-3 h-3 text-muted-foreground" />
                                          </Badge>
                                        </a>
                                      </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {uniqueLogSources.length > 0 && (
                                <div>
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">Log Sources</h5>
                                  <div className="rounded-md overflow-hidden border border-border keep-border">
                                    <table className="w-full text-sm">
                                      <thead className="bg-muted/50">
                                        <tr>
                                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Data Component</th>
                                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Channel</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-border">
                                        {uniqueLogSources.map((row, idx) => (
                                          <tr key={`${row.dataComponentId}-${idx}`}>
                                            <td className="px-3 py-2">
                                              <button
                                                onClick={() => {
                                                  const dc = (dataComponents as Record<string, any>)[row.dataComponentId];
                                                  if (dc) setSelectedDataComponent(dc);
                                                }}
                                                className="text-primary hover:underline text-left"
                                                data-testid={`button-view-dc-community-${row.dataComponentId}`}
                                              >
                                                {row.dataComponentName}
                                                <span className="text-muted-foreground ml-1">({row.dataComponentId})</span>
                                            </button>
                                          </td>
                                          <td className="px-3 py-2 font-mono text-foreground">{row.logSourceName}</td>
                                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{formatChannel(row.channel)}</td>
                                        </tr>
                                      ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  {enablementNotes.length > 0 && (
                                    <details className="mt-3 rounded-md bg-background/60 p-3 text-xs">
                                      <summary className="cursor-pointer font-medium text-muted-foreground select-none">
                                        Enablement notes
                                      </summary>
                                      <div className="mt-2 space-y-2 text-muted-foreground">
                                        {enablementNotes.map((entry) => (
                                          <div key={`${entry.dataComponentName}-${entry.logSourceName}-${entry.note}`}>
                                            <div className="font-semibold text-foreground">
                                              {entry.dataComponentName} — {entry.logSourceName}
                                            </div>
                                            <div>{entry.note}</div>
                                          </div>
                                        ))}
                                      </div>
                                    </details>
                                  )}
                                </div>
                              )}

                              <div>
                                <h5 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                                  Mutable Elements
                                </h5>
                                <div className="rounded-md overflow-hidden border border-border keep-border">
                                  <table className="w-full text-sm">
                                    <thead className="bg-muted/50">
                                      <tr>
                                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-48">Field</th>
                                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Description</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                      {combinedMutableElements.map(me => (
                                        <tr key={me.field}>
                                          <td className="px-3 py-2 font-mono text-primary">{me.field}</td>
                                          <td className="px-3 py-2 text-foreground">{me.description}</td>
                                        </tr>
                                      ))}
                                      {combinedMutableElements.length === 0 && (
                                        <tr>
                                          <td colSpan={2} className="px-3 py-2 text-muted-foreground italic">
                                            No mutable elements found for this strategy.
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              {(() => {
                                const splunkHowTo = splunkAnalytics
                                  .map(ca => ca.howToImplement || extractHowToImplement(ca.description))
                                  .find(Boolean) as string | undefined;

                                return splunkHowTo ? (
                                  <div>
                                    {renderHowToSection('How to implement (Splunk)', splunkHowTo)}
                                  </div>
                                ) : null;
                              })()}

                              {(() => {
                                const elasticHowTo = elasticAnalytics
                                  .map(ca => ca.howToImplement || extractHowToImplement(ca.description))
                                  .find(Boolean) as string | undefined;

                                return elasticHowTo ? (
                                  <div>
                                    {renderHowToSection('How to implement (Elastic)', elasticHowTo)}
                                  </div>
                                ) : null;
                              })()}

                              {visibleCommunityAnalytics.length > 0 && (
                                <div>
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">Community detections used</h5>
                                  <div className="space-y-3">
                                    {(['splunk', 'sigma', 'elastic', 'azure', 'ctid'] as ResourceType[])
                                      .filter(source => visibleCommunityAnalytics.some(ca => getCommunitySource(ca) === source))
                                      .map(source => {
                                        const rules = visibleCommunityAnalytics.filter(ca => getCommunitySource(ca) === source);
                                        return (
                                          <div key={`rules-${analytic.id}-${source}`}>
                                            <Badge
                                              className={cn(
                                                "text-xs text-white",
                                                source === 'sigma' && "bg-purple-600",
                                                source === 'elastic' && "bg-orange-600",
                                                source === 'splunk' && "bg-green-600",
                                                source === 'azure' && "bg-sky-600",
                                                source === 'ctid' && "bg-blue-600"
                                              )}
                                            >
                                              {source === 'sigma' ? 'Sigma' : source === 'elastic' ? 'Elastic' : source === 'splunk' ? 'Splunk' : source === 'azure' ? 'Azure' : 'CTID'}
                                            </Badge>
                                            <div className="mt-2 space-y-1 text-sm text-foreground">
                                              {rules.map(rule => (
                                                <div key={`rule-${analytic.id}-${rule.id}`} className="flex items-center justify-between gap-3">
                                                  <span className="truncate">{rule.name}</span>
                                                  <span className="text-xs text-muted-foreground font-mono flex-shrink-0">{rule.id}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        );
                                      })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {scopedStrategies.length === 0 && (
        <div className="text-sm text-muted-foreground">
          No product-scoped analytics are mapped for this technique.
        </div>
      )}
    </div>
  );
  };

  const renderAttackTree = (
    attackTree: Array<{
      name: string;
      techniques: Array<{
        id: string;
        name: string;
        description?: string;
        strategies: Array<{ id: string; name: string; description: string; techniques: string[]; analytics: AnalyticItem[] | StixAnalytic[] }>;
        subtechniques: Array<{
          id: string;
          name: string;
          description?: string;
          strategies: Array<{ id: string; name: string; description: string; techniques: string[]; analytics: AnalyticItem[] | StixAnalytic[] }>;
        }>;
      }>;
    }>,
    sectionKey: string,
    options: { enforceDcScope: boolean },
    renderStrategies: (
      strategies: Array<{ id: string; name: string; description: string; techniques: string[]; analytics: AnalyticItem[] | StixAnalytic[] }>,
      key: string,
      scopedTechniqueId?: string
    ) => JSX.Element
  ) => {
    const getAnalyticsCount = (strategies: Array<{ analytics: AnalyticItem[] | StixAnalytic[] }>) =>
      strategies.reduce((sum, strategy) => sum + strategy.analytics.length, 0);

    return (
      <div className="space-y-4">
        {attackTree.map(tactic => {
          const tacticSlug = tactic.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const tacticKey = `${sectionKey}-tactic-${tacticSlug}`;
          const isTacticExpanded = expandedTactics.has(tacticKey);
          const tacticStrategyCount = tactic.techniques.reduce((sum, technique) => (
            sum + technique.strategies.length + technique.subtechniques.reduce((subSum, sub) => subSum + sub.strategies.length, 0)
          ), 0);
          const tacticSubtechniqueCount = tactic.techniques.reduce((sum, technique) => (
            sum + technique.subtechniques.length
          ), 0);
          const tacticAnalyticsCount = tactic.techniques.reduce((sum, technique) => (
            sum
            + getAnalyticsCount(scopeStrategiesToTechnique(technique.strategies, technique.id, options))
            + technique.subtechniques.reduce((subSum, sub) => (
              subSum + getAnalyticsCount(scopeStrategiesToTechnique(sub.strategies, sub.id, options))
            ), 0)
          ), 0);

          return (
            <div key={tacticKey} className="rounded-lg overflow-hidden bg-card">
              <button
                onClick={() => toggleTactic(tacticKey)}
                className="w-full px-4 py-4 text-left flex items-center gap-4 hover:bg-muted/50 transition-colors"
                data-testid={`button-expand-tactic-${tacticKey}`}
              >
                <ChevronRight className={cn(
                  "w-5 h-5 text-muted-foreground transition-transform flex-shrink-0",
                  isTacticExpanded && "rotate-90"
                )} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs uppercase text-muted-foreground tracking-wide">Tactic</div>
                  <div className="font-semibold text-foreground">{tactic.name}</div>
                </div>
                {!isTacticExpanded && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {tacticSubtechniqueCount > 0 && (
                      <Badge variant="secondary" className="text-xs bg-destructive text-destructive-foreground">
                        {tacticSubtechniqueCount} Techniques
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {tacticStrategyCount} Strategies
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {tacticAnalyticsCount} Analytics
                    </Badge>
                  </div>
                )}
              </button>

              {isTacticExpanded && (
                <div>
                  <div className="px-6 py-4 bg-muted/20 space-y-4">
                    <div className="text-xs uppercase text-muted-foreground tracking-wide">Techniques</div>
                    <div className="space-y-3">
                      {tactic.techniques.map(technique => {
                      const techniqueKey = `${sectionKey}-tech-${technique.id}`;
                      const isTechniqueExpanded = expandedTechniques.has(techniqueKey);
                      const scopedTechniqueStrategies = scopeStrategiesToTechnique(technique.strategies, technique.id, options);
                      const scopedSubtechniques = technique.subtechniques.map((sub) => ({
                        ...sub,
                        scopedStrategies: scopeStrategiesToTechnique(sub.strategies, sub.id, options),
                      }));
                      const techniqueStrategyCount = scopedTechniqueStrategies.length + scopedSubtechniques.reduce((sum, sub) => sum + sub.scopedStrategies.length, 0);
                      const techniqueSubtechniqueCount = technique.subtechniques.length;
                      const techniqueAnalyticsCount = getAnalyticsCount(scopedTechniqueStrategies)
                        + scopedSubtechniques.reduce((sum, sub) => sum + getAnalyticsCount(sub.scopedStrategies), 0);

                      return (
                        <div key={techniqueKey} className="rounded-md overflow-hidden bg-background">
                          <button
                            onClick={() => toggleTechnique(techniqueKey)}
                            className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-muted/30 transition-colors"
                            data-testid={`button-expand-technique-${techniqueKey}`}
                          >
                            <ChevronRight className={cn(
                              "w-4 h-4 text-muted-foreground transition-transform flex-shrink-0",
                              isTechniqueExpanded && "rotate-90"
                            )} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <code className="text-xs text-red-600 font-mono font-bold">{technique.id}</code>
                                <span className="font-medium text-foreground">{technique.name}</span>
                              </div>
                              {technique.description && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {getFirstSentence(technique.description)}
                                </p>
                              )}
                            </div>
                            {!isTechniqueExpanded && (
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {techniqueSubtechniqueCount > 0 && (
                                  <Badge variant="secondary" className="text-xs bg-destructive text-destructive-foreground">
                                    {techniqueSubtechniqueCount} Sub-Techniques
                                  </Badge>
                                )}
                                <Badge variant="secondary" className="text-xs">
                                  {techniqueStrategyCount} Strategies
                                </Badge>
                                <Badge variant="secondary" className="text-xs">
                                  {techniqueAnalyticsCount} Analytics
                                </Badge>
                              </div>
                            )}
                          </button>

                          {isTechniqueExpanded && (
                            <div>
                              <div className="px-5 py-4 bg-muted/10 space-y-4">
                                {scopedTechniqueStrategies.length > 0 && (
                                  <div className="space-y-3">
                                    <div className="text-xs uppercase text-muted-foreground tracking-wide">Detection Strategies</div>
                                    {renderStrategies(technique.strategies, `${sectionKey}-${technique.id}`, technique.id)}
                                  </div>
                                )}

                                {technique.subtechniques.length > 0 && (
                                  <div className="space-y-3">
                                    <div className="text-xs uppercase text-muted-foreground tracking-wide">Sub-Techniques</div>
                                    {scopedSubtechniques.map(subtechnique => {
                                      const subtechKey = `${sectionKey}-subtech-${subtechnique.id}`;
                                      const isSubtechExpanded = expandedSubtechniques.has(subtechKey);
                                      const subtechAnalyticsCount = getAnalyticsCount(subtechnique.scopedStrategies);

                                      return (
                                        <div key={subtechKey} className="rounded-md overflow-hidden bg-card">
                                          <button
                                            onClick={() => toggleSubtechnique(subtechKey)}
                                            className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-muted/30 transition-colors"
                                            data-testid={`button-expand-subtech-${subtechKey}`}
                                          >
                                            <ChevronRight className={cn(
                                              "w-4 h-4 text-muted-foreground transition-transform flex-shrink-0",
                                              isSubtechExpanded && "rotate-90"
                                            )} />
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-2">
                                                <code className="text-xs text-red-600 font-mono font-bold">{subtechnique.id}</code>
                                                <span className="font-medium text-foreground">{subtechnique.name}</span>
                                              </div>
                                              {subtechnique.description && (
                                                <p className="text-xs text-muted-foreground mt-1">
                                                  {getFirstSentence(subtechnique.description)}
                                                </p>
                                              )}
                                            </div>
                                            {!isSubtechExpanded && (
                                              <div className="flex items-center gap-2 flex-shrink-0">
                                                <Badge variant="secondary" className="text-xs">
                                                  {subtechnique.scopedStrategies.length} Strategies
                                                </Badge>
                                                <Badge variant="secondary" className="text-xs">
                                                  {subtechAnalyticsCount} Analytics
                                                </Badge>
                                              </div>
                                            )}
                                          </button>

                                          {isSubtechExpanded && (
                                            <div>
                                              <div className="px-4 py-4 bg-muted/10">
                                                {renderStrategies(subtechnique.strategies, `${sectionKey}-${subtechnique.id}`, subtechnique.id)}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {scopedTechniqueStrategies.length === 0 && scopedSubtechniques.length === 0 && (
                                  <div className="text-sm text-muted-foreground">
                                    No detection strategies mapped for this technique.
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const ctidAttackTree = useMemo(() => buildAttackTree(filteredStrategies), [filteredStrategies, buildAttackTree]);
  const communityAttackTree = useMemo(() => buildAttackTree(filteredCommunityStrategies), [filteredCommunityStrategies, buildAttackTree]);

  const mappedDataComponents = useMemo(() => {
    const byId = new Map<string, any>();
    const staticDataComponents = dataComponents as Record<string, any>;

    const addByObject = (dc: any) => {
      if (!dc?.id) return;
      const key = normalizeDataComponentId(dc.id);
      if (byId.has(key)) return;
      byId.set(key, {
        id: dc.id,
        name: dc.name || dc.id,
        dataSource: dc.dataSource || 'Mapped data component',
        description: dc.description || 'Mapped data component',
        mutableElements: Array.isArray(dc.mutableElements) ? dc.mutableElements : [],
        platforms: Array.isArray(dc.platforms) ? dc.platforms : [],
        logSources: Array.isArray(dc.logSources) ? dc.logSources : [],
      });
    };

    const stixDataComponents = ssmStixMapping?.dataComponents || [];
    const stixById = new Map<string, { id: string; name: string; dataSource: string }>();
    const stixByName = new Map<string, { id: string; name: string; dataSource: string }>();
    stixDataComponents.forEach((dc) => {
      stixById.set(normalizeDataComponentId(dc.id), dc);
      stixByName.set(normalizeDataComponentId(dc.name), dc);
    });

    const addByIdOrName = (value: string) => {
      if (!value) return;
      const normalizedValue = normalizeDataComponentId(value);
      const dcIdMatch = value.toUpperCase().match(/DC\d{4}/)?.[0];
      if (dcIdMatch) {
        const staticDc = staticDataComponents[dcIdMatch];
        if (staticDc) {
          addByObject(staticDc);
          return;
        }
        const stixDc = stixById.get(normalizeDataComponentId(dcIdMatch));
        if (stixDc) {
          addByObject(stixDc);
          return;
        }
        addByObject({
          id: dcIdMatch,
          name: dcIdMatch,
          dataSource: 'Mapped data component',
          description: 'Mapped data component',
          mutableElements: [],
          platforms: [],
          logSources: [],
        });
        return;
      }

      const byNameCandidates = dataComponentsByName.get(normalizedValue) || [];
      if (byNameCandidates.length > 0) {
        byNameCandidates.forEach((candidate) => addByObject(candidate));
        return;
      }

      const stixDcByName = stixByName.get(normalizedValue);
      if (stixDcByName) {
        addByObject(stixDcByName);
      }
    };

    (product.dataComponentIds || []).forEach((dcId) => addByIdOrName(dcId));
    vendorSupportedDataComponentSet.forEach((value) => addByIdOrName(value));

    return Array.from(byId.values()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }, [
    dataComponentsByName,
    product.dataComponentIds,
    ssmStixMapping?.dataComponents,
    vendorSupportedDataComponentSet,
  ]);

  const visibleMappedDataComponents = useMemo(() => {
    if (!hasDataComponentFilter) return mappedDataComponents;
    return mappedDataComponents.filter((dc) => selectedDataComponentFilter.has(normalizeDataComponentId(dc.id)));
  }, [mappedDataComponents, hasDataComponentFilter, selectedDataComponentFilter]);

  const stixAnalyticsForExport = useMemo(() => {
    return filteredStrategies.flatMap((strategy) =>
      strategy.analytics.map((analytic) => ({
        strategyId: strategy.id,
        strategyName: strategy.name,
        analyticId: analytic.id,
        analyticName: analytic.name,
        platforms: Array.isArray((analytic as { platforms?: string[] }).platforms) ? (analytic as { platforms?: string[] }).platforms || [] : [],
        dataComponents: Array.isArray((analytic as { dataComponents?: string[] }).dataComponents) ? (analytic as { dataComponents?: string[] }).dataComponents || [] : [],
      }))
    );
  }, [filteredStrategies]);

  const communityAnalyticsForExport = useMemo(() => {
    return filteredCommunityStrategies.flatMap((strategy) =>
      strategy.analytics.map((analytic) => ({
        strategyId: strategy.id,
        strategyName: strategy.name,
        analyticId: analytic.id,
        analyticName: analytic.name,
        platforms: Array.isArray((analytic as { platforms?: string[] }).platforms) ? (analytic as { platforms?: string[] }).platforms || [] : [],
        dataComponents: Array.isArray((analytic as { dataComponents?: string[] }).dataComponents) ? (analytic as { dataComponents?: string[] }).dataComponents || [] : [],
      }))
    );
  }, [filteredCommunityStrategies]);

  const exportPayload = useMemo(() => {
    const generatedAt = new Date().toISOString();
    return {
      generatedAt,
      product: {
        productId: productKey,
        vendor: product.vendor,
        productName: product.productName,
        platforms: allPlatforms,
      },
      filters: {
        selectedTechniqueIds: Array.from(selectedTechniqueFilter),
        selectedDataComponentIds: Array.from(selectedDataComponentFilter),
        selectedCommunitySources: Array.from(sourceFilters),
        hasTechniqueFilter,
        hasDataComponentFilter,
        scenario: {
          enabled: scenarioFilterEnabled,
          maxTechniques: scenarioMaxTechniques,
          showAllRanked: scenarioShowAll,
          answers: scenarioAnswers,
          manualOverrides: Array.from(scenarioOverrideTechniqueIds),
          excludedCounts: scenarioExcludedCounts,
          totalExcluded: totalScenarioExcluded,
          techniqueScores: scenarioFilterEnabled
            ? scenarioTechniqueInsights.scoredEntries.map((entry) => ({
                techniqueId: entry.techniqueId,
                tactic: entry.tactic,
                base: +entry.baseScore.toFixed(4),
                killWeight: +entry.killWeight.toFixed(2),
                dnaBoost: +entry.dnaBoost.toFixed(2),
                final: +entry.finalScore.toFixed(4),
                dropped: entry.dropped,
              }))
            : [],
        },
      },
      overview: {
        stixStrategies: filteredStrategies.length,
        stixAnalytics: totalAnalytics,
        communityStrategies: communityStrategiesCount,
        communityAnalytics: communityAnalyticsCount,
        mappedTechniquesVisible: visibleTechniqueChips.length,
        mappedDataComponentsVisible: visibleMappedDataComponents.length,
      },
      mappedTechniques: visibleTechniqueChips.map((tech) => ({
        id: tech.id,
        name: tech.name,
        tactic: tech.tactic || null,
      })),
      mappedDataComponents: visibleMappedDataComponents.map((dc) => ({
        id: dc.id,
        name: dc.name,
        dataSource: dc.dataSource || null,
      })),
      vendorEvidence: filteredVerifiedEvidence.map((entry) => ({
        dataComponentId: entry.dataComponentId,
        dataComponentName: entry.dataComponentName,
        logSources: entry.logSources,
      })),
      stixMappings: {
        strategies: filteredStrategies.map((strategy) => ({
          id: strategy.id,
          name: strategy.name,
          techniques: strategy.techniques || [],
          analytics: strategy.analytics.map((analytic) => ({
            id: analytic.id,
            name: analytic.name,
            platforms: (analytic as { platforms?: string[] }).platforms || [],
            dataComponents: (analytic as { dataComponents?: string[] }).dataComponents || [],
          })),
        })),
        analytics: stixAnalyticsForExport,
      },
      communityMappings: {
        strategies: filteredCommunityStrategies.map((strategy) => ({
          id: strategy.id,
          name: strategy.name,
          techniques: strategy.techniques || [],
          analytics: strategy.analytics.map((analytic) => ({
            id: analytic.id,
            name: analytic.name,
            platforms: (analytic as { platforms?: string[] }).platforms || [],
            dataComponents: (analytic as { dataComponents?: string[] }).dataComponents || [],
          })),
        })),
        analytics: communityAnalyticsForExport,
      },
      notes: exportNotes.trim() || null,
    };
  }, [
    allPlatforms,
    communityAnalyticsCount,
    communityStrategiesCount,
    exportNotes,
    filteredCommunityStrategies,
    filteredStrategies,
    filteredVerifiedEvidence,
    hasDataComponentFilter,
    hasTechniqueFilter,
    product.productName,
    product.vendor,
    productKey,
    scenarioAnswers,
    scenarioExcludedCounts,
    scenarioFilterEnabled,
    scenarioMaxTechniques,
    scenarioOverrideTechniqueIds,
    scenarioShowAll,
    scenarioTechniqueInsights.scoredEntries,
    selectedDataComponentFilter,
    selectedTechniqueFilter,
    sourceFilters,
    stixAnalyticsForExport,
    totalAnalytics,
    visibleMappedDataComponents,
    visibleTechniqueChips,
    communityAnalyticsForExport,
  ]);

  const exportMarkdown = useMemo(() => {
    const lines: string[] = [];
    const generatedAt = new Date().toISOString();
    const selectedTechniques = Array.from(selectedTechniqueFilter);
    const selectedDataComponents = Array.from(selectedDataComponentFilter);
    const selectedSources = Array.from(sourceFilters).map((src) => RESOURCE_LABELS[src]?.label || src);

    lines.push(`# ${productTitle} - Mapping Export`);
    lines.push('');
    lines.push(`Generated: ${generatedAt}`);
    lines.push(`Product ID: ${productKey}`);
    lines.push(`Platforms: ${allPlatforms.length > 0 ? allPlatforms.join(', ') : 'None'}`);
    lines.push('');
    lines.push('## Applied Filters');
    lines.push('');
    lines.push(`- Technique filter: ${selectedTechniques.length > 0 ? selectedTechniques.join(', ') : 'None'}`);
    lines.push(`- Data Component filter: ${selectedDataComponents.length > 0 ? selectedDataComponents.join(', ') : 'None'}`);
    lines.push(`- Community source filter: ${selectedSources.length > 0 ? selectedSources.join(', ') : 'None'}`);
    lines.push(`- Deployment profile filter enabled: ${scenarioFilterEnabled ? 'Yes' : 'No'}`);
    if (scenarioFilterEnabled) {
      lines.push(`- Scenario max techniques: ${scenarioShowAll ? 'All ranked' : scenarioMaxTechniques}`);
      lines.push(`- Scenario answers: ${Object.entries(scenarioAnswers).map(([key, value]) => `${SCENARIO_QUESTION_LABELS[key as ScenarioQuestionKey]}=${value ? 'Yes' : 'No'}`).join(', ')}`);
      lines.push(`- Scenario manual overrides: ${scenarioOverrideTechniqueIds.size > 0 ? Array.from(scenarioOverrideTechniqueIds).join(', ') : 'None'}`);
      lines.push(`- Profile exclusions: ${totalScenarioExcluded} unique (No Process Visibility ${scenarioExcludedCounts.processVisibility}, No Stored Data ${scenarioExcludedCounts.dataAtRest}, No User Interaction ${scenarioExcludedCounts.userInteraction})`);
      if (scenarioTechniqueInsights.scoredEntries.length > 0) {
        lines.push('');
        lines.push('### Technique Scores');
        lines.push('');
        lines.push(
          toMarkdownTable(
            ['Technique', 'Tactic', 'Base', 'Kill Weight', 'DNA Boost', 'Final', 'Status'],
            scenarioTechniqueInsights.scoredEntries.map((entry) => [
              entry.techniqueId,
              entry.tactic || 'Unknown',
              entry.baseScore.toFixed(3),
              entry.killWeight.toFixed(2),
              `x${entry.dnaBoost.toFixed(2)}`,
              entry.finalScore.toFixed(3),
              entry.dropped.length > 0 ? `Dropped (${entry.dropped.join(', ')})` : 'Included',
            ])
          )
        );
      }
    }
    lines.push('');
    lines.push('## Overview');
    lines.push('');
    lines.push(`- STIX Strategies: ${filteredStrategies.length}`);
    lines.push(`- STIX Analytics: ${totalAnalytics}`);
    lines.push(`- Community Strategies: ${communityStrategiesCount}`);
    lines.push(`- Community Analytics: ${communityAnalyticsCount}`);
    lines.push(`- Visible Techniques: ${visibleTechniqueChips.length}`);
    lines.push(`- Visible Data Components: ${visibleMappedDataComponents.length}`);
    lines.push('');
    lines.push('## Mapped Techniques (Visible)');
    lines.push('');
    if (visibleTechniqueChips.length > 0) {
      lines.push(
        toMarkdownTable(
          ['Technique ID', 'Name', 'Tactic'],
          visibleTechniqueChips.map((tech) => [tech.id, tech.name, tech.tactic || 'Unknown'])
        )
      );
    } else {
      lines.push('_No visible techniques._');
    }
    lines.push('');
    lines.push('## Mapped Data Components (Visible)');
    lines.push('');
    if (visibleMappedDataComponents.length > 0) {
      lines.push(
        toMarkdownTable(
          ['Data Component ID', 'Name'],
          visibleMappedDataComponents.map((dc) => [dc.id, dc.name])
        )
      );
    } else {
      lines.push('_No visible data components._');
    }
    lines.push('');
    lines.push('## STIX Analytics (Visible)');
    lines.push('');
    if (stixAnalyticsForExport.length > 0) {
      lines.push(
        toMarkdownTable(
          ['Strategy', 'Analytic ID', 'Analytic Name', 'Platforms', 'Data Components'],
          stixAnalyticsForExport.map((analytic) => [
            analytic.strategyName,
            analytic.analyticId,
            analytic.analyticName,
            analytic.platforms.join(', '),
            analytic.dataComponents.join(', '),
          ])
        )
      );
    } else {
      lines.push('_No STIX analytics visible._');
    }
    lines.push('');
    lines.push('## Community Analytics (Visible)');
    lines.push('');
    if (communityAnalyticsForExport.length > 0) {
      lines.push(
        toMarkdownTable(
          ['Strategy', 'Analytic ID', 'Analytic Name', 'Platforms', 'Data Components'],
          communityAnalyticsForExport.map((analytic) => [
            analytic.strategyName,
            analytic.analyticId,
            analytic.analyticName,
            analytic.platforms.join(', '),
            analytic.dataComponents.join(', '),
          ])
        )
      );
    } else {
      lines.push('_No community analytics visible._');
    }
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    lines.push(exportNotes.trim().length > 0 ? exportNotes.trim() : '_No notes provided._');
    lines.push('');

    return lines.join('\n');
  }, [
    allPlatforms,
    communityAnalyticsCount,
    communityAnalyticsForExport,
    communityStrategiesCount,
    exportNotes,
    filteredStrategies.length,
    productKey,
    productTitle,
    scenarioAnswers,
    scenarioExcludedCounts.processVisibility,
    scenarioExcludedCounts.dataAtRest,
    scenarioExcludedCounts.userInteraction,
    scenarioFilterEnabled,
    scenarioMaxTechniques,
    scenarioOverrideTechniqueIds,
    scenarioShowAll,
    scenarioTechniqueInsights.scoredEntries,
    selectedDataComponentFilter,
    selectedTechniqueFilter,
    sourceFilters,
    stixAnalyticsForExport,
    totalAnalytics,
    totalScenarioExcluded,
    visibleMappedDataComponents,
    visibleTechniqueChips,
  ]);

  const handleExportPdf = () => {
    const originalTitle = document.title;
    const reportTitle = `${product.vendor} ${product.productName} - Mapping Report`;
    document.title = reportTitle;
    const restoreTitle = () => {
      document.title = originalTitle;
    };
    window.addEventListener('afterprint', restoreTitle, { once: true });
    window.print();
    window.setTimeout(restoreTitle, 1200);
    toast({
      title: 'Print dialog opened',
      description: 'Choose "Save as PDF" to export the current filtered UI view.',
    });
  };

  const tocItems = [
    { id: 'overview', label: 'Overview' },
    { id: 'coverage', label: 'Coverage Summary' },
    { id: 'verified-evidence', label: 'Vendor Log Sources' },
    { id: 'detection-strategies', label: hasWizardGuidedCoverage ? 'STIX Wizard Mappings' : 'STIX Detection Mappings' },
    { id: 'community-coverage', label: 'Community Detection Mappings' },
    { id: 'export', label: 'Export' },
  ];

  return (
      <div className="flex">
        <div className="flex-1 min-w-0">
          <div className="p-8">
          <Dialog open={isEvidenceDialogOpen} onOpenChange={setIsEvidenceDialogOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Evidence Overrides</DialogTitle>
                <DialogDescription>
                  Update the log sources, query logic, or caveats used for {evidenceTechniqueId} {evidenceTechniqueName}.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">Log Sources</div>
                  {evidenceEntries.map((entry, idx) => (
                    <div key={`evidence-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <Input
                        value={entry.name}
                        onChange={(event) => updateEvidenceEntry(idx, 'name', event.target.value)}
                        placeholder="Log source name"
                        className="bg-background"
                      />
                      <Input
                        value={entry.channel}
                        onChange={(event) => updateEvidenceEntry(idx, 'channel', event.target.value)}
                        placeholder="Channel"
                        className="bg-background"
                      />
                      <Input
                        value={entry.eventId}
                        onChange={(event) => updateEvidenceEntry(idx, 'eventId', event.target.value)}
                        placeholder="Event ID"
                        className="bg-background"
                      />
                      <div className="flex items-center gap-2">
                        <Input
                          value={entry.dataComponent}
                          onChange={(event) => updateEvidenceEntry(idx, 'dataComponent', event.target.value)}
                          placeholder="Data component"
                          className="bg-background"
                        />
                        {evidenceEntries.length > 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeEvidenceEntry(idx)}
                            className="h-8 px-2 text-xs"
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" onClick={addEvidenceEntry}>
                    Add Log Source
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">Analytic Logic</div>
                  <Textarea
                    value={evidenceQuery}
                    onChange={(event) => setEvidenceQuery(event.target.value)}
                    placeholder="Paste the analytic logic or query"
                    className="bg-background min-h-[120px]"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">Caveats</div>
                  <Textarea
                    value={evidenceCaveats}
                    onChange={(event) => setEvidenceCaveats(event.target.value)}
                    placeholder="One caveat per line"
                    className="bg-background min-h-[90px]"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="secondary" onClick={() => setIsEvidenceDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveEvidenceOverrides}>Save Evidence</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <div className="flex items-center justify-between mb-6">
            <nav className="flex items-center gap-2 text-sm text-muted-foreground">
              <button 
                onClick={onBack} 
                className="hover:text-foreground transition-colors flex items-center gap-1"
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4" />
                Products
              </button>
              <ChevronRight className="w-4 h-4" />
              <span className="text-foreground">{productTitle}</span>
            </nav>
            {product.source === 'custom' && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setLocation(`/ai-mapper?evidenceFor=${encodeURIComponent(String(productKey))}`)}
                >
                  Evidence Wizard
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteProduct}
                  disabled={deleteProductMutation.isPending}
                >
                  Delete Product
                </Button>
              </div>
            )}
          </div>

          <header className="mb-8" id="overview">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-semibold text-foreground">{productTitle}</h1>
                  {autoMapping.isAutoRunning && (
                    <Badge variant="outline" className="text-xs text-blue-600 border-blue-600">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Auto-mapping...
                    </Badge>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {productAliases.length === 0 && (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        None
                      </Badge>
                    )}
                    {productAliases.map(alias => (
                      <Badge key={alias.id} variant="secondary" className="text-xs flex items-center gap-1">
                        {alias.alias}
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => deleteAliasMutation.mutate(alias.id)}
                          disabled={deleteAliasMutation.isPending}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                    <div className="flex items-center gap-2">
                      <Input
                        value={newAlias}
                        onChange={(event) => setNewAlias(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            handleAddAlias();
                          }
                        }}
                        placeholder="Add alias"
                        className="h-7 w-40 text-xs"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleAddAlias}
                        disabled={addAliasMutation.isPending}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
                <p className="text-lg text-muted-foreground">{product.description}</p>
                <div className="pt-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Mapped Platforms</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {mappedPlatforms.length > 0 ? (
                      mappedPlatforms.map((platformValue) => (
                        <Badge key={`platform-${platformValue}`} variant="outline" className="text-xs flex items-center gap-1.5">
                          {getPlatformIcon(platformValue)}
                          <span>{getPlatformDisplayName(platformValue)}</span>
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No mapping platform scope recorded yet.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            <section className="mt-6" id="coverage">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-muted/30">
                  <div className="text-2xl font-semibold text-foreground">
                    {filteredStrategies.length + communityStrategiesCount}
                  </div>
                  <div className="text-sm text-muted-foreground">CTID + Community Mappings</div>
                </div>
                <div className="p-4 rounded-lg bg-muted/30">
                  <div className="text-2xl font-semibold text-foreground">
                    {totalAnalytics + communityAnalyticsCount}
                  </div>
                  <div className="text-sm text-muted-foreground">Analytics</div>
                </div>
                <div className="p-4 rounded-lg bg-muted/30">
                  <div className="text-2xl font-semibold text-foreground">{overviewTechniqueCount}</div>
                  <div className="text-sm text-muted-foreground">Techniques Covered</div>
                </div>
                <div className="p-4 rounded-lg bg-muted/30">
                <div className="text-xl font-semibold text-foreground">
                  {`${mappedTechniqueStats.withCommunity}/${mappedTechniqueStats.total} (${mappedTechniqueStats.total > 0 ? Math.round((mappedTechniqueStats.withCommunity / mappedTechniqueStats.total) * 100) : 0}%)`}
                </div>
                <div className="text-sm text-muted-foreground">Techniques with at least 1 Detection Rule</div>
              </div>
              </div>
            </section>

            <section className="mt-6">
              <div className="p-4 rounded-lg bg-card border border-border/60">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Filter className="w-4 h-4 text-primary" />
                      Deployment Profile Filter
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                            aria-label="Deployment profile filter info"
                            data-testid="button-scenario-filter-info"
                          >
                            <Info className="w-3.5 h-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[34rem] max-h-[32rem] overflow-auto">
                          <div className="space-y-3">
                            <div>
                              <div className="text-sm font-semibold text-foreground">How This Filter Works</div>
                              <p className="text-xs text-muted-foreground mt-1">
                                Each question describes a property of this product's deployment. Based on your answers, techniques are
                                scored and ranked: irrelevant technique families are dropped (e.g., persistence techniques for a black-box appliance),
                                while likely attack paths are boosted (e.g., Initial Access for internet-exposed products). You can view
                                all ranked techniques or limit to the top N.
                              </p>
                            </div>

                            <div>
                              <div className="text-xs font-semibold text-foreground mb-1">References Used</div>
                              <ul className="space-y-1">
                                {SCENARIO_REFERENCE_LINKS.map((reference) => (
                                  <li key={reference.url} className="text-xs">
                                    <a
                                      href={reference.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-primary hover:underline"
                                    >
                                      <span>{reference.label}</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Answer {SCENARIO_QUESTION_COUNT} questions about how this product is deployed to rank techniques by relevance and remove inapplicable ones.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Enable</span>
                    <Switch
                      checked={scenarioFilterEnabled}
                      onCheckedChange={(value) => setScenarioFilterEnabled(Boolean(value))}
                      data-testid="switch-scenario-filter"
                    />
                  </div>
                </div>

                <div className={cn("mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3", !scenarioFilterEnabled && "opacity-60")}>
                  {(Object.keys(SCENARIO_QUESTION_LABELS) as ScenarioQuestionKey[]).map((key) => (
                    <div key={key} className="rounded-md border border-border/60 p-3 bg-muted/20">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-foreground">{SCENARIO_QUESTION_LABELS[key]}</div>
                        <Switch
                          checked={scenarioAnswers[key]}
                          disabled={!scenarioFilterEnabled}
                          onCheckedChange={(value) => updateScenarioAnswer(key, Boolean(value))}
                          data-testid={`switch-scenario-${key}`}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">{SCENARIO_QUESTION_HELP[key]}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Why it matters: {SCENARIO_QUESTION_WHY[key]}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <label className="text-xs text-muted-foreground" htmlFor="scenario-max-techniques">
                    Max techniques shown
                  </label>
                  <Input
                    id="scenario-max-techniques"
                    type="number"
                    min={1}
                    max={200}
                    value={scenarioMaxTechniques}
                    disabled={!scenarioFilterEnabled || scenarioShowAll}
                    onChange={(event) => {
                      const parsed = parseInt(event.target.value, 10);
                      if (Number.isNaN(parsed)) return;
                      setScenarioMaxTechniques(Math.min(200, Math.max(1, parsed)));
                    }}
                    className="h-8 w-24 text-xs"
                    data-testid="input-scenario-max-techniques"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!scenarioFilterEnabled}
                    onClick={() => setScenarioShowAll((prev) => !prev)}
                  >
                    {scenarioShowAll ? 'Limit to Top N' : 'Show All Ranked'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!scenarioFilterEnabled}
                    onClick={() => setScenarioAnswers(inferScenarioAnswersFromPlatforms(allPlatforms))}
                  >
                    Reset Suggested Answers
                  </Button>
                </div>

                {scenarioFilterEnabled && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      Showing {scenarioTechniqueInsights.allowedSet.size}/{scenarioTechniqueInsights.totalCandidates} techniques
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      Ranked {scenarioShowAll ? 'all' : `top ${scenarioMaxTechniques}`}
                    </Badge>
                    {totalScenarioExcluded > 0 && (
                      <Badge variant="outline" className="text-xs">
                        Excluded {totalScenarioExcluded} (No Process Visibility {scenarioExcludedCounts.processVisibility}, No Stored Data {scenarioExcludedCounts.dataAtRest}, No User Interaction {scenarioExcludedCounts.userInteraction})
                      </Badge>
                    )}
                    {tacticDiversityWarning && (
                      <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500/40">
                        {tacticDiversityWarning}
                      </Badge>
                    )}
                  </div>
                )}

                {scenarioFilterEnabled && totalScenarioExcluded > 0 && (
                  <details className="mt-4 rounded-md border border-border/60 bg-background/60 p-3">
                    <summary className="cursor-pointer text-xs font-medium text-foreground select-none flex items-center justify-between gap-2">
                      <span>Excluded Techniques ({totalScenarioExcluded})</span>
                      {scenarioOverrideTechniqueIds.size > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={(e) => { e.preventDefault(); clearScenarioOverrides(); }}
                          className="h-7 text-xs"
                        >
                          Clear Overrides ({scenarioOverrideTechniqueIds.size})
                        </Button>
                      )}
                    </summary>
                    <div className="mt-3 space-y-3">
                      {(Object.entries(excludedTechniquesByReason) as [ScenarioDropReason, string[]][]).map(([reason, techIds]) => {
                        if (techIds.length === 0) return null;
                        return (
                          <div key={reason}>
                            <div className="text-xs text-muted-foreground mb-1.5">
                              {SCENARIO_QUESTION_LABELS[reason]} ({techIds.length})
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {techIds.map((techId) => {
                                const isOverridden = scenarioOverrideTechniqueIds.has(normalizeTechniqueId(techId));
                                return (
                                  <button
                                    key={`override-${reason}-${techId}`}
                                    type="button"
                                    onClick={() => toggleScenarioOverrideTechnique(techId)}
                                    className={cn(
                                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                                      isOverridden
                                        ? "border-primary/60 bg-primary/10 text-foreground"
                                        : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-primary/40"
                                    )}
                                    data-testid={`button-scenario-override-${techId}`}
                                  >
                                    <code className="font-mono text-[10px] text-red-600">{techId}</code>
                                    <span>{getTechniqueName(techId)}</span>
                                    <span className="text-[10px]">
                                      {isOverridden ? 'Remove' : 'Add Back'}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}

                {scenarioFilterEnabled && (
                  <details className="mt-4 rounded-md border border-border/60 bg-background/60 p-3">
                    <summary className="cursor-pointer text-xs font-medium text-foreground select-none">
                      Score breakdown (top 15)
                    </summary>
                    <div className="mt-3 rounded-md overflow-hidden border border-border/60 keep-border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="px-2 py-2 text-left font-medium text-muted-foreground">Technique</th>
                            <th className="px-2 py-2 text-left font-medium text-muted-foreground">Tactic</th>
                            <th className="px-2 py-2 text-left font-medium text-muted-foreground">Base</th>
                            <th className="px-2 py-2 text-left font-medium text-muted-foreground">Kill Wt</th>
                            <th className="px-2 py-2 text-left font-medium text-muted-foreground">DNA Boost</th>
                            <th className="px-2 py-2 text-left font-medium text-muted-foreground">Final</th>
                            <th className="px-2 py-2 text-left font-medium text-muted-foreground">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {scenarioTechniqueInsights.scoredEntries.slice(0, 15).map((entry) => (
                            <tr key={`scenario-score-${entry.techniqueId}`}>
                              <td className="px-2 py-2">
                                <code className="font-mono text-red-600">{entry.techniqueId}</code>
                              </td>
                              <td className="px-2 py-2 text-foreground">{entry.tactic || 'Unknown'}</td>
                              <td className="px-2 py-2 text-foreground">{entry.baseScore.toFixed(3)}</td>
                              <td className="px-2 py-2 text-foreground">{entry.killWeight.toFixed(2)}</td>
                              <td className="px-2 py-2 text-foreground">x{entry.dnaBoost.toFixed(2)}</td>
                              <td className="px-2 py-2 text-foreground">{entry.finalScore.toFixed(3)}</td>
                              <td className="px-2 py-2 text-muted-foreground">
                                {entry.dropped.length > 0 ? `Dropped (${entry.dropped.join(', ')})` : 'Included'}
                              </td>
                            </tr>
                          ))}
                          {scenarioTechniqueInsights.scoredEntries.length === 0 && (
                            <tr>
                              <td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">
                                No technique scoring data available.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            </section>

            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    Mapped Techniques
                  </h3>
                  <div className="flex items-center gap-2">
                    {selectedTechniqueIds.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearTechniqueFilters}
                        className="text-xs h-7 text-muted-foreground hover:text-foreground"
                      >
                        Clear Filter
                      </Button>
                    )}
                    {visibleTechniqueChips.length > 20 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllTechniques(!showAllTechniques)}
                        className="text-xs h-7 text-muted-foreground hover:text-foreground"
                      >
                        {showAllTechniques ? 'Show Less' : `Show All (${visibleTechniqueChips.length})`}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Techniques mapped to this product (Detection + Visibility):
                </p>
                <div className={cn("pr-4 overflow-y-auto", !showAllTechniques && "max-h-48")}>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const detectionSet = new Set(detectionTechniques.map(t => t.id));
                      return visibleTechniqueChips.map(tech => {
                        const hasDetection = detectionSet.has(tech.id);
                        const normalizedId = normalizeTechniqueId(tech.id);
                        const isSelected = selectedTechniqueFilter.has(normalizedId);
                        return (
                          <button
                            key={tech.id}
                            onClick={() => toggleTechniqueFilter(tech.id)}
                            className={cn(
                              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors text-sm",
                              isSelected
                                ? "border-primary/60 bg-primary/10 text-foreground"
                                : "border-border bg-muted/50 hover:bg-muted hover:border-primary/30"
                            )}
                            aria-pressed={isSelected}
                            data-testid={`button-tech-chip-${tech.id}`}
                          >
                            <code className={cn(
                              "text-xs font-mono",
                              hasDetection ? "text-red-600 font-bold" : "text-slate-500 font-medium"
                            )}>
                              {tech.id}
                            </code>
                            <span className="text-foreground">{tech.name}</span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                focusTechnique(tech.id, getPrimaryTactic(tech));
                              }}
                              className="ml-1 text-muted-foreground hover:text-foreground"
                              title="Jump to tactic"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </button>
                        );
                      });
                    })()}
                    {visibleTechniqueChips.length === 0 && (
                      <div className="text-sm text-muted-foreground italic">
                        {hasTechniqueFilter
                          ? 'No mapped techniques match the selected filter.'
                          : scenarioFilterEnabled
                            ? 'No mapped techniques match the current scenario settings.'
                            : 'No techniques mapped yet.'}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Database className="w-4 h-4 text-primary" />
                    Mapped Data Components
                  </h3>
                  <div className="flex items-center gap-2">
                    {selectedDataComponentIds.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearDataComponentFilters}
                        className="text-xs h-7 text-muted-foreground hover:text-foreground"
                      >
                        Clear Filter
                      </Button>
                    )}
                    {visibleMappedDataComponents.length > 20 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllDataComponents(!showAllDataComponents)}
                        className="text-xs h-7 text-muted-foreground hover:text-foreground"
                      >
                        {showAllDataComponents ? 'Show Less' : `Show All (${visibleMappedDataComponents.length})`}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  This asset provides the following telemetry sources:
                </p>
                <div className={cn("pr-4 overflow-y-auto", !showAllDataComponents && "max-h-48")}>
                  <div className="flex flex-wrap gap-2">
                    {visibleMappedDataComponents.map(dc => {
                      const normalizedId = normalizeDataComponentId(dc.id);
                      const isSelected = selectedDataComponentFilter.has(normalizedId);
                      return (
                        <button
                          key={dc.id}
                          onClick={() => toggleDataComponentFilter(dc.id)}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors text-sm",
                            isSelected
                              ? "border-primary/60 bg-primary/10 text-foreground"
                              : "border-border bg-muted/50 hover:bg-muted hover:border-primary/30"
                          )}
                          aria-pressed={isSelected}
                          data-testid={`button-dc-chip-${dc.id}`}
                        >
                          <Badge variant="outline" className={`text-[10px] ${subjectIdPillClass('data-component')}`}>
                            {dc.id}
                          </Badge>
                          <span className="text-foreground">{dc.name}</span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedDataComponent(dc);
                            }}
                            className="ml-1 text-muted-foreground hover:text-foreground"
                            title="View details"
                          >
                            <Info className="w-3 h-3" />
                          </button>
                        </button>
                      );
                    })}
                    {visibleMappedDataComponents.length === 0 && (
                      <div className="text-sm text-muted-foreground italic">
                        {hasDataComponentFilter ? 'No mapped data components match the selected filter.' : 'No data components mapped yet.'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <section className="mt-6" id="verified-evidence">
              <div className="p-4 rounded-lg bg-card">
                <div className="flex items-center justify-between mb-3">
                  <button
                    type="button"
                    onClick={() => setIsVendorLogSourcesExpanded((prev) => !prev)}
                    className="w-full flex items-center justify-between text-left rounded-md border border-border/60 bg-background/60 px-3 py-2 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">Vendor Log Sources</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {filteredVerifiedEvidence.length} data component{filteredVerifiedEvidence.length === 1 ? '' : 's'}
                      </span>
                      <ChevronRight
                        className={cn(
                          "w-4 h-4 text-muted-foreground transition-transform",
                          isVendorLogSourcesExpanded && "rotate-90"
                        )}
                      />
                    </div>
                  </button>
                </div>
                {isVendorLogSourcesExpanded && (
                  <>
                    <p className="text-sm text-muted-foreground mb-3">
                      Product-specific log sources captured from research or manual mapping.
                    </p>
                    {filteredVerifiedEvidence.length > 0 ? (
                      <div className="space-y-4">
                        {filteredVerifiedEvidence.map((entry) => {
                          return (
                            <div key={entry.dataComponentId} className="rounded-lg bg-background/50 p-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold text-foreground">
                                  {entry.dataComponentId} - {entry.dataComponentName}
                                </div>
                              </div>
                              <div className="rounded-md overflow-hidden border border-border keep-border">
                                <table className="w-full text-xs">
                                  <thead className="bg-muted/50">
                                    <tr>
                                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Log Source</th>
                                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Channel</th>
                                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Notes</th>
                                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Source</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border">
                                    {entry.logSources.map((source, idx) => (
                                      <tr key={`${entry.dataComponentId}-${idx}`}>
                                        <td className="px-3 py-2 font-mono text-foreground">{source.name}</td>
                                        <td className="px-3 py-2 font-mono text-muted-foreground">{formatChannel(source.channel)}</td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                          {source.notes ? source.notes : '-'}
                                        </td>
                                        <td className="px-3 py-2">
                                          {source.sourceUrl ? (
                                            <a
                                              href={source.sourceUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="inline-flex items-center rounded-md border border-border/60 bg-background px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted"
                                            >
                                              Reference
                                            </a>
                                          ) : (
                                            <span className="text-muted-foreground">-</span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground rounded-lg p-4 text-center">
                        {hasDataComponentFilter
                          ? 'No vendor log sources for the selected data components.'
                          : 'No vendor log sources saved yet.'}
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

          </header>

          <section id="detection-strategies">
            <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              {hasWizardGuidedCoverage ? 'Mappings using STIX Data (Wizard)' : 'Mappings using STIX Data'}
            </h2>
            <p className="text-muted-foreground mb-6">
              MITRE STIX-based mappings for {product.productName}, organized by tactic, technique, strategy, and analytic for easier traversal.
            </p>

            {ctidAttackTree.length > 0 ? (
              renderAttackTree(ctidAttackTree, 'ctid', { enforceDcScope: true }, renderStrategyList)
            ) : (
              <div className="py-12 text-center text-muted-foreground rounded-lg">
                No STIX mappings found for {product.productName}.
              </div>
            )}
          </section>

          {/* Community Detection Mappings */}
          <section id="community-coverage" className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Community Detection Mappings
                {availableSources.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {communityStrategiesCount} Strategies / {communityAnalyticsCount} Analytics
                  </Badge>
                )}
              </h2>
              {availableSources.length > 0 && (
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setShowSourceFilter(!showSourceFilter)}
                  className="gap-2 text-muted-foreground hover:text-foreground"
                >
                  <Filter className="w-4 h-4" />
                  Filter Sources
                </Button>
              )}
            </div>
            
            {showSourceFilter && availableSources.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2 items-center">
                <span className="text-sm text-muted-foreground mr-1">Show from:</span>
                {(['sigma', 'elastic', 'splunk', 'azure', 'ctid'] as ResourceType[]).filter(s => availableSources.includes(s)).map(source => {
                  const isActive = sourceFilters.has(source);
                  const sourceConfig = RESOURCE_LABELS[source];
                  return (
                    <Button
                      key={source}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        const newFilters = new Set(sourceFilters);
                        if (isActive) {
                          newFilters.delete(source);
                        } else {
                          newFilters.add(source);
                        }
                        setSourceFilters(newFilters);
                      }}
                      className={cn(
                        "text-xs h-7",
                        isActive && source === 'sigma' && "bg-purple-600 hover:bg-purple-700",
                        isActive && source === 'elastic' && "bg-orange-600 hover:bg-orange-700",
                        isActive && source === 'splunk' && "bg-green-600 hover:bg-green-700",
                        isActive && source === 'azure' && "bg-sky-600 hover:bg-sky-700",
                        isActive && source === 'ctid' && "bg-blue-600 hover:bg-blue-700"
                      )}
                    >
                      {sourceConfig?.label || source}
                    </Button>
                  );
                })}
              </div>
            )}
            
            <p className="text-muted-foreground mb-6">
              Detection strategies derived from techniques discovered in community detection rules (Sigma, Elastic, Splunk, Azure).
            </p>

            {!autoMapping.isLoading && autoMapping.enrichedMapping && (
              <div className="mb-6 flex flex-wrap gap-2">
                <Badge variant="secondary" className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-700">
                  {communityMappingSummary.detect} Confirmed
                </Badge>
                <Badge variant="secondary" className="border border-sky-500/20 bg-sky-500/10 text-sky-700">
                  {communityMappingSummary.visibility} Visibility
                </Badge>
                <Badge variant="secondary" className="border border-amber-500/20 bg-amber-500/10 text-amber-700">
                  {communityMappingSummary.candidate} Candidates
                </Badge>
                {autoMapping.data?.status === 'partial' && (
                  <Badge variant="secondary" className="border border-amber-500/20 bg-amber-500/10 text-amber-700">
                    Partial Auto-Mapping
                  </Badge>
                )}
              </div>
            )}

            {autoMapping.isLoading && (
              <div className="py-8 text-center rounded-lg">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                <p className="text-muted-foreground">Querying community resources...</p>
              </div>
            )}

            {filteredCommunityStrategies.length > 0 && (
              <ErrorBoundary>
                {renderAttackTree(communityAttackTree, 'community', { enforceDcScope: false }, renderCommunityStrategyList)}
              </ErrorBoundary>
            )}

            {(autoMapping.data?.status === 'matched' || autoMapping.data?.status === 'partial') && !autoMapping.isLoading && autoMapping.enrichedMapping && filteredCommunityStrategies.length === 0 && autoMapping.enrichedMapping.techniqueIds.length === 0 && (
              <div className="py-8 text-center rounded-lg">
                <p className="text-muted-foreground">Found community references, but no MITRE ATT&CK technique IDs could be extracted from the detection rules.</p>
              </div>
            )}

            {(autoMapping.data?.status === 'matched' || autoMapping.data?.status === 'partial') && !autoMapping.isLoading && autoMapping.enrichedMapping && filteredCommunityStrategies.length === 0 && autoMapping.enrichedMapping.techniqueIds.length > 0 && (
              <div className="p-4 rounded-lg bg-card">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Found <strong className="text-foreground">{autoMapping.enrichedMapping.techniqueIds.length}</strong> technique references from {RESOURCE_LABELS[autoMapping.enrichedMapping.source]?.label}, but these techniques either lack detection strategies in the MITRE ATT&CK STIX v18 knowledge base or remain visibility-only evidence.
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Confirmed mappings indicate stronger ATT&CK detection coverage. Visibility mappings show telemetry support that still needs corroboration or promotion.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {autoMapping.enrichedMapping.techniqueIds.slice(0, 10).map(techId => (
                        <a
                          key={techId}
                          href={`https://attack.mitre.org/techniques/${techId.replace('.', '/')}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border bg-muted/50 hover:border-primary/30 text-xs font-mono text-red-600 hover:underline"
                        >
                          {techId}
                        </a>
                      ))}
                      {autoMapping.enrichedMapping.techniqueIds.length > 10 && (
                        <span className="text-xs text-muted-foreground">+{autoMapping.enrichedMapping.techniqueIds.length - 10} more</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {autoMapping.data?.status === 'ai_pending' && (
              <div className="py-8 text-center rounded-lg bg-amber-500/5">
                <AlertCircle className="w-6 h-6 mx-auto mb-2 text-amber-500" />
                <p className="text-amber-600 font-medium">No Automated Mappings Found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  This product requires AI-assisted mapping to determine detection coverage.
                </p>
              </div>
            )}

            {autoMapping.data?.status === 'partial' && (
              <div className="py-6 px-4 rounded-lg bg-sky-500/5 border border-sky-500/10">
                <p className="text-sky-700 font-medium">Visibility Evidence Found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Community sources found telemetry or inferred ATT&CK relationships for this product, but not enough confirmed evidence to publish full detection coverage.
                </p>
              </div>
            )}

            {autoMapping.data?.status === 'not_found' && (
              <div className="py-8 text-center rounded-lg">
                <p className="text-muted-foreground">No references to this product found in community detection rule repositories (Sigma, Elastic, Splunk, Azure).</p>
              </div>
            )}

            {!autoMapping.data && !autoMapping.isLoading && (
              <div className="py-8 text-center rounded-lg">
                <p className="text-muted-foreground">Community coverage will load automatically.</p>
              </div>
            )}
          </section>

          <section id="export" className="mt-10">
            <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Export Snapshot
            </h2>
            <p className="text-muted-foreground mb-4">
              Export this page with current filters and scenario view applied. Add notes below to include them at the bottom of the export.
            </p>
            <div className="p-4 rounded-lg bg-card space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Notes</label>
                <Textarea
                  value={exportNotes}
                  onChange={(event) => setExportNotes(event.target.value)}
                  placeholder="Add scenario context, assumptions, coverage caveats, and implementation notes..."
                  className="min-h-[120px]"
                  data-testid="textarea-export-notes"
                />
              </div>
              <div className="no-print flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={handleExportPdf}>
                  <FileDown className="w-4 h-4 mr-2" />
                  Export PDF
                </Button>
                <StixExportControls
                  baseName={`${product.vendor}-${product.productName}-mapping-view`}
                  jsonPayload={exportPayload}
                  markdownContent={exportMarkdown}
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      <aside className="no-print w-40 flex-shrink-0 border-l border-border p-6 sticky top-0 h-screen overflow-auto hidden xl:block">
        <h3 className="text-sm font-medium text-foreground mb-3">On this page</h3>
        <nav className="space-y-1">
          {tocItems.map(item => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={cn(
                "block text-sm py-1.5 transition-colors",
                activeSection === item.id
                  ? "text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setActiveSection(item.id)}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      {selectedDataComponent && (
        <DataComponentDetail
          dc={selectedDataComponent}
          platform={platform}
          vendorEvidence={verifiedEvidenceByDcId.get(selectedDataComponent.id.toLowerCase())}
          onClose={() => setSelectedDataComponent(null)}
        />
      )}

      </div>
  );
}
