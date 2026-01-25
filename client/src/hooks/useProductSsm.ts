import { useQuery } from "@tanstack/react-query";
import { fetchProductSsm } from "@/lib/api";
import type { SsmCapability } from "@shared/schemas/ssm";

export function useProductSsm(productId?: string) {
  return useQuery<SsmCapability[]>({
    queryKey: ["product-ssm", productId],
    queryFn: () => fetchProductSsm(productId || ''),
    enabled: Boolean(productId),
  });
}
