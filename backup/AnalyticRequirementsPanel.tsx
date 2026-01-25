/**
 * Analytic Requirements Panel
 *
 * This component displays the derived analytic requirements when users answer
 * wizard questions. It shows:
 *
 * - Channel classification for the selected Data Components
 * - Expected core fields that should be present in the telemetry
 * - Default mutable elements to consider for detection engineering
 * - Log sources to look for in the user's environment
 *
 * This implements Step 4 of the 6-step methodology: "Derive analytic requirement tuples"
 */

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  ChevronDown,
  ChevronRight,
  Database,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Radio,
  Settings2,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { platformMatchesAny } from '@shared/platforms';
import {
  DC_ANALYTIC_REQUIREMENTS,
  getAnalyticRequirements,
  type AnalyticRequirement,
} from '@/lib/dc-analytic-requirements';

interface AnalyticRequirementsPanelProps {
  /** List of selected Data Component names */
  selectedDCNames: string[];
  /** Optional: Platform context for filtering */
  platform?: string;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Optional: Callback when user wants to see more details */
  onViewDetails?: (dcName: string) => void;
  /** Optional: Vendor-specific enrichment evidence keyed by DC ID */
  enrichmentByDcId?: Record<string, EnrichedEvidence>;
  /** Optional: Gemini suggested platforms for the product */
  suggestedPlatforms?: string[];
  /** Optional: STIX-derived platforms per DC */
  stixPlatformsByDcId?: Record<string, string[]>;
  /** Optional: render without internal header */
  showHeader?: boolean;
  /** Optional: show the mutable elements help callout */
  showMutableHelp?: boolean;
  /** Optional: render the full list without a fixed height */
  fullHeight?: boolean;
}

interface ChannelGroup {
  channel: string;
  requirements: AnalyticRequirement[];
}

export interface EnrichedLogSource {
  name: string;
  channel?: string;
  requiredFields?: string[];
  missingFields?: string[];
  evidence?: string;
  sourceUrl?: string;
}

export interface EnrichedEvidence {
  dcId: string;
  dcName: string;
  logSources: EnrichedLogSource[];
  targetFields?: string[];
}

/**
 * Group requirements by channel for organized display
 */
function groupByChannel(requirements: AnalyticRequirement[]): ChannelGroup[] {
  const groups = new Map<string, AnalyticRequirement[]>();

  for (const req of requirements) {
    const existing = groups.get(req.channel) || [];
    existing.push(req);
    groups.set(req.channel, existing);
  }

  return Array.from(groups.entries())
    .map(([channel, requirements]) => ({ channel, requirements }))
    .sort((a, b) => b.requirements.length - a.requirements.length);
}

/**
 * Get icon for a channel category
 */
function getChannelIcon(channel: string) {
  const channelLower = channel.toLowerCase();

  if (channelLower.includes('auth') || channelLower.includes('session') || channelLower.includes('identity')) {
    return <Radio className="w-4 h-4" />;
  }
  if (channelLower.includes('process') || channelLower.includes('execution') || channelLower.includes('shell')) {
    return <Zap className="w-4 h-4" />;
  }
  if (channelLower.includes('file') || channelLower.includes('storage')) {
    return <FileText className="w-4 h-4" />;
  }
  if (channelLower.includes('network') || channelLower.includes('flow')) {
    return <Database className="w-4 h-4" />;
  }

  return <Settings2 className="w-4 h-4" />;
}

/**
 * Individual requirement card
 */
