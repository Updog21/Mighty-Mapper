import { detectionStrategies, type DetectionStrategy } from '@/lib/mitreData';

export function getDetectionStrategiesForProduct(_productId?: string | null): DetectionStrategy[] {
  return detectionStrategies;
}
