import { useMemo } from 'react';
import { useRoute } from 'wouter';
import { Sidebar } from '@/components/Sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StixExportControls } from '@/components/StixExportControls';
import { useMitreTechniqueDetail } from '@/hooks/useMitreData';
import { useSystemStatus } from '@/hooks/useProducts';
import { toMarkdownTable } from '@/lib/stix-export';
import { Target, Loader2, AlertCircle, ExternalLink, ArrowLeft } from 'lucide-react';

export default function TechniqueDetail() {
  const [, params] = useRoute('/techniques/:techniqueId');
  const techniqueId = useMemo(() => {
    const raw = params?.techniqueId ? decodeURIComponent(params.techniqueId) : '';
    return raw.trim().toUpperCase();
  }, [params?.techniqueId]);

  const { data: technique, isLoading, error } = useMitreTechniqueDetail(techniqueId);
  const { data: systemStatus } = useSystemStatus();

  const lastSync = systemStatus?.lastMitreSync
    ? new Date(systemStatus.lastMitreSync)
    : null;
  const isStale = !lastSync || Date.now() - lastSync.getTime() > 30 * 24 * 60 * 60 * 1000;
  const exportPayload = useMemo(
    () => ({
      page: 'technique-detail',
      techniqueId: technique?.id || techniqueId || null,
      technique: technique || null,
    }),
    [technique, techniqueId]
  );
  const exportMarkdown = useMemo(() => {
    if (!technique) {
      return [
        '# Technique Detail',
        '',
        `- Technique ID: ${techniqueId || 'Unknown'}`,
        '',
        'No technique data is currently loaded.',
      ].join('\n');
    }

    const lines: string[] = [
      '# Technique Detail',
      '',
      `## ${technique.name} (${technique.id})`,
      '',
      technique.description || 'No description provided.',
      '',
      `- Tactics: ${technique.tactics.length > 0 ? technique.tactics.join(', ') : 'None'}`,
      `- Platforms: ${technique.platforms.length > 0 ? technique.platforms.join(', ') : 'None'}`,
      '',
      '### Sub-techniques',
      '',
    ];

    if (technique.subTechniques.length > 0) {
      lines.push(
        toMarkdownTable(
          ['ID', 'Name', 'Platforms'],
          technique.subTechniques.map((subTechnique) => [
            subTechnique.id,
            subTechnique.name,
            subTechnique.platforms.length > 0 ? subTechnique.platforms.join(', ') : '-',
          ])
        )
      );
    } else {
      lines.push('No sub-techniques for this technique.');
    }
    lines.push('', '### Procedure Examples', '');

    if (technique.procedureExamples.length > 0) {
      lines.push(
        toMarkdownTable(
          ['Source', 'Example', 'Reference'],
          technique.procedureExamples.map((example) => [
            `${example.sourceName}${example.sourceType ? ` (${example.sourceType})` : ''}`,
            example.description || 'No relationship description provided.',
            example.url || '-',
          ])
        )
      );
    } else {
      lines.push('No procedure examples available.');
    }
    lines.push('', '### Detection Strategies', '');

    if (technique.detectionStrategies.length > 0) {
      lines.push(
        toMarkdownTable(
          ['ID', 'Name'],
          technique.detectionStrategies.map((strategy) => [strategy.id, strategy.name])
        )
      );
    } else {
      lines.push('No detection strategies mapped.');
    }
    lines.push('', '### Mitigations', '');

    if (technique.mitigations.length > 0) {
      lines.push(
        toMarkdownTable(
          ['ID', 'Name', 'Description'],
          technique.mitigations.map((mitigation) => [
            mitigation.id,
            mitigation.name,
            mitigation.description || 'No description provided.',
          ])
        )
      );
    } else {
      lines.push('No mitigations mapped.');
    }

    return lines.join('\n');
  }, [technique, techniqueId]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar variant="dashboard" />

      <main className="flex-1 overflow-auto">
        <div className="grid-pattern min-h-full">
          <div className="p-6 space-y-6">
            <header className="space-y-2">
              <a
                href="/techniques"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Techniques
              </a>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Technique Details</h1>
              <p className="text-muted-foreground text-sm">
                Full ATT&CK technique context including sub-techniques, procedure examples, detection strategies, and mitigations.
              </p>
              <div className="pt-1">
                <StixExportControls
                  baseName={`technique-${technique?.id || techniqueId || 'detail'}`}
                  jsonPayload={exportPayload}
                  markdownContent={exportMarkdown}
                  disabled={isLoading || Boolean(error) || !technique}
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

            {isLoading ? (
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading technique detail...
                  </div>
                </CardContent>
              </Card>
            ) : error || !technique ? (
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardContent className="pt-6 text-sm text-red-400">
                  Failed to load technique detail for `{techniqueId}`.
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="bg-card/50 backdrop-blur border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="w-5 h-5 text-primary" />
                      {technique.name}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs font-mono text-red-600">
                        {technique.id}
                      </Badge>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <a
                      href={`https://attack.mitre.org/techniques/${technique.id.replace('.', '/')}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline underline-offset-2 break-all text-sm"
                    >
                      {`https://attack.mitre.org/techniques/${technique.id.replace('.', '/')}/`}
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>

                    <div className="space-y-1">
                      <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Description</h4>
                      <p className="text-sm text-foreground leading-relaxed">
                        {technique.description || 'No description provided.'}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Tactics</h4>
                      {technique.tactics.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {technique.tactics.map((tactic) => (
                            <Badge key={`${technique.id}-tactic-${tactic}`} variant="secondary" className="text-xs">
                              {tactic}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No tactics listed.</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Platforms</h4>
                      {technique.platforms.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {technique.platforms.map((platform) => (
                            <Badge key={`${technique.id}-platform-${platform}`} variant="secondary" className="text-xs">
                              {platform}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No platform tags listed.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-card/50 backdrop-blur border-border">
                  <CardHeader>
                    <CardTitle className="text-base">Sub-techniques</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {technique.subTechniques.length > 0 ? (
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
                            {technique.subTechniques.map((subTechnique) => (
                              <tr key={`${technique.id}-sub-${subTechnique.id}`}>
                                <td className="px-3 py-2 border border-border">
                                  <a href={`/techniques/${encodeURIComponent(subTechnique.id)}`} className="font-mono text-red-600 hover:underline underline-offset-2">
                                    {subTechnique.id}
                                  </a>
                                </td>
                                <td className="px-3 py-2 text-foreground font-normal border border-border">
                                  <a href={`/techniques/${encodeURIComponent(subTechnique.id)}`} className="text-foreground hover:underline underline-offset-2">
                                    {subTechnique.name}
                                  </a>
                                </td>
                                <td className="px-3 py-2 text-muted-foreground border border-border">
                                  {subTechnique.platforms.length > 0 ? subTechnique.platforms.join(', ') : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No sub-techniques for this technique.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-card/50 backdrop-blur border-border">
                  <CardHeader>
                    <CardTitle className="text-base">Procedure Examples</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {technique.procedureExamples.length > 0 ? (
                      <div className="overflow-x-auto rounded-md border border-border">
                        <table className="w-full text-sm border-collapse">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Source</th>
                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Example</th>
                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Reference</th>
                            </tr>
                          </thead>
                          <tbody>
                            {technique.procedureExamples.map((example, index) => (
                              <tr key={`${technique.id}-procedure-${index}`} className="align-top">
                                <td className="px-3 py-2 text-foreground border border-border">
                                  <div>{example.sourceName}</div>
                                  <div className="text-xs text-muted-foreground">{example.sourceType}</div>
                                </td>
                                <td className="px-3 py-2 text-muted-foreground border border-border">
                                  {example.description || 'No relationship description provided.'}
                                </td>
                                <td className="px-3 py-2 border border-border">
                                  {example.url ? (
                                    <a href={example.url} target="_blank" rel="noreferrer" className="text-primary hover:underline underline-offset-2">
                                      Source
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No procedure examples available.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-card/50 backdrop-blur border-border">
                  <CardHeader>
                    <CardTitle className="text-base">Detection Strategies</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {technique.detectionStrategies.length > 0 ? (
                      <div className="overflow-x-auto rounded-md border border-border">
                        <table className="w-full text-sm border-collapse">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">ID</th>
                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Name</th>
                            </tr>
                          </thead>
                          <tbody>
                            {technique.detectionStrategies.map((strategy) => (
                              <tr key={`${technique.id}-strategy-${strategy.id}`}>
                                <td className="px-3 py-2 border border-border">
                                  <a href={`/detection-strategies?strategy=${encodeURIComponent(strategy.id)}`} className="text-primary font-mono text-xs hover:underline underline-offset-2">
                                    {strategy.id}
                                  </a>
                                </td>
                                <td className="px-3 py-2 text-foreground font-normal border border-border">
                                  <a href={`/detection-strategies?strategy=${encodeURIComponent(strategy.id)}`} className="text-foreground hover:underline underline-offset-2">
                                    {strategy.name}
                                  </a>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No detection strategies mapped.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-card/50 backdrop-blur border-border">
                  <CardHeader>
                    <CardTitle className="text-base">Mitigations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {technique.mitigations.length > 0 ? (
                      <div className="overflow-x-auto rounded-md border border-border">
                        <table className="w-full text-sm border-collapse">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">ID</th>
                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Name</th>
                              <th className="text-left px-3 py-2 font-medium text-foreground border border-border">Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {technique.mitigations.map((mitigation) => (
                              <tr key={`${technique.id}-mitigation-${mitigation.id}`} className="align-top">
                                <td className="px-3 py-2 text-foreground font-mono text-xs border border-border">{mitigation.id}</td>
                                <td className="px-3 py-2 text-foreground font-normal border border-border">{mitigation.name}</td>
                                <td className="px-3 py-2 text-muted-foreground border border-border">
                                  {mitigation.description || 'No description provided.'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No mitigations mapped.</p>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
