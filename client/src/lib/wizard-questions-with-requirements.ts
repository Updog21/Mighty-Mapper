/**
 * Wizard Questions with Analytic Requirements
 *
 * This bridges the simple wizard questions with full requirement derivation.
 * Use this when you want to show users the full context of what they're selecting.
 *
 * This follows the adapter pattern - simple questions are adapted to enhanced ones on-demand.
 */

import { WIZARD_QUESTION_SETS, WIZARD_CONTEXT_ALIASES, type WizardQuestion } from './wizard-questions';
import { normalizePlatformList } from '@shared/platforms';
import { DC_ANALYTIC_REQUIREMENTS, type AnalyticRequirement } from './dc-analytic-requirements';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface QuestionWithRequirements {
  // Original question data
  id: string;
  text: string;
  dcNames: string[];
  requiredFields?: string[];
  advanced?: boolean;

  // Derived requirements
  requirements: AnalyticRequirement[];
  primaryChannel: string;
  allChannels: Set<string>;
  allExpectedFields: Set<string>;
  allMutableElements: Set<string>;
  allLogSources: Set<string>;
}

export interface RequirementSummary {
  totalDCs: number;
  channels: string[];
  expectedFieldCount: number;
  mutableElementCount: number;
  sampleFields: string[];
  sampleMutableElements: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a basic question to one with full requirements
 *
 * @example
 * ```typescript
 * const question = WIZARD_QUESTION_SETS['Windows'].categories[0].questions[0];
 * const enriched = enrichQuestion(question);
 *
 * console.log(enriched.primaryChannel);
 * // "Authentication telemetry"
 *
 * console.log(enriched.allExpectedFields);
 * // Set(['user/account identifier', 'timestamp', 'outcome (success/failure)', ...])
 * ```
 */
export function enrichQuestion(question: WizardQuestion): QuestionWithRequirements {
  const requirements: AnalyticRequirement[] = [];
  const allChannels = new Set<string>();
  const allExpectedFields = new Set<string>();
  const allMutableElements = new Set<string>();
  const allLogSources = new Set<string>();

  for (const dcName of question.dcNames) {
    const req = DC_ANALYTIC_REQUIREMENTS[dcName];
    if (req) {
      requirements.push(req);
      allChannels.add(req.channel);
      req.expectedCoreFields.forEach(f => allExpectedFields.add(f));
      req.defaultMutableElements.forEach(m => allMutableElements.add(m));
      req.logSourcesToLookFor.forEach(l => allLogSources.add(l));
    }
  }

  return {
    id: question.id,
    text: question.text,
    dcNames: question.dcNames,
    requiredFields: question.requiredFields,
    advanced: question.advanced,
    requirements,
    primaryChannel: requirements[0]?.channel || 'Unknown',
    allChannels,
    allExpectedFields,
    allMutableElements,
    allLogSources,
  };
}

/**
 * Get all questions for a platform, enriched with requirements
 *
 * @param platform - MITRE platform name (e.g., 'Windows', 'Linux', 'IaaS')
 * @returns Array of enriched questions with full analytic requirements
 *
 * @example
 * ```typescript
 * const questions = getEnrichedQuestionsForPlatform('Windows');
 *
 * for (const q of questions) {
 *   console.log(`${q.text}`);
 *   console.log(`  Channel: ${q.primaryChannel}`);
 *   console.log(`  DCs: ${q.dcNames.join(', ')}`);
 * }
 * ```
 */
export function getEnrichedQuestionsForPlatform(platform: string): QuestionWithRequirements[] {
  const normalized = normalizePlatformList([platform])[0] || platform;
  const alias = WIZARD_CONTEXT_ALIASES[normalized.toLowerCase()] || normalized;
  const questionSet = WIZARD_QUESTION_SETS[alias];

  if (!questionSet) return [];

  const allQuestions: QuestionWithRequirements[] = [];

  for (const category of questionSet.categories) {
    for (const question of category.questions) {
      allQuestions.push(enrichQuestion(question));
    }
  }

  return allQuestions;
}

/**
 * Get summary of all requirements for selected DC names
 *
 * This is useful for showing aggregate statistics when users have answered
 * multiple questions.
 *
 * @param dcNames - List of Data Component names
 * @returns Summary statistics and sample data
 *
 * @example
 * ```typescript
 * const summary = summarizeRequirements([
 *   'Process Creation',
 *   'User Account Authentication',
 *   'Network Connection Creation'
 * ]);
 *
 * console.log(`${summary.totalDCs} DCs covering ${summary.channels.length} channels`);
 * console.log(`Expected fields: ${summary.sampleFields.join(', ')}`);
 * ```
 */
export function summarizeRequirements(dcNames: string[]): RequirementSummary {
  const allChannels = new Set<string>();
  const allFields = new Set<string>();
  const allMutable = new Set<string>();

  for (const dcName of dcNames) {
    const req = DC_ANALYTIC_REQUIREMENTS[dcName];
    if (req) {
      allChannels.add(req.channel);
      req.expectedCoreFields.forEach(f => allFields.add(f));
      req.defaultMutableElements.forEach(m => allMutable.add(m));
    }
  }

  return {
    totalDCs: dcNames.length,
    channels: Array.from(allChannels),
    expectedFieldCount: allFields.size,
    mutableElementCount: allMutable.size,
    sampleFields: Array.from(allFields).slice(0, 5),
    sampleMutableElements: Array.from(allMutable).slice(0, 5),
  };
}

/**
 * Get detailed breakdown of requirements by channel
 *
 * Groups DCs by their channel classification for organized display
 *
 * @param dcNames - List of Data Component names
 * @returns Map of channel → DC requirements in that channel
 *
 * @example
 * ```typescript
 * const breakdown = getRequirementsByChannel([
 *   'Process Creation',
 *   'User Account Authentication'
 * ]);
 *
 * for (const [channel, dcs] of breakdown.entries()) {
 *   console.log(`\n${channel}:`);
 *   dcs.forEach(dc => console.log(`  - ${dc.name}`));
 * }
 * ```
 */
export function getRequirementsByChannel(dcNames: string[]): Map<string, AnalyticRequirement[]> {
  const byChannel = new Map<string, AnalyticRequirement[]>();

  for (const dcName of dcNames) {
    const req = DC_ANALYTIC_REQUIREMENTS[dcName];
    if (req) {
      const existing = byChannel.get(req.channel) || [];
      existing.push(req);
      byChannel.set(req.channel, existing);
    }
  }

  return byChannel;
}

/**
 * Get all unique log sources mentioned across selected DCs
 *
 * Useful for showing users what log sources they should be looking for
 *
 * @param dcNames - List of Data Component names
 * @returns Sorted array of unique log source names
 *
 * @example
 * ```typescript
 * const logSources = getUniqueLogSources(['Process Creation', 'File Creation']);
 * // Returns: ['Sysmon Event ID 1', 'Sysmon Event ID 11', 'Windows Security (4688)', ...]
 * ```
 */
export function getUniqueLogSources(dcNames: string[]): string[] {
  const logSources = new Set<string>();

  for (const dcName of dcNames) {
    const req = DC_ANALYTIC_REQUIREMENTS[dcName];
    if (req) {
      req.logSourcesToLookFor.forEach(ls => logSources.add(ls));
    }
  }

  return Array.from(logSources).sort();
}

/**
 * Get all unique mutable elements across selected DCs
 *
 * Useful for showing detection engineers what fields they need to parameterize
 *
 * @param dcNames - List of Data Component names
 * @returns Sorted array of unique mutable element names
 *
 * @example
 * ```typescript
 * const mutable = getUniqueMutableElements(['Process Creation', 'Command Execution']);
 * // Returns: ['PID/Process GUID', 'command line content', 'working directory', ...]
 * ```
 */
export function getUniqueMutableElements(dcNames: string[]): string[] {
  const mutable = new Set<string>();

  for (const dcName of dcNames) {
    const req = DC_ANALYTIC_REQUIREMENTS[dcName];
    if (req) {
      req.defaultMutableElements.forEach(m => mutable.add(m));
    }
  }

  return Array.from(mutable).sort();
}

/**
 * Check if a given platform has questions available
 *
 * @param platform - MITRE platform name
 * @returns True if questions exist for this platform
 */
export function hasQuestionsForPlatform(platform: string): boolean {
  const normalized = normalizePlatformList([platform])[0] || platform;
  const alias = WIZARD_CONTEXT_ALIASES[normalized.toLowerCase()] || normalized;
  return WIZARD_QUESTION_SETS[alias] !== undefined;
}

/**
 * Get list of all supported platforms
 *
 * @returns Array of platform names that have question sets
 */
export function getSupportedPlatforms(): string[] {
  return Object.keys(WIZARD_QUESTION_SETS);
}

// ═══════════════════════════════════════════════════════════════════════════
// RE-EXPORTS FOR CONVENIENCE
// ═══════════════════════════════════════════════════════════════════════════

export { WIZARD_QUESTION_SETS, WIZARD_CONTEXT_ALIASES };
export type { WizardQuestion } from './wizard-questions';
export type { AnalyticRequirement } from './dc-analytic-requirements';
