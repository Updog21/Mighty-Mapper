import { useState } from 'react';
import { ProductMapping, DataComponent, Analytic, Technique, LogRequirement } from '@/lib/v18Data';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Server, 
  FileText, 
  Search, 
  Target, 
  CheckCircle2, 
  Shield,
  Zap,
  ChevronDown,
  ChevronRight,
  Code,
  Terminal,
  Database,
  AlertCircle,
  ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface ValueChainDisplayProps {
  mapping: ProductMapping;
  onBack: () => void;
}

function LogRequirementCard({ log, index }: { log: LogRequirement; index: number }) {
  return (
    <div className="p-3 rounded bg-muted/30 border border-border space-y-2">
      <div className="flex items-center gap-2">
        <Terminal className="w-4 h-4 text-cyan-400 flex-shrink-0" />
        <span className="font-mono text-sm text-cyan-400">{log.channel}</span>
      </div>
      <p className="text-xs text-muted-foreground">{log.description}</p>
      
      <div className="space-y-2">
        <div>
          <span className="text-xs font-medium text-foreground">Event Codes:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {log.eventCodes.map((code) => (
              <Badge key={code} className="font-mono text-xs bg-orange-500/20 text-orange-400 border-orange-500/30">
                {code}
              </Badge>
            ))}
          </div>
        </div>
        
        <div>
          <span className="text-xs font-medium text-foreground">Required Fields:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {log.requiredFields.map((field) => (
              <Badge key={field} variant="secondary" className="font-mono text-[10px]">
                {field}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticDetailCard({ analytic }: { analytic: Analytic }) {
  const [isOpen, setIsOpen] = useState(false);
  const hasLogDetails = analytic.logRequirements && analytic.logRequirements.length > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        "rounded-lg border transition-all",
        isOpen ? "bg-yellow-500/10 border-yellow-500/40" : "bg-yellow-500/5 border-yellow-500/20",
        hasLogDetails && "cursor-pointer"
      )}>
        <CollapsibleTrigger className="w-full text-left p-3" disabled={!hasLogDetails}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                <span className="font-mono text-xs text-yellow-400">{analytic.id}</span>
                {analytic.detectionStrategyId && (
                  <Badge className="text-[10px] bg-purple-500/20 text-purple-400 border-purple-500/30">
                    Detection Strategy
                  </Badge>
                )}
              </div>
              <div className="text-sm font-medium text-foreground">{analytic.name}</div>
              <div className="text-xs text-muted-foreground mt-1">{analytic.description}</div>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="secondary" className="text-[10px]">{analytic.source}</Badge>
                {analytic.detectsTechniques.map(t => (
                  <Badge key={t} className="text-[10px] bg-red-500/20 text-red-400 border-red-500/30">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
            {hasLogDetails && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Database className="w-3 h-3" />
                <span className="text-xs">{analytic.logRequirements?.length} logs</span>
                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
            )}
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3 border-t border-yellow-500/20 pt-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <AlertCircle className="w-4 h-4 text-yellow-400" />
              Log Requirements
            </div>
            
            {analytic.logRequirements?.map((log, idx) => (
              <LogRequirementCard key={idx} log={log} index={idx} />
            ))}
            
            {analytic.pseudocode && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Code className="w-4 h-4 text-green-400" />
                  Detection Logic (Pseudocode)
                </div>
                <pre className="p-3 rounded bg-background border border-border text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                  {analytic.pseudocode}
                </pre>
              </div>
            )}
            
            {analytic.detectionStrategyId && (
              <a 
                href={`https://attack.mitre.org/detectionstrategies/${analytic.detectionStrategyId}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-primary hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                View on MITRE ATT&CK
              </a>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function DataComponentCard({ dc }: { dc: DataComponent }) {
  const [isOpen, setIsOpen] = useState(false);
  const hasLogDetails = dc.logRequirements && dc.logRequirements.length > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        "rounded border transition-all",
        isOpen ? "bg-blue-500/15 border-blue-500/40" : "bg-blue-500/10 border-blue-500/20"
      )}>
        <CollapsibleTrigger className="w-full text-left p-2" disabled={!hasLogDetails}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">{dc.name}</div>
              <div className="text-xs text-muted-foreground">{dc.dataSource}</div>
            </div>
            {hasLogDetails && (
              <div className="flex items-center text-muted-foreground">
                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
            )}
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-2 pb-2 space-y-2 border-t border-blue-500/20 pt-2">
            {dc.logRequirements?.map((log, idx) => (
              <LogRequirementCard key={idx} log={log} index={idx} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function ValueChainDisplay({ mapping, onBack }: ValueChainDisplayProps) {
  const { asset, dataComponents, analytics, techniques, valueScore } = mapping;

  const getValueLabel = (score: number) => {
    if (score >= 80) return { label: 'Critical Value', color: 'text-green-400', bg: 'bg-green-500/20' };
    if (score >= 60) return { label: 'High Value', color: 'text-blue-400', bg: 'bg-blue-500/20' };
    if (score >= 40) return { label: 'Medium Value', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
    return { label: 'Low Value', color: 'text-orange-400', bg: 'bg-orange-500/20' };
  };

  const valueInfo = getValueLabel(valueScore);
  
  const totalLogRequirements = analytics.reduce((acc, a) => 
    acc + (a.logRequirements?.length || 0), 0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button 
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          data-testid="button-back"
        >
          ← Back to search
        </button>
        <Badge className={cn(valueInfo.bg, valueInfo.color, "text-sm px-3 py-1")}>
          <Zap className="w-3 h-3 mr-1" />
          {valueInfo.label} ({valueScore}%)
        </Badge>
      </div>

      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-sm text-muted-foreground">{asset.vendor}</span>
              <CardTitle className="text-2xl mt-1">{asset.productName}</CardTitle>
              {asset.deployment && (
                <Badge variant="secondary" className="mt-2">{asset.deployment}</Badge>
              )}
            </div>
            <div className="text-right space-y-1">
              <div>
                <div className="text-3xl font-bold text-primary">{analytics.length}</div>
                <div className="text-xs text-muted-foreground">Analytics Unlocked</div>
              </div>
              {totalLogRequirements > 0 && (
                <div className="text-xs text-cyan-400 font-mono">
                  {totalLogRequirements} log sources documented
                </div>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-3">{asset.description}</p>
        </CardHeader>
      </Card>

      <div className="text-center py-4">
        <h3 className="text-lg font-semibold text-foreground mb-2">MITRE v18 Value Chain</h3>
        <p className="text-sm text-muted-foreground">
          Click on any analytic to see specific event channels, event codes, and required fields
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50 backdrop-blur border-primary/30" data-testid="card-asset">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center">
                <Server className="w-4 h-4 text-primary" />
              </div>
              Step 1: Asset
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-3 rounded bg-primary/10 border border-primary/20">
              <div className="font-semibold text-foreground">{asset.productName}</div>
              <div className="text-xs text-muted-foreground mt-1">The security tool that produces data</div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-blue-500/30" data-testid="card-data-components">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-blue-500/20 flex items-center justify-center">
                <FileText className="w-4 h-4 text-blue-400" />
              </div>
              Step 2: Data Components
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {dataComponents.map((dc) => (
                <DataComponentCard key={dc.id} dc={dc} />
              ))}
            </div>
            <div className="text-xs text-muted-foreground mt-2 text-center">
              {dataComponents.length} log types generated
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-yellow-500/30 lg:col-span-2" data-testid="card-analytics">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-yellow-500/20 flex items-center justify-center">
                <Search className="w-4 h-4 text-yellow-400" />
              </div>
              Step 3: Analytics Unlocked
              <span className="text-xs text-muted-foreground ml-auto">Click to expand log details</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {analytics.map((a) => (
                <AnalyticDetailCard key={a.id} analytic={a} />
              ))}
            </div>
            <div className="text-xs text-muted-foreground mt-2 text-center">
              {analytics.length} detection rules enabled
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur border-red-500/30" data-testid="card-techniques">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-red-500/20 flex items-center justify-center">
              <Target className="w-4 h-4 text-red-400" />
            </div>
            Step 4: Techniques Detected
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {techniques.map((t) => (
              <div 
                key={t.id}
                className="p-3 rounded bg-red-500/10 border border-red-500/20"
              >
                <div className="flex items-center gap-2">
                  <Shield className="w-3 h-3 text-green-400 flex-shrink-0" />
                  <span className="font-mono text-sm text-red-400">{t.id}</span>
                </div>
                <div className="text-sm font-medium text-foreground mt-1">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{t.tactic}</div>
                {t.usedByGroups.length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {t.usedByGroups.slice(0, 3).map(g => (
                      <Badge key={g} variant="destructive" className="text-[10px] px-1">
                        {g}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground mt-3 text-center">
            Protection against {techniques.length} techniques
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-r from-green-500/10 to-primary/10 border-green-500/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <Zap className="w-6 h-6 text-green-400" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-foreground">Security Value Summary</h4>
              <p className="text-sm text-muted-foreground mt-1">
                By deploying <strong className="text-primary">{asset.productName}</strong>, you gain visibility into{' '}
                <strong className="text-blue-400">{dataComponents.length} data components</strong>, which enables{' '}
                <strong className="text-yellow-400">{analytics.length} detection analytics</strong> that protect against{' '}
                <strong className="text-red-400">{techniques.length} ATT&CK techniques</strong> used by threat groups like{' '}
                {techniques.flatMap(t => t.usedByGroups).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ')}.
              </p>
              <div className="mt-3">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Overall Detection Value</span>
                  <span className={cn("font-bold", valueInfo.color)}>{valueScore}%</span>
                </div>
                <Progress value={valueScore} className="h-2" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
