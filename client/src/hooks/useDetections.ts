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

async function fetchDetections(): Promise<Detection[]> {
  const response = await fetch('/api/detections');
  if (!response.ok) {
    throw new Error('Failed to fetch detections');
  }
  return response.json();
}

export function useDetections() {
  return useQuery({
    queryKey: ['detections'],
    queryFn: fetchDetections,
    staleTime: 5 * 60 * 1000,
  });
}
