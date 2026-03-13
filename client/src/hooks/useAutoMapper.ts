import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";

export interface StixDetectionStrategy {
  id: string;
  name: string;
  description: string;
  techniques: string[];
  analytics: StixAnalytic[];
}

export interface StixLogSource {
  dataComponentId: string;
  dataComponentName: string;
  name: string;
  channel?: string;
}

export interface StixMutableElement {
  field: string;
  description: string;
}

export interface StixAnalytic {
  id: string;
  name: string;
  description: string;
  platforms: string[];
  dataComponents: string[];
  logSources: StixLogSource[];
  mutableElements: StixMutableElement[];
}

export interface StixDataComponent {
  id: string;
  name: string;
  dataSource: string;
}

export interface EnrichedCommunityMapping {
  source: string;
  confidence: number;
  techniqueIds: string[];
  detectTechniqueIds: string[];
  visibilityTechniqueIds: string[];
  candidateAnalyticsCount: number;
  detectionStrategies: StixDetectionStrategy[];
  dataComponents: StixDataComponent[];
  communityAnalytics: AnalyticMapping[];
  techniqueSources: Record<string, ResourceType[]>;
  techniqueNames: Record<string, string>;
}

export type ResourceType = 'ctid' | 'sigma' | 'elastic' | 'splunk' | 'azure' | 'mitre_stix';

