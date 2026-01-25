import { Sidebar } from '@/components/Sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDetectionStrategies } from '@/hooks/useMitreData';
import { Shield, Loader2 } from 'lucide-react';

export default function DetectionStrategies() {
  const { data: strategies, isLoading, error } = useDetectionStrategies();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar variant="dashboard" />

      <main className="flex-1 overflow-auto">
        <div className="grid-pattern min-h-full">
          <div className="p-6 space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Detection Strategies</h1>
              <p className="text-muted-foreground text-sm mt-1">
                MITRE detection strategies flattened for quick lookup and coverage planning.
              </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-primary">{strategies?.length || 0}</div>
                  <div className="text-sm text-muted-foreground">Total Strategies</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-foreground">
                    {strategies?.filter(strategy => strategy.description).length || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">With Descriptions</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Source</div>
                  <div className="text-lg font-semibold text-foreground">MITRE ATT&CK</div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-primary" />
                  Strategy Catalog
                </CardTitle>
                <CardDescription>Detection strategies synchronized from MITRE STIX</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading detection strategies...
                  </div>
                ) : error ? (
                  <div className="text-sm text-red-400">Failed to load detection strategies.</div>
                ) : (strategies || []).length === 0 ? (
                  <div className="text-center py-12">
                    <Shield className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">No strategies yet</h3>
                    <p className="text-sm text-muted-foreground">
                      Run MITRE Data Sync in Admin Tasks to populate the catalog.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {strategies?.map(strategy => (
                      <Card
                        key={strategy.strategyId}
                        className="bg-background border-border hover:border-primary/50 transition-colors"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="secondary" className="text-xs">
                                  {strategy.strategyId}
                                </Badge>
                              </div>
                              <h3 className="font-semibold text-foreground">{strategy.name}</h3>
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {strategy.description || 'No description provided.'}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
