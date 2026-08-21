import { createHash } from 'node:crypto';
import {
  AdminManualAssessment,
  AdminManualCategoryInput,
  AdminManualHazard,
  CATEGORY_SCHEMA_VERSION,
  EventDetails,
  EventRecord,
  HARD_RULE_VERSION,
  hirarcRiskLevelFor,
  MANUAL_ASSESSMENT_SCHEMA_VERSION,
  MANUAL_OFFICIAL_FORMULA_VERSION,
  ManualOfficialAssessmentResult,
  ManualReviewRiskAssessment,
  riskLevelFor,
  ScoreEvidence,
  ScoreRating,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { computeCategoryBasedAssessment } from './ruleBased';
import { evaluateCategoryHardRules } from './hardRuleEvaluator';
import { stableStringify, validateManualOfficialAssessmentResult } from './resourceCalculator';

const CATEGORY_IDS = ACTIVE_CATEGORY_SCHEMA.categories.map((category) => category.id);

export interface ManualAssessmentInput {
  hazards: AdminManualHazard[];
  categories: AdminManualCategoryInput[];
  rationale: string;
  idempotencyKey: string;
}

export function validateManualAssessmentInput(input: unknown, evidence: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ['input'];
  const hazards = input.hazards;
  const categories = input.categories;
  if (!Array.isArray(hazards) || hazards.length < 1 || hazards.length > 40) errors.push('hazard-count');
  if (!Array.isArray(categories) || categories.length !== CATEGORY_IDS.length) errors.push('category-count');
  if (!validText(input.rationale, 20, 2000)) errors.push('assessment-rationale');
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) errors.push('idempotency-key');
  const eligible = eligibleEvidenceKeys(evidence);
  const hazardIds = new Set<string>();
  if (Array.isArray(hazards)) for (const raw of hazards) {
    if (!isRecord(raw)
      || !validText(raw.hazardId, 1, 100) || hazardIds.has(raw.hazardId as string)
      || !validText(raw.hazardName, 3, 200)
      || !CATEGORY_IDS.includes(raw.categoryId as never)
      || !validEvidenceReferences(raw.evidenceReferences, eligible, eligible.size > 0)
      || !validText(raw.rationale, 10, 1000)) errors.push('hazard');
    else hazardIds.add(raw.hazardId as string);
  }
  const seen = new Set<string>();
  if (Array.isArray(categories)) for (const raw of categories) {
    if (!isRecord(raw) || !CATEGORY_IDS.includes(raw.categoryId as never) || seen.has(raw.categoryId as string)) {
      errors.push('category');
      continue;
    }
    seen.add(raw.categoryId as string);
    if (!isScore(raw.likelihood) || !isScore(raw.severity)) errors.push(`score-${raw.categoryId}`);
    if (!validText(raw.rationale, 10, 1000)) errors.push(`rationale-${raw.categoryId}`);
    if (!validEvidenceReferences(raw.evidenceReferences, eligible, false)) errors.push(`evidence-${raw.categoryId}`);
    const refs = Array.isArray(raw.evidenceReferences) ? raw.evidenceReferences : [];
    if (refs.length === 0 && !validText(raw.missingInformation, 10, 1000)) errors.push(`missing-information-${raw.categoryId}`);
    if (refs.length > 0 && (typeof raw.missingInformation !== 'string' || raw.missingInformation.length > 1000)) errors.push(`missing-information-${raw.categoryId}`);
  }
  if (CATEGORY_IDS.some((categoryId) => !seen.has(categoryId))) errors.push('missing-category');
  return [...new Set(errors)];
}

export function buildManualAssessment(args: {
  assessment: ManualReviewRiskAssessment;
  eventVersionInputHash: string;
  submittedBy: string;
  manualAssessmentId: string;
  input: ManualAssessmentInput;
  createdAt: number;
}): AdminManualAssessment {
  const errors = validateManualAssessmentInput(args.input, args.assessment.evidence);
  if (errors.length) throw new Error(`invalid-manual-assessment:${errors.join(',')}`);
  return {
    manualAssessmentId: args.manualAssessmentId,
    schemaVersion: MANUAL_ASSESSMENT_SCHEMA_VERSION,
    eventId: args.assessment.eventId,
    versionId: args.assessment.versionId,
    assessmentId: args.assessment.assessmentId,
    assessmentInputHash: args.assessment.inputHash,
    eventVersionInputHash: args.eventVersionInputHash,
    categorySchemaVersion: CATEGORY_SCHEMA_VERSION,
    hardRuleVersion: HARD_RULE_VERSION,
    officialFormulaVersion: MANUAL_OFFICIAL_FORMULA_VERSION,
    hazards: args.input.hazards.map((hazard) => ({ ...hazard, evidenceReferences: [...hazard.evidenceReferences], rationale: hazard.rationale.trim(), hazardName: hazard.hazardName.trim() })),
    categories: args.input.categories.map((category) => ({ ...category, evidenceReferences: [...category.evidenceReferences], rationale: category.rationale.trim(), missingInformation: category.missingInformation.trim() })),
    rationale: args.input.rationale.trim(),
    submittedBy: args.submittedBy,
    idempotencyKey: args.input.idempotencyKey,
    createdAt: args.createdAt,
  };
}