function RequirementCard({
  requirement,
  isExpanded,
  onToggle,
  enrichment,
  suggestedPlatforms,
  stixPlatforms,
}: {
  requirement: AnalyticRequirement;
  isExpanded: boolean;
  onToggle: () => void;
  enrichment?: EnrichedEvidence;
  suggestedPlatforms?: string[];
  stixPlatforms?: string[];
}) {
  const targetFields = enrichment?.targetFields || [];
  const requiredFields = enrichment?.logSources
    ? Array.from(new Set(enrichment.logSources.flatMap((source) => source.requiredFields || [])))
    : [];
  const matchedCount = targetFields.length > 0
    ? requiredFields.filter((field) =>
      targetFields.some((target) => target.toLowerCase() === field.toLowerCase())
    ).length
    : 0;
  const missingFromTargets = targetFields.length > 0
    ? targetFields.filter((field) =>
      !requiredFields.some((required) => required.toLowerCase() === field.toLowerCase())
    )
    : [];
  const missingFromSources = enrichment?.logSources
    ? enrichment.logSources.flatMap((source) => source.missingFields || [])
    : [];
  const missingFields = Array.from(new Set([...missingFromTargets, ...missingFromSources]));
  const hasPlatformMatch = suggestedPlatforms?.length && stixPlatforms?.length
    ? platformMatchesAny(stixPlatforms, suggestedPlatforms)
    : null;

  return (
    <div className="border border-border rounded-lg bg-background/40 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-mono">
            {requirement.dcId}
          </Badge>
          <span className="text-sm font-medium text-foreground">
            {requirement.name}
          </span>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/50">
          {hasPlatformMatch !== null && (
            <div className="rounded-md border border-border/60 bg-background/60 p-2 text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-2">
                <span>Platform alignment</span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px]",
                    hasPlatformMatch ? "text-emerald-600" : "text-amber-500"
                  )}
                >
                  {hasPlatformMatch ? "Match" : "Platform Mismatch"}
                </Badge>
              </div>
              <div>STIX: {(stixPlatforms || []).join(", ") || "Unknown"}</div>
              <div>Gemini: {(suggestedPlatforms || []).join(", ") || "None suggested"}</div>
            </div>
          )}
          {/* Expected Core Fields */}
          <div className="pt-3">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              Expected Core Fields
            </div>
            <div className="flex flex-wrap gap-1.5">
              {requirement.expectedCoreFields.map((field, idx) => (
                <Badge
                  key={idx}
                  variant="secondary"
                  className="text-xs font-normal"
                >
                  {field}
                </Badge>
              ))}
            </div>
          </div>

          {/* Default Mutable Elements */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              Mutable Elements (STIX)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {requirement.defaultMutableElements.map((element, idx) => (
                <Badge
                  key={idx}
                  variant="outline"
                  className="text-xs font-normal text-amber-500 border-amber-500/30"
                >
                  {element}
                </Badge>
              ))}
            </div>
          </div>

          {/* Log Sources / Verified Evidence */}
          {enrichment && enrichment.logSources.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span>Verified Evidence</span>
                <Badge variant="secondary" className="text-[10px]">Verified by AI</Badge>
              </div>
              {targetFields.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Mutable element checklist (STIX): {targetFields.join(', ')}
                </div>
              )}
              {targetFields.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Field match:</span>{' '}
                  {matchedCount}/{targetFields.length}
                  <span className="text-muted-foreground"> (STIX checklist vs evidence fields)</span>
                </div>
              )}
              {missingFields.length > 0 && (
                <div className="text-xs text-amber-600">
                  <span className="font-semibold">Missing fields:</span> {missingFields.join(', ')}
                </div>
              )}
              <div className="space-y-2">
                {enrichment.logSources.map((source, idx) => (
                  <div key={`${requirement.dcId}-${idx}`} className="rounded-md border border-border/60 bg-background/60 p-2 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">{source.name}</div>
                    {source.channel && (
                      <div>
                        <span className="font-semibold text-foreground">Channel:</span> {source.channel}
                      </div>
                    )}
                    {source.requiredFields && source.requiredFields.length > 0 && (
                      <div className="space-y-1">
                        <div className="font-semibold text-foreground">Fields:</div>
                        <div className="flex flex-wrap gap-1">
                          {source.requiredFields.map((field) => (
                            <Badge key={`${requirement.dcId}-${idx}-${field}`} variant="outline" className="text-[10px]">
                              {field}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {source.missingFields && source.missingFields.length > 0 && (
                      <div className="space-y-1">
                        <div className="font-semibold">Missing fields:</div>
                        <div className="flex flex-wrap gap-1">
                          {source.missingFields.map((field) => (
                            <Badge key={`${requirement.dcId}-${idx}-missing-${field}`} variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                              {field}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {source.sourceUrl && (
                      <a
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-2"
                      >
                        {source.sourceUrl}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">
                Log Sources to Look For
              </div>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {requirement.logSourcesToLookFor.map((source, idx) => (
                  <li key={idx} className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-primary" />
                    {source}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Data Source */}
          {requirement.dataSource && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Data Source:</span> {requirement.dataSource}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Channel group section
 */
function ChannelSection({
  group,
  expandedDCs,
  onToggleDC,
  enrichmentByDcId,
  suggestedPlatforms,
  stixPlatformsByDcId,
}: {
  group: ChannelGroup;
  expandedDCs: Set<string>;
  onToggleDC: (dcName: string) => void;
  enrichmentByDcId?: Record<string, EnrichedEvidence>;
  suggestedPlatforms?: string[];
  stixPlatformsByDcId?: Record<string, string[]>;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30 transition-colors text-left"
        >
          <div className="flex items-center justify-center w-6 h-6 rounded bg-primary/10 text-primary">
            {getChannelIcon(group.channel)}
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">
              {group.channel}
            </div>
            <div className="text-xs text-muted-foreground">
              {group.requirements.length} data component{group.requirements.length !== 1 ? 's' : ''}
            </div>
          </div>
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-8 space-y-2 pt-2">
          {group.requirements.map((req) => (
            <RequirementCard
              key={req.dcId}
              requirement={req}
              isExpanded={expandedDCs.has(req.name)}
              onToggle={() => onToggleDC(req.name)}
              enrichment={enrichmentByDcId?.[req.dcId.toLowerCase()]}
              suggestedPlatforms={suggestedPlatforms}
              stixPlatforms={stixPlatformsByDcId?.[req.dcId.toLowerCase()] || req.platforms}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Summary stats bar
 */
function SummaryStats({ requirements }: { requirements: AnalyticRequirement[] }) {
  const stats = useMemo(() => {
    const channels = new Set(requirements.map(r => r.channel));
    const totalFields = requirements.reduce((sum, r) => sum + r.expectedCoreFields.length, 0);
    const totalMutable = requirements.reduce((sum, r) => sum + r.defaultMutableElements.length, 0);

    return {
      dcCount: requirements.length,
      channelCount: channels.size,
      fieldCount: totalFields,
      mutableCount: totalMutable,
    };
  }, [requirements]);

  return (
    <div className="grid grid-cols-4 gap-2 p-3 rounded-lg bg-muted/30 border border-border">
      <div className="text-center">
        <div className="text-lg font-semibold text-foreground">{stats.dcCount}</div>
        <div className="text-xs text-muted-foreground">Data Components</div>
      </div>
      <div className="text-center">
        <div className="text-lg font-semibold text-foreground">{stats.channelCount}</div>
        <div className="text-xs text-muted-foreground">Channels</div>
      </div>
      <div className="text-center">
        <div className="text-lg font-semibold text-foreground">{stats.fieldCount}</div>
        <div className="text-xs text-muted-foreground">Expected Fields</div>
      </div>
      <div className="text-center">
        <div className="text-lg font-semibold text-amber-500">{stats.mutableCount}</div>
        <div className="text-xs text-muted-foreground">Mutable Elements</div>
      </div>
    </div>
  );
}

/**
 * Main Panel Component
 */
export function AnalyticRequirementsPanel({
  selectedDCNames,
  platform,
  compact = false,
  onViewDetails,
  enrichmentByDcId,
  suggestedPlatforms,
  stixPlatformsByDcId,
  showHeader = true,
  showMutableHelp = true,
  fullHeight = false,
}: AnalyticRequirementsPanelProps) {
  const [expandedDCs, setExpandedDCs] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  // Get requirements for selected DCs
  const requirements = useMemo(() => {
    return getAnalyticRequirements(selectedDCNames);
  }, [selectedDCNames]);

  // Group by channel
  const channelGroups = useMemo(() => {
    return groupByChannel(requirements);
  }, [requirements]);

  // Toggle DC expansion
  const handleToggleDC = (dcName: string) => {
    setExpandedDCs(prev => {
      const next = new Set(prev);
      if (next.has(dcName)) {
        next.delete(dcName);
      } else {
        next.add(dcName);
      }
      return next;
    });
  };

  // Expand/collapse all
  const handleToggleAll = () => {
    if (expandedDCs.size === requirements.length) {
      setExpandedDCs(new Set());
    } else {
      setExpandedDCs(new Set(requirements.map(r => r.name)));
    }
  };

  if (selectedDCNames.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">
            Derived Requirements
          </div>
          <Badge variant="secondary" className="text-xs">
            {requirements.length} DCs
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1">
          {channelGroups.slice(0, 3).map(group => (
            <Badge key={group.channel} variant="outline" className="text-xs">
              {group.channel}
            </Badge>
          ))}
          {channelGroups.length > 3 && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              +{channelGroups.length - 3} more
            </Badge>
          )}
        </div>
        {!showAll && requirements.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAll(true)}
            className="w-full text-xs"
          >
            Show requirement details
          </Button>
        )}
      </div>
    );
  }

  const requirementsList = (
    <div className={cn("space-y-3", !fullHeight && "pr-4")}>
      {channelGroups.map((group) => (
        <ChannelSection
          key={group.channel}
          group={group}
          expandedDCs={expandedDCs}
          onToggleDC={handleToggleDC}
          enrichmentByDcId={enrichmentByDcId}
          suggestedPlatforms={suggestedPlatforms}
          stixPlatformsByDcId={stixPlatformsByDcId}
        />
      ))}
    </div>
  );

  return (
    <Card className="bg-card/50 backdrop-blur border-border">
      {showHeader && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Derived Analytic Requirements</CardTitle>
              <CardDescription className="text-xs">
                Based on your selected telemetry capabilities
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={handleToggleAll}>
              {expandedDCs.size === requirements.length ? 'Collapse All' : 'Expand All'}
            </Button>
          </div>
        </CardHeader>
      )}
      <CardContent className={cn("space-y-4", !showHeader && "pt-4")}>
        <SummaryStats requirements={requirements} />

        {fullHeight ? (
          requirementsList
        ) : (
          <ScrollArea className="h-80">
            {requirementsList}
          </ScrollArea>
        )}

        {showMutableHelp && (
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">What are mutable elements?</strong>
            <p className="mt-1">
              Mutable elements are fields that vary across environments (like source IPs, session IDs, process GUIDs).
              Detection rules should treat these as variables, not constants. The amber badges above highlight fields
              your detection engineers need to parameterize.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Inline version for embedding in question answers
 */
export function InlineRequirementHint({
  dcNames,
  enrichment,
}: {
  dcNames: string[];
  enrichment?: EnrichedEvidence;
}) {
  const requirements = getAnalyticRequirements(dcNames);

  if (requirements.length === 0) {
    return null;
  }

  const targetFields = enrichment?.targetFields || [];
  const requiredFields = enrichment?.logSources
    ? Array.from(new Set(enrichment.logSources.flatMap((source) => source.requiredFields || [])))
    : [];
  const missingFromTargets = targetFields.length > 0
    ? targetFields.filter((field) =>
      !requiredFields.some((required) => required.toLowerCase() === field.toLowerCase())
    )
    : [];
  const missingFromSources = enrichment?.logSources
    ? enrichment.logSources.flatMap((source) => source.missingFields || [])
    : [];
  const missingFields = Array.from(new Set([...missingFromTargets, ...missingFromSources]));
  const matchedCount = targetFields.length > 0
    ? requiredFields.filter((field) =>
      targetFields.some((target) => target.toLowerCase() === field.toLowerCase())
    ).length
    : 0;
  const aiChannels = enrichment?.logSources
    ? Array.from(new Set(
      enrichment.logSources
        .map((source) => source.channel || source.name)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ))
    : [];

  const channels = aiChannels.length > 0
    ? aiChannels
    : [...new Set(requirements.map(r => r.channel))];
  const expectedFields = requirements.flatMap(r => r.expectedCoreFields);
  const displayFieldsSource = aiChannels.length > 0 && requiredFields.length > 0
    ? requiredFields
    : expectedFields;
  const sampleFields = displayFieldsSource.slice(0, 3);
  const totalFieldCount = displayFieldsSource.length;
  const displayChannels = channels.slice(0, 2).join(', ');
  const channelSuffix = channels.length > 2 ? ` +${channels.length - 2} more` : '';
  const missingPreview = missingFields.slice(0, 3);
  const missingSuffix = missingFields.length > 3 ? ` +${missingFields.length - 3} more` : '';

  return (
    <div className="mt-2 pl-6 text-xs space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Radio className="w-3 h-3" />
        <span className="font-semibold text-foreground">Channel:</span>
        <span>{displayChannels || 'Unknown'}{channelSuffix}</span>
        {aiChannels.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">Verified by AI</Badge>
        )}
      </div>
      {targetFields.length > 0 && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {matchedCount === targetFields.length ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          ) : (
            <AlertTriangle className="w-3 h-3 text-amber-500" />
          )}
          <span className="font-semibold text-foreground">Field match:</span>
          <span>{matchedCount}/{targetFields.length}</span>
          <span className="text-muted-foreground"> (STIX vs evidence)</span>
        </div>
      )}
      {missingPreview.length > 0 && (
        <div className="text-amber-600">
          <span className="font-semibold">Missing:</span> {missingPreview.join(', ')}{missingSuffix}
        </div>
      )}
      {sampleFields.length > 0 && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <FileText className="w-3 h-3" />
          <span className="font-semibold text-foreground">Fields:</span>
          <span>{sampleFields.join(', ')}{totalFieldCount > 3 ? '...' : ''}</span>
        </div>
      )}
    </div>
  );
}

export default AnalyticRequirementsPanel;
