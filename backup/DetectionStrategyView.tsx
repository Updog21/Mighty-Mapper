import { useState } from 'react';
import { DetectionStrategy, AnalyticItem, DataComponentRef, dataComponents } from '@/lib/mitreData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { 
  Target, 
  Code, 
  Database,
  Terminal,
  ChevronRight,
  ExternalLink,
  FileText,
  Layers,
  Monitor,
  Server
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizePlatformList, platformMatchesAny } from '@shared/platforms';

interface DetectionStrategyViewProps {
  strategy: DetectionStrategy;
  onBack: () => void;
}

function getPlatformIcon(platform: string) {
  const canonical = normalizePlatformList([platform])[0] || platform;
  switch (canonical) {
    case 'Windows': return <Monitor className="w-4 h-4" />;
    case 'Linux': return <Terminal className="w-4 h-4" />;
    case 'macOS': return <Monitor className="w-4 h-4" />;
    case 'Android': return <Monitor className="w-4 h-4" />;
    case 'iOS': return <Monitor className="w-4 h-4" />;
    case 'ESXi': return <Server className="w-4 h-4" />;
    case 'Identity Provider': return <Database className="w-4 h-4" />;
    case 'Azure AD': return <Database className="w-4 h-4" />;
    case 'IaaS': return <Server className="w-4 h-4" />;
    case 'AWS': return <Server className="w-4 h-4" />;
    case 'Azure': return <Server className="w-4 h-4" />;
    case 'GCP': return <Server className="w-4 h-4" />;
    case 'SaaS': return <Layers className="w-4 h-4" />;
    case 'Office 365': return <FileText className="w-4 h-4" />;
    case 'Office Suite': return <FileText className="w-4 h-4" />;
    case 'Google Workspace': return <FileText className="w-4 h-4" />;
    case 'Network Devices': return <Target className="w-4 h-4" />;
    case 'Containers': return <Layers className="w-4 h-4" />;
    case 'None': return <Database className="w-4 h-4" />;
    case 'PRE': return <Database className="w-4 h-4" />;
    default: return <Monitor className="w-4 h-4" />;
  }
}

