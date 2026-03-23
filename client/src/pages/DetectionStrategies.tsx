import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StixExportControls } from '@/components/StixExportControls';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useDetectionStrategies } from '@/hooks/useMitreData';
import { useSystemStatus } from '@/hooks/useProducts';
import { toMarkdownTable } from '@/lib/stix-export';
import { subjectIdPillClass } from '@/lib/utils';
import { Shield, Loader2, AlertCircle, ExternalLink, ChevronDown, ChevronRight, Layers } from 'lucide-react';

export default function DetectionStrategies() {
  const { data: strategies, isLoading, error } = useDetectionStrategies();
  const { data: systemStatus } = useSystemStatus();
  const [location] = useLocation();
  const [expandedStrategies, setExpandedStrategies] = useState<Set<string>>(new Set());

  const strategyFilter = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return (new URLSearchParams(window.location.search).get('strategy') || '').trim().toUpperCase();
  }, [location]);

  const visibleStrategies = useMemo(() => {
    const list = strategies || [];
    if (!strategyFilter) return list;
    return list.filter((strategy) => (
      strategy.strategyId.toUpperCase() === strategyFilter
      || strategy.name.toLowerCase().includes(strategyFilter.toLowerCase())
    ));
  }, [strategies, strategyFilter]);

  const uniqueTechniques = useMemo(() => (
    new Set(
      visibleStrategies.flatMap((strategy) => (
        Array.isArray(strategy.techniques)
          ? strategy.techniques.map((technique) => technique.id)
          : []
      ))
    ).size
  ), [visibleStrategies]);

  const lastSync = systemStatus?.lastMitreSync
    ? new Date(systemStatus.lastMitreSync)
    : null;
  const isStale = !lastSync || Date.now() - lastSync.getTime() > 30 * 24 * 60 * 60 * 1000;

  const setExpanded = (strategyId: string, open: boolean) => {
    setExpandedStrategies((prev) => {
      const next = new Set(prev);
      if (open) next.add(strategyId);
      else next.delete(strategyId);
      return next;
    });
  };
  const exportPayload = useMemo(
    () => ({
      page: 'detection-strategies',
      strategyFilter: strategyFilter || null,
      totalStrategies: visibleStrategies.length,
      detectionStrategies: visibleStrategies,
    }),
    [strategyFilter, visibleStrategies]
  );
  const exportMarkdown = useMemo(() => {
    const lines: string[] = [
      '# Detection Strategies',
      '',
      `- Strategy Filter: ${strategyFilter || 'None'}`,
      `- Total Strategies: ${visibleStrategies.length}`,
      '',
    ];

    visibleStrategies.forEach((strategy) => {
      lines.push(`## ${strategy.name} (${strategy.strategyId})`, '');
      lines.push(strategy.description || 'No description provided.', '');

      lines.push('### Techniques', '');
      if (Array.isArray(strategy.techniques) && strategy.techniques.length > 0) {
        lines.push(
          toMarkdownTable(
            ['ID', 'Name'],
            strategy.techniques.map((technique) => [technique.id, technique.name])
          )
        );
      } else {
        lines.push('No techniques mapped.');
      }
      lines.push('');

      lines.push('### Analytics', '');
      if (Array.isArray(strategy.analytics) && strategy.analytics.length > 0) {
        lines.push(
          toMarkdownTable(
            ['ID', 'Name', 'Platforms'],
            strategy.analytics.map((analytic) => [
              analytic.id,
              analytic.name,
              Array.isArray(analytic.platforms) && analytic.platforms.length > 0
                ? analytic.platforms.join(', ')
                : '-',
            ])
          )
        );
      } else {
        lines.push('No analytics mapped.');
      }
      lines.push('');

      lines.push('### Data Components', '');
      if (Array.isArray(strategy.dataComponents) && strategy.dataComponents.length > 0) {
        lines.push(
          toMarkdownTable(
            ['ID', 'Name'],
            strategy.dataComponents.map((component) => [
              component.id,
              component.name,
            ])
          )
        );
      } else {
        lines.push('No data components mapped.');
      }
      lines.push('');
    });

    return lines.join('\n');
  }, [strategyFilter, visibleStrategies]);

  return (
    <AppShell contentClassName="space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Detection Strategies</h1>
              <p className="text-muted-foreground text-sm mt-1">
                MITRE ATT&CK detection strategies with linked techniques, analytics, and data components.
              </p>
              <div className="mt-3">
                <StixExportControls
                  baseName={`detection-strategies-${strategyFilter || 'all'}`}
                  jsonPayload={exportPayload}
                  markdownContent={exportMarkdown}
                  disabled={isLoading || Boolean(error)}
                />
              </div>
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
                  <div className="text-3xl font-bold text-primary">{visibleStrategies.length}</div>
                  <div className="text-sm text-muted-foreground">Total Strategies</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-foreground">{uniqueTechniques}</div>
                  <div className="text-sm text-muted-foreground">Techniques Covered</div>
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
                ) : visibleStrategies.length === 0 ? (
                  <div className="text-center py-12">
                    <Layers className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {strategyFilter ? `No results for ${strategyFilter}` : 'No strategies yet'}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {strategyFilter
                        ? 'Try a different strategy link or clear filters from the source page.'
                        : 'Run MITRE Data Sync in Admin Tasks to populate the catalog.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {strategyFilter ? (
                      <p className="text-xs text-muted-foreground">
                        Filtered by strategy: <span className="font-mono">{strategyFilter}</span>
                      </p>
                    ) : null}
                    {visibleStrategies.map((strategy) => {
                      const strategyKey = strategy.strategyId;
                      const isExpanded = expandedStrategies.has(strategyKey);
                      return (
                        <Card
                          key={strategyKey}
                          className="bg-background border-border hover:border-primary/50 transition-colors overflow-hidden"
                        >
                          <Collapsible open={isExpanded} onOpenChange={(open) => setExpanded(strategyKey, open)}>
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                className="flex w-full items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/20"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-3">
                                    <h3 className="text-base font-normal text-foreground leading-tight">
                                      {strategy.name}
                                    </h3>
                                    <Badge variant="outline" className={`shrink-0 text-xs ${subjectIdPillClass('detection-strategy')}`}>
                                      {strategy.strategyId}
                                    </Badge>
                                  </div>
                                </div>
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                                )}
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <CardContent className="px-5 pb-5 pt-0 space-y-4 border-t border-border/60">
                                <div className="pt-4">
                                  <a
                                    href={`https://attack.mitre.org/detectionstrategies/${strategy.strategyId}/`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-primary hover:underline underline-offset-2 break-all text-sm"
                                  >
                                    {`https://attack.mitre.org/detectionstrategies/${strategy.strategyId}/`}
                                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                                  </a>
                                </div>

                                <div className="space-y-1">
                                  <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                                    Description
                                  </h4>
                                  <p className="text-sm text-foreground leading-relaxed">
                                    {strategy.description || 'No description provided.'}
                                  </p>
                                </div>

                                <div className="space-y-1">
                                  <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                                    Techniques
                                  </h4>
                                  {Array.isArray(strategy.techniques) && strategy.techniques.length > 0 ? (
                                    <div className="overflow-x-auto rounded-md border border-border">
                                      <table className="w-full text-sm border-collapse">
                                        <thead className="bg-muted/40">
                                          <tr>
                                            <th className="text-left px-3 py-2 font-medium text-foreground border border-border">ID</th>
                                            <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Name</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {strategy.techniques.map((technique) => (
                                            <tr key={`${strategyKey}-technique-${technique.id}`} className="align-top">
                                              <td className="px-3 py-2 border border-border">
                                                <a
                                                  href={`/detections?technique=${encodeURIComponent(technique.id)}`}
                                                  className="font-mono text-red-600 hover:underline underline-offset-2"
                                                >
                                                  {technique.id}
                                                </a>
                                              </td>
                                              <td className="px-3 py-2 text-foreground font-normal border border-border">
                                                {technique.name}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">No techniques mapped.</p>
                                  )}
                                </div>

                                <div className="space-y-1">
                                  <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                                    Analytics
                                  </h4>
                                  {Array.isArray(strategy.analytics) && strategy.analytics.length > 0 ? (
                                    <div className="overflow-x-auto rounded-md border border-border">
                                      <table className="w-full text-sm border-collapse">
                                        <thead className="bg-muted/40">
                                          <tr>
                                            <th className="text-left px-3 py-2 font-medium text-foreground border border-border">ID</th>
                                            <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Name</th>
                                            <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Platforms</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {strategy.analytics.map((analytic) => (
                                            <tr key={`${strategyKey}-analytic-${analytic.id}`} className="align-top">
                                              <td className="px-3 py-2 text-foreground font-mono text-xs border border-border">
                                                {analytic.id}
                                              </td>
                                              <td className="px-3 py-2 text-foreground font-normal border border-border">
                                                {analytic.name}
                                              </td>
                                              <td className="px-3 py-2 text-muted-foreground border border-border">
                                                {Array.isArray(analytic.platforms) && analytic.platforms.length > 0
                                                  ? analytic.platforms.join(', ')
                                                  : '—'}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">No analytics mapped.</p>
                                  )}
                                </div>

                                <div className="space-y-1">
                                  <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                                    Data Components
                                  </h4>
                                  {Array.isArray(strategy.dataComponents) && strategy.dataComponents.length > 0 ? (
                                    <div className="overflow-x-auto rounded-md border border-border">
                                      <table className="w-full text-sm border-collapse">
                                        <thead className="bg-muted/40">
                                          <tr>
                                            <th className="text-left px-3 py-2 font-medium text-foreground border border-border">ID</th>
                                            <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Name</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {strategy.dataComponents.map((component) => (
                                            <tr key={`${strategyKey}-dc-${component.id}`} className="align-top">
                                              <td className="px-3 py-2 text-foreground font-mono text-xs border border-border">
                                                {component.id}
                                              </td>
                                              <td className="px-3 py-2 text-foreground font-normal border border-border">
                                                {component.name}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">No data components mapped.</p>
                                  )}
                                </div>
                              </CardContent>
                            </CollapsibleContent>
                          </Collapsible>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
    </AppShell>
  );
}
