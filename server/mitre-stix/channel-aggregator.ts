/**
 * MITRE Knowledge Graph Channel Aggregator
 *
 * This module aggregates channel information from STIX analytics to provide
 * DC-level channel derivation. While STIX stores log source references
 * (with channels) at the analytic level, this aggregator:
 *
 * 1. Traverses all analytics that use a given Data Component
 * 2. Collects all log source references with their channels
 * 3. Derives the most common/appropriate channel for the DC
 * 4. Returns channel + log source metadata for wizard enhancement
 *
 * STIX Availability:
 * - x-mitre-analytic.x_mitre_log_source_references includes channel field
 * - x-mitre-analytic.x_mitre_mutable_elements includes field + description
 * - These are aggregated here to provide DC-level defaults
 */

import { mitreKnowledgeGraph } from './knowledge-graph';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ChannelInfo {
  /** The normalized channel name */
  channel: string;
  /** How many analytics use this channel for this DC */
  frequency: number;
}

export interface LogSourceInfo {
  /** The log source name (from STIX x_mitre_log_source_references) */
  name: string;
  /** The channel this log source provides */
  channel?: string;
  /** The DC this log source is for */
  dataComponentName: string;
  /** How many analytics reference this log source */
  frequency: number;
}

export interface MutableElementInfo {
  /** The field name */
  field: string;
  /** Description of why this field is mutable */
  description: string;
  /** Which analytics define this mutable element */
  analyticIds: string[];
}

