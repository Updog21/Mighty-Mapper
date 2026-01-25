import { useQuery } from "@tanstack/react-query";

export interface DataComponent {
  id: number;
  componentId: string;
  name: string;
  dataSourceId?: string | null;
  dataSourceName?: string | null;
  description: string;
  createdAt: string;
}

export interface DetectionStrategy {
  id: number;
  strategyId: string;
  name: string;
  description: string;
  createdAt: string;
}

async function fetchDataComponents(): Promise<DataComponent[]> {
  const response = await fetch('/api/data-components');
  if (!response.ok) {
    throw new Error('Failed to fetch data components');
  }
  return response.json();
}

async function fetchDetectionStrategies(): Promise<DetectionStrategy[]> {
  const response = await fetch('/api/detection-strategies');
  if (!response.ok) {
    throw new Error('Failed to fetch detection strategies');
  }
  return response.json();
}

export function useDataComponents() {
  return useQuery({
    queryKey: ['mitre', 'data-components'],
    queryFn: fetchDataComponents,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDetectionStrategies() {
  return useQuery({
    queryKey: ['mitre', 'detection-strategies'],
    queryFn: fetchDetectionStrategies,
    staleTime: 5 * 60 * 1000,
  });
}
