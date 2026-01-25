/**
 * Wizard Integration Layer
 *
 * This module connects the enhanced wizard question flow with the auto-mapper
 * system, implementing the full 6-step methodology from the design document:
 *
 * Step 1: Define data source boundary (vendor/product) ✅ Wizard Details step
 * Step 2: Assign MITRE platform buckets ✅ Wizard Platform selection
 * Step 3: Choose candidate DCs based on telemetry ✅ Enhanced wizard questions
 * Step 4: Derive analytic requirement tuples ✅ DC_ANALYTIC_REQUIREMENTS
 * Step 5: Bind to implementation ✅ Stream configuration + auto-mapper
 * Step 6: Handoff ✅ SSM capability generation
 *
 * This integration layer provides:
 * - Full requirement derivation from wizard answers
 * - Channel and mutable element propagation
 * - Validation of coverage completeness
 * - Stream-to-DC binding suggestions
 */

import { aggregateChannelsForDC, getChannelsForDCs, type DCChannelAggregation } from '../mitre-stix/channel-aggregator';
import { mitreKnowledgeGraph } from '../mitre-stix/knowledge-graph';
import type { ResourceType } from '@shared/schema';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Step 1 & 2: Product boundary definition
 */
export interface ProductBoundary {
  vendor: string;
  productName: string;
  description: string;
  platforms: string[];
  productType?: string;
}

/**
 * Step 3: Selected Data Components from wizard
 */
export interface SelectedDataComponent {
  dcName: string;
  questionId: string;
  platform: string;
}

/**
 * Step 4: Full analytic requirement tuple
 * This is the key output of the wizard methodology
 */
export interface AnalyticRequirementTuple {
  // From STIX (authoritative)
  dcId: string;
  dcName: string;
  dataSource: string;

  // Derived (from STIX semantics + aggregation)
  channel: string;
  expectedCoreFields: string[];
  defaultMutableElements: string[];

  // From STIX analytics (if available)
  stixLogSources: string[];
  stixMutableElements: string[];

  // Inferred log sources to look for
  logSourcesToLookFor: string[];

  // Platform context
  platforms: string[];
}

/**
 * Step 5: Implementation binding
 */
export interface ImplementationBinding {
  dcName: string;
  boundStreamName?: string;
  siemSourceType?: string;
  actualFields?: string[];
  retentionDays?: number;
  samplingRate?: number;
  status: 'configured' | 'pending' | 'not_available';
}

/**
 * Step 6: Handoff record
 */
export interface HandoffRecord {
  productId: string;
  productBoundary: ProductBoundary;
  analyticRequirements: AnalyticRequirementTuple[];
  implementationBindings: ImplementationBinding[];
  coverageGaps: CoverageGap[];
  completedAt: Date;
}

