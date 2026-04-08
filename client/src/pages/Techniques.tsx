import { useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StixExportControls } from '@/components/StixExportControls';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useMitreTechniques } from '@/hooks/useMitreData';
import { useSystemStatus } from '@/hooks/useProducts';
import { toMarkdownTable } from '@/lib/stix-export';
import { subjectIdPillClass } from '@/lib/utils';
import { PLATFORM_VALUES, normalizePlatformList } from '@shared/platforms';
import { Target, Layers, Loader2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';

export default function Techniques() {
  const [location] = useLocation();
  const [selectedPlatform, setSelectedPlatform] = useState<string>('All Platforms');
  const [expandedTactics, setExpandedTactics] = useState<Set<string>>(new Set());
  const [showDescriptions, setShowDescriptions] = useState<boolean>(false);

  const normalizedSelection = useMemo(() => (
    selectedPlatform === 'All Platforms'
      ? []
      : normalizePlatformList([selectedPlatform])
  ), [selectedPlatform]);

  const { data: techniques, isLoading, error } = useMitreTechniques(normalizedSelection);
  const { data: systemStatus } = useSystemStatus();

  const techniqueFilter = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return (new URLSearchParams(window.location.search).get('technique') || '').trim().toUpperCase();
  }, [location]);

  const filteredTechniques = useMemo(() => {
    const list = techniques || [];
    if (!techniqueFilter) return list;
    return list.filter((technique) => (
      technique.id.toUpperCase() === techniqueFilter
      || technique.name.toLowerCase().includes(techniqueFilter.toLowerCase())
    ));
  }, [techniques, techniqueFilter]);

  const groupedByTactic = useMemo(() => {
    const groups = new Map<string, typeof filteredTechniques>();
    filteredTechniques.forEach((technique) => {
      const tactic = Array.isArray(technique.tactics) && technique.tactics.length > 0
        ? technique.tactics[0]
        : 'Uncategorized';
      const existing = groups.get(tactic) || [];
      existing.push(technique);
      groups.set(tactic, existing);
    });

    return Array.from(groups.entries())
      .map(([tactic, items]) => ({
        tactic,
        items: [...items].sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => a.tactic.localeCompare(b.tactic));
  }, [filteredTechniques]);

  const uniqueStrategies = useMemo(() => (
    new Set(
      filteredTechniques.flatMap((technique) => (
        Array.isArray(technique.strategies)
          ? technique.strategies.map((strategy) => strategy.id)
          : []
      ))
    ).size
  ), [filteredTechniques]);

  const platformOptions = useMemo(() => ['All Platforms', ...PLATFORM_VALUES], []);
  const lastSync = systemStatus?.lastMitreSync
    ? new Date(systemStatus.lastMitreSync)
    : null;
  const isStale = !lastSync || Date.now() - lastSync.getTime() > 30 * 24 * 60 * 60 * 1000;

  const setTacticExpanded = (tactic: string, open: boolean) => {
    setExpandedTactics((prev) => {
      const next = new Set(prev);
      if (open) next.add(tactic);
      else next.delete(tactic);
      return next;
    });
  };
  const exportPayload = useMemo(
    () => ({
      page: 'techniques',
      selectedPlatform,
      techniqueFilter: techniqueFilter || null,
      totalTechniques: filteredTechniques.length,
      tactics: groupedByTactic.map((group) => ({
        tactic: group.tactic,
        techniques: group.items,
      })),
    }),
    [filteredTechniques, groupedByTactic, selectedPlatform, techniqueFilter]
  );
  const exportMarkdown = useMemo(() => {
    const lines: string[] = [
      '# Techniques',
      '',
      `- Platform Filter: ${selectedPlatform}`,
      `- Technique Filter: ${techniqueFilter || 'None'}`,
      `- Total Techniques: ${filteredTechniques.length}`,
      '',
    ];

    groupedByTactic.forEach((group) => {
      lines.push(`## ${group.tactic}`, '');
      lines.push(
        toMarkdownTable(
          ['ID', 'Name', 'Platforms', 'Linked Strategies'],
          group.items.map((technique) => [
            technique.id,
            technique.name,
            Array.isArray(technique.platforms) && technique.platforms.length > 0
              ? technique.platforms.join(', ')
              : '-',
            Array.isArray(technique.strategies) && technique.strategies.length > 0
              ? technique.strategies.map((strategy) => strategy.id).join(', ')
              : '-',
          ])
        )
      );
      lines.push('');
    });

    return lines.join('\n');
  }, [filteredTechniques.length, groupedByTactic, selectedPlatform, techniqueFilter]);

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
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Techniques</h1>
              <p className="text-muted-foreground text-sm mt-1">
                MITRE ATT&CK techniques organized by tactic. Click a technique to view complete details.
              </p>
              <div className="mt-3">
                <StixExportControls
                  baseName={`techniques-${selectedPlatform}-${techniqueFilter || 'all'}`}
                  jsonPayload={exportPayload}
                  markdownContent={exportMarkdown}
                  disabled={isLoading || Boolean(error)}
                />
              </div>
            </header>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Platform filter</CardTitle>
                <CardDescription>Filter techniques by MITRE platform scope.</CardDescription>
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
                  <div className="text-3xl font-bold text-primary">{filteredTechniques.length}</div>
                  <div className="text-sm text-muted-foreground">Techniques</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-foreground">{groupedByTactic.length}</div>
                  <div className="text-sm text-muted-foreground">Tactics</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-foreground">{uniqueStrategies}</div>
                  <div className="text-sm text-muted-foreground">Linked Strategies</div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="w-5 h-5 text-primary" />
                      Technique Catalog
                    </CardTitle>
                    <CardDescription>Techniques synchronized from MITRE STIX</CardDescription>
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
                    Loading techniques...
                  </div>
                ) : error ? (
                  <div className="text-sm text-red-400">Failed to load techniques.</div>
                ) : groupedByTactic.length === 0 ? (
                  <div className="text-center py-12">
                    <Layers className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {techniqueFilter ? `No results for ${techniqueFilter}` : 'No techniques found'}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {techniqueFilter
                        ? 'Try a different technique link or clear filters from the source page.'
                        : 'Run MITRE Data Sync in Admin Tasks to populate the catalog.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {techniqueFilter ? (
                      <p className="text-xs text-muted-foreground">
                        Filtered by technique: <span className="font-mono">{techniqueFilter}</span>
                      </p>
                    ) : null}

                    {groupedByTactic.map((group) => {
                      const tacticOpen = expandedTactics.has(group.tactic);
                      return (
                        <Card key={group.tactic} className="bg-background border-border overflow-hidden">
                          <Collapsible open={tacticOpen} onOpenChange={(open) => setTacticExpanded(group.tactic, open)}>
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/20 transition-colors"
                              >
                                <div className="flex items-start gap-2 min-w-0">
                                  <h3 className="text-base font-normal text-foreground">{group.tactic}</h3>
                                  <Badge variant="secondary" className="text-xs">
                                    {group.items.length}
                                  </Badge>
                                </div>
                                {tacticOpen ? (
                                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                                )}
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="border-t border-border/60">
                                {group.items.map((technique) => (
                                  <a
                                    key={`${group.tactic}-${technique.id}`}
                                    href={`/techniques/${encodeURIComponent(technique.id)}`}
                                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/20 transition-colors border-b border-border/40 last:border-b-0"
                                  >
                                    <div className="min-w-0 pr-3">
                                      <p className="text-sm font-normal text-foreground truncate">{technique.name}</p>
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        {Array.isArray(technique.platforms) && technique.platforms.length > 0
                                          ? technique.platforms.join(', ')
                                          : 'No platform tags'}
                                      </p>
                                      {showDescriptions && (
                                        <div className="text-xs text-muted-foreground mt-2 leading-relaxed">
                                          {renderDescription(technique.description)}
                                        </div>
                                      )}
                                    </div>
                                    <Badge variant="outline" className={`ml-3 text-xs ${subjectIdPillClass('technique')}`}>
                                      {technique.id}
                                    </Badge>
                                  </a>
                                ))}
                              </div>
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
