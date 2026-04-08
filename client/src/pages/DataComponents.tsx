import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StixExportControls } from '@/components/StixExportControls';
import { useDataComponents } from '@/hooks/useMitreData';
import { useSystemStatus } from '@/hooks/useProducts';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toMarkdownTable } from '@/lib/stix-export';
import { subjectIdPillClass } from '@/lib/utils';
import { PLATFORM_VALUES, normalizePlatformList } from '@shared/platforms';
import { Database, Layers, Loader2, AlertCircle, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

export default function DataComponents() {
  const [selectedPlatform, setSelectedPlatform] = useState<string>('All Platforms');
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(new Set());
  const [showDescriptions, setShowDescriptions] = useState<boolean>(false);
  const normalizedSelection = useMemo(() => (
    selectedPlatform === 'All Platforms'
      ? []
      : normalizePlatformList([selectedPlatform])
  ), [selectedPlatform]);
  const { data: components, isLoading, error } = useDataComponents(normalizedSelection);
  const { data: systemStatus } = useSystemStatus();

  const lastSync = systemStatus?.lastMitreSync
    ? new Date(systemStatus.lastMitreSync)
    : null;
  const isStale = !lastSync || Date.now() - lastSync.getTime() > 30 * 24 * 60 * 60 * 1000;
  const uniqueSources = new Set(
    (components || []).map(component => component.dataSourceName).filter(Boolean)
  ).size;
  const platformOptions = useMemo(
    () => ['All Platforms', ...PLATFORM_VALUES],
    []
  );
  const toAttackDataComponentId = (value: string): string => {
    if (!value) return '';
    const match = value.match(/DC\d{4}/i);
    return match ? match[0].toUpperCase() : '';
  };
  const setExpanded = (componentKey: string, open: boolean) => {
    setExpandedComponents((prev) => {
      const next = new Set(prev);
      if (open) next.add(componentKey);
      else next.delete(componentKey);
      return next;
    });
  };
  const componentRows = components || [];
  const exportPayload = useMemo(
    () => ({
      page: 'data-components',
      selectedPlatform,
      totalComponents: componentRows.length,
      dataComponents: componentRows,
    }),
    [componentRows, selectedPlatform]
  );
  const exportMarkdown = useMemo(() => {
    const lines: string[] = [
      '# Data Components',
      '',
      `- Platform Filter: ${selectedPlatform}`,
      `- Total Components: ${componentRows.length}`,
      '',
    ];

    componentRows.forEach((component) => {
      const attackId = toAttackDataComponentId(component.id) || component.id;
      lines.push(`## ${component.name} (${attackId})`, '');
      lines.push(component.description || 'No description provided.', '');

      if (Array.isArray(component.examples) && component.examples.length > 0) {
        lines.push('### Examples', '');
        component.examples.forEach((example) => lines.push(`- ${example}`));
        lines.push('');
      }

      lines.push('### Log Sources', '');
      if (Array.isArray(component.logSources) && component.logSources.length > 0) {
        lines.push(
          toMarkdownTable(
            ['Name', 'Channel'],
            component.logSources.map((source) => [source.name, source.channel || '-'])
          )
        );
      } else {
        lines.push('No log sources listed.');
      }
      lines.push('');

      lines.push('### Detection Strategies', '');
      if (Array.isArray(component.detectionStrategies) && component.detectionStrategies.length > 0) {
        lines.push(
          toMarkdownTable(
            ['ID', 'Name', 'Technique Detected'],
            component.detectionStrategies.map((strategy) => [
              strategy.id,
              strategy.name,
              Array.isArray(strategy.techniques) && strategy.techniques.length > 0
                ? strategy.techniques.map((technique) => `${technique.id} (${technique.name})`).join(', ')
                : '-',
            ])
          )
        );
      } else {
        lines.push('No detection strategies mapped.');
      }
      lines.push('');
    });

    return lines.join('\n');
  }, [componentRows, selectedPlatform]);

  function renderDescription(text: string) {
    if (!text) return 'No description provided.';
    const codeRegex = /<code>([\s\S]*?)<\/code>/gi;
    const urlRegex = /(https?:\/\/[^\s)]+)/g;

    const parts: Array<string | ReactNode> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    // Extract <code> blocks and surrounding text
    while ((match = codeRegex.exec(text)) !== null) {
      const idx = match.index ?? 0;
      if (idx > lastIndex) {
        parts.push(text.slice(lastIndex, idx));
      }
      const inner = match[1] ?? '';
      parts.push(
        <code key={`code-${idx}`} className="px-1 rounded bg-muted/30 font-mono text-[0.85em]">
          {inner}
        </code>
      );
      lastIndex = idx + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    // Linkify URLs in string segments only
    const linked: Array<string | ReactNode> = [];
    parts.forEach((node, i) => {
      if (typeof node !== 'string') {
        linked.push(node);
        return;
      }
      let cursor = 0;
      let urlMatch: RegExpExecArray | null;
      while ((urlMatch = urlRegex.exec(node)) !== null) {
        const mi = urlMatch.index ?? 0;
        if (mi > cursor) {
          linked.push(node.slice(cursor, mi));
        }
        const url = urlMatch[1];
        linked.push(
          <a key={`url-${i}-${mi}`} href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {url}
          </a>
        );
        cursor = mi + url.length;
      }
      if (cursor < node.length) {
        linked.push(node.slice(cursor));
      }
    });

    return <span className="whitespace-pre-wrap">{linked}</span>;
  }

  return (
    <AppShell contentClassName="space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Data Components</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Flattened MITRE ATT&CK data components with source context for quick mapping.
              </p>
              <div className="mt-3">
                <StixExportControls
                  baseName={`data-components-${selectedPlatform}`}
                  jsonPayload={exportPayload}
                  markdownContent={exportMarkdown}
                  disabled={isLoading || Boolean(error)}
                />
              </div>
            </header>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Platform filter</CardTitle>
                <CardDescription>Filter data components by MITRE platform scope.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {platformOptions.map((platform) => {
                    const isSelected = platform === selectedPlatform;
                    return (
                      <Button
                        key={platform}
                        type="button"
                        size="sm"
                        variant={isSelected ? 'default' : 'outline'}
                        className="rounded-full"
                        onClick={() => setSelectedPlatform(platform)}
                      >
                        {platform}
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

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
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="w-5 h-5 text-primary" />
                      Component Catalog
                    </CardTitle>
                    <CardDescription>Data component definitions synchronized from MITRE STIX</CardDescription>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
                    <span>Show descriptions</span>
                    <Switch checked={showDescriptions} onCheckedChange={setShowDescriptions} />
                  </label>
                </div>
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
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {selectedPlatform === 'All Platforms'
                        ? 'No data components yet'
                        : `No data components mapped for ${selectedPlatform}`}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedPlatform === 'All Platforms'
                        ? 'Run MITRE Data Sync in Admin Tasks to populate the catalog.'
                        : 'Ensure the platform map has been rebuilt (restart the server or run Database Seed).'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {components?.map(component => (
                      (() => {
                        const componentKey = `${component.id}-${component.name}`;
                        const attackId = toAttackDataComponentId(component.id);
                        const isExpanded = expandedComponents.has(componentKey);
                        return (
                          <Card
                            key={componentKey}
                            className="bg-background border-border hover:border-primary/50 transition-colors overflow-hidden"
                          >
                            <Collapsible open={isExpanded} onOpenChange={(open) => setExpanded(componentKey, open)}>
                              <CollapsibleTrigger asChild>
                                <button
                                  type="button"
                                  className="flex w-full items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/20"
                                >
                                  <div className="min-w-0 flex-1 pr-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <h3 className="text-base font-normal text-foreground leading-tight">
                                        {component.name}
                                      </h3>
                                      <Badge variant="outline" className={`shrink-0 text-xs ${subjectIdPillClass('data-component')}`}>
                                        {attackId || 'Unknown ID'}
                                      </Badge>
                                    </div>
                                    {showDescriptions && (
                                      <div className="text-xs text-muted-foreground mt-2 leading-relaxed">
                                        {renderDescription(component.description || '')}
                                      </div>
                                    )}
                                  </div>
                                  <div className="ml-1 flex items-center gap-2">
                                    {isExpanded ? (
                                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                                    )}
                                  </div>
                                </button>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <CardContent className="px-5 pb-5 pt-0 space-y-4 border-t border-border/60">
                                  {attackId ? (
                                    <div className="pt-4">
                                      <a
                                        href={`https://attack.mitre.org/datacomponents/${attackId}/`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-primary hover:underline underline-offset-2 break-all text-sm"
                                      >
                                        {`https://attack.mitre.org/datacomponents/${attackId}/`}
                                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                                      </a>
                                    </div>
                                  ) : null}

                                  <div className="space-y-1">
                                    <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                                      Description
                                    </h4>
                                    <p className="text-sm text-foreground leading-relaxed">
                                      {component.description || 'No description provided.'}
                                    </p>
                                  </div>

                                  {Array.isArray(component.examples) && component.examples.length > 0 ? (
                                    <div className="space-y-2">
                                      <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                                        Examples
                                      </h4>
                                      <div className="rounded-md border border-border bg-muted/20 p-3">
                                        <ol className="list-decimal pl-5 space-y-2 text-sm text-foreground">
                                          {component.examples.map((example, idx) => (
                                            <li key={`${component.id}-example-${idx}`} className="leading-relaxed">
                                              {example}
                                            </li>
                                          ))}
                                        </ol>
                                      </div>
                                    </div>
                                  ) : null}

                                  <div className="space-y-1">
                                    <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                                      Log Sources
                                    </h4>
                                    {Array.isArray(component.logSources) && component.logSources.length > 0 ? (
                                      <div className="overflow-x-auto rounded-md border border-border">
                                        <table className="w-full text-sm border-collapse">
                                          <thead className="bg-muted/40">
                                            <tr>
                                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Name</th>
                                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Channel</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {component.logSources.map((source, idx) => (
                                              <tr key={`${component.id}-logsource-${idx}`} className="align-top">
                                                <td className="px-3 py-2 text-foreground font-normal border border-border">{source.name}</td>
                                                <td className="px-3 py-2 text-muted-foreground border border-border">{source.channel || '—'}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">No log sources listed.</p>
                                    )}
                                  </div>

                                  <div className="space-y-1">
                                    <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                                      Detection Strategies
                                    </h4>
                                    {Array.isArray(component.detectionStrategies) && component.detectionStrategies.length > 0 ? (
                                      <div className="overflow-x-auto rounded-md border border-border">
                                        <table className="w-full text-sm border-collapse">
                                          <thead className="bg-muted/40">
                                            <tr>
                                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">ID</th>
                                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Name</th>
                                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Technique Detected</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {component.detectionStrategies.map((strategy) => (
                                              <tr key={`${component.id}-strategy-${strategy.id}`} className="align-top">
                                                <td className="px-3 py-2 text-foreground font-mono text-xs border border-border">
                                                  <a
                                                    href={`/detection-strategies?strategy=${encodeURIComponent(strategy.id)}`}
                                                    className="text-primary hover:underline underline-offset-2"
                                                  >
                                                    {strategy.id}
                                                  </a>
                                                </td>
                                                <td className="px-3 py-2 text-foreground font-normal border border-border">
                                                  <a
                                                    href={`/detection-strategies?strategy=${encodeURIComponent(strategy.id)}`}
                                                    className="text-foreground font-normal hover:underline underline-offset-2"
                                                  >
                                                    {strategy.name}
                                                  </a>
                                                </td>
                                                <td className="px-3 py-2 text-muted-foreground border border-border">
                                                  {Array.isArray(strategy.techniques) && strategy.techniques.length > 0
                                                    ? strategy.techniques.map((technique, index) => (
                                                      <span key={`${strategy.id}-${technique.id}`}>
                                                        {index > 0 ? ', ' : ''}
                                                        <a
                                                          href={`/detections?technique=${encodeURIComponent(technique.id)}`}
                                                          className="text-foreground hover:text-primary hover:underline underline-offset-2"
                                                        >
                                                          <span className="font-mono text-red-600">{technique.id}</span>
                                                          <span className="text-muted-foreground">{` (${technique.name})`}</span>
                                                        </a>
                                                      </span>
                                                    ))
                                                    : '—'}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">No detection strategies mapped.</p>
                                    )}
                                  </div>
                                </CardContent>
                              </CollapsibleContent>
                            </Collapsible>
                          </Card>
                        );
                      })()
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
    </AppShell>
  );
}