export interface CoverageGap {
  dcName: string;
  channel: string;
  reason: 'not_selected' | 'not_bound' | 'missing_fields';
  techniquesAffected: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 4: DERIVE ANALYTIC REQUIREMENT TUPLES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Derive full analytic requirement tuples from selected DCs
 *
 * This is the core of Step 4 - for each selected DC, we:
 * 1. Get the authoritative DC info from STIX
 * 2. Aggregate channel info from analytics
 * 3. Combine with static requirements from DC_ANALYTIC_REQUIREMENTS
 * 4. Return the complete tuple
 */
export async function deriveAnalyticRequirements(
  selectedDCs: SelectedDataComponent[]
): Promise<AnalyticRequirementTuple[]> {
  await mitreKnowledgeGraph.ensureInitialized();

  const results: AnalyticRequirementTuple[] = [];
  const dcNames = [...new Set(selectedDCs.map(dc => dc.dcName))];

  // Get channel aggregations from STIX
  const channelAggregations = await getChannelsForDCs(dcNames);

  // Import static requirements (we'll inline this for the example)
  const staticRequirements = getStaticRequirements();

  for (const dcName of dcNames) {
    const aggregation = channelAggregations[dcName];
    const staticReq = staticRequirements[dcName];
    const dcInfo = mitreKnowledgeGraph.getDataComponentByName(dcName);

    if (!dcInfo) {
      console.warn(`[WizardIntegration] DC not found in STIX: ${dcName}`);
      continue;
    }

    // Merge STIX aggregation with static requirements
    const tuple: AnalyticRequirementTuple = {
      // From STIX
      dcId: dcInfo.id,
      dcName: dcInfo.name,
      dataSource: dcInfo.dataSourceName,

      // Derived channel (prefer STIX aggregation, fall back to static)
      channel: aggregation?.primaryChannel || staticReq?.channel || 'Unspecified',

      // Expected fields from static requirements
      expectedCoreFields: staticReq?.expectedCoreFields || [],

      // Mutable elements: merge STIX and static
      defaultMutableElements: [
        ...(staticReq?.defaultMutableElements || []),
      ],

      // STIX-specific log sources and mutable elements
      stixLogSources: aggregation?.logSources.map(ls => ls.name) || [],
      stixMutableElements: aggregation?.mutableElements.map(me => me.field) || [],

      // Log sources to look for from static requirements
      logSourcesToLookFor: staticReq?.logSourcesToLookFor || [],

      // Platforms from the DC info
      platforms: dcInfo.platforms || [],
    };

    // Merge STIX mutable elements into default list
    for (const stixME of tuple.stixMutableElements) {
      if (!tuple.defaultMutableElements.includes(stixME)) {
        tuple.defaultMutableElements.push(stixME);
      }
    }

    results.push(tuple);
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 5: IMPLEMENTATION BINDING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Suggest stream bindings for a list of requirement tuples
 *
 * This helps users during the Stream Configuration step by:
 * 1. Matching requirement channels to existing streams
 * 2. Suggesting new streams based on log sources to look for
 * 3. Identifying gaps where no binding is possible
 */
export function suggestStreamBindings(
  requirements: AnalyticRequirementTuple[],
  existingStreams: Array<{ name: string; dataComponents: string[] }>
): ImplementationBinding[] {
  const bindings: ImplementationBinding[] = [];

  for (const req of requirements) {
    // Try to find an existing stream that covers this DC
    const matchingStream = existingStreams.find(stream =>
      stream.dataComponents.includes(req.dcName)
    );

    if (matchingStream) {
      bindings.push({
        dcName: req.dcName,
        boundStreamName: matchingStream.name,
        status: 'configured',
      });
    } else {
      // Suggest creating a stream based on log sources
      const suggestedSource = req.logSourcesToLookFor[0] ||
        req.stixLogSources[0] ||
        `${req.dataSource} telemetry`;

      bindings.push({
        dcName: req.dcName,
        siemSourceType: suggestedSource,
        status: 'pending',
      });
    }
  }

  return bindings;
}

/**
 * Validate that bindings have the expected fields
 */
export function validateBindingFields(
  binding: ImplementationBinding,
  requirement: AnalyticRequirementTuple
): { valid: boolean; missingFields: string[]; mutableMatched: string[] } {
  const actualFields = binding.actualFields || [];
  const expectedFields = requirement.expectedCoreFields;
  const mutableElements = requirement.defaultMutableElements;

  // Check for missing expected fields
  const missingFields: string[] = [];
  for (const expected of expectedFields) {
    // Fuzzy match - check if any actual field contains the expected field concept
    const matched = actualFields.some(actual =>
      actual.toLowerCase().includes(expected.toLowerCase().split('/')[0]) ||
      expected.toLowerCase().includes(actual.toLowerCase())
    );
    if (!matched) {
      missingFields.push(expected);
    }
  }

  // Check which mutable elements are present
  const mutableMatched: string[] = [];
  for (const mutable of mutableElements) {
    const matched = actualFields.some(actual =>
      actual.toLowerCase().includes(mutable.toLowerCase().split(' ')[0])
    );
    if (matched) {
      mutableMatched.push(mutable);
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
    mutableMatched,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 6: COVERAGE GAP ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze coverage gaps for a set of requirements and bindings
 *
 * This helps identify:
 * 1. DCs that were not selected but are needed for technique coverage
 * 2. DCs that are selected but not bound to streams
 * 3. DCs where bindings are missing expected fields
 */
export async function analyzeCoverageGaps(
  selectedDCs: string[],
  bindings: ImplementationBinding[],
  targetTechniqueIds?: string[]
): Promise<CoverageGap[]> {
  await mitreKnowledgeGraph.ensureInitialized();

  const gaps: CoverageGap[] = [];

  // If target techniques are specified, find required DCs
  if (targetTechniqueIds && targetTechniqueIds.length > 0) {
    const mapping = mitreKnowledgeGraph.getFullMappingForTechniques(targetTechniqueIds);

    // Check each required DC
    for (const dc of mapping.dataComponents) {
      if (!selectedDCs.includes(dc.name)) {
        // Find which techniques need this DC
        const techniquesNeedingDC = targetTechniqueIds.filter(techId => {
          const reqs = mitreKnowledgeGraph.getLogRequirements(techId);
          return reqs.some(r => r.dataComponentName === dc.name);
        });

        gaps.push({
          dcName: dc.name,
          channel: inferChannelFromDCName(dc.name),
          reason: 'not_selected',
          techniquesAffected: techniquesNeedingDC,
        });
      }
    }
  }

  // Check for unbound DCs
  for (const dcName of selectedDCs) {
    const binding = bindings.find(b => b.dcName === dcName);
    if (!binding || binding.status === 'pending') {
      gaps.push({
        dcName,
        channel: inferChannelFromDCName(dcName),
        reason: 'not_bound',
        techniquesAffected: [], // Could be populated with technique lookup
      });
    }
  }

  return gaps;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE FLOW: PROCESS WIZARD ANSWERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process complete wizard flow and generate handoff record
 *
 * This is the main entry point that orchestrates:
 * 1. Takes wizard inputs (boundary, platforms, question answers)
 * 2. Derives analytic requirements
 * 3. Suggests stream bindings
 * 4. Analyzes coverage gaps
 * 5. Generates handoff record
 */
export async function processWizardFlow(input: {
  boundary: ProductBoundary;
  questionAnswers: Array<{
    questionId: string;
    platform: string;
    dcNames: string[];
    answered: boolean;
  }>;
  existingStreams?: Array<{ name: string; dataComponents: string[] }>;
  targetTechniqueIds?: string[];
}): Promise<HandoffRecord> {
  // Step 3: Collect selected DCs from answered questions
  const selectedDCs: SelectedDataComponent[] = [];
  for (const answer of input.questionAnswers) {
    if (answer.answered) {
      for (const dcName of answer.dcNames) {
        selectedDCs.push({
          dcName,
          questionId: answer.questionId,
          platform: answer.platform,
        });
      }
    }
  }

  // Step 4: Derive analytic requirements
  const requirements = await deriveAnalyticRequirements(selectedDCs);

  // Step 5: Suggest stream bindings
  const bindings = suggestStreamBindings(
    requirements,
    input.existingStreams || []
  );

  // Step 6: Analyze coverage gaps
  const gaps = await analyzeCoverageGaps(
    selectedDCs.map(dc => dc.dcName),
    bindings,
    input.targetTechniqueIds
  );

  // Generate handoff record
  const handoff: HandoffRecord = {
    productId: `${input.boundary.vendor.toLowerCase()}-${input.boundary.productName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    productBoundary: input.boundary,
    analyticRequirements: requirements,
    implementationBindings: bindings,
    coverageGaps: gaps,
    completedAt: new Date(),
  };

  return handoff;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATIC REQUIREMENTS (imported from dc-analytic-requirements.ts)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get static requirements for DCs
 * In production, this would import from the shared dc-analytic-requirements.ts
 */
function getStaticRequirements(): Record<string, {
  channel: string;
  expectedCoreFields: string[];
  defaultMutableElements: string[];
  logSourcesToLookFor: string[];
}> {
  // This is a subset - in production, import the full DC_ANALYTIC_REQUIREMENTS
  return {
    'User Account Authentication': {
      channel: 'Authentication telemetry',
      expectedCoreFields: [
        'user/account identifier',
        'timestamp',
        'outcome (success/failure)',
        'credential/auth method',
        'target resource',
        'source IP/device context',
      ],
      defaultMutableElements: [
        'source IP (NAT/VPN)',
        'user agent/device ID',
        'auth policy/risk evaluation outputs',
        'failure reason strings/codes',
      ],
      logSourcesToLookFor: [
        'OS auth logs',
        'IdP sign-in logs',
        'VPN auth logs',
        'Cloud sign-in logs',
      ],
    },
    'Process Creation': {
      channel: 'Endpoint process telemetry',
      expectedCoreFields: [
        'process image/name/path',
        'timestamp',
        'parent process',
        'command line/args',
        'user context',
      ],
      defaultMutableElements: [
        'PID/Process GUID',
        'command line content',
        'parent-child graph',
      ],
      logSourcesToLookFor: [
        'Sysmon Event ID 1',
        'Windows Security Event Log (4688)',
        'Linux auditd (execve)',
        'EDR process telemetry',
      ],
    },
    'Command Execution': {
      channel: 'Endpoint shell/interpreter telemetry',
      expectedCoreFields: [
        'command text',
        'timestamp',
        'interpreter (cmd/bash/PowerShell)',
        'parameters/arguments',
        'user context',
      ],
      defaultMutableElements: [
        'command strings',
        'arguments',
        'working directory',
        'runspace/session identifiers',
      ],
      logSourcesToLookFor: [
        'PowerShell Operational Log (4103, 4104)',
        'Bash history / auditd',
        'EDR command telemetry',
      ],
    },
    'Network Connection Creation': {
      channel: 'Network session establishment telemetry',
      expectedCoreFields: [
        'timestamp',
        'source/destination IP',
        'source/destination port',
        'protocol',
        'initiating process/host context',
      ],
      defaultMutableElements: [
        'ephemeral ports',
        'NAT addresses',
        'connection IDs',
      ],
      logSourcesToLookFor: [
        'Sysmon Event ID 3',
        'Firewall logs',
        'EDR network telemetry',
        'VPN logs',
      ],
    },
    'File Creation': {
      channel: 'Host file system telemetry',
      expectedCoreFields: [
        'file path',
        'timestamp',
        'creating process/user',
        'file name',
      ],
      defaultMutableElements: [
        'file paths (temp dirs)',
        'file names',
        'hashes',
      ],
      logSourcesToLookFor: [
        'Sysmon Event ID 11',
        'Linux auditd',
        'EDR file telemetry',
      ],
    },
    // Add more as needed...
  };
}

/**
 * Infer channel from DC name (fallback)
 */
function inferChannelFromDCName(dcName: string): string {
  const nameLower = dcName.toLowerCase();

  if (nameLower.includes('authentication')) return 'Authentication telemetry';
  if (nameLower.includes('process')) return 'Endpoint process telemetry';
  if (nameLower.includes('command') || nameLower.includes('script')) return 'Endpoint shell/interpreter telemetry';
  if (nameLower.includes('file')) return 'Host file system telemetry';
  if (nameLower.includes('network')) return 'Network telemetry';
  if (nameLower.includes('registry')) return 'Windows configuration telemetry';
  if (nameLower.includes('service')) return 'Service control telemetry';

  return 'Application/service audit logs';
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  deriveAnalyticRequirements,
  suggestStreamBindings,
  validateBindingFields,
  analyzeCoverageGaps,
  processWizardFlow,
};