export interface AnalyticMapping {
  id: string;
  name: string;
  techniqueIds?: string[];
  description?: string;
  howToImplement?: string;
  logSources?: string[];
  query?: string;
  source?: ResourceType;
  sourceFile?: string;
  mappingMethod?:
    | 'explicit_attack_id'
    | 'ctid_import'
    | 'tactic_data_component_inference'
    | 'source_hint_inference'
    | 'stream_data_component_inference'
    | 'mitre_keyword_match';
  evidenceTier?: 'strong' | 'medium' | 'weak';
  coverageKind?: 'detect' | 'visibility' | 'candidate';
  requiresValidation?: boolean;
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

export interface NormalizedMapping {
  productId: string;
  source: string;
  confidence: number;
  detectionStrategies: string[];
  analytics: AnalyticMapping[];
  dataComponents: DataComponentMapping[];
  rawData: unknown;
  techniqueSources?: Record<string, ResourceType[]>;
}

export interface MappingResult {
  productId: string;
  status: 'matched' | 'partial' | 'ai_pending' | 'not_found';
  source?: string;
  confidence?: number;
  mapping?: NormalizedMapping;
  error?: string;
}

async function fetchMappingStatus(productId: string): Promise<MappingResult | null> {
  const response = await fetch(`/api/auto-mapper/mappings/${productId}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Failed to fetch mapping status');
  }
  return response.json();
}

async function runAutoMapper(productId: string): Promise<MappingResult> {
  const response = await fetch(`/api/auto-mapper/run/${productId}`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to run auto-mapper');
  }
  return response.json();
}

export function useMappingStatus(productId: string) {
  return useQuery({
    queryKey: ['mapping', productId],
    queryFn: () => fetchMappingStatus(productId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRunAutoMapper() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: runAutoMapper,
    onSuccess: (data) => {
      queryClient.setQueryData(['mapping', data.productId], data);
    },
  });
}

export function useAutoMappingWithAutoRun(
  productId: string, 
  platform?: string,
  hybridSelectors?: string[] | null
) {
  const queryClient = useQueryClient();
  
  const statusQuery = useQuery({
    queryKey: ['mapping', productId],
    queryFn: () => fetchMappingStatus(productId),
    staleTime: 5 * 60 * 1000,
  });

  const autoRunMutation = useMutation({
    mutationFn: runAutoMapper,
    onSuccess: (data) => {
      queryClient.setQueryData(['mapping', data.productId], data);
    },
  });

  const shouldAutoRun = statusQuery.isSuccess && 
                        !statusQuery.isFetching &&
                        statusQuery.data === null && 
                        !autoRunMutation.isPending && 
                        !autoRunMutation.isSuccess &&
                        !autoRunMutation.isError;

  const rawData = autoRunMutation.data || statusQuery.data;

  const [stixMapping, setStixMapping] = useState<{
    detectionStrategies: StixDetectionStrategy[];
    dataComponents: StixDataComponent[];
    techniqueNames: Record<string, string>;
  } | null>(null);
  const [stixLoading, setStixLoading] = useState(false);
  
  const baseTechniqueIds = useMemo(() => {
    if (!rawData?.mapping || (rawData.status !== 'matched' && rawData.status !== 'partial')) {
      return [];
    }
    
    const rawStrategies = rawData.mapping.detectionStrategies || [];
    const strategyTechniqueIds = rawStrategies.map((id: string) => {
      if (id.startsWith('DS-')) {
        return id.substring(3);
      }
      return id;
    });
    const analyticsTechniqueIds = (rawData.mapping.analytics || [])
      .flatMap((analytic) => analytic.techniqueIds || []);

    return Array.from(new Set([...strategyTechniqueIds, ...analyticsTechniqueIds]));
  }, [rawData]);

  const combinedTechniqueIds = useMemo(() => {
    return baseTechniqueIds;
  }, [baseTechniqueIds]);

  useEffect(() => {
    if (combinedTechniqueIds.length === 0) {
      setStixMapping(null);
      return;
    }

    const idsKey = combinedTechniqueIds.join(',');
    const platformList = Array.from(
      new Set([platform, ...(hybridSelectors || [])].filter(Boolean))
    );
    
    setStixLoading(true);
    fetch('/api/mitre-stix/techniques/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        techniqueIds: combinedTechniqueIds,
        platforms: platformList.length > 0 ? platformList : undefined,
      }),
    })
      .then(res => res.json())
      .then(data => {
        setStixMapping(data);
        setStixLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch STIX mapping:', err);
        setStixLoading(false);
      });
  }, [combinedTechniqueIds.join(','), platform, hybridSelectors?.join(',')]);

  const enrichedMapping = useMemo((): EnrichedCommunityMapping | null => {
    if (!rawData?.mapping || (rawData.status !== 'matched' && rawData.status !== 'partial')) {
      return null;
    }

    const analytics = rawData.mapping.analytics || [];
    const detectTechniqueIds = Array.from(new Set(
      analytics
        .filter((analytic) => analytic.coverageKind === 'detect')
        .flatMap((analytic) => analytic.techniqueIds || [])
        .map((id) => id.toUpperCase())
    ));
    const visibilityTechniqueIds = Array.from(new Set(
      analytics
        .filter((analytic) => analytic.coverageKind === 'visibility')
        .flatMap((analytic) => analytic.techniqueIds || [])
        .map((id) => id.toUpperCase())
    ));
    const allTechniqueIds = Array.from(new Set([
      ...detectTechniqueIds,
      ...visibilityTechniqueIds,
      ...combinedTechniqueIds.map((id) => id.toUpperCase()),
    ]));
    
    return {
      source: rawData.source || 'unknown',
      confidence: rawData.confidence || 0,
      techniqueIds: allTechniqueIds,
      detectTechniqueIds,
      visibilityTechniqueIds,
      candidateAnalyticsCount: analytics.filter((analytic) => analytic.coverageKind === 'candidate').length,
      detectionStrategies: stixMapping?.detectionStrategies || [],
      dataComponents: stixMapping?.dataComponents || [],
      communityAnalytics: analytics,
      techniqueSources: rawData.mapping.techniqueSources || {},
      techniqueNames: stixMapping?.techniqueNames || {},
    };
  }, [rawData, combinedTechniqueIds, stixMapping]);

  return {
    data: rawData,
    enrichedMapping,
    isLoading: statusQuery.isLoading || autoRunMutation.isPending || stixLoading,
    isAutoRunning: autoRunMutation.isPending,
    isStixLoading: stixLoading,
    baseTechniqueIds,
    combinedTechniqueIds,
    error: statusQuery.error || autoRunMutation.error,
    shouldAutoRun,
    triggerAutoRun: () => autoRunMutation.mutate(productId),
  };
}

export const RESOURCE_LABELS: Record<string, { label: string; color: string }> = {
  ctid: { label: 'CTID Mappings', color: 'bg-blue-500' },
  sigma: { label: 'Sigma Rules', color: 'bg-purple-500' },
  elastic: { label: 'Elastic Rules', color: 'bg-orange-500' },
  splunk: { label: 'Splunk Content', color: 'bg-green-500' },
  azure: { label: 'Azure Sentinel Rules', color: 'bg-sky-500' },
  mitre_stix: { label: 'MITRE STIX', color: 'bg-red-500' },
};
