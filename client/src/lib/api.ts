import { apiRequest } from "./queryClient";
import { SsmResponseSchema, type SsmCapability } from "@shared/schemas/ssm";

export async function fetchProductSsm(productId: string): Promise<SsmCapability[]> {
  const res = await apiRequest("GET", `/api/products/${productId}/ssm`);
  const data = await res.json();
  return SsmResponseSchema.parse(data);
}
