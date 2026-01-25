import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Boxes, X, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDetections, Detection, DetectionSource } from '@/hooks/useDetections';
import { RESOURCE_LABELS, ResourceType } from '@/hooks/useAutoMapper';
import { Input } from '@/components/ui/input';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { techniques } from '@/lib/mitreData';

const SOURCE_ORDER: DetectionSource[] = ['splunk', 'sigma', 'elastic', 'azure', 'ctid', 'mitre_stix'];

const getSourceLabel = (source?: DetectionSource) => {
  if (!source) return 'Unknown';
  return RESOURCE_LABELS[source]?.label || source;
};

const getSourceBadgeClass = (source?: DetectionSource) => {
  switch (source) {
    case 'sigma':
      return 'bg-purple-600 text-white';
    case 'elastic':
      return 'bg-orange-600 text-white';
    case 'splunk':
      return 'bg-green-600 text-white';
    case 'azure':
      return 'bg-sky-600 text-white';
    case 'ctid':
      return 'bg-blue-600 text-white';
    case 'mitre_stix':
      return 'bg-red-600 text-white';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

const getCodeBlockContent = (detection: Detection) => {
  if (detection.query) return detection.query;
  if (detection.howToImplement) return detection.howToImplement;
  if (detection.description) return detection.description;
  return 'No detection content available.';
};

const getDetectionLanguage = (detection: Detection) => {
  if (detection.source === 'elastic') return 'toml';
  if (detection.source === 'sigma' || detection.source === 'splunk' || detection.source === 'azure') return 'yaml';
  return 'text';
};

const buildSearchableText = (detection: Detection) => {
  return [
    detection.name,
    detection.description,
    detection.howToImplement,
    detection.query,
    detection.sourceFile,
    detection.id,
    ...(detection.techniqueIds || []),
    ...(detection.logSources || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

export default function Detections() {
  const { data, isLoading, error } = useDetections();
  const [sourceFilters, setSourceFilters] = useState<Set<DetectionSource>>(new Set());
  const [techniqueFilters, setTechniqueFilters] = useState<Set<string>>(new Set());
  const [isTechniquePanelOpen, setIsTechniquePanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [techniqueNames, setTechniqueNames] = useState<Record<string, string>>({});

  const availableSources = useMemo(() => {
    const set = new Set<DetectionSource>();
    (data || []).forEach(d => {
      if (d.source) {
        set.add(d.source);
      }
    });
    return Array.from(set);
  }, [data]);

  useEffect(() => {
    if (availableSources.length > 0) {
      setSourceFilters(new Set(availableSources));
    }
  }, [availableSources.join('|')]);

  const detectionsWithSearch = useMemo(() => {
    const search = appliedSearch.trim();
    if (!search) {
      return (data || []).map(detection => ({ detection, searchable: '' }));
    }
    return (data || []).map(detection => ({
      detection,
      searchable: buildSearchableText(detection),
    }));
  }, [data, appliedSearch]);

  const groupedDetections = useMemo(() => {
    const groups = new Map<DetectionSource, Detection[]>();
    const search = appliedSearch.trim().toLowerCase();
    detectionsWithSearch.forEach(({ detection, searchable }) => {
      const source = detection.source || 'ctid';
      if (!sourceFilters.has(source)) return;
      if (techniqueFilters.size > 0) {
        const detectionTechniques = detection.techniqueIds || [];
        const hasTechnique = detectionTechniques.some(tid => techniqueFilters.has(tid));
        if (!hasTechnique) return;
      }
      if (search) {
        if (!searchable.includes(search)) return;
      }
      const existing = groups.get(source) || [];
      existing.push(detection);
      groups.set(source, existing);
    });
    return groups;
  }, [detectionsWithSearch, sourceFilters, techniqueFilters, appliedSearch]);

  const filteredSources = SOURCE_ORDER.filter(source => groupedDetections.has(source));
  const totalDetections = data?.length || 0;
  const availableTechniques = useMemo(() => {
    const set = new Set<string>();
    (data || []).forEach(detection => {
      (detection.techniqueIds || []).forEach(tid => set.add(tid));
    });
    return Array.from(set).sort();
  }, [data]);
  const techniqueNameMap = useMemo(() => {
    const map = new Map<string, string>();
    Object.entries(techniqueNames).forEach(([id, name]) => {
      map.set(id.toUpperCase(), name);
    });
    techniques.forEach((tech) => {
      if (!map.has(tech.id.toUpperCase())) {
        map.set(tech.id.toUpperCase(), tech.name);
      }
    });
    return map;
  }, [techniqueNames]);

  const filteredTechniqueOptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const options = query
      ? availableTechniques.filter((tid) => {
          const name = techniqueNameMap.get(tid.toUpperCase()) || '';
          return tid.toLowerCase().includes(query) || name.toLowerCase().includes(query);
        })
      : availableTechniques;
    return options.filter(tid => !techniqueFilters.has(tid));
  }, [availableTechniques, techniqueFilters, searchQuery, techniqueNameMap]);

  useEffect(() => {
    if (availableTechniques.length === 0) return;
    const controller = new AbortController();
    const chunkSize = 500;
    let cancelled = false;

    const fetchChunk = async (offset: number) => {
      const response = await fetch('/api/techniques/names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ techniqueIds: availableTechniques, limit: chunkSize, offset }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return response.json();
    };

    const run = async () => {
      let offset = 0;
      const total = availableTechniques.length;
      while (offset < total && !cancelled) {
        const data = await fetchChunk(offset);
        if (data?.techniqueNames) {
          setTechniqueNames((prev) => ({ ...prev, ...data.techniqueNames }));
        }
        offset += chunkSize;
      }
    };

    run().catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [availableTechniques.join('|')]);

  useEffect(() => {
    if (filteredSources.length === 0) return;
    setVisibleCounts((prev) => {
      const next = { ...prev };
      filteredSources.forEach((source) => {
        if (!next[source]) {
          next[source] = 30;
        }
      });
      return next;
    });
  }, [filteredSources.join('|')]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar variant="dashboard" />

      <main className="flex-1 overflow-auto">
        <div className="grid-pattern min-h-full">
          <div className="p-6 space-y-6">
            <header className="space-y-2">
              <div className="flex items-center gap-2">
                <Boxes className="w-5 h-5 text-primary" />
                <h1 className="text-2xl font-bold text-foreground tracking-tight">Detections</h1>
              </div>
              <p className="text-muted-foreground text-sm">
                Community detections gathered from Sigma, Elastic, Splunk, Azure, and CTID sources.
              </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-primary">{totalDetections}</div>
                  <div className="text-sm text-muted-foreground">Total Detections</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-3xl font-bold text-foreground">{availableSources.length}</div>
                  <div className="text-sm text-muted-foreground">Sources Represented</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Grouped By</div>
                  <div className="text-lg font-semibold text-foreground">Source Repository</div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <CardTitle>Search & Filters</CardTitle>
                <CardDescription>
                  Search across detection content, technique IDs, and file names. Refine by source and technique.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {availableSources.map(source => {
                      const isActive = sourceFilters.has(source);
                      const label = RESOURCE_LABELS[source as ResourceType]?.label || source;
                      return (
                        <Button
                          key={source}
                          variant={isActive ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => {
                            const next = new Set(sourceFilters);
                            if (isActive) {
                              next.delete(source);
                            } else {
                              next.add(source);
                            }
                            setSourceFilters(next);
                          }}
                          className={cn(
                            "text-xs h-7",
                            isActive && source === 'sigma' && "bg-purple-600 hover:bg-purple-700",
                            isActive && source === 'elastic' && "bg-orange-600 hover:bg-orange-700",
                            isActive && source === 'splunk' && "bg-green-600 hover:bg-green-700",
                            isActive && source === 'azure' && "bg-sky-600 hover:bg-sky-700",
                            isActive && source === 'ctid' && "bg-blue-600 hover:bg-blue-700",
                            isActive && source === 'mitre_stix' && "bg-red-600 hover:bg-red-700"
                          )}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Input
                    placeholder="Search detections..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => setAppliedSearch(searchQuery)}
                    >
                      Apply
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearchQuery('');
                        setAppliedSearch('');
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="space-y-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsTechniquePanelOpen(!isTechniquePanelOpen)}
                    className="gap-2 text-muted-foreground hover:text-foreground"
                  >
                    {isTechniquePanelOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <span className="text-xs font-medium">Techniques</span>
                  </Button>
                  {techniqueFilters.size > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {Array.from(techniqueFilters).map(tid => (
                        <button
                          key={tid}
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-foreground hover:bg-muted"
                          onClick={() => {
                            const next = new Set(techniqueFilters);
                            next.delete(tid);
                            setTechniqueFilters(next);
                          }}
                        >
                          <span className="font-mono">{tid}</span>
                          <X className="w-3 h-3 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  )}
                  {isTechniquePanelOpen && (
                    filteredTechniqueOptions.length > 0 ? (
                      <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-background">
                        <div className="divide-y divide-border">
                          {filteredTechniqueOptions.map(tid => (
                            <button
                              key={tid}
                              type="button"
                              className="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                              onClick={() => {
                                const next = new Set(techniqueFilters);
                                next.add(tid);
                                setTechniqueFilters(next);
                              }}
                            >
                              <div className="flex flex-col">
                                <span className="font-mono">{tid}</span>
                                <span className="text-[11px] text-muted-foreground">
                                  {techniqueNameMap.get(tid.toUpperCase()) || 'Unknown technique'}
                                </span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">Add</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        No techniques match the current search.
                      </div>
                    )
                  )}
                </div>
              </CardContent>
            </Card>

            {isLoading ? (
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="py-8 flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading detections...
                </CardContent>
              </Card>
            ) : error ? (
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="py-8 text-sm text-red-400">
                  Failed to load detections.
                </CardContent>
              </Card>
            ) : filteredSources.length === 0 ? (
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="py-10 text-center text-muted-foreground">
                  No detections available for the selected sources.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {filteredSources.map(source => {
                  const detections = groupedDetections.get(source) || [];
                  const visibleCount = visibleCounts[source] || 30;
                  const visibleDetections = detections.slice(0, visibleCount);
                  return (
                    <Card key={source} className="bg-card/50 backdrop-blur border-border">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Badge className={cn("text-xs", getSourceBadgeClass(source))}>
                            {getSourceLabel(source)}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            Showing {Math.min(visibleCount, detections.length)} of {detections.length}
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {visibleDetections.map(detection => {
                            return (
                              <div
                                key={detection.id}
                                className="border border-border rounded-lg bg-background p-4 space-y-3"
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="text-base font-semibold text-foreground">{detection.name}</h3>
                                      {detection.techniqueIds && detection.techniqueIds.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                          {detection.techniqueIds.map(tid => (
                                            <Badge key={tid} className="text-xs font-mono bg-red-500/40 text-foreground border border-red-500/50">
                                              {tid}
                                            </Badge>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    {detection.description && (
                                      <p className="text-sm text-muted-foreground">{detection.description}</p>
                                    )}
                                  </div>
                                </div>

                                <div className="relative">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-2 top-2 h-7 w-7"
                                    title={copiedId === detection.id ? 'Copied' : 'Copy'}
                                    onClick={async () => {
                                      const payload = getCodeBlockContent(detection);
                                      try {
                                        await navigator.clipboard.writeText(payload);
                                        setCopiedId(detection.id);
                                        setTimeout(() => setCopiedId(null), 1500);
                                      } catch {
                                        setCopiedId(null);
                                      }
                                    }}
                                  >
                                    {copiedId === detection.id ? (
                                      <Check className="w-4 h-4" />
                                    ) : (
                                      <Copy className="w-4 h-4" />
                                    )}
                                  </Button>
                                  <SyntaxHighlighter
                                    language={getDetectionLanguage(detection)}
                                    style={oneLight}
                                    customStyle={{
                                      margin: 0,
                                      background: 'hsl(var(--muted))',
                                      fontSize: '0.75rem',
                                      fontFamily: '"ProggyClean","ProggySquare","ProggyTiny",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace',
                                      color: 'hsl(var(--foreground))',
                                      whiteSpace: 'pre-wrap',
                                    }}
                                    codeTagProps={{
                                      style: {
                                        fontFamily: '"ProggyClean","ProggySquare","ProggyTiny",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace',
                                      },
                                    }}
                                    wrapLongLines
                                    wrapLines
                                    className="text-foreground border border-border rounded-md p-3"
                                  >
                                    {getCodeBlockContent(detection)}
                                  </SyntaxHighlighter>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {visibleCount < detections.length && (
                          <div className="mt-4 flex justify-center">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setVisibleCounts((prev) => ({
                                  ...prev,
                                  [source]: Math.min(detections.length, visibleCount + 30),
                                }))
                              }
                            >
                              Load more
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
