import { useState } from 'react';
import { Search, Database, Cpu, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { searchProducts, Asset, getAllProducts } from '@/lib/v18Data';
import { cn } from '@/lib/utils';

interface ProductSearchProps {
  onSelectProduct: (asset: Asset) => void;
  onRequestAIMapping: () => void;
}

export function ProductSearch({ onSelectProduct, onRequestAIMapping }: ProductSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Asset[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = () => {
    if (!query.trim()) return;
    const found = searchProducts(query);
    setResults(found);
    setHasSearched(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const getSourceBadge = (source: Asset['source']) => {
    switch (source) {
      case 'ctid':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">CTID Verified</Badge>;
      case 'custom':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Custom Mapping</Badge>;
      case 'ai-pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">AI Pending</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search vendor products (e.g., Azure Entra ID, Cisco Meraki)..."
              className="pl-11 h-12 bg-background border-input text-base"
              data-testid="input-product-search"
            />
          </div>
          <Button onClick={handleSearch} size="lg" data-testid="button-search">
            <Search className="w-4 h-4 mr-2" />
            Search
          </Button>
        </div>
      </div>

      {hasSearched && (
        <div className="space-y-3">
          {results.length > 0 ? (
            <>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Database className="w-4 h-4 text-green-400" />
                <span>Found {results.length} product(s) in CTID Security Stack Mappings</span>
              </div>
              
              {results.map((asset) => (
                <Card 
                  key={asset.id}
                  className="bg-card/50 backdrop-blur border-border hover:border-primary/50 transition-all cursor-pointer group"
                  onClick={() => onSelectProduct(asset)}
                  data-testid={`card-result-${asset.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm text-muted-foreground">{asset.vendor}</span>
                          {getSourceBadge(asset.source)}
                        </div>
                        <h3 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                          {asset.productName}
                        </h3>
                        {asset.deployment && (
                          <span className="text-xs text-muted-foreground">Deployment: {asset.deployment}</span>
                        )}
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                          {asset.description}
                        </p>
                        <div className="flex items-center gap-2 mt-3">
                          <Badge variant="secondary" className="text-xs">
                            {asset.dataComponents.length} Data Components
                          </Badge>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          ) : (
            <Card className="bg-card/50 backdrop-blur border-border border-dashed">
              <CardContent className="p-6 text-center">
                <Cpu className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  No CTID mapping found for "{query}"
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This product isn't in the MITRE CTID Security Stack Mappings database yet.
                  Would you like to use AI to create a mapping?
                </p>
                <Button onClick={onRequestAIMapping} data-testid="button-request-ai-mapping">
                  <Cpu className="w-4 h-4 mr-2" />
                  Create AI Mapping
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!hasSearched && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
          <div className="text-sm text-muted-foreground mb-2 col-span-full">
            Popular products with CTID mappings:
          </div>
          {getAllProducts().slice(0, 4).map((asset) => (
            <Card 
              key={asset.id}
              className="bg-muted/20 border-border hover:border-primary/50 transition-all cursor-pointer group"
              onClick={() => onSelectProduct(asset)}
              data-testid={`card-popular-${asset.id}`}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-muted-foreground">{asset.vendor}</span>
                    <h4 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {asset.productName}
                    </h4>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
