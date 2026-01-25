import { useMemo, useState, useEffect } from 'react';
import { 
  Search, 
  Database, 
  Loader2,
  CheckCircle2,
  Shield,
  ChevronRight,
  Activity
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Asset, ctidProducts, dataComponents } from '@/lib/mitreData';
import { ProductView } from '@/components/ProductView';
import { useSearchProducts, useAliases, useAddAlias, useDeleteAlias, useDeleteProduct, useProducts, type Product } from '@/hooks/useProducts';
import { Sidebar } from '@/components/Sidebar';
import { getProductMapping } from '@/lib/v18Data';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { PLATFORM_VALUES, platformMatchesAny } from '@shared/platforms';

type ViewState = 'search' | 'product';

const platformOptions = ['All Platforms', ...PLATFORM_VALUES];

function convertProductToAsset(product: Product): Asset {
  return {
    id: product.productId,
    vendor: product.vendor,
    productName: product.productName,
    deployment: product.deployment || undefined,
    description: product.description,
    platforms: product.platforms,
    dataComponentIds: product.dataComponentIds,
    mitreAssetIds: product.mitreAssetIds || undefined,
    source: product.source as 'ctid' | 'custom' | 'ai-pending',
  };
}

export default function Dashboard() {
  const [location] = useLocation();
  const [view, setView] = useState<ViewState>('search');
  const [selectedProduct, setSelectedProduct] = useState<Asset | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeCategories, setActiveCategories] = useState<string[]>(['All Platforms']);
  const [selectedAliasProduct, setSelectedAliasProduct] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [editingAliasId, setEditingAliasId] = useState<number | null>(null);
  const [editingAliasValue, setEditingAliasValue] = useState('');
  const [showAliasOptions, setShowAliasOptions] = useState(false);
  const [aliasTouched, setAliasTouched] = useState(false);
  const [selectedCustomProducts, setSelectedCustomProducts] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!query.trim()) {
      setNewAlias('');
      setSelectedAliasProduct('');
      setAliasTouched(false);
      return;
    }
    if (!aliasTouched) {
      setNewAlias(query.trim());
    }
  }, [aliasTouched, query]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('productId');
    if (!productId) return;
    fetch(`/api/products/${encodeURIComponent(productId)}`)
      .then(res => res.ok ? res.json() : null)
      .then((data: Product | null) => {
        if (!data) return;
        setSelectedProduct(convertProductToAsset(data));
        setView('product');
      })
      .catch(() => undefined);
  }, [location]);

  const { data: apiProducts, isLoading } = useSearchProducts(debouncedQuery);
  const { data: allProducts = [] } = useProducts();
  const { data: aliases = [] } = useAliases();
  const addAlias = useAddAlias();
  const deleteAlias = useDeleteAlias();
  const deleteProduct = useDeleteProduct();

  const apiAssets = useMemo(() => allProducts.map(convertProductToAsset), [allProducts]);
  const mergedProducts = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const product of [...ctidProducts, ...apiAssets]) {
      if (!map.has(product.id)) {
        map.set(product.id, product);
      }
    }
    return Array.from(map.values());
  }, [apiAssets]);

  const filteredProducts = query.trim() 
    ? (apiProducts || []).map(convertProductToAsset)
    : mergedProducts.filter(p => {
        if (activeCategories.includes('All Platforms')) return true;
        return activeCategories.some(category => platformMatchesAny(p.platforms, [category]));
      });

  const counts = filteredProducts.reduce(
    (acc, product) => {
      acc.total += 1;
      if (product.source === 'ctid') acc.ctid += 1;
      if (product.source === 'custom') acc.custom += 1;
      return acc;
    },
    { total: 0, ctid: 0, custom: 0 }
  );

  const handleSelectProduct = (product: Asset) => {
    setSelectedProduct(product);
    setView('product');
  };

  const handleBack = () => {
    setView('search');
    setSelectedProduct(null);
  };

  const getSourceBadge = (source: Asset['source']) => {
    switch (source) {
      case 'ctid':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">CTID</Badge>;
      case 'custom':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Custom</Badge>;
      case 'ai-pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pending</Badge>;
    }
  };

  const aliasMatches = query.trim()
    ? aliases.filter((alias) => {
        const haystack = `${alias.alias} ${alias.productName} ${alias.vendor}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
    : [];

  const aliasProductOptions = Array.from(
    new Set([...(apiProducts || []), ...allProducts].map((product) => product.productName))
  );
  const aliasProductSuggestions = selectedAliasProduct.trim()
    ? aliasProductOptions.filter((name) =>
        name.toLowerCase().includes(selectedAliasProduct.toLowerCase())
      )
    : aliasProductOptions;
  const isKnownProduct = selectedAliasProduct.trim()
    ? aliasProductOptions.some(
        (name) => name.toLowerCase() === selectedAliasProduct.toLowerCase()
      )
    : false;

  const handleAddAlias = async () => {
    if (!newAlias.trim() || !selectedAliasProduct.trim()) return;
    await addAlias.mutateAsync({
      productName: selectedAliasProduct,
      alias: newAlias.trim(),
    });
    setNewAlias('');
  };

  const handleEditAlias = (aliasId: number, currentAlias: string) => {
    setEditingAliasId(aliasId);
    setEditingAliasValue(currentAlias);
  };

  const handleSaveAliasEdit = async (aliasId: number, productName: string) => {
    if (!editingAliasValue.trim()) return;
    await deleteAlias.mutateAsync(aliasId);
    await addAlias.mutateAsync({
      productName,
      alias: editingAliasValue.trim(),
    });
    setEditingAliasId(null);
    setEditingAliasValue('');
  };

  const selectableCustomIds = useMemo(
    () => filteredProducts.filter(product => product.source === 'custom').map(product => product.id),
    [filteredProducts]
  );

  useEffect(() => {
    if (selectedCustomProducts.size === 0) return;
    setSelectedCustomProducts(prev => {
      const allowed = new Set(selectableCustomIds);
      const next = new Set(Array.from(prev).filter(id => allowed.has(id)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [selectableCustomIds, selectedCustomProducts.size]);

  const allCustomSelected = selectableCustomIds.length > 0 &&
    selectableCustomIds.every(id => selectedCustomProducts.has(id));

  const toggleCustomSelection = (productId: string, checked: boolean) => {
    setSelectedCustomProducts(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(productId);
      } else {
        next.delete(productId);
      }
      return next;
    });
  };

  const handleSelectAllCustom = (checked: boolean) => {
    if (!checked) {
      setSelectedCustomProducts(new Set());
      return;
    }
    setSelectedCustomProducts(new Set(selectableCustomIds));
  };

  const handleBulkDelete = async () => {
    if (selectedCustomProducts.size === 0) return;
    const confirmed = window.confirm(`Delete ${selectedCustomProducts.size} custom products? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await Promise.all(Array.from(selectedCustomProducts).map(id => deleteProduct.mutateAsync(id)));
      setSelectedCustomProducts(new Set());
      toast({
        title: 'Products deleted',
        description: 'Selected custom products have been removed.',
      });
    } catch (error) {
      toast({
        title: 'Failed to delete products',
        description: error instanceof Error ? error.message : 'Unexpected error',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar variant="dashboard" />

      <main className="flex-1 overflow-auto">
        {view === 'product' && selectedProduct ? (
            <ProductView product={selectedProduct} onBack={handleBack} />
        ) : (
          <div className="p-8 space-y-6">
            <header>
              <h1 className="text-2xl font-semibold text-foreground">Security Products</h1>
              <p className="text-muted-foreground mt-1">
                Browse CTID-verified product mappings to MITRE ATT&CK detection strategies
              </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-primary">{counts.total}</div>
                  <div className="text-sm text-muted-foreground">Total Products</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-green-400">{counts.ctid}</div>
                  <div className="text-sm text-muted-foreground">CTID Verified</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-blue-400">{counts.custom}</div>
                  <div className="text-sm text-muted-foreground">Custom Mappings</div>
                </CardContent>
              </Card>
            </div>

            <div className="mb-6">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search for a product..."
                  className="pl-10 h-11 text-base"
                  data-testid="input-product-search"
                />
              </div>
            </div>

            {query.trim() && (
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="p-4 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground mb-1">Step 1: Review matching aliases</h2>
                    <p className="text-xs text-muted-foreground mb-3">
                      These aliases already exist. Use them to find the right product, or edit them if the wording is off.
                    </p>
                    {aliasMatches.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No aliases found for this query.</p>
                    ) : (
                      <div className="space-y-2">
                        {aliasMatches.slice(0, 8).map((alias) => (
                          <div
                            key={alias.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary" className="text-xs">{alias.alias}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {alias.vendor} • {alias.productName}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              {editingAliasId === alias.id ? (
                                <>
                                  <Input
                                    value={editingAliasValue}
                                    onChange={(e) => setEditingAliasValue(e.target.value)}
                                    className="h-8 w-40 text-xs"
                                  />
                                  <button
                                    className="text-primary hover:underline"
                                    onClick={() => handleSaveAliasEdit(alias.id, alias.productName)}
                                  >
                                    Save
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={() => handleEditAlias(alias.id, alias.alias)}
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-border pt-4">
                    <h2 className="text-sm font-semibold text-foreground mb-1">Step 2: Add a new alias</h2>
                    <p className="text-xs text-muted-foreground mb-3">
                      Add a new search term that should map to a product. You can pick an existing product or type a new name.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <div className="relative min-w-[220px] flex-1">
                        <Input
                          value={selectedAliasProduct}
                          onChange={(e) => setSelectedAliasProduct(e.target.value)}
                          onFocus={() => setShowAliasOptions(true)}
                          onBlur={() => setTimeout(() => setShowAliasOptions(false), 100)}
                          placeholder="Product name"
                          className="h-9 w-full"
                          data-testid="select-alias-product"
                        />
                        {showAliasOptions && aliasProductSuggestions.length > 0 && (
                          <div className="absolute z-20 mt-2 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-sm">
                            {aliasProductSuggestions.map((productName) => (
                              <button
                                key={productName}
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
                                onMouseDown={() => setSelectedAliasProduct(productName)}
                              >
                                {productName}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="flex h-9 items-center text-sm text-muted-foreground">=</span>
                      <Input
                        value={newAlias}
                        onChange={(e) => {
                          setNewAlias(e.target.value);
                          setAliasTouched(true);
                        }}
                        placeholder={`Alias for "${query}"`}
                        className="h-9 flex-1 min-w-[200px]"
                        data-testid="input-add-alias"
                      />
                      <button
                        className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
                        onClick={handleAddAlias}
                        disabled={addAlias.isPending || !isKnownProduct}
                        data-testid="button-add-alias"
                      >
                        Add Alias
                      </button>
                    </div>
                    {!isKnownProduct && selectedAliasProduct.trim() && (
                      <p className="text-xs text-muted-foreground">
                        Select an existing product to attach the alias.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-wrap gap-2">
              {platformOptions.map((platform) => (
                <button
                  key={platform}
                  onClick={() => {
                    setActiveCategories((prev) => {
                      if (platform === 'All Platforms') return ['All Platforms'];
                      const next = prev.filter(item => item !== 'All Platforms');
                      if (next.includes(platform)) {
                        const filtered = next.filter(item => item !== platform);
                        return filtered.length === 0 ? ['All Platforms'] : filtered;
                      }
                      return [...next, platform];
                    });
                  }}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    activeCategories.includes(platform)
                      ? 'bg-muted text-foreground border-foreground/30'
                      : 'bg-background text-foreground border-border hover:border-foreground/30'
                  }`}
                  data-testid={`filter-${platform.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {platform}
                </button>
              ))}
            </div>

            {selectableCustomIds.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={allCustomSelected}
                    onCheckedChange={(checked) => handleSelectAllCustom(Boolean(checked))}
                  />
                  <span>
                    Select all custom ({selectedCustomProducts.size})
                  </span>
                  {selectedCustomProducts.size > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedCustomProducts(new Set())}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleBulkDelete}
                  disabled={selectedCustomProducts.size === 0 || deleteProduct.isPending}
                >
                  Delete selected
                </Button>
              </div>
            )}

            {isLoading && query.trim() ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <span className="ml-3 text-muted-foreground">Searching products...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredProducts.map((product) => {
                  const mapping = getProductMapping(product.id);
                  const isSelected = selectedCustomProducts.has(product.id);
                  return (
                    <Card 
                      key={product.id}
                      className={cn(
                        "bg-background border-border hover:border-primary/50 transition-all cursor-pointer group",
                        isSelected && "ring-2 ring-primary/30"
                      )}
                      onClick={() => handleSelectProduct(product)}
                      data-testid={`card-product-${product.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm text-muted-foreground">{product.vendor}</span>
                              {getSourceBadge(product.source)}
                            </div>
                            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                              {product.productName}
                            </h3>
                            {product.deployment && (
                              <span className="text-xs text-muted-foreground">{product.deployment}</span>
                            )}
                            
                            <div className="flex items-center gap-4 mt-3 text-xs">
                              <div className="flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-blue-400" />
                                <span className="text-muted-foreground">
                                  {product.dataComponentIds.length} Data Components
                                </span>
                              </div>
                              {mapping && (
                                <div className="flex items-center gap-1">
                                  <Activity className="w-3 h-3 text-purple-400" />
                                  <span className="text-muted-foreground">
                                    {mapping.analytics.length} Analytics
                                  </span>
                                </div>
                              )}
                              {mapping && (
                                <div className="flex items-center gap-1">
                                  <Shield className="w-3 h-3 text-green-400" />
                                  <span className="text-muted-foreground">
                                    {mapping.techniques.length} Techniques
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            {product.source === 'custom' && (
                              <Checkbox
                                checked={isSelected}
                                onClick={(event) => event.stopPropagation()}
                                onCheckedChange={(checked) => toggleCustomSelection(product.id, Boolean(checked))}
                              />
                            )}
                            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {filteredProducts.length === 0 && !isLoading && (
              <div className="text-center py-16">
                <Database className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No products found</h3>
                <p className="text-muted-foreground">
                  Try adjusting your search or filters
                </p>
                {query.trim() && (
                  <div className="mt-6">
                    <Link href={`/ai-mapper?q=${encodeURIComponent(query.trim())}`}>
                      <Button>New Mapping</Button>
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