export interface DCChannelAggregation {
  /** The Data Component name */
  dataComponentName: string;
  /** The Data Component ID (DCxxxx) */
  dataComponentId: string;
  /** Parent Data Source name */
  dataSourceName: string;
  /** Derived primary channel (most frequent) */
  primaryChannel: string;
  /** All channels observed for this DC */
  allChannels: ChannelInfo[];
  /** All log sources observed for this DC */
  logSources: LogSourceInfo[];
  /** All mutable elements observed for this DC */
  mutableElements: MutableElementInfo[];
  /** Number of analytics that use this DC */
  analyticCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL AGGREGATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate channel information for a specific Data Component
 *
 * Traversal path:
 * 1. Find DC by name
 * 2. Get all analytics that reference this DC (via dataComponentToAnalytics)
 * 3. For each analytic, collect log source references and mutable elements
 * 4. Aggregate and return
 */
export async function aggregateChannelsForDC(
  dataComponentName: string
): Promise<DCChannelAggregation | null> {
  await mitreKnowledgeGraph.ensureInitialized();

  // Find the DC by name
  const dc = mitreKnowledgeGraph.getDataComponentByName(dataComponentName);
  if (!dc) {
    console.warn(`[ChannelAggregator] DC not found: ${dataComponentName}`);
    return null;
  }

  // Get all analytics that use this DC
  // We need to access the internal maps - this is a bit of a hack but necessary
  // In production, you'd expose a method on MitreKnowledgeGraph for this
  const analyticInfos = getAnalyticsForDataComponent(dc.stixId);

  if (analyticInfos.length === 0) {
    // No analytics found, return basic info with inferred channel
    return {
      dataComponentName: dc.name,
      dataComponentId: dc.id,
      dataSourceName: dc.dataSourceName,
      primaryChannel: inferChannelFromDCName(dc.name),
      allChannels: [{
        channel: inferChannelFromDCName(dc.name),
        frequency: 1,
      }],
      logSources: [],
      mutableElements: [],
      analyticCount: 0,
    };
  }

  // Aggregate channels
  const channelCounts = new Map<string, number>();
  const logSourceMap = new Map<string, LogSourceInfo>();
  const mutableElementMap = new Map<string, MutableElementInfo>();

  for (const analytic of analyticInfos) {
    // Process log source references
    for (const lsr of analytic.logSourceReferences) {
      // Only count if it's for this DC
      if (lsr.dataComponentRef !== dc.stixId) continue;

      const channel = lsr.channel || 'Unspecified';
      channelCounts.set(channel, (channelCounts.get(channel) || 0) + 1);

      // Aggregate log sources
      const lsKey = `${lsr.name}|${channel}`;
      if (logSourceMap.has(lsKey)) {
        logSourceMap.get(lsKey)!.frequency++;
      } else {
        logSourceMap.set(lsKey, {
          name: lsr.name,
          channel: lsr.channel,
          dataComponentName: dc.name,
          frequency: 1,
        });
      }
    }

    // Process mutable elements
    for (const me of analytic.mutableElements) {
      if (mutableElementMap.has(me.field)) {
        mutableElementMap.get(me.field)!.analyticIds.push(analytic.id);
      } else {
        mutableElementMap.set(me.field, {
          field: me.field,
          description: me.description,
          analyticIds: [analytic.id],
        });
      }
    }
  }

  // Sort channels by frequency
  const allChannels = Array.from(channelCounts.entries())
    .map(([channel, frequency]) => ({ channel, frequency }))
    .sort((a, b) => b.frequency - a.frequency);

  // Primary channel is most frequent, or inferred if none found
  const primaryChannel = allChannels.length > 0
    ? allChannels[0].channel
    : inferChannelFromDCName(dc.name);

  // If we have no channels from STIX, add the inferred one
  if (allChannels.length === 0) {
    allChannels.push({
      channel: primaryChannel,
      frequency: 1,
    });
  }

  return {
    dataComponentName: dc.name,
    dataComponentId: dc.id,
    dataSourceName: dc.dataSourceName,
    primaryChannel,
    allChannels,
    logSources: Array.from(logSourceMap.values()).sort((a, b) => b.frequency - a.frequency),
    mutableElements: Array.from(mutableElementMap.values()),
    analyticCount: analyticInfos.length,
  };
}

/**
 * Aggregate channels for all Data Components
 */
export async function aggregateAllChannels(): Promise<DCChannelAggregation[]> {
  await mitreKnowledgeGraph.ensureInitialized();

  const allDCs = mitreKnowledgeGraph.getAllDataComponents();
  const results: DCChannelAggregation[] = [];

  for (const dc of allDCs) {
    const aggregation = await aggregateChannelsForDC(dc.name);
    if (aggregation) {
      results.push(aggregation);
    }
  }

  return results;
}

/**
 * Get channel aggregation for a list of DC names (for wizard integration)
 */
export async function getChannelsForDCs(
  dcNames: string[]
): Promise<Record<string, DCChannelAggregation>> {
  const results: Record<string, DCChannelAggregation> = {};

  for (const dcName of dcNames) {
    const aggregation = await aggregateChannelsForDC(dcName);
    if (aggregation) {
      results[dcName] = aggregation;
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get analytics for a data component STIX ID
 * This uses the internal knowledge graph structure
 */
function getAnalyticsForDataComponent(dcStixId: string): Array<{
  id: string;
  name: string;
  logSourceReferences: Array<{
    dataComponentRef: string;
    name: string;
    channel?: string;
  }>;
  mutableElements: Array<{
    field: string;
    description: string;
  }>;
}> {
  // Access the knowledge graph's internal data
  // In a production system, you'd add a public method for this
  const kg = mitreKnowledgeGraph as any;

  if (!kg.dataComponentToAnalytics || !kg.analyticMap) {
    return [];
  }

  const analyticStixIds = kg.dataComponentToAnalytics.get(dcStixId) || [];
  const results: Array<{
    id: string;
    name: string;
    logSourceReferences: Array<{
      dataComponentRef: string;
      name: string;
      channel?: string;
    }>;
    mutableElements: Array<{
      field: string;
      description: string;
    }>;
  }> = [];

  for (const analyticStixId of analyticStixIds) {
    const analytic = kg.analyticMap.get(analyticStixId);
    if (analytic) {
      results.push({
        id: analytic.id,
        name: analytic.name,
        logSourceReferences: analytic.logSourceReferences || [],
        mutableElements: analytic.mutableElements || [],
      });
    }
  }

  return results;
}

/**
 * Infer channel from DC name when STIX doesn't provide explicit channel
 *
 * This uses naming patterns to derive reasonable channel categories
 */
function inferChannelFromDCName(dcName: string): string {
  const nameLower = dcName.toLowerCase();

  // Authentication / Identity
  if (nameLower.includes('authentication') || nameLower.includes('logon')) {
    return 'Authentication telemetry';
  }
  if (nameLower.includes('session')) {
    return 'Session lifecycle telemetry';
  }
  if (nameLower.includes('user account') || nameLower.includes('account creation')) {
    return 'Identity administration/audit';
  }
  if (nameLower.includes('group')) {
    return 'Authorization administration/audit';
  }
  if (nameLower.includes('active directory')) {
    return 'Directory change audit';
  }

  // Process / Execution
  if (nameLower.includes('process')) {
    return 'Endpoint process telemetry';
  }
  if (nameLower.includes('command') || nameLower.includes('script')) {
    return 'Endpoint shell/interpreter telemetry';
  }
  if (nameLower.includes('module')) {
    return 'Endpoint process/module telemetry';
  }
  if (nameLower.includes('api')) {
    return 'Low-level OS API/syscall telemetry';
  }

  // File System
  if (nameLower.includes('file')) {
    return 'Host file system telemetry';
  }
  if (nameLower.includes('drive')) {
    return 'Host storage device/mount telemetry';
  }

  // Windows Specific
  if (nameLower.includes('registry')) {
    return 'Windows configuration telemetry';
  }
  if (nameLower.includes('wmi')) {
    return 'Windows management instrumentation telemetry';
  }
  if (nameLower.includes('pipe')) {
    return 'Windows IPC telemetry';
  }

  // Network
  if (nameLower.includes('network connection')) {
    return 'Network session establishment telemetry';
  }
  if (nameLower.includes('network traffic flow') || nameLower.includes('flow')) {
    return 'Flow telemetry';
  }
  if (nameLower.includes('network traffic content') || nameLower.includes('content')) {
    return 'Full content/PCAP or deep session content';
  }
  if (nameLower.includes('share')) {
    return 'File sharing / SMB audit telemetry';
  }
  if (nameLower.includes('firewall')) {
    return 'Firewall configuration telemetry';
  }

  // Services & Persistence
  if (nameLower.includes('service')) {
    return 'Service control/daemon registration telemetry';
  }
  if (nameLower.includes('scheduled') || nameLower.includes('job')) {
    return 'Job scheduler telemetry';
  }

  // Kernel & Drivers
  if (nameLower.includes('driver')) {
    return 'Kernel/driver telemetry';
  }
  if (nameLower.includes('kernel') || nameLower.includes('firmware')) {
    return 'Boot/firmware integrity telemetry';
  }

  // Security
  if (nameLower.includes('host status') || nameLower.includes('sensor')) {
    return 'Security sensor health telemetry';
  }
  if (nameLower.includes('malware')) {
    return 'Malware repository metadata';
  }

  // Credentials
  if (nameLower.includes('credential')) {
    return 'Credential artifact issuance telemetry';
  }

  // Cloud
  if (nameLower.includes('cloud service')) {
    return 'Cloud service control-plane telemetry';
  }
  if (nameLower.includes('instance')) {
    return 'Cloud instance lifecycle telemetry';
  }
  if (nameLower.includes('cloud storage')) {
    return 'Cloud storage telemetry';
  }

  // Container
  if (nameLower.includes('container')) {
    return 'Container lifecycle telemetry';
  }
  if (nameLower.includes('pod')) {
    return 'Pod lifecycle telemetry';
  }

  // Application
  if (nameLower.includes('application log') || nameLower.includes('api request')) {
    return 'Application/service audit logs';
  }
  if (nameLower.includes('configuration')) {
    return 'Configuration change audit';
  }

  // Enrichment
  if (nameLower.includes('dns')) {
    return 'DNS intelligence';
  }
  if (nameLower.includes('domain registration') || nameLower.includes('whois')) {
    return 'Domain/WHOIS intelligence';
  }
  if (nameLower.includes('certificate')) {
    return 'Certificate intelligence';
  }
  if (nameLower.includes('response')) {
    return 'Scanner response telemetry';
  }

  // Default
  return 'Application/service audit logs';
}

// ═══════════════════════════════════════════════════════════════════════════
// API ENDPOINT HELPER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format aggregation for API response
 */
export function formatForAPI(aggregation: DCChannelAggregation): {
  dcId: string;
  name: string;
  dataSource: string;
  channel: string;
  allChannels: string[];
  logSources: string[];
  mutableElements: string[];
  analyticCount: number;
} {
  return {
    dcId: aggregation.dataComponentId,
    name: aggregation.dataComponentName,
    dataSource: aggregation.dataSourceName,
    channel: aggregation.primaryChannel,
    allChannels: aggregation.allChannels.map(c => c.channel),
    logSources: aggregation.logSources.map(ls => ls.name),
    mutableElements: aggregation.mutableElements.map(me => me.field),
    analyticCount: aggregation.analyticCount,
  };
}

export default {
  aggregateChannelsForDC,
  aggregateAllChannels,
  getChannelsForDCs,
  formatForAPI,
};