function AnalyticCard({ analytic, index }: { analytic: AnalyticItem; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const dcRefs = analytic.dataComponents.map(id => dataComponents[id]).filter(Boolean);

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-amber-400 font-mono text-sm font-bold">{index + 1}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm text-amber-400">{analytic.id}</span>
              <ChevronRight className={cn(
                "w-4 h-4 text-muted-foreground transition-transform",
                expanded && "rotate-90"
              )} />
            </div>
            <h4 className="font-semibold text-foreground">{analytic.name}</h4>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{analytic.description}</p>
            <div className="flex items-center gap-2 mt-2">
              {analytic.platforms.map(p => (
                <Badge key={p} variant="secondary" className="text-xs flex items-center gap-1">
                  {getPlatformIcon(p)}
                  {p}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border bg-muted/10 p-4 space-y-6">
          {analytic.pseudocode && (
            <div>
              <h5 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                <Code className="w-4 h-4 text-green-400" />
                Detection Logic
              </h5>
              <pre className="p-4 rounded-lg bg-background border border-border text-sm font-mono text-muted-foreground overflow-x-auto">
                {analytic.pseudocode}
              </pre>
            </div>
          )}

          <div>
            <h5 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-400" />
              Required Data Components
            </h5>
            <div className="space-y-3">
              {dcRefs.map(dc => (
                <DataComponentCard key={dc.id} dc={dc} platforms={analytic.platforms} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DataComponentCard({ dc, platforms }: { dc: DataComponentRef; platforms: string[] }) {
  const relevantPlatforms = dc.platforms.filter(p => platformMatchesAny([p.platform], platforms));
  const [activePlatform, setActivePlatform] = useState<string>(relevantPlatforms[0]?.platform || 'Windows');

  return (
    <div className="border border-blue-500/30 rounded-lg bg-blue-500/5 overflow-hidden">
      <div className="p-4 border-b border-blue-500/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-blue-400">{dc.id}</span>
              <a 
                href={`https://attack.mitre.org/datacomponents/${dc.id}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <h5 className="font-medium text-foreground">{dc.name}</h5>
            <p className="text-sm text-muted-foreground mt-1">{dc.description}</p>
          </div>
          <Badge variant="secondary" className="text-xs flex-shrink-0">
            {dc.dataSource}
          </Badge>
        </div>
      </div>

      <Tabs value={activePlatform} onValueChange={setActivePlatform} className="w-full">
        <div className="px-4 pt-3 border-b border-blue-500/20 bg-muted/30">
          <TabsList className="h-9 bg-transparent p-0 gap-1">
            {relevantPlatforms.map(pm => (
              <TabsTrigger 
                key={pm.platform} 
                value={pm.platform}
                className="text-xs px-3 h-8 data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-400"
              >
                {getPlatformIcon(pm.platform)}
                <span className="ml-1">{pm.platform}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {relevantPlatforms.map(pm => (
          <TabsContent key={pm.platform} value={pm.platform} className="m-0">
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Event Source</span>
                  <div className="font-mono text-sm text-foreground">{pm.eventSource}</div>
                </div>
                {pm.eventId && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Event ID</span>
                    <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 font-mono">
                      {pm.eventId}
                    </Badge>
                  </div>
                )}
                {pm.logChannel && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Log Channel</span>
                    <div className="font-mono text-xs text-cyan-400 break-all">{pm.logChannel}</div>
                  </div>
                )}
              </div>
              {pm.notes && (
                <p className="text-xs text-muted-foreground italic">{pm.notes}</p>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <div className="p-4 border-t border-blue-500/20 bg-muted/20">
        <h6 className="text-xs font-medium text-foreground mb-3 uppercase tracking-wide">
          Mutable Elements (Required Fields)
        </h6>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {dc.mutableElements.map(me => (
            <div key={me.name} className="p-2 rounded bg-background border border-border">
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono text-primary">{me.name}</code>
                {me.fieldPath && (
                  <code className="text-[10px] font-mono text-muted-foreground">{me.fieldPath}</code>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{me.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DetectionStrategyView({ strategy, onBack }: DetectionStrategyViewProps) {
  const dcRefs = strategy.dataComponentRefs.map(id => dataComponents[id]).filter(Boolean);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <button 
        onClick={onBack}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        data-testid="button-back"
      >
        ← Back
      </button>

      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Target className="w-7 h-7 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-sm text-primary">{strategy.id}</span>
                <a 
                  href={`https://attack.mitre.org/detectionstrategies/${strategy.id}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <CardTitle className="text-xl">{strategy.name}</CardTitle>
              <p className="text-muted-foreground mt-2">{strategy.description}</p>
              <div className="flex items-center gap-2 mt-4">
                <span className="text-xs text-muted-foreground">Detects:</span>
                {strategy.techniques.map(t => (
                  <Badge key={t} variant="destructive" className="font-mono text-xs">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card/30 border-border">
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-amber-400">{strategy.analytics.length}</div>
            <div className="text-sm text-muted-foreground">Analytics</div>
          </CardContent>
        </Card>
        <Card className="bg-card/30 border-border">
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-blue-400">{dcRefs.length}</div>
            <div className="text-sm text-muted-foreground">Data Components</div>
          </CardContent>
        </Card>
        <Card className="bg-card/30 border-border">
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold text-red-400">{strategy.techniques.length}</div>
            <div className="text-sm text-muted-foreground">Techniques</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Layers className="w-5 h-5 text-amber-400" />
          Analytics
        </h3>
        <p className="text-sm text-muted-foreground">
          Click on an analytic to see required log sources, event channels, event codes, and mutable elements.
        </p>
        
        <div className="space-y-3">
          {strategy.analytics.map((analytic, idx) => (
            <AnalyticCard key={analytic.id} analytic={analytic} index={idx} />
          ))}
        </div>
      </div>
    </div>
  );
}
