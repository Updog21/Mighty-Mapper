/**
 * Enhanced Wizard Questions with Full Analytic Requirement Derivation
 *
 * This file extends the wizard question methodology to include:
 * - Channel derivation per DC
 * - Expected core fields per DC
 * - Default mutable elements per DC
 * - Log sources to look for per DC
 *
 * When a user answers "Yes" to a question, the system derives the full
 * analytic requirement tuple for each associated Data Component.
 */

import {
  DC_ANALYTIC_REQUIREMENTS,
  getAnalyticRequirements,
  type AnalyticRequirement,
  type ChannelCategory,
} from './dc-analytic-requirements';

// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enhanced wizard question with full analytic requirement derivation
 */
export interface EnhancedWizardQuestion {
  /** Unique question identifier */
  id: string;

  /** Question text (Yes/No format) */
  text: string;

  /** Data Component names this question maps to */
  dcNames: string[];

  /**
   * Derived analytic requirements for each DC
   * Populated automatically from DC_ANALYTIC_REQUIREMENTS
   */
  analyticRequirements: AnalyticRequirement[];

  /**
   * Aggregate channel for this question
   * If multiple DCs, shows primary channel
   */
  primaryChannel: ChannelCategory;

  /**
   * Combined expected fields across all DCs
   */
  combinedExpectedFields: string[];

  /**
   * Combined mutable elements across all DCs
   */
  combinedMutableElements: string[];

  /**
   * Combined log sources across all DCs
   */
  combinedLogSources: string[];

  /** Optional: specific required fields (legacy support) */
  requiredFields?: string[];

  /** Whether this is an advanced/optional question */
  advanced?: boolean;
}

export interface EnhancedQuestionCategory {
  id: string;
  label: string;
  description?: string;
  questions: EnhancedWizardQuestion[];
}

export interface EnhancedQuestionSet {
  id: string;
  label: string;
  description: string;
  categories: EnhancedQuestionCategory[];
}

/**
 * User's answer to an enhanced question, with derived requirements
 */