export function buildManualOfficialAssessmentResult(args: {
  assessment: ManualReviewRiskAssessment;
  manualAssessment: AdminManualAssessment;
  eventDetails: EventDetails;
  eventVersionInputHash: string;
  finalizedAt: number;
  finalizedBy: string;
}): ManualOfficialAssessmentResult {
  const { assessment, manualAssessment, eventDetails, eventVersionInputHash, finalizedAt, finalizedBy } = args;
  assertManualRecordIdentity(assessment, manualAssessment, eventVersionInputHash, finalizedBy);
  const validation = validateManualAssessmentInput(manualAssessment, assessment.evidence);
  if (validation.length) throw new Error(`invalid-manual-assessment:${validation.join(',')}`);
  const baseline = computeCategoryBasedAssessment(
    { eventId: assessment.eventId, eventDetails } as EventRecord,
    assessment.contextSnapshot,
    assessment.createdAt,
  );
  const constraints = new Map(evaluateCategoryHardRules(baseline).map((constraint) => [constraint.categoryId, constraint]));
  const inputs = new Map(manualAssessment.categories.map((category) => [category.categoryId, category]));
  let weightedScore = 0;
  let highestCategoryRiskLevel: ManualOfficialAssessmentResult['highestCategoryRiskLevel'] = 'Low';
  const categories = ACTIVE_CATEGORY_SCHEMA.categories.map((definition) => {
    const input = inputs.get(definition.id)!;
    const constraint = constraints.get(definition.id);
    if (!input || !constraint) throw new Error(`missing-manual-category:${definition.id}`);
    const validatedLikelihood = Math.max(input.likelihood, constraint.likelihoodFloor) as ScoreRating;
    const validatedSeverity = Math.max(input.severity, constraint.severityFloor) as ScoreRating;
    const appliedHardRules = [];
    if (validatedLikelihood > input.likelihood) appliedHardRules.push({
      ruleId: `${constraint.ruleId}.likelihood`, categoryId: definition.id, axis: 'likelihood' as const,
      proposedValue: input.likelihood, constrainedValue: validatedLikelihood,
      rationale: `${constraint.rationale} The likelihood floor is ${constraint.likelihoodFloor}.`,
      guidelineReferences: [...constraint.guidelineReferences],
    });
    if (validatedSeverity > input.severity) appliedHardRules.push({
      ruleId: `${constraint.ruleId}.severity`, categoryId: definition.id, axis: 'severity' as const,
      proposedValue: input.severity, constrainedValue: validatedSeverity,
      rationale: `${constraint.rationale} The severity floor is ${constraint.severityFloor}.`,
      guidelineReferences: [...constraint.guidelineReferences],
    });
    const matrixScore = validatedLikelihood * validatedSeverity;
    const normalizedScore = matrixScore * 4;
    const weightedContribution = round(normalizedScore * definition.weight);
    const riskLevel = hirarcRiskLevelFor(matrixScore);
    weightedScore += normalizedScore * definition.weight;
    highestCategoryRiskLevel = higherRisk(highestCategoryRiskLevel, riskLevel);
    return {
      categoryId: definition.id, categoryName: definition.name,
      manualLikelihood: input.likelihood, manualSeverity: input.severity,
      validatedLikelihood, validatedSeverity, matrixScore, normalizedScore, riskLevel,
      weight: definition.weight, weightedContribution,
      evidenceReferences: [...input.evidenceReferences], rationale: input.rationale,
      missingInformation: input.missingInformation, appliedHardRules,
      guidelineChecks: [...definition.guidelineChecks],
    };
  });
  const overallScore = round(weightedScore);
  const weightedRiskLevel = riskLevelFor(overallScore);
  const officialInputHash = createHash('sha256').update(stableStringify({
    formulaVersion: MANUAL_OFFICIAL_FORMULA_VERSION,
    categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    hardRuleVersion: HARD_RULE_VERSION,
    assessmentSchemaVersion: assessment.schemaVersion,
    assessmentInputHash: assessment.inputHash,
    eventVersionInputHash: manualAssessment.eventVersionInputHash,
    eventDetails,
    aiAttempt: assessment.aiProposal,
    contextSnapshot: assessment.contextSnapshot,
    evidence: assessment.evidence,
    manualAssessment,
  })).digest('hex');
  const result: ManualOfficialAssessmentResult = {
    sourceKind: 'admin_manual', manualAssessmentId: manualAssessment.manualAssessmentId,
    manualHazards: manualAssessment.hazards.map((hazard) => ({ ...hazard, evidenceReferences: [...hazard.evidenceReferences] })),
    categories, overallScore, weightedRiskLevel, highestCategoryRiskLevel,
    overallRiskLevel: higherRisk(weightedRiskLevel, highestCategoryRiskLevel),
    formulaVersion: MANUAL_OFFICIAL_FORMULA_VERSION,
    categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    hardRuleVersion: HARD_RULE_VERSION,
    officialInputHash, calculatedAt: finalizedAt, finalizedAt, finalizedBy,
  };
  const resultErrors = validateManualOfficialAssessmentResult(result);
  if (resultErrors.length) throw new Error(`invalid-manual-official-result:${resultErrors.join(',')}`);
  return result;
}

