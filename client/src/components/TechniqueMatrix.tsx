import { tactics, techniques, getTechniquesByTactic, threatGroups, securityProducts } from '@/lib/mockData';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface TechniqueMatrixProps {
  selectedThreatGroup: string | null;
  selectedProducts: string[];
}

export function TechniqueMatrix({ selectedThreatGroup, selectedProducts }: TechniqueMatrixProps) {
  const threatGroup = threatGroups.find(g => g.id === selectedThreatGroup);
  const threatTechniques = new Set(threatGroup?.techniques || []);
  
  const coveredTechniques = new Set<string>();
  selectedProducts.forEach(productId => {
    const product = securityProducts.find(p => p.id === productId);
    product?.techniques.forEach(t => coveredTechniques.add(t));
  });

  const getCellStatus = (techniqueId: string): 'threat' | 'covered' | 'gap' | 'neutral' => {
    const isThreat = threatTechniques.has(techniqueId);
    const isCovered = coveredTechniques.has(techniqueId);
    
    if (isThreat && isCovered) return 'covered';
    if (isThreat && !isCovered) return 'gap';
    if (!isThreat && isCovered) return 'neutral';
    return 'neutral';
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1400px]">
        <div className="grid grid-cols-14 gap-1" style={{ gridTemplateColumns: `repeat(${tactics.length}, minmax(90px, 1fr))` }}>
          {tactics.map((tactic) => (
            <div key={tactic.id} className="text-center">
              <div className="bg-card border border-border rounded-t-lg p-2 mb-1">
                <span className="text-xs font-mono text-muted-foreground block">{tactic.id}</span>
                <span className="text-xs font-semibold text-foreground">{tactic.shortName}</span>
              </div>
              <div className="space-y-1">
                {getTechniquesByTactic(tactic.name).map((technique) => {
                  const status = getCellStatus(technique.id);
                  return (
                    <Tooltip key={technique.id}>
                      <TooltipTrigger asChild>
                        <button
                          data-testid={`cell-technique-${technique.id}`}
                          className={cn(
                            "w-full p-2 rounded text-[10px] font-mono transition-all duration-200 border cursor-pointer",
                            "hover:scale-105 hover:z-10 relative",
                            status === 'gap' && "bg-red-500/20 border-red-500/50 text-red-400 glow-threat",
                            status === 'covered' && "bg-green-500/20 border-green-500/50 text-green-400 glow-covered",
                            status === 'neutral' && "bg-card border-border text-muted-foreground hover:border-primary/50"
                          )}
                        >
                          <span className="block truncate">{technique.id}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs bg-popover border-border">
                        <div className="space-y-2">
                          <div>
                            <span className="font-mono text-primary text-xs">{technique.id}</span>
                            <p className="font-semibold text-sm">{technique.name}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">{technique.description}</p>
                          {technique.usedByThreatGroups.length > 0 && (
                            <div>
                              <span className="text-xs text-red-400">Used by: </span>
                              <span className="text-xs">{technique.usedByThreatGroups.join(', ')}</span>
                            </div>
                          )}
                          {technique.coveredByProducts.length > 0 && (
                            <div>
                              <span className="text-xs text-green-400">Covered by: </span>
                              <span className="text-xs">{technique.coveredByProducts.join(', ')}</span>
                            </div>
                          )}
                          <div className={cn(
                            "text-xs font-semibold px-2 py-1 rounded inline-block",
                            status === 'gap' && "bg-red-500/20 text-red-400",
                            status === 'covered' && "bg-green-500/20 text-green-400",
                            status === 'neutral' && "bg-muted text-muted-foreground"
                          )}>
                            {status === 'gap' ? 'COVERAGE GAP' : status === 'covered' ? 'PROTECTED' : 'NOT TARGETED'}
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
