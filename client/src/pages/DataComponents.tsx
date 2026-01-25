import { Sidebar } from '@/components/Sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useDataComponents } from '@/hooks/useMitreData';
import { useSystemStatus } from '@/hooks/useProducts';
import { Database, Layers, Loader2, AlertCircle } from 'lucide-react';

export default function DataComponents() {
  const { data: components, isLoading, error } = useDataComponents();
  const { data: systemStatus } = useSystemStatus();

  const lastSync = systemStatus?.lastMitreSync
    ? new Date(systemStatus.lastMitreSync)
    : null;
  const isStale = !lastSync || Date.now() - lastSync.getTime() > 30 * 24 * 60 * 60 * 1000;
  const uniqueSources = new Set(
    (components || []).map(component => component.dataSourceName).filter(Boolean)
  ).size;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar variant="dashboard" />

      <main className="flex-1 overflow-auto">
        <div className="grid-pattern min-h-full">
          <div className="p-6 space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Data Components</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Flattened MITRE ATT&CK data components with source context for quick mapping.
              </p>
            </header>

            {isStale && (
              <Alert className="border-yellow-500/30 bg-yellow-500/10">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                <AlertTitle>Definitions may be outdated</AlertTitle>
                <AlertDescription>
                  Run "MITRE Data Sync" from Admin Tasks to refresh definitions.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-primary">{components?.length || 0}</div>
                  <div className="text-sm text-muted-foreground">Total Components</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-foreground">{uniqueSources}</div>
                  <div className="text-sm text-muted-foreground">Data Sources</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Last Sync</div>
                  <div className="text-lg font-semibold text-foreground">
                    {lastSync ? lastSync.toLocaleDateString() : 'Never'}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-primary" />
                  Component Catalog
                </CardTitle>
                <CardDescription>Data component definitions synchronized from MITRE STIX</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading data components...
                  </div>
                ) : error ? (
                  <div className="text-sm text-red-400">Failed to load data components.</div>
                ) : (components || []).length === 0 ? (
                  <div className="text-center py-12">
                    <Layers className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">No data components yet</h3>
                    <p className="text-sm text-muted-foreground">
                      Run MITRE Data Sync in Admin Tasks to populate the catalog.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {components?.map(component => (
                      <Card
                        key={component.componentId}
                        className="bg-background border-border hover:border-primary/50 transition-colors"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm text-muted-foreground">
                                  {component.dataSourceName || 'Uncategorized'}
                                </span>
                                <Badge variant="secondary" className="text-xs">
                                  {component.componentId}
                                </Badge>
                              </div>
                              <h3 className="font-semibold text-foreground">{component.name}</h3>
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {component.description || 'No description provided.'}
                              </p>
                            </div>
                            <div className="text-xs text-muted-foreground whitespace-nowrap">
                              {component.dataSourceId || '—'}
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