export function sameManualAssessment(stored: AdminManualAssessment, proposed: AdminManualAssessment): boolean {
  return stableStringify(stored) === stableStringify(proposed);
}

export function isManualAssessmentSourceEligible(assessment: Pick<ManualReviewRiskAssessment, 'aiProposal' | 'assessmentReadiness'>): boolean {
  if (assessment.aiProposal === null) return assessment.assessmentReadiness === 'insufficient_data';
  if (!isRecord(assessment.aiProposal)) return false;
  const attempt = assessment.aiProposal;
  if (attempt.status === 'success' || !['unavailable', 'timeout', 'invalid'].includes(String(attempt.status))) return false;
  return typeof attempt.model === 'string' && Boolean(attempt.model.trim())
    && typeof attempt.promptVersion === 'string' && Boolean(attempt.promptVersion.trim())
    && typeof attempt.responseSchemaVersion === 'string' && Boolean(attempt.responseSchemaVersion.trim())
    && typeof attempt.retryable === 'boolean'
    && typeof attempt.errorSummary === 'string' && Boolean(attempt.errorSummary.trim())
    && attempt.cacheStatus === 'not-applicable'
    && Number.isFinite(attempt.generatedAt);
}

function assertManualRecordIdentity(assessment: ManualReviewRiskAssessment, manual: AdminManualAssessment, eventVersionInputHash: string, finalizedBy: string) {
  if (!isManualAssessmentSourceEligible(assessment)
    || manual.schemaVersion !== MANUAL_ASSESSMENT_SCHEMA_VERSION
    || !isSafeManualAssessmentId(manual.manualAssessmentId)
    || manual.eventId !== assessment.eventId || manual.versionId !== assessment.versionId
    || manual.assessmentId !== assessment.assessmentId || manual.assessmentInputHash !== assessment.inputHash
    || typeof eventVersionInputHash !== 'string' || !eventVersionInputHash
    || manual.eventVersionInputHash !== eventVersionInputHash
    || manual.categorySchemaVersion !== CATEGORY_SCHEMA_VERSION || manual.hardRuleVersion !== HARD_RULE_VERSION
    || manual.officialFormulaVersion !== MANUAL_OFFICIAL_FORMULA_VERSION
    || typeof manual.submittedBy !== 'string' || !manual.submittedBy
    || typeof finalizedBy !== 'string' || !finalizedBy
    || !Number.isFinite(manual.createdAt)) throw new Error('manual-assessment-identity-mismatch');
}

function isSafeManualAssessmentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function eligibleEvidenceKeys(evidence: unknown): Set<string> {
  if (!Array.isArray(evidence)) return new Set();
  return new Set((evidence as ScoreEvidence[]).filter((item) => item && item.quality !== 'missing'
    && typeof item.status === 'string'
    && !['unavailable', 'unmatched', 'missing'].includes(item.status.trim().toLowerCase()))
    .map((item) => item.key));
}

function validEvidenceReferences(value: unknown, eligible: Set<string>, requireOne: boolean): boolean {
  return Array.isArray(value) && (!requireOne || value.length > 0)
    && new Set(value).size === value.length
    && value.every((reference) => typeof reference === 'string' && eligible.has(reference));
}

function validText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

function isScore(value: unknown): value is ScoreRating {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function round(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function higherRisk(left: ManualOfficialAssessmentResult['overallRiskLevel'], right: ManualOfficialAssessmentResult['overallRiskLevel']) {
  const rank = { Low: 0, Medium: 1, High: 2 };
  return rank[left] >= rank[right] ? left : right;
}
