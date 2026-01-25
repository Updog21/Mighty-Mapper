import { useMemo, useState, useEffect } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Database, ChevronRight } from 'lucide-react';
import { ProductView } from '@/components/ProductView';
import { ctidProducts, type Asset } from '@/lib/products';
import { useDeleteProduct, useProducts, type Product } from '@/hooks/useProducts';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

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

export default function Products() {
  const [selectedProduct, setSelectedProduct] = useState<Asset | null>(null);
  const { data: dbProducts = [] } = useProducts();
  const deleteProduct = useDeleteProduct();
  const { toast } = useToast();
  const [selectedCustomProducts, setSelectedCustomProducts] = useState<Set<string>>(new Set());

  const mergedProducts = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const product of ctidProducts) {
      map.set(product.id, product);
    }
    for (const product of dbProducts.map(convertProductToAsset)) {
      if (!map.has(product.id)) {
        map.set(product.id, product);
      }
    }
    return Array.from(map.values());
  }, [dbProducts]);

  const selectableCustomIds = useMemo(
    () => mergedProducts.filter(product => product.source === 'custom').map(product => product.id),
    [mergedProducts]
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

  if (selectedProduct) {
    return (
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar variant="dashboard" />
        <main className="flex-1 overflow-auto">
          <div className="grid-pattern min-h-full">
            <div className="p-6">
              <ProductView product={selectedProduct} onBack={() => setSelectedProduct(null)} />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar variant="dashboard" />

      <main className="flex-1 overflow-auto">
        <div className="grid-pattern min-h-full">
          <div className="p-6 space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Security Stack</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Browse all mapped security products and their MITRE ATT&CK coverage
              </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-primary">{mergedProducts.length}</div>
                  <div className="text-sm text-muted-foreground">Total Products</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-green-400">
                    {mergedProducts.filter(p => p.source === 'ctid').length}
                  </div>
                  <div className="text-sm text-muted-foreground">CTID Verified</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-blue-400">
                    {mergedProducts.filter(p => p.source === 'custom').length}
                  </div>
                  <div className="text-sm text-muted-foreground">Custom Mappings</div>
                </CardContent>
              </Card>
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

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-primary" />
                  All Mapped Products
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {mergedProducts.map((product) => {
                    const isSelected = selectedCustomProducts.has(product.id);
                    return (
                    <Card
                      key={product.id}
                      className={cn(
                        "bg-background border-border hover:border-primary/50 transition-all cursor-pointer group",
                        isSelected && "ring-2 ring-primary/30"
                      )}
                      onClick={() => setSelectedProduct(product)}
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
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
