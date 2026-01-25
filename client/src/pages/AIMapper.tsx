import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Sidebar } from '@/components/Sidebar';
import { AIMapperFlow } from '@/components/AIMapperFlow';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Cpu, Plus } from 'lucide-react';

export default function AIMapper() {
  const [location, setLocation] = useLocation();
  const initialQuery = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('q') || '';
  }, [location]);
  const evidenceFor = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('evidenceFor');
  }, [location]);
  const [showFlow, setShowFlow] = useState(Boolean(initialQuery || evidenceFor));
  const flowMode: 'create' | 'evidence' = evidenceFor ? 'evidence' : 'create';

  useEffect(() => {
    if (initialQuery || evidenceFor) {
      setShowFlow(true);
    }
  }, [initialQuery, evidenceFor]);

  const handleComplete = (productId: string) => {
    setShowFlow(false);
    setLocation(`/?productId=${encodeURIComponent(productId)}`);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar variant="dashboard" />

      <main className="flex-1 overflow-auto">
        <div className="grid-pattern min-h-full">
          <div className="p-6 space-y-6">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center glow-primary">
                  <Cpu className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-foreground tracking-tight">Auto Mapper</h1>
                  <p className="text-muted-foreground text-sm">
                    Create a new product mapping and run the community auto-mapper.
                  </p>
                </div>
              </div>
              {!showFlow && (
                <Button onClick={() => setShowFlow(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Mapping
                </Button>
              )}
            </header>

            {showFlow ? (
              <AIMapperFlow
                initialQuery={flowMode === 'create' ? initialQuery : undefined}
                existingProductId={evidenceFor || undefined}
                mode={flowMode}
                onComplete={handleComplete}
                onCancel={() => setShowFlow(false)}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-card/50 backdrop-blur border-border">
                  <CardHeader>
                    <CardTitle>Start a new mapping</CardTitle>
                    <CardDescription>
                      Add the vendor and product details, select MITRE platforms, and run Auto Map.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button onClick={() => setShowFlow(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Create Mapping
                    </Button>
                  </CardContent>
                </Card>
                <Card className="bg-card/50 backdrop-blur border-border">
                  <CardHeader>
                    <CardTitle>What happens next</CardTitle>
                    <CardDescription>
                      The auto-mapper pulls detections from community sources and builds coverage for the new product.
                    </CardDescription>
                  </CardHeader>
                </Card>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
