import { useQuery } from "@tanstack/react-query";

export type DetectionSource = 'sigma' | 'elastic' | 'splunk' | 'azure' | 'ctid' | 'mitre_stix';

export interface Detection {
  id: string;
  name: string;
  techniqueIds?: string[];
  description?: string;
  howToImplement?: string;
  logSources?: string[];
  query?: string;
  source?: DetectionSource;
  sourceFile?: string;
}

async function fetchDetections(search?: string): Promise<Detection[]> {
  const query = typeof search === 'string' && search.trim().length > 0
    ? `?q=${encodeURIComponent(search.trim())}`
    : '';
  const response = await fetch(`/api/detections${query}`);
  if (!response.ok) {
    throw new Error('Failed to fetch detections');
  }
  return response.json();
}

export function useDetections(search?: string) {
  return useQuery({
    queryKey: ['detections', search?.trim().toLowerCase() || 'all'],
    queryFn: () => fetchDetections(search),
    staleTime: 5 * 60 * 1000,
  });
}