export interface QuestionAnswer {
  questionId: string;
  answer: boolean;
  /** If yes, the derived requirements from answering this question */
  derivedRequirements?: {
    dcNames: string[];
    channels: string[];
    expectedFields: string[];
    mutableElements: string[];
    logSources: string[];
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUESTION ENHANCEMENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enhance a basic question with full analytic requirement derivation
 */
export function enhanceQuestion(basicQuestion: {
  id: string;
  text: string;
  dcNames: string[];
  requiredFields?: string[];
  advanced?: boolean;
}): EnhancedWizardQuestion {
  const requirements = getAnalyticRequirements(basicQuestion.dcNames);

  // Aggregate fields across all requirements
  const allExpectedFields = new Set<string>();
  const allMutableElements = new Set<string>();
  const allLogSources = new Set<string>();
  const allChannels = new Set<string>();

  for (const req of requirements) {
    req.expectedCoreFields.forEach(f => allExpectedFields.add(f));
    req.defaultMutableElements.forEach(m => allMutableElements.add(m));
    req.logSourcesToLookFor.forEach(l => allLogSources.add(l));
    allChannels.add(req.channel);
  }

  // Primary channel is from the first requirement (or a default)
  const primaryChannel = requirements[0]?.channel || 'Application/service audit logs';

  return {
    id: basicQuestion.id,
    text: basicQuestion.text,
    dcNames: basicQuestion.dcNames,
    analyticRequirements: requirements,
    primaryChannel: primaryChannel as ChannelCategory,
    combinedExpectedFields: Array.from(allExpectedFields),
    combinedMutableElements: Array.from(allMutableElements),
    combinedLogSources: Array.from(allLogSources),
    requiredFields: basicQuestion.requiredFields,
    advanced: basicQuestion.advanced,
  };
}

/**
 * Enhance an entire question set
 */
export function enhanceQuestionSet(basicSet: {
  id: string;
  label: string;
  description: string;
  categories: Array<{
    id: string;
    label: string;
    description?: string;
    questions: Array<{
      id: string;
      text: string;
      dcNames: string[];
      requiredFields?: string[];
      advanced?: boolean;
    }>;
  }>;
}): EnhancedQuestionSet {
  return {
    id: basicSet.id,
    label: basicSet.label,
    description: basicSet.description,
    categories: basicSet.categories.map(category => ({
      id: category.id,
      label: category.label,
      description: category.description,
      questions: category.questions.map(q => enhanceQuestion(q)),
    })),
  };
}

/**
 * Process a user's answer and derive the full requirement tuple
 */
export function processAnswer(
  question: EnhancedWizardQuestion,
  answer: boolean
): QuestionAnswer {
  if (!answer) {
    return {
      questionId: question.id,
      answer: false,
    };
  }

  return {
    questionId: question.id,
    answer: true,
    derivedRequirements: {
      dcNames: question.dcNames,
      channels: [...new Set(question.analyticRequirements.map(r => r.channel))],
      expectedFields: question.combinedExpectedFields,
      mutableElements: question.combinedMutableElements,
      logSources: question.combinedLogSources,
    },
  };
}

/**
 * Aggregate all answers into a complete product telemetry profile
 */
export interface TelemetryProfile {
  platform: string;
  dataComponents: string[];
  channels: string[];
  expectedFields: Record<string, string[]>; // DC name -> fields
  mutableElements: Record<string, string[]>; // DC name -> mutable elements
  logSources: Record<string, string[]>; // DC name -> log sources
  fullRequirements: AnalyticRequirement[];
}

export function aggregateAnswers(
  platform: string,
  answers: QuestionAnswer[]
): TelemetryProfile {
  const profile: TelemetryProfile = {
    platform,
    dataComponents: [],
    channels: [],
    expectedFields: {},
    mutableElements: {},
    logSources: {},
    fullRequirements: [],
  };

  const seenDCs = new Set<string>();
  const seenChannels = new Set<string>();

  for (const answer of answers) {
    if (!answer.answer || !answer.derivedRequirements) continue;

    for (const dcName of answer.derivedRequirements.dcNames) {
      if (seenDCs.has(dcName)) continue;
      seenDCs.add(dcName);

      const req = DC_ANALYTIC_REQUIREMENTS[dcName];
      if (!req) continue;

      profile.dataComponents.push(dcName);
      profile.expectedFields[dcName] = req.expectedCoreFields;
      profile.mutableElements[dcName] = req.defaultMutableElements;
      profile.logSources[dcName] = req.logSourcesToLookFor;
      profile.fullRequirements.push(req);

      if (!seenChannels.has(req.channel)) {
        seenChannels.add(req.channel);
        profile.channels.push(req.channel);
      }
    }
  }

  return profile;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED QUESTION SETS
// ═══════════════════════════════════════════════════════════════════════════

// Import the basic question sets and enhance them
import { WIZARD_QUESTION_SETS } from './wizard-questions';

/**
 * All question sets enhanced with full analytic requirement derivation
 */
export const ENHANCED_WIZARD_QUESTION_SETS: Record<string, EnhancedQuestionSet> = {};

// Enhance all existing question sets
for (const [key, basicSet] of Object.entries(WIZARD_QUESTION_SETS)) {
  ENHANCED_WIZARD_QUESTION_SETS[key] = enhanceQuestionSet(basicSet);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXAMPLE USAGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example: Get an enhanced question and show what fields are expected
 *
 * @example
 * ```typescript
 * const windowsSet = ENHANCED_WIZARD_QUESTION_SETS['Windows'];
 * const authQuestion = windowsSet.categories[0].questions[0];
 *
 * console.log(authQuestion.text);
 * // "Does the data source record authentication attempts (success/failure)...?"
 *
 * console.log(authQuestion.primaryChannel);
 * // "Authentication telemetry"
 *
 * console.log(authQuestion.combinedExpectedFields);
 * // ["user/account identifier", "timestamp", "outcome (success/failure)", ...]
 *
 * console.log(authQuestion.combinedMutableElements);
 * // ["source IP (NAT/VPN)", "user agent/device ID", ...]
 *
 * console.log(authQuestion.combinedLogSources);
 * // ["OS auth logs", "IdP sign-in logs", "VPN auth logs", ...]
 * ```
 */

/**
 * Example: Process user answers and build a telemetry profile
 *
 * @example
 * ```typescript
 * const windowsSet = ENHANCED_WIZARD_QUESTION_SETS['Windows'];
 * const answers: QuestionAnswer[] = [];
 *
 * // User answers "Yes" to authentication question
 * const authQ = windowsSet.categories[0].questions[0];
 * answers.push(processAnswer(authQ, true));
 *
 * // User answers "Yes" to process creation question
 * const procQ = windowsSet.categories[1].questions[0];
 * answers.push(processAnswer(procQ, true));
 *
 * // Build complete profile
 * const profile = aggregateAnswers('Windows', answers);
 *
 * console.log(profile.dataComponents);
 * // ["User Account Authentication", "Process Creation", "Process Termination", "Process Metadata"]
 *
 * console.log(profile.channels);
 * // ["Authentication telemetry", "Endpoint process telemetry", "Endpoint process enrichment"]
 * ```
 */

export default ENHANCED_WIZARD_QUESTION_SETS;
