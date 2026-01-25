import { Sidebar } from '@/components/Sidebar';
import { techniques } from '@/lib/v18Data';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Target, AlertTriangle, Skull, Shield } from 'lucide-react';

const threatGroups = [
  {
    id: 'G0016',
    name: 'APT29',
    aliases: ['Cozy Bear', 'The Dukes', 'YTTRIUM'],
    description: 'APT29 is attributed to Russia\'s SVR. Known for sophisticated supply chain attacks and cloud-based intrusions.',
    country: 'Russia',
  },
  {
    id: 'G0007',
    name: 'APT28',
    aliases: ['Fancy Bear', 'Sofacy', 'STRONTIUM'],
    description: 'APT28 is attributed to Russia\'s GRU. Known for targeting government, military, and media organizations.',
    country: 'Russia',
  },
  {
    id: 'G0032',
    name: 'Lazarus',
    aliases: ['Hidden Cobra', 'ZINC', 'Guardians of Peace'],
    description: 'Lazarus Group is attributed to North Korea. Known for financial crimes and destructive attacks.',
    country: 'North Korea',
  },
];

export default function Threats() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar variant="dashboard" />
      
      <main className="flex-1 overflow-auto">
        <div className="grid-pattern min-h-full">
          <div className="p-6 space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Threat Groups</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Understand adversary TTPs and map your defenses against known threat actors
              </p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {threatGroups.map((group) => {
                const groupTechniques = techniques.filter(t => t.usedByGroups.includes(group.name));
                
                return (
                  <Card 
                    key={group.id} 
                    className="bg-card/50 backdrop-blur border-border hover:border-red-500/50 transition-colors"
                    data-testid={`card-threat-${group.id}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                            <Skull className="w-5 h-5 text-red-400" />
                          </div>
                          <div>
                            <CardTitle className="text-base">{group.name}</CardTitle>
                            <p className="text-xs font-mono text-muted-foreground">{group.id}</p>
                          </div>
                        </div>
                        <Badge variant="destructive" className="text-xs">
                          {group.country}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-1">
                          {group.aliases.map(alias => (
                            <Badge key={alias} variant="secondary" className="text-xs">
                              {alias}
                            </Badge>
                          ))}
                        </div>
                        
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {group.description}
                        </p>
                        
                        <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
                          <div className="flex items-center gap-2">
                            <Target className="w-4 h-4 text-red-400" />
                            <span className="text-muted-foreground">Known Techniques</span>
                          </div>
                          <span className="font-mono text-red-400 font-bold">{groupTechniques.length}</span>
                        </div>
                        
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {groupTechniques.slice(0, 4).map((technique) => (
                            <div 
                              key={technique.id}
                              className="flex items-center gap-2 text-xs p-1.5 rounded bg-red-500/10 border border-red-500/20"
                            >
                              <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                              <span className="font-mono text-red-400">{technique.id}</span>
                              <span className="text-foreground truncate">{technique.name}</span>
                            </div>
                          ))}
                          {groupTechniques.length > 4 && (
                            <div className="text-xs text-muted-foreground text-center py-1">
                              +{groupTechniques.length - 4} more techniques
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-primary" />
                  Technique Coverage by Threat Group
                </CardTitle>
                <CardDescription>
                  See which techniques are used by each threat group and plan your defense accordingly
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 text-muted-foreground font-medium">Technique</th>
                        <th className="text-left py-2 px-3 text-muted-foreground font-medium">Name</th>
                        <th className="text-center py-2 px-3 text-muted-foreground font-medium">APT29</th>
                        <th className="text-center py-2 px-3 text-muted-foreground font-medium">APT28</th>
                        <th className="text-center py-2 px-3 text-muted-foreground font-medium">Lazarus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {techniques.map((technique) => (
                        <tr key={technique.id} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="py-2 px-3 font-mono text-primary text-xs">{technique.id}</td>
                          <td className="py-2 px-3 text-foreground">{technique.name}</td>
                          <td className="py-2 px-3 text-center">
                            {technique.usedByGroups.includes('APT29') ? (
                              <Badge variant="destructive" className="text-[10px]">Used</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {technique.usedByGroups.includes('APT28') ? (
                              <Badge variant="destructive" className="text-[10px]">Used</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {technique.usedByGroups.includes('Lazarus') ? (
                              <Badge variant="destructive" className="text-[10px]">Used</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
