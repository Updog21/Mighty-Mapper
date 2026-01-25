import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Product {
  id: number;
  productId: string;
  vendor: string;
  productName: string;
  deployment?: string | null;
  description: string;
  platforms: string[];
  productType?: string | null;
  capabilityTags?: string[] | null;
  dataComponentIds: string[];
  mitreAssetIds: string[] | null;
  source: string;
  logoPath?: string | null;
  hybridSelectorType?: string | null;
  hybridSelectorValues?: string[] | null;
  createdAt: string;
}

export interface ProductAlias {
  id: number;
  productId: number;  // FK to products.id
  alias: string;
  confidence: number | null;
  createdBy: string | null;
  createdAt: string;
  // Joined fields from products table
  productName: string;
  vendor: string;
}

export interface ResolvedSearchTerms {
  canonicalName: string;
  vendor: string;
  aliases: string[];
  allTerms: string[];
}

export interface SystemStatus {
  products: {
    total: number;
    bySource: {
      ctid: number;
      custom: number;
      'ai-pending': number;
    };
  };
  aliases: number;
  stix: Record<string, number>;
  sigma?: {
    exists: boolean;
    lastUpdated?: string;
  };
  repos?: {
    sigma: { exists: boolean; lastUpdated?: string };
    splunk: { exists: boolean; lastUpdated?: string };
    elastic: { exists: boolean; lastUpdated?: string };
    azure: { exists: boolean; lastUpdated?: string };
    ctid: { exists: boolean; lastUpdated?: string };
    stats?: {
      sigma: { rules: number };
      splunk: { detections: number };
      elastic: { rules: number };
      azure: { rules: number };
      ctid: { mappings: number };
    };
  };
  startupLog?: string[];
  lastMitreSync?: string | null;
  timestamp: string;
}

// ============================================================
// API Functions
// ============================================================

async function fetchAllProducts(): Promise<Product[]> {
  const response = await fetch('/api/admin/products');
  if (!response.ok) {
    throw new Error('Failed to fetch products');
  }
  return response.json();
}

async function searchProductsApi(query: string): Promise<Product[]> {
  const response = await fetch(`/api/admin/products/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error('Failed to search products');
  }
  return response.json();
}

async function fetchProductById(productId: string): Promise<Product> {
  const response = await fetch(`/api/products/${encodeURIComponent(productId)}`);
  if (!response.ok) {
    throw new Error('Failed to fetch product');
  }
  return response.json();
}

async function resolveSearchTermsApi(query: string): Promise<ResolvedSearchTerms> {
  const response = await fetch(`/api/admin/products/resolve/${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error('Could not resolve product');
  }
  return response.json();
}

async function fetchAllAliases(): Promise<ProductAlias[]> {
  const response = await fetch('/api/admin/aliases');
  if (!response.ok) {
    throw new Error('Failed to fetch aliases');
  }
  return response.json();
}

async function fetchSystemStatus(): Promise<SystemStatus> {
  const response = await fetch('/api/admin/status');
  if (!response.ok) {
    throw new Error('Failed to fetch system status');
  }
  return response.json();
}

interface CreateProductInput {
  productId: string;
  vendor: string;
  productName: string;
  description: string;
  platforms: string[];
  dataComponentIds: string[];
  source: 'custom' | 'ai-pending';
  deployment?: string;
  productType?: string;
  logoPath?: string;
}

async function createProductApi(product: CreateProductInput): Promise<Product> {
  const response = await fetch('/api/admin/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product)
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create product');
  }
  return response.json();
}

interface AddAliasInput {
  productId?: number;      // Use FK directly
  productName?: string;    // Or lookup by name
  alias: string;
  confidence?: number;
}

async function addAliasApi(input: AddAliasInput): Promise<ProductAlias> {
  const response = await fetch('/api/admin/aliases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add alias');
  }
  return response.json();
}

async function deleteAliasApi(aliasId: number): Promise<void> {
  const response = await fetch(`/api/admin/aliases/${aliasId}`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete alias');
  }
}

async function deleteProductApi(productId: string): Promise<void> {
  const response = await fetch(`/api/admin/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete product');
  }
}

// ============================================================
// React Query Hooks
// ============================================================

/**
 * Fetch all products from database
 */
export function useProducts() {
  return useQuery({
    queryKey: ['products', 'all'],
    queryFn: fetchAllProducts,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Search products with alias resolution
 */
export function useSearchProducts(query: string) {
  return useQuery({
    queryKey: ['products', 'search', query],
    queryFn: () => searchProductsApi(query),
    enabled: query.trim().length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get a single product by ID
 */
export function useProduct(productId: string) {
  return useQuery({
    queryKey: ['products', productId],
    queryFn: () => fetchProductById(productId),
    enabled: !!productId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Resolve search terms for a query (useful for debugging)
 */
export function useResolveSearchTerms(query: string) {
  return useQuery({
    queryKey: ['products', 'resolve', query],
    queryFn: () => resolveSearchTermsApi(query),
    enabled: query.trim().length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch all product aliases
 */
export function useAliases() {
  return useQuery({
    queryKey: ['aliases', 'all'],
    queryFn: fetchAllAliases,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch system status
 */
export function useSystemStatus() {
  return useQuery({
    queryKey: ['admin', 'status'],
    queryFn: fetchSystemStatus,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Create a new custom product
 */
export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProductApi,
    onSuccess: () => {
      // Invalidate products list to refetch
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'status'] });
    },
  });
}

/**
 * Add a new alias
 */
export function useAddAlias() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addAliasApi,
    onSuccess: () => {
      // Invalidate aliases list
      queryClient.invalidateQueries({ queryKey: ['aliases'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'status'] });
    },
  });
}

/**
 * Delete an alias
 */
export function useDeleteAlias() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAliasApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aliases'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'status'] });
    },
  });
}

/**
 * Delete a product
 */
export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteProductApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'status'] });
    },
  });
}

/**
 * Group products by source type
 */
export function groupProductsBySource(products: Product[]): Record<string, Product[]> {
  return products.reduce((acc, product) => {
    const source = product.source || 'unknown';
    if (!acc[source]) {
      acc[source] = [];
    }
    acc[source].push(product);
    return acc;
  }, {} as Record<string, Product[]>);
}

/**
 * Group products by vendor
 */
export function groupProductsByVendor(products: Product[]): Record<string, Product[]> {
  return products.reduce((acc, product) => {
    const vendor = product.vendor || 'Unknown';
    if (!acc[vendor]) {
      acc[vendor] = [];
    }
    acc[vendor].push(product);
    return acc;
  }, {} as Record<string, Product[]>);
}
