import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProducts } from '@/hooks/useProducts';
import { useToast } from '@/hooks/use-toast';
import { ChevronRight, Filter, GitBranch, Loader2, Route, Plus, X, Save, Sparkles } from 'lucide-react';

interface CoveragePathNode {
  id: string;
  type: string;
  name: string;
  externalId?: string;
  label: string;
}

interface CoveragePathRow {
  techniqueId: string;
  techniqueName: string;
  originProductId: string;
  path: string[];
  pathNodes: CoveragePathNode[];
}

interface CoverageRow {
  techniqueId: string;
  techniqueName: string;
  coverageCount: number;
  tactics?: string[];
  techniqueDescription?: string;
}

interface ProductStreamRow {
  id: number;
  name: string;
  streamType?: string;
  metadata?: Record<string, unknown> | null;
  mappedDataComponents?: unknown;
}

interface StreamMutableValue {
  analytic_id: string;
  field: string;
  value: string;
  source_url?: string;
  note?: string;
}

interface PathBuilderLogSourceOverride {
  analytic_id?: string;
  data_component_id?: string;
  data_component_name?: string;
  name: string;
  channel?: string;
  notes?: string;
  source_url?: string;
}

interface PathBuilderOverrides {
  analytic_log_sources: PathBuilderLogSourceOverride[];
  dc_log_sources: PathBuilderLogSourceOverride[];
  mutable_element_values: StreamMutableValue[];
}

interface StixLogSource {
  dataComponentId: string;
  dataComponentName: string;
  name: string;
  channel?: string;
}

interface StixMutableElement {
  field: string;
  description: string;
}

interface StixAnalytic {
  id: string;
  name: string;
  description: string;
  platforms: string[];
  dataComponents: string[];
  logSources: StixLogSource[];
  mutableElements: StixMutableElement[];
}

interface StixDetectionStrategy {
  id: string;
  name: string;
  description: string;
  techniques: string[];
  analytics: StixAnalytic[];
}

interface StixDataComponent {
  id: string;
  name: string;
  dataSource: string;
}

interface StixMappingResponse {
  detectionStrategies: StixDetectionStrategy[];
  dataComponents: StixDataComponent[];
}

interface EditableLogSource {
  name: string;
  channel: string;
  dataComponentId?: string;
  dataComponentName?: string;
  notes?: string;
  sourceUrl?: string;
}

interface EditableMutableElement {
  field: string;
  description: string;
  value: string;
  sourceUrl?: string;
  note?: string;
}

type NodeEditorDraft =
  | {
      kind: 'analytic';
      analyticId: string;
      analyticName: string;
      analyticDescription: string;
      logSources: EditableLogSource[];
      mutableElements: EditableMutableElement[];
      defaultLogSources: EditableLogSource[];
      defaultMutableElements: EditableMutableElement[];
    }
  | {
      kind: 'data_component';
      dataComponentId: string;
      dataComponentName: string;
      dataSource?: string;
      logSources: EditableLogSource[];
      defaultLogSources: EditableLogSource[];
    };

type SelectedEditorNode =
  | { kind: 'analytic'; analyticId: string }
  | { kind: 'data_component'; dataComponentId: string };

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

const PATH_BUILDER_STREAM_NAME = '__path_builder_overrides__';

function normalizeTechniqueId(value: string): string {
  const match = value.toUpperCase().match(/T\d{4}(?:\.\d{3})?/);
  return match ? match[0] : value.toUpperCase();
}

function parseTechniqueInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map(normalizeTechniqueId)
        .filter((entry) => /^T\d{4}(?:\.\d{3})?$/.test(entry))
    )
  );
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
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
}

