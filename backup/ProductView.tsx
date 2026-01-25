import { useState, useMemo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Asset, getDetectionStrategiesForProduct, dataComponents, techniques, DetectionStrategy, AnalyticItem, DataComponentRef, detectionStrategies, Technique } from '@/lib/mitreData';
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
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAutoMappingWithAutoRun, RESOURCE_LABELS, ResourceType, StixDataComponent, StixAnalytic, StixDetectionStrategy, AnalyticMapping } from '@/hooks/useAutoMapper';
import { useProductSsm } from '@/hooks/useProductSsm';
import { getAggregateCoverage } from '@/lib/ssm-utils';
import { buildMappingIdsByTechnique, buildMetadataByTechnique, getHybridStrategies } from '@/lib/ssm-hybrid';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Filter } from 'lucide-react';
import { useDeleteProduct } from '@/hooks/useProducts';
import { useToast } from '@/hooks/use-toast';
import { normalizePlatformList, platformMatchesAny } from '@shared/platforms';

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

interface LogSourceRow {
  dataComponentId: string;
  dataComponentName: string;
  logSourceName: string;
  channel: string;
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
  onClose 
}: { 
  dc: DataComponentRef; 
  platform: string; 
  onClose: () => void;
}) {
  const prefixes = getPlatformPrefixes(platform);
  
  const filteredLogSources = dc.logSources?.filter(ls => 
    prefixes.some(prefix => ls.name.toLowerCase().startsWith(prefix.toLowerCase()))
  ) || [];
  
  const platformMeasure = dc.dataCollectionMeasures?.find(m => platformMatchesAny([m.platform], [platform]));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-background border border-border rounded-lg max-w-3xl w-full max-h-[85vh] overflow-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between">
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
              <div className="bg-muted/30 border border-border rounded-md p-4">
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
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Channel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredLogSources.map((ls, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2 font-mono text-foreground">{ls.name}</td>
                        <td className="px-4 py-2 text-muted-foreground">{ls.channel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-4 text-center">
                No log sources defined for {platform} in this data component.
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-border">
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
  channel?: string;
  requiredFields?: string[];
  missingFields?: string[];
  evidence?: string;
  sourceUrl?: string;
  verifiedByAi?: boolean;
}

interface AiEvidenceEntry {
  dataComponentId: string;
  dataComponentName: string;
  targetFields?: string[];
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
  const [sourceFilters, setSourceFilters] = useState<Set<ResourceType>>(() => new Set<ResourceType>(['ctid', 'sigma', 'elastic', 'splunk', 'azure']));
  const [showSourceFilter, setShowSourceFilter] = useState(false);
  const [showAllTechniques, setShowAllTechniques] = useState(false);
  const [showAllDataComponents, setShowAllDataComponents] = useState(false);
  const [newAlias, setNewAlias] = useState('');
  const [isEvidenceDialogOpen, setIsEvidenceDialogOpen] = useState(false);
  const [evidenceTechniqueId, setEvidenceTechniqueId] = useState('');
  const [evidenceTechniqueName, setEvidenceTechniqueName] = useState('');
  const [evidenceEntries, setEvidenceEntries] = useState<Array<{ name: string; channel: string; eventId: string; dataComponent: string }>>([]);
  const [evidenceQuery, setEvidenceQuery] = useState('');
  const [evidenceCaveats, setEvidenceCaveats] = useState('');
  const queryClient = useQueryClient();
  const deleteProductMutation = useDeleteProduct();
  const { toast } = useToast();
  
  const platform = normalizePlatformList(product.platforms || [])[0] || product.platforms[0];
  const productTitle = `${product.vendor} ${product.productName}`.trim();
  const productKey = product.productId ?? product.id;
  
  const { data: productData, refetch: refetchProduct } = useQuery<ProductData>({
    queryKey: ['product', product.id],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productKey}`);
      if (!res.ok) throw new Error('Failed to fetch product');
      return res.json();
    },
    staleTime: 30 * 1000,
  });

  const { data: productAliases = [] } = useQuery<ProductAlias[]>({
    queryKey: ['product-aliases', productKey],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productKey}/aliases`);
      if (res.status === 404) return [];
      if (!res.ok) throw new Error('Failed to fetch product aliases');
      return res.json();
    },
    staleTime: 30 * 1000,
  });

  const productStreamId = product.productId || productData?.productId;
  const { data: productStreams = [] } = useQuery<ProductStreamRow[]>({
    queryKey: ['product-streams', productStreamId],
    queryFn: async () => {
      const res = await fetch(`/api/products/${encodeURIComponent(String(productStreamId))}/streams`);
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
    return getAggregateCoverage(ssmCapabilities);
  }, [ssmCapabilities]);

  const techniqueIndex = useMemo(() => {
    const map = new Map<string, Technique>();
    techniques.forEach(tech => map.set(tech.id.toUpperCase(), tech));
    return map;
  }, []);

  const techniqueTacticMap = useMemo(() => {
    const map = new Map<string, string>();
    techniques.forEach((technique) => {
      map.set(technique.id.toUpperCase(), technique.tactic);
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

  const verifiedEvidence = useMemo(() => {
    const map = new Map<string, AiEvidenceEntry>();

    const normalizeLogSources = (sources: any[]): AiEvidenceLogSource[] => {
      if (!Array.isArray(sources)) return [];
      return sources
        .map((source) => {
          const name = typeof source?.name === 'string' ? source.name.trim() : '';
          if (!name) return null;
          const requiredFields = Array.isArray(source?.required_fields)
            ? source.required_fields
            : Array.isArray(source?.requiredFields) ? source.requiredFields : [];
          const missingFields = Array.isArray(source?.missing_fields)
            ? source.missing_fields
            : Array.isArray(source?.missingFields) ? source.missingFields : [];
          return {
            name,
            channel: typeof source?.channel === 'string' ? source.channel : undefined,
            requiredFields: requiredFields.filter((field: unknown) => typeof field === 'string') as string[],
            missingFields: missingFields.filter((field: unknown) => typeof field === 'string') as string[],
            evidence: typeof source?.evidence === 'string' ? source.evidence : undefined,
            sourceUrl: typeof source?.source_url === 'string'
              ? source.source_url
              : typeof source?.sourceUrl === 'string' ? source.sourceUrl : undefined,
            verifiedByAi: source?.verified_by_ai === true || source?.verifiedByAi === true,
          } as AiEvidenceLogSource;
        })
        .filter(Boolean) as AiEvidenceLogSource[];
    };

    productStreams.forEach((stream) => {
      const metadata = stream?.metadata || {};
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
        const targetFields = Array.isArray(entry?.target_fields)
          ? entry.target_fields
          : Array.isArray(entry?.targetFields) ? entry.targetFields : [];
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
            targetFields,
            logSources,
          });
          return;
        }

        const combined = [...existing.logSources];
        logSources.forEach((source) => {
          const duplicate = combined.some((existingSource) =>
            existingSource.name === source.name
            && existingSource.channel === source.channel
            && existingSource.sourceUrl === source.sourceUrl
          );
          if (!duplicate) {
            combined.push(source);
          }
        });
        existing.logSources = combined;
        if (!existing.targetFields?.length && targetFields.length > 0) {
          existing.targetFields = targetFields;
        }
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

  const mutableElementValuesByAnalytic = useMemo(() => {
    const map = new Map<string, Map<string, MutableElementValueEntry>>();
    productStreams.forEach((stream) => {
      const metadata = stream?.metadata || {};
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

    queryClient.invalidateQueries({ queryKey: ['product-ssm', productData?.id ?? 0] });
    setIsEvidenceDialogOpen(false);
  };

  const ssmTechniqueIds = useMemo(() => {
    const set = new Set<string>();
    ssmCapabilities.forEach(cap => {
      cap.mappings.forEach(mapping => set.add(mapping.techniqueId));
    });
    return Array.from(set);
  }, [ssmCapabilities]);

  const allPlatforms = useMemo(() => {
    const combined = [
      ...(product.platforms || []),
      ...(productData?.hybridSelectorValues || []),
    ];
    return normalizePlatformList(combined);
  }, [product.platforms, productData?.hybridSelectorValues]);

  const { data: ssmStixMapping } = useQuery<{
    detectionStrategies: StixDetectionStrategy[];
    dataComponents: StixDataComponent[];
    techniqueNames: Record<string, string>;
  }>({
    queryKey: ['ssm-stix-mapping', productKey, ssmTechniqueIds.join('|'), allPlatforms.join('|')],
    queryFn: async () => {
      const res = await fetch('/api/mitre-stix/techniques/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          techniqueIds: ssmTechniqueIds,
          platforms: allPlatforms.length > 0 ? allPlatforms : undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to fetch SSM technique mapping');
      return res.json();
    },
    enabled: ssmTechniqueIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const addAliasMutation = useMutation({
    mutationFn: async (alias: string) => {
      const res = await fetch(`/api/products/${productKey}/aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias }),
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

  const resolveTacticName = useMemo(() => {
    return (techniqueId: string, tactics?: string[]) => {
      if (Array.isArray(tactics) && tactics.length > 0) return tactics[0];
      const normalized = normalizeTechniqueId(techniqueId);
      const direct = coverageTacticMap.get(normalized)
        || techniqueIndex.get(normalized)?.tactic
        || techniqueTacticMap.get(normalized);
      if (direct) return direct;
      if (normalized.includes('.')) {
        const parentId = normalized.split('.')[0];
        return coverageTacticMap.get(parentId)
          || techniqueIndex.get(parentId)?.tactic
          || techniqueTacticMap.get(parentId)
          || 'Unknown';
      }
      return 'Unknown';
    };
  }, [coverageTacticMap, techniqueIndex, techniqueTacticMap]);

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
    product.id, 
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
      ssmCapabilities,
      ssmStixMapping?.detectionStrategies,
      getDetectionStrategiesForProduct(product.id),
      allPlatforms
    );
  }, [ssmCapabilities, ssmStixMapping?.detectionStrategies, product.id, allPlatforms]);
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

  const getLogSourcesForAnalytic = (analytic: AnalyticItem, targetPlatforms?: string[]): LogSourceRow[] => {
    const rows: LogSourceRow[] = [];
    const platformsToUse = targetPlatforms && targetPlatforms.length > 0 ? targetPlatforms : [platform];
    const allPrefixes = platformsToUse.flatMap(p => getPlatformPrefixes(p));

    analytic.dataComponents.forEach((dcId: string) => {
      const dc = dataComponents[dcId];
      if (!dc) return;

      if (dc.logSources && dc.logSources.length > 0) {
        const filteredSources = dc.logSources.filter(ls =>
          allPrefixes.some(prefix => ls.name.toLowerCase().startsWith(prefix.toLowerCase()))
        );
        filteredSources.forEach(ls => {
          rows.push({
            dataComponentId: dc.id,
            dataComponentName: dc.name,
            logSourceName: ls.name,
            channel: ls.channel,
          });
        });
      } else {
        const platformMappings = dc.platforms.filter(p => platformMatchesAny([p.platform], platformsToUse));
        platformMappings.forEach(mapping => {
          rows.push({
            dataComponentId: dc.id,
            dataComponentName: dc.name,
            logSourceName: mapping.logSourceName,
            channel: mapping.logChannel || '-',
          });
        });
      }
    });

    return rows;
  };

  const getLogSourcesForStixAnalytic = (analytic: StixAnalytic): LogSourceRow[] => {
    if (!analytic) {
      return [];
    }

    const rows: LogSourceRow[] = [];
    const seen = new Set<string>();
    const pushRow = (row: LogSourceRow) => {
      const key = `${row.dataComponentId.toLowerCase()}|${row.logSourceName.toLowerCase()}|${row.channel.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
    };

    const stixLogSources = Array.isArray(analytic.logSources) ? analytic.logSources : [];
    const stixDcIds = new Set<string>();

    stixLogSources
      .filter((ls) => ls && ls.dataComponentId && ls.dataComponentName && ls.name)
      .forEach((ls) => {
        stixDcIds.add(ls.dataComponentId.toLowerCase());
        pushRow({
          dataComponentId: ls.dataComponentId,
          dataComponentName: ls.dataComponentName,
          logSourceName: ls.name,
          channel: ls.channel || '-',
        });
      });

    if (Array.isArray(analytic.dataComponents) && verifiedEvidenceByDcId.size > 0) {
      analytic.dataComponents.forEach((dcId) => {
        if (!dcId) return;
        const dcKey = dcId.toLowerCase();
        if (stixDcIds.has(dcKey)) return;
        const evidence = verifiedEvidenceByDcId.get(dcKey);
        if (!evidence) return;
        const dcName = evidence.dataComponentName || dataComponents[dcId]?.name || dcId;
        evidence.logSources.forEach((source) => {
          if (!source.name) return;
          pushRow({
            dataComponentId: evidence.dataComponentId || dcId,
            dataComponentName: dcName,
            logSourceName: source.name,
            channel: source.channel || '-',
          });
        });
      });
    }

    return rows;
  };

  const isStixAnalytic = (analytic: AnalyticItem | StixAnalytic): analytic is StixAnalytic => {
    return Array.isArray((analytic as StixAnalytic).logSources) ||
      Array.isArray((analytic as StixAnalytic).mutableElements);
  };

  const getMutableElementsForAnalytic = (analytic: AnalyticItem): MutableElementRow[] => {
    const seen = new Set<string>();
    const rows: MutableElementRow[] = [];

    analytic.dataComponents.forEach((dcId: string) => {
      const dc = dataComponents[dcId];
      if (!dc) return;

      dc.mutableElements.forEach(me => {
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
            channel: '-',
          };
        }
        if (entry && typeof entry === 'object') {
          const obj = entry as { name?: string; channel?: string; dataComponent?: string };
          return {
            dataComponentId: 'custom',
            dataComponentName: obj.dataComponent || 'Custom Log Source',
            logSourceName: obj.name || 'Log Source',
            channel: obj.channel || '-',
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
      <details className="bg-background p-3 rounded border border-border">
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

  const getMutableElementsForCommunityAnalytic = (
    analytic: AnalyticItem,
    stixDataComponents: StixDataComponent[]
  ): MutableElementRow[] => {
    const seen = new Set<string>();
    const rows: MutableElementRow[] = [];

    analytic.dataComponents.forEach((dcId: string) => {
      let dc = dataComponents[dcId];
      if (!dc) {
        const stixDc = stixDataComponents.find(item => item.id === dcId);
        if (stixDc) {
          const candidates = dataComponentsByName.get(stixDc.name.toLowerCase()) || [];
          dc = candidates.find(candidate =>
            candidate.dataSource.toLowerCase() === stixDc.dataSource.toLowerCase()
          ) || candidates[0];
        }
      }

      if (!dc) return;

      dc.mutableElements.forEach(me => {
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

  const filteredStrategies = useMemo(() => {
    return strategies;
  }, [strategies]);

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
    (autoMapping.enrichedMapping?.communityAnalytics || []).forEach(ca => {
      const source = getCommunitySource(ca);
      if (source) sources.add(source);
    });
    return Array.from(sources);
  }, [autoMapping.enrichedMapping?.communityAnalytics, getCommunitySource]);

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
    
    if (autoMapping.enrichedMapping?.techniqueIds) {
      autoMapping.enrichedMapping.techniqueIds.forEach(id => fallbackIds.add(id.toUpperCase()));
    }

    return Array.from(fallbackIds).map(id => ({
      id,
      name: getTechniqueName(id),
      tactic: resolveTacticName(id),
      description: resolveTechniqueDescription(id),
      usedByGroups: [],
      detectionStrategies: []
    })).sort((a, b) => a.id.localeCompare(b.id));
  }, [coverageData?.coverage, ssmCoverage, autoMapping.enrichedMapping?.techniqueIds, getTechniqueName, resolveTacticName, resolveTechniqueDescription]);

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
    Object.keys(ssmCoverage).forEach(id => fallbackIds.add(id.toUpperCase()));
    if (autoMapping.enrichedMapping?.techniqueIds) {
      autoMapping.enrichedMapping.techniqueIds.forEach(id => fallbackIds.add(id.toUpperCase()));
    }

    return Array.from(fallbackIds).map(id => ({
      id,
      name: getTechniqueName(id),
      tactic: getTechniqueTactic(id),
      description: resolveTechniqueDescription(id),
      usedByGroups: [],
      detectionStrategies: []
    })).sort((a, b) => a.id.localeCompare(b.id));
  }, [visibilityCoverageData?.coverage, ssmCoverage, autoMapping.enrichedMapping?.techniqueIds, getTechniqueName, getTechniqueTactic, resolveTechniqueDescription, resolveTacticName]);

  const mappedTechniqueStats = useMemo(() => {
    const mappedIds = new Set<string>();
    if (ssmTechniqueIds.length > 0) {
      ssmTechniqueIds.forEach(id => mappedIds.add(id));
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
  }, [ssmTechniqueIds, visibilityTechniques, detectionTechniques, techniqueSources]);

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
    const hasTechniqueSources = Object.keys(techniqueSources).length > 0;

    return autoMapping.enrichedMapping.detectionStrategies.map(strategy => ({
      ...strategy,
      // Filter analytics by platform, but keep the strategy even if analytics become empty
      analytics: strategy.analytics.filter(a =>
        platformMatchesAny(a.platforms, allPlatforms)
      )
    })).filter(s => {
      // Filter by source (e.g. Sigma, Splunk) if filters are active
      if (!hasTechniqueSources) return true;
      const strategySources = getSourcesForStrategy(s);
      // If the strategy has no sources (shouldn't happen for auto-mapped items), keep it
      if (strategySources.length === 0) return true;
      return strategySources.some(src => sourceFilters.has(src));
    });
  }, [autoMapping.enrichedMapping?.detectionStrategies, allPlatforms, sourceFilters, techniqueSources, getSourcesForStrategy]);

  const communityStrategiesCount = useMemo(() => {
    return filteredCommunityStrategies.length;
  }, [filteredCommunityStrategies]);

  const communityAnalyticsCount = useMemo(() => {
    return filteredCommunityStrategies.reduce(
      (sum, s) => sum + s.analytics.length, 0
    );
  }, [filteredCommunityStrategies]);

  const detectionCoverageScore = useMemo(() => {
    const totalTechniques = mitreStats?.techniques || techniques.length || 1;
    const score = Math.round((detectionTechniques.length / totalTechniques) * 100);
    return Math.min(100, Math.max(0, score));
  }, [detectionTechniques.length, mitreStats?.techniques]);

  const overviewTechniqueCount = useMemo(() => {
    if (visibilityTechniques.length > 0) return visibilityTechniques.length;
    if (detectionTechniques.length > 0) return detectionTechniques.length;
    if (ssmTechniqueIds.length > 0) return ssmTechniqueIds.length;
    const fallbackCount = Object.keys(techniqueSources).length;
    return fallbackCount;
  }, [visibilityTechniques.length, detectionTechniques.length, ssmTechniqueIds.length, techniqueSources]);

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

  const renderStrategyList = (
    strategiesToRender: Array<{ id: string; name: string; description: string; techniques: string[]; analytics: AnalyticItem[] | StixAnalytic[] }>,
    sectionKey: string
  ) => (
    <div className="space-y-3">
      {strategiesToRender.map((strategy) => {
        const strategyKey = `${sectionKey}-strategy-${strategy.id}`;
        const isStrategyExpanded = expandedStrategies.has(strategyKey);
        return (
          <div key={strategyKey} className="border border-border rounded-lg overflow-hidden bg-card">
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
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-xs text-primary font-mono">{strategy.id}</code>
                  <span className="font-semibold text-foreground">{strategy.name}</span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-1">{strategy.description}</p>
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
                      const strategyMetadata = getMetadataForTechniques(strategy.techniques);
                      const overrideLogSources = getLogSourcesFromMetadata(strategyMetadata);
                      const overrideMutableElements = getMutableElementsFromMetadata(strategyMetadata);
                      const metadataQuery = getQueryFromMetadata(strategyMetadata);
                      const logSources = overrideLogSources.length > 0
                        ? overrideLogSources
                        : (isStixAnalytic(analytic)
                          ? getLogSourcesForStixAnalytic(analytic)
                          : getLogSourcesForAnalytic(analytic));
                      const mutableElements = overrideMutableElements.length > 0
                        ? overrideMutableElements
                        : (isStixAnalytic(analytic)
                          ? getMutableElementsForStixAnalytic(analytic)
                          : getMutableElementsForAnalytic(analytic));
                      const showMutableValues = mutableElements.some((element) =>
                        typeof element.value === 'string' && element.value.trim().length > 0
                      );

                      return (
                        <div key={analyticKey} className="border border-border rounded-md overflow-hidden bg-background">
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
                            </div>
                          </button>

                          {isAnalyticExpanded && (
                            <div className="px-4 pb-4 pt-2 border-t border-border space-y-5">
                              <div>
                                <h5 className="text-sm font-medium text-muted-foreground mb-2">Description</h5>
                                <p className="text-sm text-foreground">{analytic.description}</p>
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
                                            >
                                              <Badge variant="outline" className="text-xs hover:bg-muted/50 transition-colors">
                                                <code className="text-red-600 mr-1">{techId}</code>
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
                                          {techniqueDescription && (
                                            <p className="text-xs text-muted-foreground">
                                              {techniqueDescription}
                                            </p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              <div>
                                <h5 className="text-sm font-medium text-muted-foreground mb-2">Log Sources</h5>
                                <div className="border border-border rounded-md overflow-hidden">
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
                                                const dc = dataComponents[row.dataComponentId];
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
                                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.channel}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              {mutableElements.length > 0 && (
                                <div>
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">Mutable Elements</h5>
                                  <div className="border border-border rounded-md overflow-hidden">
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
                                </div>
                              )}

                              {metadataQuery && (
                                <div>
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">Analytic Logic</h5>
                                  <pre className="text-xs bg-muted/40 border border-border rounded-md p-3 overflow-x-auto">
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
    </div>
  );

  const renderCommunityStrategyList = (
    strategiesToRender: Array<{ id: string; name: string; description: string; techniques: string[]; analytics: AnalyticItem[] | StixAnalytic[] }>,
    sectionKey: string
  ) => (
    <div className="space-y-3">
      {strategiesToRender.map((strategy) => {
        const analytics = strategy.analytics as StixAnalytic[];
        const strategyKey = `${sectionKey}-strategy-${strategy.id}`;
        const isStrategyExpanded = expandedStrategies.has(strategyKey);
        const stixDataComponents = autoMapping.enrichedMapping?.dataComponents || [];
        const communityAnalytics = autoMapping.enrichedMapping?.communityAnalytics || [];
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
          <div key={strategyKey} className="border border-border rounded-lg overflow-hidden bg-card">
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
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-xs text-primary font-mono">{strategy.id}</code>
                  <span className="font-semibold text-foreground">{strategy.name}</span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-1">{strategy.description}</p>
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
                      const visibleCommunityAnalytics = communityAnalytics.filter(ca => {
                        const source = getCommunitySource(ca);
                        if (!source || !sourceFilters.has(source)) return false;
                        return hasTechniqueOverlap(ca.techniqueIds, strategy.techniques);
                      });
                      const splunkAnalytics = visibleCommunityAnalytics.filter(ca =>
                        getCommunitySource(ca) === 'splunk'
                      );
                      const elasticAnalytics = visibleCommunityAnalytics.filter(ca =>
                        getCommunitySource(ca) === 'elastic'
                      );
                      const azureAnalytics = visibleCommunityAnalytics.filter(ca =>
                        getCommunitySource(ca) === 'azure'
                      );
                      const sigmaAnalytics = visibleCommunityAnalytics.filter(ca =>
                        getCommunitySource(ca) === 'sigma'
                      );
                      const ctidAnalytics = visibleCommunityAnalytics.filter(ca =>
                        getCommunitySource(ca) === 'ctid'
                      );

                      const uniqueLogSources = getLogSourcesForStixAnalytic(analytic);
                      const uniqueMutableElements = getMutableElementsForStixAnalytic(analytic);
                      const elasticMutableElements = getCommunityMutableElements(elasticAnalytics, 'Elastic');
                      const azureMutableElements = getCommunityMutableElements(azureAnalytics, 'Azure');
                      const combinedMutableElements = (() => {
                        const seen = new Set<string>();
                        const rows: MutableElementRow[] = [];
                        [...uniqueMutableElements, ...elasticMutableElements, ...azureMutableElements].forEach(me => {
                          const key = me.field.toLowerCase();
                          if (seen.has(key)) return;
                          seen.add(key);
                          rows.push(me);
                        });
                        return rows;
                      })();
                      const hasMitreEnrichment = uniqueLogSources.length > 0 || uniqueMutableElements.length > 0;
                      const hasSplunkData = splunkAnalytics.length > 0;
                      const hasElasticData = elasticAnalytics.length > 0;
                      const hasAzureData = azureAnalytics.length > 0;
                      const hasSigmaData = sigmaAnalytics.length > 0;
                      const hasCtidData = ctidAnalytics.length > 0;

                      return (
                        <div key={analyticKey} className="border border-border rounded-md overflow-hidden bg-background">
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
                            <div className="px-4 pb-4 pt-2 border-t border-border space-y-5">
                              <div>
                                <h5 className="text-sm font-medium text-muted-foreground mb-2">Description</h5>
                                <p className="text-sm text-foreground">{analytic.description}</p>
                              </div>

                              {strategy.techniques.length > 0 && (
                                <div>
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">Techniques</h5>
                                  <div className="flex flex-wrap gap-1">
                                    {strategy.techniques.map(techId => (
                                      <div key={techId} className="flex flex-col gap-1">
                                        <a
                                          href={`https://attack.mitre.org/techniques/${techId.replace('.', '/')}/`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          <Badge variant="outline" className="text-xs hover:bg-muted/50 transition-colors">
                                            <code className="text-red-600 mr-1">{techId}</code>
                                            <ExternalLink className="w-3 h-3 text-muted-foreground" />
                                          </Badge>
                                        </a>
                                        {resolveTechniqueDescription(techId) && (
                                          <p className="text-xs text-muted-foreground">
                                            {resolveTechniqueDescription(techId)}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {uniqueLogSources.length > 0 && (
                                <div>
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">Log Sources</h5>
                                  <div className="border border-border rounded-md overflow-hidden">
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
                                                  const dc = dataComponents[row.dataComponentId];
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
                                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.channel}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              <div>
                                <h5 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                                  Mutable Elements
                                </h5>
                                <div className="border border-border rounded-md overflow-hidden">
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
    </div>
  );

  const renderAttackTree = (
    attackTree: Array<{
      name: string;
      techniques: Array<{
        id: string;
        name: string;
        strategies: Array<{ id: string; name: string; description: string; techniques: string[]; analytics: AnalyticItem[] | StixAnalytic[] }>;
        subtechniques: Array<{
          id: string;
          name: string;
          strategies: Array<{ id: string; name: string; description: string; techniques: string[]; analytics: AnalyticItem[] | StixAnalytic[] }>;
        }>;
      }>;
    }>,
    sectionKey: string,
    renderStrategies: (strategies: Array<{ id: string; name: string; description: string; techniques: string[]; analytics: AnalyticItem[] | StixAnalytic[] }>, key: string) => JSX.Element
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
          const tacticAnalyticsCount = tactic.techniques.reduce((sum, technique) => (
            sum
            + getAnalyticsCount(technique.strategies)
            + technique.subtechniques.reduce((subSum, sub) => subSum + getAnalyticsCount(sub.strategies), 0)
          ), 0);

          return (
            <div key={tacticKey} className="border border-border rounded-lg overflow-hidden bg-card">
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
                      const techniqueStrategyCount = technique.strategies.length + technique.subtechniques.reduce((sum, sub) => sum + sub.strategies.length, 0);
                      const techniqueAnalyticsCount = getAnalyticsCount(technique.strategies)
                        + technique.subtechniques.reduce((sum, sub) => sum + getAnalyticsCount(sub.strategies), 0);

                      return (
                        <div key={techniqueKey} className="border border-border rounded-md overflow-hidden bg-background">
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
                                  {technique.description}
                                </p>
                              )}
                            </div>
                            {!isTechniqueExpanded && (
                              <div className="flex items-center gap-2 flex-shrink-0">
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
                                {technique.strategies.length > 0 && (
                                  <div className="space-y-3">
                                    <div className="text-xs uppercase text-muted-foreground tracking-wide">Detection Strategies</div>
                                    {renderStrategies(technique.strategies, `${sectionKey}-${technique.id}`)}
                                  </div>
                                )}

                                {technique.subtechniques.length > 0 && (
                                  <div className="space-y-3">
                                    <div className="text-xs uppercase text-muted-foreground tracking-wide">Sub-Techniques</div>
                                    {technique.subtechniques.map(subtechnique => {
                                      const subtechKey = `${sectionKey}-subtech-${subtechnique.id}`;
                                      const isSubtechExpanded = expandedSubtechniques.has(subtechKey);
                                      const subtechAnalyticsCount = getAnalyticsCount(subtechnique.strategies);

                                      return (
                                        <div key={subtechKey} className="border border-border rounded-md overflow-hidden bg-card">
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
                                                  {subtechnique.description}
                                                </p>
                                              )}
                                            </div>
                                            {!isSubtechExpanded && (
                                              <div className="flex items-center gap-2 flex-shrink-0">
                                                <Badge variant="secondary" className="text-xs">
                                                  {subtechnique.strategies.length} Strategies
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
                                                {renderStrategies(subtechnique.strategies, `${sectionKey}-${subtechnique.id}`)}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {technique.strategies.length === 0 && technique.subtechniques.length === 0 && (
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
    // Start with static data components
    const staticDCs = product.dataComponentIds
      .map(id => dataComponents[id])
      .filter(Boolean);
    
    // Add dynamic data components from auto-mapping
    const dynamicDCs = autoMapping.enrichedMapping?.dataComponents || [];
    
    // Combine and deduplicate by ID
    const combined = [...staticDCs];
    
    dynamicDCs.forEach(dc => {
      // Skip if already present by ID
      if (combined.some(existing => existing.id === dc.id)) return;
      
      // Check if we have static metadata for this ID (now that IDs match)
      const staticMeta = dataComponents[dc.id];
      
      if (staticMeta) {
        combined.push(staticMeta);
      } else {
        // Fallback to dynamic DC data
        combined.push({
          id: dc.id,
          name: dc.name,
          dataSource: dc.dataSource,
          description: 'Dynamically mapped data component',
          mutableElements: [],
          platforms: []
        });
      }
    });
    return combined;
  }, [product.dataComponentIds, autoMapping.enrichedMapping?.dataComponents]);

  const tocItems = [
    { id: 'overview', label: 'Overview' },
    { id: 'coverage', label: 'Coverage Summary' },
    { id: 'verified-evidence', label: 'Verified Evidence' },
    { id: 'detection-strategies', label: 'CTID Mappings' },
    { id: 'community-coverage', label: 'Mappings based from Community Resources' },
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
              </div>
            </div>
            
            <section className="mt-6" id="coverage">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg border border-border bg-muted/30">
                  <div className="text-2xl font-semibold text-foreground">
                    {filteredStrategies.length + communityStrategiesCount}
                  </div>
                  <div className="text-sm text-muted-foreground">CTID + Community Mappings</div>
                </div>
                <div className="p-4 rounded-lg border border-border bg-muted/30">
                  <div className="text-2xl font-semibold text-foreground">
                    {totalAnalytics + communityAnalyticsCount}
                  </div>
                  <div className="text-sm text-muted-foreground">Analytics</div>
                </div>
                <div className="p-4 rounded-lg border border-border bg-muted/30">
                  <div className="text-2xl font-semibold text-foreground">{overviewTechniqueCount}</div>
                  <div className="text-sm text-muted-foreground">Techniques Covered</div>
                </div>
                <div className="p-4 rounded-lg border border-border bg-muted/30">
                <div className="text-xl font-semibold text-foreground">
                  {`${mappedTechniqueStats.withCommunity}/${mappedTechniqueStats.total} (${mappedTechniqueStats.total > 0 ? Math.round((mappedTechniqueStats.withCommunity / mappedTechniqueStats.total) * 100) : 0}%)`}
                </div>
                <div className="text-sm text-muted-foreground">Techniques with at least 1 Detection Rule</div>
              </div>
              </div>
            </section>

            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    Mapped Techniques
                  </h3>
                  {visibilityTechniques.length > 20 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllTechniques(!showAllTechniques)}
                      className="text-xs h-7 text-muted-foreground hover:text-foreground"
                    >
                      {showAllTechniques ? 'Show Less' : `Show All (${visibilityTechniques.length})`}
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Techniques mapped to this product (Detection + Visibility):
                </p>
                <div className={cn("pr-4 overflow-y-auto", !showAllTechniques && "max-h-48")}>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const detectionSet = new Set(detectionTechniques.map(t => t.id));
                      return visibilityTechniques.map(tech => {
                        const hasDetection = detectionSet.has(tech.id);
                        return (
                          <button
                            key={tech.id}
                            onClick={() => {
                              const tactic = tech.tactic.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                              const element = document.getElementById(`ctid-tactic-${tactic}`);
                              if (element) {
                                element.scrollIntoView({ behavior: 'smooth' });
                                setExpandedTactics(prev => new Set(prev).add(`ctid-tactic-${tactic}`));
                                setExpandedTechniques(prev => new Set(prev).add(`ctid-tech-${tech.id}`));
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-muted/50 hover:bg-muted hover:border-primary/30 transition-colors text-sm"
                            data-testid={`button-tech-chip-${tech.id}`}
                          >
                            <code className={cn(
                              "text-xs font-mono",
                              hasDetection ? "text-red-600 font-bold" : "text-slate-500 font-medium"
                            )}>
                              {tech.id}
                            </code>
                            <span className="text-foreground">{tech.name}</span>
                          </button>
                        );
                      });
                    })()}
                    {visibilityTechniques.length === 0 && (
                      <div className="text-sm text-muted-foreground italic">No techniques mapped yet.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Database className="w-4 h-4 text-primary" />
                    Mapped Data Components
                  </h3>
                  {mappedDataComponents.length > 20 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllDataComponents(!showAllDataComponents)}
                      className="text-xs h-7 text-muted-foreground hover:text-foreground"
                    >
                      {showAllDataComponents ? 'Show Less' : `Show All (${mappedDataComponents.length})`}
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  This asset provides the following telemetry sources:
                </p>
                <div className={cn("pr-4 overflow-y-auto", !showAllDataComponents && "max-h-48")}>
                  <div className="flex flex-wrap gap-2">
                    {mappedDataComponents.map(dc => (
                        <button
                          key={dc.id}
                          onClick={() => setSelectedDataComponent(dc)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-muted/50 hover:bg-muted hover:border-primary/30 transition-colors text-sm"
                          data-testid={`button-dc-chip-${dc.id}`}
                        >
                          <code className="text-xs text-primary font-mono">{dc.id}</code>
                          <span className="text-foreground">{dc.name}</span>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </div>

            <section className="mt-6" id="verified-evidence">
              <div className="p-4 rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    Verified Evidence
                  </h3>
                  {verifiedEvidence.length > 0 && (
                    <Badge variant="secondary" className="text-xs">Verified by AI</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Product-specific log sources validated against vendor documentation.
                </p>
                {verifiedEvidence.length > 0 ? (
                  <div className="space-y-4">
                    {verifiedEvidence.map((entry) => {
                      const targetFields = entry.targetFields || [];
                      const requiredFields = Array.from(
                        new Set(entry.logSources.flatMap((source) => source.requiredFields || []))
                      );
                      const matchedCount = targetFields.length > 0
                        ? requiredFields.filter((field) =>
                          targetFields.some((target) => target.toLowerCase() === field.toLowerCase())
                        ).length
                        : 0;
                      return (
                        <div key={entry.dataComponentId} className="rounded-lg border border-border/60 bg-background/50 p-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-foreground">
                              {entry.dataComponentId} - {entry.dataComponentName}
                            </div>
                            <Badge variant="outline" className="text-[10px]">Verified by AI</Badge>
                          </div>
                          {targetFields.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              Mutable element checklist (STIX): {targetFields.join(', ')} · Field match: {matchedCount}/{targetFields.length}
                            </div>
                          )}
                          <div className="border border-border rounded-md overflow-hidden">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/50">
                                <tr>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Log Source</th>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Channel</th>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Required Fields</th>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Source</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {entry.logSources.map((source, idx) => (
                                  <tr key={`${entry.dataComponentId}-${idx}`}>
                                    <td className="px-3 py-2 font-mono text-foreground">{source.name}</td>
                                    <td className="px-3 py-2 font-mono text-muted-foreground">{source.channel || '-'}</td>
                                    <td className="px-3 py-2">
                                      {source.requiredFields && source.requiredFields.length > 0 ? (
                                        <div className="flex flex-wrap gap-1">
                                          {source.requiredFields.map((field) => (
                                            <Badge key={`${entry.dataComponentId}-${idx}-${field}`} variant="outline" className="text-[10px]">
                                              {field}
                                            </Badge>
                                          ))}
                                          {source.missingFields && source.missingFields.length > 0 && (
                                            source.missingFields.map((field) => (
                                              <Badge key={`${entry.dataComponentId}-${idx}-missing-${field}`} variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                                                Missing: {field}
                                              </Badge>
                                            ))
                                          )}
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground">-</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      {source.sourceUrl ? (
                                        <a
                                          href={source.sourceUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-primary underline underline-offset-2"
                                        >
                                          {source.sourceUrl}
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
                  <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4 text-center">
                    No verified evidence saved yet.
                  </div>
                )}
              </div>
            </section>

          </header>

          <section id="detection-strategies">
            <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              CTID Mappings
            </h2>
            <p className="text-muted-foreground mb-6">
              CTID mappings for {product.productName} on {platform}, organized by tactic, technique, and analytic for easier traversal.
            </p>

            {ctidAttackTree.length > 0 ? (
              renderAttackTree(ctidAttackTree, 'ctid', renderStrategyList)
            ) : (
              <div className="py-12 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                No CTID mappings found for {product.productName} on {platform}.
              </div>
            )}
          </section>

          {/* Mappings based from Community Resources */}
          <section id="community-coverage" className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Mappings based from Community Resources
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

            {autoMapping.isLoading && (
              <div className="py-8 text-center border border-dashed border-border rounded-lg">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                <p className="text-muted-foreground">Querying community resources...</p>
              </div>
            )}

            {filteredCommunityStrategies.length > 0 && (
              renderAttackTree(communityAttackTree, 'community', renderCommunityStrategyList)
            )}

            {autoMapping.data?.status === 'matched' && !autoMapping.isLoading && autoMapping.enrichedMapping && filteredCommunityStrategies.length === 0 && autoMapping.enrichedMapping.techniqueIds.length === 0 && (
              <div className="py-8 text-center border border-dashed border-border rounded-lg">
                <p className="text-muted-foreground">Found community references, but no MITRE ATT&CK technique IDs could be extracted from the detection rules.</p>
              </div>
            )}

            {autoMapping.data?.status === 'matched' && !autoMapping.isLoading && autoMapping.enrichedMapping && filteredCommunityStrategies.length === 0 && autoMapping.enrichedMapping.techniqueIds.length > 0 && (
              <div className="p-4 rounded-lg border border-border bg-card">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Found <strong className="text-foreground">{autoMapping.enrichedMapping.techniqueIds.length}</strong> technique references from {RESOURCE_LABELS[autoMapping.enrichedMapping.source]?.label}, but these techniques don't have detection strategies defined in the MITRE ATT&CK STIX v18 knowledge base. Not all ATT&CK techniques have corresponding detection strategies.
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      The community detection rules still provide value - they show this product is referenced in active threat detection content.
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
              <div className="py-8 text-center border border-dashed border-amber-500/50 rounded-lg bg-amber-500/5">
                <AlertCircle className="w-6 h-6 mx-auto mb-2 text-amber-500" />
                <p className="text-amber-600 font-medium">No Automated Mappings Found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  This product requires AI-assisted mapping to determine detection coverage.
                </p>
              </div>
            )}

            {autoMapping.data?.status === 'not_found' && (
              <div className="py-8 text-center border border-dashed border-border rounded-lg">
                <p className="text-muted-foreground">No references to this product found in community detection rule repositories (Sigma, Elastic, Splunk, Azure).</p>
              </div>
            )}

            {!autoMapping.data && !autoMapping.isLoading && (
              <div className="py-8 text-center border border-dashed border-border rounded-lg">
                <p className="text-muted-foreground">Community coverage will load automatically.</p>
              </div>
            )}
          </section>
        </div>
      </div>

      <aside className="w-40 flex-shrink-0 border-l border-border p-6 sticky top-0 h-screen overflow-auto hidden xl:block">
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
          onClose={() => setSelectedDataComponent(null)}
        />
      )}

      </div>
  );
}