function normalizeUpper(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeLower(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeChannelText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry || '').trim()))
      .filter((entry) => entry.length > 0)
      .join(', ');
  }
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function dedupeEditableLogSources(rows: EditableLogSource[]): EditableLogSource[] {
  const byKey = new Map<string, EditableLogSource>();
  rows.forEach((row) => {
    const name = row.name.trim();
    if (!name) return;
    const key = `${normalizeLower(row.dataComponentId || row.dataComponentName || '')}|${normalizeLower(name)}|${normalizeLower(row.channel || '')}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...row,
        name,
        channel: (row.channel || '').trim(),
        dataComponentId: row.dataComponentId?.trim(),
        dataComponentName: row.dataComponentName?.trim(),
        notes: row.notes?.trim(),
        sourceUrl: row.sourceUrl?.trim(),
      });
    }
  });
  return Array.from(byKey.values());
}

function getNodeStyles(type: string): string {
  switch (type) {
    case 'x-mitre-mapper-product':
      return 'bg-primary/20 text-primary border-primary/40';
    case 'data_component':
    case 'x-mitre-data-component':
      return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
    case 'analytic':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    case 'detection-strategy':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'technique':
      return 'bg-red-500/20 text-red-300 border-red-500/40';
    default:
      return 'bg-muted text-foreground border-border';
  }
}

function emptyOverrides(): PathBuilderOverrides {
  return {
    analytic_log_sources: [],
    dc_log_sources: [],
    mutable_element_values: [],
  };
}

function hasAnyOverrides(overrides: PathBuilderOverrides): boolean {
  return (
    overrides.analytic_log_sources.length > 0 ||
    overrides.dc_log_sources.length > 0 ||
    overrides.mutable_element_values.length > 0
  );
}

export default function PathBuilder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queryParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  const queryProductId = (queryParams.get('productId') || '').trim();
  const queryTechniques = parseTechniqueInput(queryParams.get('techniques') || '');

  const [selectedProductId, setSelectedProductId] = useState<string>(queryProductId);
  const [techniqueInput, setTechniqueInput] = useState<string>(queryTechniques.join(', '));
  const [selectedTechniqueIds, setSelectedTechniqueIds] = useState<Set<string>>(new Set(queryTechniques));
  const [selectedEditorNode, setSelectedEditorNode] = useState<SelectedEditorNode | null>(null);
  const [editorDraft, setEditorDraft] = useState<NodeEditorDraft | null>(null);

  const { data: products = [], isLoading: productsLoading } = useProducts();

  const sortedProducts = useMemo(() => (
    [...products].sort((a, b) => {
      const vendorCompare = a.vendor.localeCompare(b.vendor);
      if (vendorCompare !== 0) return vendorCompare;
      return a.productName.localeCompare(b.productName);
    })
  ), [products]);

  useEffect(() => {
    if (sortedProducts.length === 0) return;
    const exists = sortedProducts.some((product) => product.productId === selectedProductId);
    if (!exists) {
      setSelectedProductId(sortedProducts[0].productId);
      setSelectedEditorNode(null);
      setEditorDraft(null);
    }
  }, [selectedProductId, sortedProducts]);

  const selectedProduct = useMemo(
    () => sortedProducts.find((product) => product.productId === selectedProductId) || null,
    [sortedProducts, selectedProductId]
  );

  const selectedTechniqueList = useMemo(
    () => Array.from(selectedTechniqueIds).sort((a, b) => a.localeCompare(b)),
    [selectedTechniqueIds]
  );

  const { data: coverageData, isLoading: coverageLoading } = useQuery<{ coverage: CoverageRow[] }>({
    queryKey: ['path-builder-coverage', selectedProductId],
    enabled: Boolean(selectedProductId),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('productId', selectedProductId);
      params.set('scope', 'detection');
      const response = await fetch(`/api/graph/coverage?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch product coverage');
      }
      return response.json();
    },
    staleTime: 60 * 1000,
  });

  const { data: coveragePathsData, isLoading: pathsLoading } = useQuery<{ paths: CoveragePathRow[] }>({
    queryKey: ['path-builder-paths', selectedProductId, selectedTechniqueList.join('|')],
    enabled: Boolean(selectedProductId),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('productId', selectedProductId);
      params.set('limit', '600');
      if (selectedTechniqueList.length > 0) {
        params.set('techniques', selectedTechniqueList.join(','));
      }
      const response = await fetch(`/api/graph/coverage/paths?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch coverage paths');
      }
      return response.json();
    },
    staleTime: 60 * 1000,
  });

  const { data: productStreamsData, isLoading: streamsLoading } = useQuery<{ streams: ProductStreamRow[] }>({
    queryKey: ['path-builder-streams', selectedProductId],
    enabled: Boolean(selectedProductId),
    queryFn: async () => {
      const response = await fetch(`/api/products/${encodeURIComponent(selectedProductId)}/streams`);
      if (!response.ok) {
        throw new Error('Failed to fetch product streams');
      }
      return response.json();
    },
    staleTime: 30 * 1000,
  });

  const productStreams = useMemo(
    () => (Array.isArray(productStreamsData?.streams) ? productStreamsData.streams : []),
    [productStreamsData?.streams]
  );

  const coverageByTechniqueId = useMemo(() => {
    const map = new Map<string, CoverageRow>();
    (coverageData?.coverage || []).forEach((row) => {
      map.set(normalizeTechniqueId(row.techniqueId), row);
    });
    return map;
  }, [coverageData?.coverage]);

  const availableTechniques = useMemo(
    () => (coverageData?.coverage || []).map((row) => normalizeTechniqueId(row.techniqueId)).sort((a, b) => a.localeCompare(b)),
    [coverageData?.coverage]
  );

  const groupedPaths = useMemo(() => {
    const dedupe = new Set<string>();
    const grouped = new Map<string, { techniqueName: string; rows: CoveragePathRow[] }>();
    (coveragePathsData?.paths || []).forEach((row) => {
      const techniqueId = normalizeTechniqueId(row.techniqueId);
      const dedupeKey = `${techniqueId}|${row.path.join('>')}`;
      if (dedupe.has(dedupeKey)) return;
      dedupe.add(dedupeKey);

      const current = grouped.get(techniqueId) || {
        techniqueName: row.techniqueName,
        rows: [],
      };
      current.rows.push(row);
      if (!current.techniqueName && row.techniqueName) {
        current.techniqueName = row.techniqueName;
      }
      grouped.set(techniqueId, current);
    });

    return Array.from(grouped.entries())
      .map(([techniqueId, value]) => ({
        techniqueId,
        techniqueName: value.techniqueName,
        rows: value.rows,
      }))
      .sort((a, b) => a.techniqueId.localeCompare(b.techniqueId));
  }, [coveragePathsData?.paths]);

  const requiredDataComponentsCount = useMemo(() => {
    const ids = new Set<string>();
    (coveragePathsData?.paths || []).forEach((row) => {
      (row.pathNodes || [])
        .filter((node) => node.type === 'data_component' || node.type === 'x-mitre-data-component')
        .forEach((node) => ids.add(node.id));
    });
    return ids.size;
  }, [coveragePathsData?.paths]);

  const techniquesForMapping = useMemo(() => {
    if (selectedTechniqueList.length > 0) return selectedTechniqueList;
    return groupedPaths.map((group) => group.techniqueId);
  }, [selectedTechniqueList, groupedPaths]);

  const { data: stixMappingData, isLoading: stixMappingLoading } = useQuery<StixMappingResponse>({
    queryKey: [
      'path-builder-stix-mapping',
      selectedProductId,
      techniquesForMapping.join('|'),
      (selectedProduct?.platforms || []).join('|'),
    ],
    enabled: techniquesForMapping.length > 0,
    queryFn: async () => {
      const response = await fetch('/api/mitre-stix/techniques/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          techniqueIds: techniquesForMapping,
          platforms: selectedProduct?.platforms || undefined,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to fetch STIX mapping details');
      }
      return response.json();
    },
    staleTime: 60 * 1000,
  });

  const analyticById = useMemo(() => {
    const map = new Map<string, StixAnalytic>();
    (stixMappingData?.detectionStrategies || []).forEach((strategy) => {
      (strategy.analytics || []).forEach((analytic) => {
        const id = normalizeUpper(analytic.id || '');
        if (!id) return;
        if (!map.has(id)) {
          map.set(id, analytic);
        }
      });
    });
    return map;
  }, [stixMappingData?.detectionStrategies]);

  const dataComponentById = useMemo(() => {
    const map = new Map<string, StixDataComponent>();
    (stixMappingData?.dataComponents || []).forEach((dc) => {
      const id = normalizeUpper(dc.id || '');
      if (!id) return;
      if (!map.has(id)) {
        map.set(id, dc);
      }
    });
    (stixMappingData?.detectionStrategies || []).forEach((strategy) => {
      (strategy.analytics || []).forEach((analytic) => {
        (analytic.logSources || []).forEach((source) => {
          const id = normalizeUpper(source.dataComponentId || '');
          if (!id) return;
          if (!map.has(id)) {
            map.set(id, {
              id,
              name: source.dataComponentName || id,
              dataSource: '',
            });
          }
        });
      });
    });
    return map;
  }, [stixMappingData?.dataComponents, stixMappingData?.detectionStrategies]);

  const pathBuilderOverrides = useMemo(() => {
    const merged = emptyOverrides();

    const appendLogSources = (target: PathBuilderLogSourceOverride[], incoming: PathBuilderLogSourceOverride[]) => {
      const byKey = new Map<string, PathBuilderLogSourceOverride>();
      [...target, ...incoming].forEach((entry) => {
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        if (!name) return;
        const analyticId = typeof entry.analytic_id === 'string' ? normalizeUpper(entry.analytic_id) : undefined;
        const dcId = typeof entry.data_component_id === 'string' ? normalizeUpper(entry.data_component_id) : undefined;
        const channel = typeof entry.channel === 'string' ? entry.channel.trim() : undefined;
        const key = `${analyticId || ''}|${dcId || ''}|${normalizeLower(name)}|${normalizeLower(channel || '')}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            ...entry,
            name,
            analytic_id: analyticId,
            data_component_id: dcId,
            data_component_name: typeof entry.data_component_name === 'string' ? entry.data_component_name.trim() : undefined,
            channel,
            notes: typeof entry.notes === 'string' ? entry.notes.trim() : undefined,
            source_url: typeof entry.source_url === 'string' ? entry.source_url.trim() : undefined,
          });
        }
      });
      return Array.from(byKey.values());
    };

    const appendMutableValues = (target: StreamMutableValue[], incoming: StreamMutableValue[]) => {
      const byKey = new Map<string, StreamMutableValue>();
      [...target, ...incoming].forEach((entry) => {
        const analyticId = typeof entry?.analytic_id === 'string' ? normalizeUpper(entry.analytic_id) : '';
        const field = typeof entry?.field === 'string' ? entry.field.trim() : '';
        if (!analyticId || !field) return;
        const value = typeof entry?.value === 'string' ? entry.value : String(entry?.value ?? '');
        const key = `${analyticId}|${normalizeLower(field)}`;
        byKey.set(key, {
          analytic_id: analyticId,
          field,
          value,
          source_url: typeof entry.source_url === 'string' ? entry.source_url.trim() : undefined,
          note: typeof entry.note === 'string' ? entry.note.trim() : undefined,
        });
      });
      return Array.from(byKey.values());
    };

    productStreams.forEach((stream) => {
      const metadata = normalizeMetadata(stream.metadata);
      const rawOverrides = (metadata.path_builder_overrides || metadata.pathBuilderOverrides) as unknown;
      if (!rawOverrides || typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) return;
      const overrides = rawOverrides as Record<string, unknown>;

      const analyticLogSources = Array.isArray(overrides.analytic_log_sources)
        ? overrides.analytic_log_sources as PathBuilderLogSourceOverride[]
        : Array.isArray(overrides.analyticLogSources)
          ? overrides.analyticLogSources as PathBuilderLogSourceOverride[]
          : [];

      const dcLogSources = Array.isArray(overrides.dc_log_sources)
        ? overrides.dc_log_sources as PathBuilderLogSourceOverride[]
        : Array.isArray(overrides.dcLogSources)
          ? overrides.dcLogSources as PathBuilderLogSourceOverride[]
          : [];

      const mutableValues = Array.isArray(overrides.mutable_element_values)
        ? overrides.mutable_element_values as StreamMutableValue[]
        : Array.isArray(overrides.mutableElementValues)
          ? overrides.mutableElementValues as StreamMutableValue[]
          : [];

      merged.analytic_log_sources = appendLogSources(merged.analytic_log_sources, analyticLogSources);
      merged.dc_log_sources = appendLogSources(merged.dc_log_sources, dcLogSources);
      merged.mutable_element_values = appendMutableValues(merged.mutable_element_values, mutableValues);
    });

    return merged;
  }, [productStreams]);

  const verifiedEvidenceMaps = useMemo(() => {
    const byDcId = new Map<string, AiEvidenceEntry>();
    const byDcName = new Map<string, AiEvidenceEntry>();

    const normalizeChannelList = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value
          .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry || '').trim()))
          .filter((entry) => entry.length > 0);
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
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
          return {
            name,
            channel: channel.length > 0 ? channel : undefined,
            notes: typeof source?.notes === 'string' ? source.notes : typeof source?.note === 'string' ? source.note : undefined,
            sourceUrl: typeof source?.source_url === 'string' ? source.source_url : typeof source?.sourceUrl === 'string' ? source.sourceUrl : undefined,
          } as AiEvidenceLogSource;
        })
        .filter(Boolean) as AiEvidenceLogSource[];
    };

    productStreams.forEach((stream) => {
      const metadata = normalizeMetadata(stream.metadata);
      const enrichment = (metadata as any).ai_enrichment || (metadata as any).aiEnrichment;
      if (!enrichment || typeof enrichment !== 'object') return;
      const confirmed = (enrichment as any).confirmed === true
        || Boolean((enrichment as any).confirmed_at || (enrichment as any).confirmedAt);
      if (!confirmed) return;

      const results = Array.isArray((enrichment as any).results) ? (enrichment as any).results : [];
      results.forEach((entry: any) => {
        const dcIdRaw = typeof entry?.data_component_id === 'string'
          ? entry.data_component_id
          : typeof entry?.dataComponentId === 'string'
            ? entry.dataComponentId
            : '';
        if (!dcIdRaw) return;

        const dcId = normalizeUpper(dcIdRaw);
        const dcName = typeof entry?.data_component_name === 'string'
          ? entry.data_component_name
          : typeof entry?.dataComponentName === 'string'
            ? entry.dataComponentName
            : dcId;

        const logSources = normalizeLogSources(
          Array.isArray(entry?.log_sources) ? entry.log_sources : entry?.logSources
        );
        if (logSources.length === 0) return;

        const existing = byDcId.get(dcId);
        const mergedSources = dedupeEditableLogSources([
          ...((existing?.logSources || []).map((source) => ({
            name: source.name,
            channel: source.channel?.join(', ') || '',
            dataComponentId: dcId,
            dataComponentName: dcName,
            notes: source.notes,
            sourceUrl: source.sourceUrl,
          })) || []),
          ...logSources.map((source) => ({
            name: source.name,
            channel: source.channel?.join(', ') || '',
            dataComponentId: dcId,
            dataComponentName: dcName,
            notes: source.notes,
            sourceUrl: source.sourceUrl,
          })),
        ]).map((item) => ({
          name: item.name,
          channel: item.channel ? item.channel.split(',').map((c) => c.trim()).filter(Boolean) : undefined,
          notes: item.notes,
          sourceUrl: item.sourceUrl,
        }));

        const mergedEntry: AiEvidenceEntry = {
          dataComponentId: dcId,
          dataComponentName: dcName,
          logSources: mergedSources,
        };

        byDcId.set(dcId, mergedEntry);
        byDcName.set(normalizeLower(dcName), mergedEntry);
      });
    });

    return { byDcId, byDcName };
  }, [productStreams]);

  const baseMutableValuesByAnalytic = useMemo(() => {
    const map = new Map<string, Map<string, StreamMutableValue>>();

    const upsert = (entry: StreamMutableValue) => {
      const analyticId = normalizeUpper(entry.analytic_id || '');
      const field = (entry.field || '').trim();
      if (!analyticId || !field) return;
      if (!map.has(analyticId)) {
        map.set(analyticId, new Map());
      }
      map.get(analyticId)!.set(normalizeLower(field), {
        analytic_id: analyticId,
        field,
        value: entry.value || '',
        source_url: entry.source_url,
        note: entry.note,
      });
    };

    productStreams.forEach((stream) => {
      const metadata = normalizeMetadata(stream.metadata);
      const valuesRaw = (metadata as any).mutable_element_values || (metadata as any).mutableElementValues;
      if (!Array.isArray(valuesRaw)) return;
      valuesRaw.forEach((entry: any) => {
        const analyticId = typeof entry?.analytic_id === 'string'
          ? entry.analytic_id
          : typeof entry?.analyticId === 'string' ? entry.analyticId : '';
        const field = typeof entry?.field === 'string' ? entry.field : '';
        const value = entry?.value === undefined || entry?.value === null
          ? ''
          : typeof entry.value === 'string' ? entry.value : String(entry.value);
        if (!analyticId || !field) return;
        upsert({
          analytic_id: analyticId,
          field,
          value,
          source_url: typeof entry?.source_url === 'string'
            ? entry.source_url
            : typeof entry?.sourceUrl === 'string' ? entry.sourceUrl : undefined,
          note: typeof entry?.note === 'string' ? entry.note : undefined,
        });
      });
    });

    pathBuilderOverrides.mutable_element_values.forEach((entry) => upsert(entry));
    return map;
  }, [productStreams, pathBuilderOverrides.mutable_element_values]);

  const buildAnalyticDefaults = (analyticId: string): NodeEditorDraft | null => {
    const analytic = analyticById.get(normalizeUpper(analyticId));
    if (!analytic) return null;

    const prefilledFromStix: EditableLogSource[] = (analytic.logSources || []).map((source) => ({
      name: source.name,
      channel: source.channel || '',
      dataComponentId: source.dataComponentId,
      dataComponentName: source.dataComponentName,
    }));

    const prefilledFromEvidence: EditableLogSource[] = [];
    (analytic.dataComponents || []).forEach((dcId) => {
      const evidence = verifiedEvidenceMaps.byDcId.get(normalizeUpper(dcId));
      if (!evidence) return;
      evidence.logSources.forEach((source) => {
        prefilledFromEvidence.push({
          name: source.name,
          channel: (source.channel || []).join(', '),
          dataComponentId: evidence.dataComponentId,
          dataComponentName: evidence.dataComponentName,
          notes: source.notes,
          sourceUrl: source.sourceUrl,
        });
      });
    });

    const defaultLogSources = dedupeEditableLogSources([...prefilledFromStix, ...prefilledFromEvidence]);

    const manualLogSources = pathBuilderOverrides.analytic_log_sources
      .filter((entry) => normalizeUpper(entry.analytic_id || '') === normalizeUpper(analytic.id))
      .map((entry) => ({
        name: entry.name,
        channel: entry.channel || '',
        dataComponentId: entry.data_component_id,
        dataComponentName: entry.data_component_name,
        notes: entry.notes,
        sourceUrl: entry.source_url,
      }));

    const mergedFields = new Map<string, EditableMutableElement>();
    (analytic.mutableElements || []).forEach((element) => {
      const key = normalizeLower(element.field || '');
      if (!key) return;
      const existing = baseMutableValuesByAnalytic.get(normalizeUpper(analytic.id))?.get(key);
      mergedFields.set(key, {
        field: element.field,
        description: element.description || '',
        value: existing?.value || '',
        sourceUrl: existing?.source_url,
        note: existing?.note,
      });
    });

    const manualMutable = pathBuilderOverrides.mutable_element_values
      .filter((entry) => normalizeUpper(entry.analytic_id || '') === normalizeUpper(analytic.id));

    manualMutable.forEach((entry) => {
      const key = normalizeLower(entry.field || '');
      if (!key) return;
      const existing = mergedFields.get(key);
      mergedFields.set(key, {
        field: entry.field,
        description: existing?.description || '',
        value: entry.value || '',
        sourceUrl: entry.source_url || existing?.sourceUrl,
        note: entry.note || existing?.note,
      });
    });

    const defaultMutableElements = Array.from(mergedFields.values());

    return {
      kind: 'analytic',
      analyticId: analytic.id,
      analyticName: analytic.name,
      analyticDescription: analytic.description,
      logSources: manualLogSources.length > 0 ? dedupeEditableLogSources(manualLogSources) : defaultLogSources,
      mutableElements: defaultMutableElements,
      defaultLogSources,
      defaultMutableElements,
    };
  };

  const buildDataComponentDefaults = (dataComponentId: string): NodeEditorDraft | null => {
    const dc = dataComponentById.get(normalizeUpper(dataComponentId));
    if (!dc) return null;

    const analyticLogSources: EditableLogSource[] = [];
    Array.from(analyticById.values()).forEach((analytic) => {
      (analytic.logSources || []).forEach((source) => {
        if (normalizeUpper(source.dataComponentId || '') !== normalizeUpper(dc.id)) return;
        analyticLogSources.push({
          name: source.name,
          channel: source.channel || '',
          dataComponentId: source.dataComponentId,
          dataComponentName: source.dataComponentName,
        });
      });
    });

    const evidence = verifiedEvidenceMaps.byDcId.get(normalizeUpper(dc.id))
      || verifiedEvidenceMaps.byDcName.get(normalizeLower(dc.name));

    const evidenceSources: EditableLogSource[] = (evidence?.logSources || []).map((source) => ({
      name: source.name,
      channel: (source.channel || []).join(', '),
      dataComponentId: evidence?.dataComponentId,
      dataComponentName: evidence?.dataComponentName,
      notes: source.notes,
      sourceUrl: source.sourceUrl,
    }));

    const defaultLogSources = dedupeEditableLogSources([...analyticLogSources, ...evidenceSources]);

    const manualLogSources = pathBuilderOverrides.dc_log_sources
      .filter((entry) => normalizeUpper(entry.data_component_id || '') === normalizeUpper(dc.id))
      .map((entry) => ({
        name: entry.name,
        channel: entry.channel || '',
        dataComponentId: entry.data_component_id,
        dataComponentName: entry.data_component_name,
        notes: entry.notes,
        sourceUrl: entry.source_url,
      }));

    return {
      kind: 'data_component',
      dataComponentId: dc.id,
      dataComponentName: dc.name,
      dataSource: dc.dataSource,
      logSources: manualLogSources.length > 0 ? dedupeEditableLogSources(manualLogSources) : defaultLogSources,
      defaultLogSources,
    };
  };

  useEffect(() => {
    if (!selectedEditorNode) {
      setEditorDraft(null);
      return;
    }

    if (selectedEditorNode.kind === 'analytic') {
      setEditorDraft(buildAnalyticDefaults(selectedEditorNode.analyticId));
      return;
    }

    setEditorDraft(buildDataComponentDefaults(selectedEditorNode.dataComponentId));
  }, [
    selectedEditorNode,
    stixMappingData,
    pathBuilderOverrides,
    verifiedEvidenceMaps,
    baseMutableValuesByAnalytic,
    analyticById,
    dataComponentById,
  ]);

  const handleApplyTechniqueFilter = () => {
    setSelectedTechniqueIds(new Set(parseTechniqueInput(techniqueInput)));
  };

  const handleToggleTechnique = (techniqueId: string) => {
    setSelectedTechniqueIds((prev) => {
      const next = new Set(prev);
      if (next.has(techniqueId)) {
        next.delete(techniqueId);
      } else {
        next.add(techniqueId);
      }
      setTechniqueInput(Array.from(next).sort((a, b) => a.localeCompare(b)).join(', '));
      return next;
    });
  };

  const resolveAnalyticIdFromNode = (node: CoveragePathNode): string | null => {
    const candidates = [node.externalId, node.label, node.name]
      .filter((value): value is string => Boolean(value && value.trim().length > 0))
      .map((value) => normalizeUpper(value));

    for (const candidate of candidates) {
      if (analyticById.has(candidate)) return candidate;
    }

    return null;
  };

  const resolveDataComponentIdFromNode = (node: CoveragePathNode): string | null => {
    const candidates = [node.externalId, node.label, node.name]
      .filter((value): value is string => Boolean(value && value.trim().length > 0))
      .map((value) => normalizeUpper(value));

    for (const candidate of candidates) {
      if (dataComponentById.has(candidate)) return candidate;
    }

    return null;
  };

  const handleNodeSelect = (node: CoveragePathNode) => {
    if (node.type === 'analytic') {
      const analyticId = resolveAnalyticIdFromNode(node);
      if (!analyticId) {
        toast({
          title: 'Analytic details unavailable',
          description: 'This analytic was not found in the current STIX mapping context.',
          variant: 'destructive',
        });
        return;
      }
      setSelectedEditorNode({ kind: 'analytic', analyticId });
      return;
    }

    if (node.type === 'data_component' || node.type === 'x-mitre-data-component') {
      const dataComponentId = resolveDataComponentIdFromNode(node);
      if (!dataComponentId) {
        toast({
          title: 'Data component details unavailable',
          description: 'This data component was not found in the current STIX mapping context.',
          variant: 'destructive',
        });
        return;
      }
      setSelectedEditorNode({ kind: 'data_component', dataComponentId });
    }
  };

  const updateDraftLogSource = (index: number, key: keyof EditableLogSource, value: string) => {
    setEditorDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev } as NodeEditorDraft;
      const rows = [...next.logSources];
      const target = { ...(rows[index] || { name: '', channel: '' }) };
      target[key] = value;
      rows[index] = target;
      next.logSources = rows;
      return next;
    });
  };

  const addDraftLogSource = () => {
    setEditorDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        logSources: [...prev.logSources, { name: '', channel: '', dataComponentId: '', dataComponentName: '' }],
      };
    });
  };

  const removeDraftLogSource = (index: number) => {
    setEditorDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        logSources: prev.logSources.filter((_, rowIndex) => rowIndex !== index),
      };
    });
  };

  const updateDraftMutable = (index: number, key: keyof EditableMutableElement, value: string) => {
    setEditorDraft((prev) => {
      if (!prev || prev.kind !== 'analytic') return prev;
      const rows = [...prev.mutableElements];
      const target = { ...(rows[index] || { field: '', description: '', value: '' }) };
      target[key] = value;
      rows[index] = target;
      return { ...prev, mutableElements: rows };
    });
  };

  const addDraftMutable = () => {
    setEditorDraft((prev) => {
      if (!prev || prev.kind !== 'analytic') return prev;
      return {
        ...prev,
        mutableElements: [...prev.mutableElements, { field: '', description: '', value: '' }],
      };
    });
  };

  const removeDraftMutable = (index: number) => {
    setEditorDraft((prev) => {
      if (!prev || prev.kind !== 'analytic') return prev;
      return {
        ...prev,
        mutableElements: prev.mutableElements.filter((_, rowIndex) => rowIndex !== index),
      };
    });
  };

  const saveOverridesMutation = useMutation({
    mutationFn: async (nextOverrides: PathBuilderOverrides) => {
      if (!selectedProductId) {
        throw new Error('No product selected');
      }

      const normalizedStreams = productStreams.map((stream) => {
        const metadata = normalizeMetadata(stream.metadata);
        const cleanedMetadata = { ...metadata };
        delete (cleanedMetadata as any).path_builder_overrides;
        delete (cleanedMetadata as any).pathBuilderOverrides;

        return {
          name: stream.name,
          streamType: typeof stream.streamType === 'string' && stream.streamType.trim().length > 0
            ? stream.streamType
            : 'log',
          mappedDataComponents: Array.isArray(stream.mappedDataComponents)
            ? stream.mappedDataComponents.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [],
          metadata: cleanedMetadata,
        };
      });

      const overrideIndex = normalizedStreams.findIndex((stream) => normalizeLower(stream.name) === normalizeLower(PATH_BUILDER_STREAM_NAME));
      if (hasAnyOverrides(nextOverrides)) {
        const overrideMetadata = {
          path_builder_overrides: nextOverrides,
        };
        if (overrideIndex >= 0) {
          normalizedStreams[overrideIndex] = {
            ...normalizedStreams[overrideIndex],
            metadata: {
              ...(normalizedStreams[overrideIndex].metadata || {}),
              ...overrideMetadata,
            },
          };
        } else {
          normalizedStreams.push({
            name: PATH_BUILDER_STREAM_NAME,
            streamType: 'metadata',
            mappedDataComponents: [],
            metadata: overrideMetadata,
          });
        }
      } else if (overrideIndex >= 0) {
        normalizedStreams.splice(overrideIndex, 1);
      }

      const response = await fetch(`/api/products/${encodeURIComponent(selectedProductId)}/streams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streams: normalizedStreams }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || 'Failed to save path builder overrides');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['path-builder-streams', selectedProductId] });
      queryClient.invalidateQueries({ queryKey: ['product-streams', selectedProductId] });
      toast({
        title: 'Detection builder updated',
        description: 'Your path builder values were saved.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Unexpected error while saving.',
        variant: 'destructive',
      });
    },
  });

  const handleResetDraft = () => {
    if (!editorDraft) return;
    if (editorDraft.kind === 'analytic') {
      setEditorDraft({
        ...editorDraft,
        logSources: [...editorDraft.defaultLogSources],
        mutableElements: [...editorDraft.defaultMutableElements],
      });
      return;
    }

    setEditorDraft({
      ...editorDraft,
      logSources: [...editorDraft.defaultLogSources],
    });
  };

  const handleSaveDraft = async () => {
    if (!editorDraft) return;

    const nextOverrides: PathBuilderOverrides = {
      analytic_log_sources: [...pathBuilderOverrides.analytic_log_sources],
      dc_log_sources: [...pathBuilderOverrides.dc_log_sources],
      mutable_element_values: [...pathBuilderOverrides.mutable_element_values],
    };

    if (editorDraft.kind === 'analytic') {
      const analyticId = normalizeUpper(editorDraft.analyticId);
      nextOverrides.analytic_log_sources = nextOverrides.analytic_log_sources
        .filter((entry) => normalizeUpper(entry.analytic_id || '') !== analyticId);
      nextOverrides.mutable_element_values = nextOverrides.mutable_element_values
        .filter((entry) => normalizeUpper(entry.analytic_id || '') !== analyticId);

      dedupeEditableLogSources(editorDraft.logSources)
        .filter((entry) => entry.name.trim().length > 0)
        .forEach((entry) => {
          nextOverrides.analytic_log_sources.push({
            analytic_id: analyticId,
            data_component_id: entry.dataComponentId?.trim() || undefined,
            data_component_name: entry.dataComponentName?.trim() || undefined,
            name: entry.name.trim(),
            channel: entry.channel.trim() || undefined,
            notes: entry.notes?.trim() || undefined,
            source_url: entry.sourceUrl?.trim() || undefined,
          });
        });

      editorDraft.mutableElements
        .map((entry) => ({
          field: entry.field.trim(),
          description: entry.description,
          value: entry.value,
          sourceUrl: entry.sourceUrl,
          note: entry.note,
        }))
        .filter((entry) => entry.field.length > 0 && entry.value.trim().length > 0)
        .forEach((entry) => {
          nextOverrides.mutable_element_values.push({
            analytic_id: analyticId,
            field: entry.field,
            value: entry.value,
            source_url: entry.sourceUrl?.trim() || undefined,
            note: entry.note?.trim() || undefined,
          });
        });
    } else {
      const dcId = normalizeUpper(editorDraft.dataComponentId);
      nextOverrides.dc_log_sources = nextOverrides.dc_log_sources
        .filter((entry) => normalizeUpper(entry.data_component_id || '') !== dcId);

      dedupeEditableLogSources(editorDraft.logSources)
        .filter((entry) => entry.name.trim().length > 0)
        .forEach((entry) => {
          nextOverrides.dc_log_sources.push({
            data_component_id: dcId,
            data_component_name: entry.dataComponentName?.trim() || editorDraft.dataComponentName,
            name: entry.name.trim(),
            channel: entry.channel.trim() || undefined,
            notes: entry.notes?.trim() || undefined,
            source_url: entry.sourceUrl?.trim() || undefined,
          });
        });
    }

    await saveOverridesMutation.mutateAsync(nextOverrides);
  };

  const editorLoading = streamsLoading || stixMappingLoading;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar variant="dashboard" />

      <main className="flex-1 overflow-auto">
        <div className="grid-pattern min-h-full">
          <div className="p-6 space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Path Builder</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Pick a product, filter techniques, then click analytic/data-component nodes to build detection-ready values.
              </p>
            </header>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Filter className="w-4 h-4 text-primary" />
                  Path scope
                </CardTitle>
                <CardDescription>Use technique IDs like `T1190, T1133, T1110` to focus the diagram.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Product</p>
                    <Select
                      value={selectedProductId}
                      onValueChange={(value) => {
                        setSelectedProductId(value);
                        setSelectedEditorNode(null);
                        setEditorDraft(null);
                      }}
                      disabled={productsLoading || sortedProducts.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={productsLoading ? 'Loading products...' : 'Select a product'} />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedProducts.map((product) => (
                          <SelectItem key={product.productId} value={product.productId}>
                            {product.vendor} - {product.productName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Technique filter</p>
                    <div className="flex gap-2">
                      <Input
                        value={techniqueInput}
                        onChange={(event) => setTechniqueInput(event.target.value)}
                        placeholder="T1190, T1133, T1110"
                      />
                      <Button type="button" onClick={handleApplyTechniqueFilter}>
                        Apply
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setTechniqueInput('');
                          setSelectedTechniqueIds(new Set());
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>

                {availableTechniques.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Covered techniques</p>
                    <div className="flex flex-wrap gap-2">
                      {availableTechniques.slice(0, 80).map((techniqueId) => {
                        const selected = selectedTechniqueIds.has(techniqueId);
                        return (
                          <Button
                            key={techniqueId}
                            size="sm"
                            variant={selected ? 'default' : 'outline'}
                            onClick={() => handleToggleTechnique(techniqueId)}
                            className={selected ? 'bg-red-600 text-white hover:bg-red-500' : 'text-red-600 border-red-500/40 hover:bg-red-500/10'}
                          >
                            {techniqueId}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-primary">{coverageData?.coverage?.length || 0}</div>
                  <div className="text-sm text-muted-foreground">Mapped Techniques</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-foreground">{coveragePathsData?.paths?.length || 0}</div>
                  <div className="text-sm text-muted-foreground">Rendered Paths</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-foreground">{requiredDataComponentsCount}</div>
                  <div className="text-sm text-muted-foreground">Data Components In Scope</div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Route className="w-5 h-5 text-primary" />
                  Mapping diagram
                </CardTitle>
                <CardDescription>
                  {selectedProduct
                    ? `${selectedProduct.vendor} ${selectedProduct.productName}`
                    : 'Select a product to render the path'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {coverageLoading || pathsLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Building path view...
                  </div>
                ) : !selectedProductId ? (
                  <p className="text-sm text-muted-foreground">Select a product to begin.</p>
                ) : groupedPaths.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No paths found for the current filter. Remove strict technique filters or run Auto Mapper for this product.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      Click <span className="text-cyan-300">data component</span> or <span className="text-amber-300">analytic</span> nodes to open the detection builder panel.
                    </p>
                    {groupedPaths.map((group) => {
                      const coverageMeta = coverageByTechniqueId.get(group.techniqueId);
                      const tactics = coverageMeta?.tactics || [];
                      const description = coverageMeta?.techniqueDescription || '';
                      return (
                        <Card key={group.techniqueId} className="bg-background border-border">
                          <CardHeader className="pb-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge className="bg-red-500/20 text-red-300 border-red-500/40 font-mono">
                                {group.techniqueId}
                              </Badge>
                              <CardTitle className="text-base font-normal">{group.techniqueName || group.techniqueId}</CardTitle>
                              <a
                                href={`/techniques/${encodeURIComponent(group.techniqueId)}`}
                                className="text-xs text-primary hover:underline"
                              >
                                View details
                              </a>
                            </div>
                            {tactics.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {tactics.map((tactic) => (
                                  <Badge key={`${group.techniqueId}-${tactic}`} variant="secondary" className="text-xs">
                                    {tactic}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {description && (
                              <p className="text-sm text-muted-foreground">{description}</p>
                            )}
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {group.rows.map((row, index) => (
                              <div
                                key={`${group.techniqueId}-${index}`}
                                className="rounded-md border border-border bg-card/40 p-3 overflow-x-auto"
                              >
                                <div className="flex items-center gap-2 min-w-max">
                                  {(row.pathNodes || []).map((node, nodeIndex) => {
                                    const isInteractive =
                                      node.type === 'analytic'
                                      || node.type === 'data_component'
                                      || node.type === 'x-mitre-data-component';
                                    const analyticId = node.type === 'analytic' ? resolveAnalyticIdFromNode(node) : null;
                                    const dcId = (node.type === 'data_component' || node.type === 'x-mitre-data-component')
                                      ? resolveDataComponentIdFromNode(node)
                                      : null;
                                    const isSelected = Boolean(
                                      (selectedEditorNode?.kind === 'analytic' && analyticId && normalizeUpper(selectedEditorNode.analyticId) === normalizeUpper(analyticId))
                                      || (selectedEditorNode?.kind === 'data_component' && dcId && normalizeUpper(selectedEditorNode.dataComponentId) === normalizeUpper(dcId))
                                    );

                                    return (
                                      <div key={`${row.techniqueId}-${index}-${node.id}-${nodeIndex}`} className="flex items-center gap-2">
                                        {isInteractive ? (
                                          <button
                                            type="button"
                                            onClick={() => handleNodeSelect(node)}
                                            className="inline-flex"
                                          >
                                            <Badge className={`text-xs border ${getNodeStyles(node.type)} ${isSelected ? 'ring-2 ring-primary/40' : ''}`}>
                                              {node.label || node.name}
                                            </Badge>
                                          </button>
                                        ) : (
                                          <Badge className={`text-xs border ${getNodeStyles(node.type)}`}>
                                            {node.label || node.name}
                                          </Badge>
                                        )}
                                        {nodeIndex < (row.pathNodes || []).length - 1 && (
                                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}

                            <div className="flex flex-wrap gap-2 pt-1">
                              {Array.from(
                                new Set(
                                  group.rows.flatMap((row) => (
                                    (row.pathNodes || [])
                                      .filter((node) => node.type === 'detection-strategy')
                                      .map((node) => node.externalId || node.label)
                                  ))
                                )
                              ).map((strategyId) => (
                                <a
                                  key={`${group.techniqueId}-strategy-${strategyId}`}
                                  href={`/detection-strategies?strategy=${encodeURIComponent(strategyId)}`}
                                  className="inline-flex items-center"
                                >
                                  <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40 text-xs font-mono">
                                    {strategyId}
                                  </Badge>
                                </a>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="w-4 h-4 text-primary" />
                  What this path represents
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-1">
                <p>{'Product -> Data Component -> Analytic -> Detection Strategy -> Technique'}</p>
                <p>Log sources and mutable values are prefilled from Auto Mapper/STIX where available, then editable for your detection build.</p>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Detection Builder
                </CardTitle>
                <CardDescription>
                  {selectedEditorNode
                    ? selectedEditorNode.kind === 'analytic'
                      ? `Editing analytic ${selectedEditorNode.analyticId}`
                      : `Editing data component ${selectedEditorNode.dataComponentId}`
                    : 'Select a data component or analytic node from the diagram to start.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {editorLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading builder context...
                  </div>
                ) : !editorDraft ? (
                  <p className="text-sm text-muted-foreground">No node selected.</p>
                ) : (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-foreground">Log Sources</h3>
                        <Button type="button" size="sm" variant="outline" onClick={addDraftLogSource}>
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          Add source
                        </Button>
                      </div>

                      {editorDraft.logSources.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No log sources yet. Add one.</p>
                      ) : (
                        <div className="space-y-2">
                          {editorDraft.logSources.map((row, index) => (
                            <div key={`log-source-${index}`} className="rounded-md border border-border p-3 bg-background/60 space-y-2">
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                                <Input
                                  value={row.name}
                                  onChange={(event) => updateDraftLogSource(index, 'name', event.target.value)}
                                  placeholder="Log source name"
                                />
                                <Input
                                  value={row.channel || ''}
                                  onChange={(event) => updateDraftLogSource(index, 'channel', event.target.value)}
                                  placeholder="Channel"
                                />
                                <div className="flex gap-2">
                                  <Input
                                    value={row.dataComponentName || row.dataComponentId || ''}
                                    onChange={(event) => updateDraftLogSource(index, 'dataComponentName', event.target.value)}
                                    placeholder="Data component"
                                  />
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => removeDraftLogSource(index)}
                                  >
                                    <X className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                                <Input
                                  value={row.sourceUrl || ''}
                                  onChange={(event) => updateDraftLogSource(index, 'sourceUrl', event.target.value)}
                                  placeholder="Evidence URL (optional)"
                                />
                                <Input
                                  value={row.notes || ''}
                                  onChange={(event) => updateDraftLogSource(index, 'notes', event.target.value)}
                                  placeholder="Notes (optional)"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {editorDraft.kind === 'analytic' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-foreground">Mutable Elements</h3>
                          <Button type="button" size="sm" variant="outline" onClick={addDraftMutable}>
                            <Plus className="w-3.5 h-3.5 mr-1" />
                            Add field
                          </Button>
                        </div>

                        {editorDraft.mutableElements.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No mutable fields yet. Add one.</p>
                        ) : (
                          <div className="space-y-2">
                            {editorDraft.mutableElements.map((row, index) => (
                              <div key={`mutable-${index}`} className="rounded-md border border-border p-3 bg-background/60 space-y-2">
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                                  <Input
                                    value={row.field}
                                    onChange={(event) => updateDraftMutable(index, 'field', event.target.value)}
                                    placeholder="Field"
                                  />
                                  <Input
                                    value={row.value}
                                    onChange={(event) => updateDraftMutable(index, 'value', event.target.value)}
                                    placeholder="Value"
                                  />
                                  <div className="flex gap-2">
                                    <Input
                                      value={row.sourceUrl || ''}
                                      onChange={(event) => updateDraftMutable(index, 'sourceUrl', event.target.value)}
                                      placeholder="Source URL"
                                    />
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => removeDraftMutable(index)}
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                                <Input
                                  value={row.description || ''}
                                  onChange={(event) => updateDraftMutable(index, 'description', event.target.value)}
                                  placeholder="Field description"
                                />
                                <Textarea
                                  value={row.note || ''}
                                  onChange={(event) => updateDraftMutable(index, 'note', event.target.value)}
                                  placeholder="Implementation note"
                                  rows={2}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {editorDraft.kind === 'analytic' && editorDraft.analyticDescription && (
                      <div className="rounded-md border border-border bg-background/40 p-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">Analytic context</p>
                        <p className="text-sm text-muted-foreground">{editorDraft.analyticDescription}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleResetDraft}
                        disabled={saveOverridesMutation.isPending}
                      >
                        Reset To Prefill
                      </Button>
                      <Button
                        type="button"
                        onClick={handleSaveDraft}
                        disabled={saveOverridesMutation.isPending}
                      >
                        {saveOverridesMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4 mr-2" />
                        )}
                        Save Builder Values
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
