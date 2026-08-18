import {
  ASSESSMENT_SCHEMA_VERSION,
  AssessmentJob,
  AssessmentRecord,
  CATEGORY_SCHEMA_VERSION,
  HARD_RULE_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  ProvisionalAssessmentResult,
  OrganizerAssessmentSummary,
  ResourceRecommendation,
  RiskAssessment,
  RiskLevel,
  hirarcRiskLevelFor,
  riskLevelFor,
} from '@shared/types';
import { RESOURCE_FIELDS } from './m2Presentation';

const EXPECTED_CATEGORY_IDS = new Set([
  'crowd', 'venue_fire', 'weather_environment', 'public_health',
  'food_water_sanitation', 'medical_capacity', 'security_cbrn', 'transport_accessibility',
]);
const EXPECTED_CATEGORY_WEIGHT = 0.125;

export function isCurrentRiskAssessment(value: unknown): value is RiskAssessment {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RiskAssessment>;
  if (record.schemaVersion !== ASSESSMENT_SCHEMA_VERSION) return false;
  if (!['manual_review_required', 'provisional_ready', 'authority_review', 'official_ready'].includes(record.status ?? '')) return false;
  if (!record.contextSnapshot?.weather || !record.contextSnapshot.calendar || !record.contextSnapshot.venue || !record.contextSnapshot.incidentHistory) return false;
  if (!Array.isArray(record.evidence) || !Array.isArray(record.warnings)) return false;
  if (record.status === 'manual_review_required') return typeof record.manualReviewReason === 'string';
  const calculated = record as Partial<RiskAssessment & { provisionalResult: ProvisionalAssessmentResult }>;
  if (record.aiProposal?.status !== 'success'
    || typeof record.aiProposal.proposalId !== 'string'
    || record.aiProposal.proposalId.trim().length === 0
    || !isCalculatedResult(calculated.provisionalResult, record.aiProposal.proposalId)) return false;
  if (record.status !== 'official_ready') return true;
  return isCalculatedResult(record.officialResult, record.aiProposal.proposalId)
    && Number.isFinite(record.officialResult.finalizedAt)
    && typeof record.officialResult.finalizedBy === 'string'
    && record.officialResult.finalizedBy.trim().length > 0;
}

export function isCurrentAssessmentJob(value: unknown): value is AssessmentJob {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<AssessmentJob>;
  return (record.status === 'processing' || record.status === 'failed')
    && typeof record.assessmentId === 'string'
    && typeof record.eventId === 'string'
    && typeof record.versionId === 'string'
    && typeof record.inputHash === 'string'
    && typeof record.claimId === 'string'
    && typeof record.claimedAt === 'number'
    && typeof record.leaseExpiresAt === 'number'
    && typeof record.createdAt === 'number';
}

export function isCurrentAssessmentRecord(value: unknown): value is AssessmentRecord {
  return isCurrentRiskAssessment(value) || isCurrentAssessmentJob(value);
}

export function isOrganizerAssessmentSummary(value: unknown): value is OrganizerAssessmentSummary {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== ASSESSMENT_SCHEMA_VERSION
    || typeof value.assessmentId !== 'string' || !value.assessmentId
    || typeof value.eventId !== 'string' || !value.eventId
    || typeof value.versionId !== 'string' || !value.versionId
    || !['manual_review_required', 'provisional_ready', 'authority_review', 'official_ready', 'failed'].includes(String(value.status))
    || typeof value.authorityReviewRequired !== 'boolean'
    || typeof value.computedAt !== 'number' || !Number.isFinite(value.computedAt)
    || !Array.isArray(value.categories)
    || !value.categories.every((category) => isRecord(category)
      && typeof category.categoryId === 'string'
      && typeof category.categoryName === 'string'
      && typeof category.normalizedScore === 'number'
      && Number.isFinite(category.normalizedScore)
      && category.normalizedScore >= 0 && category.normalizedScore <= 100
      && ['Low', 'Medium', 'High'].includes(String(category.riskLevel)))) return false;
  const calculatedStatus = ['provisional_ready', 'authority_review', 'official_ready'].includes(String(value.status));
  if (calculatedStatus) {
    if (typeof value.overallScore !== 'number' || !Number.isFinite(value.overallScore)
      || !['Low', 'Medium', 'High'].includes(String(value.overallRiskLevel))) return false;
    const ids = value.categories.map((category) => category.categoryId);
    if (ids.length !== EXPECTED_CATEGORY_IDS.size
      || new Set(ids).size !== ids.length
      || !ids.every((id) => EXPECTED_CATEGORY_IDS.has(id))) return false;
    let weightedScore = 0;
    let highestRisk: RiskLevel = 'Low';
    for (const category of value.categories) {
      const matrixScore = category.normalizedScore / 4;
      if (!Number.isInteger(matrixScore) || matrixScore < 1 || matrixScore > 25
        || category.riskLevel !== hirarcRiskLevelFor(matrixScore)) return false;
      weightedScore += category.normalizedScore * EXPECTED_CATEGORY_WEIGHT;
      highestRisk = higherRisk(highestRisk, category.riskLevel as RiskLevel);
    }
    const score = round(weightedScore);
    if (value.overallScore !== score
      || value.overallRiskLevel !== higherRisk(riskLevelFor(score), highestRisk)) return false;
  } else if (value.overallScore !== undefined
    || value.overallRiskLevel !== undefined
    || value.categories.length !== 0
    || value.resourceQuantities !== undefined) {
    return false;
  }
  if (value.resourceQuantities !== undefined) {
    const quantities = value.resourceQuantities;
    if (!isRecord(quantities)
      || !RESOURCE_FIELDS.every(({ key }) => Number.isSafeInteger(quantities[key])
        && Number(quantities[key]) >= 0)) return false;
  }
  return true;
}

export function hasCalculatedAssessment(
  assessment: RiskAssessment | undefined | null,
): assessment is RiskAssessment & { provisionalResult: ProvisionalAssessmentResult } {
  return Boolean(assessment && 'provisionalResult' in assessment);
}

export function assessmentResult(assessment: RiskAssessment): ProvisionalAssessmentResult | undefined {
  if (assessment.status === 'official_ready') return assessment.officialResult;
  return 'provisionalResult' in assessment ? assessment.provisionalResult : undefined;
}

export function assessmentRiskLevel(assessment?: RiskAssessment): RiskLevel | undefined {
  return assessment ? assessmentResult(assessment)?.overallRiskLevel : undefined;
}

export function assessmentScore(assessment?: RiskAssessment): number | undefined {
  return assessment ? assessmentResult(assessment)?.overallScore : undefined;
}

export function isCurrentResourceRecommendation(value: unknown): value is ResourceRecommendation {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ResourceRecommendation>;
  return RESOURCE_FIELDS.every(({ key }) => Number.isInteger(record[key]) && Number(record[key]) >= 0)
    && typeof record.formulaVersion === 'string'
    && typeof record.guidelineVersion === 'string'
    && Boolean(record.rationales)
    && (record.assessmentStage === 'provisional' || record.assessmentStage === 'official')
    && Array.isArray(record.aiConsiderations);
}

function isCalculatedResult(value: unknown, proposalId: string): value is ProvisionalAssessmentResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<ProvisionalAssessmentResult>;
  if (result.proposalId !== proposalId
    || !Array.isArray(result.validatedHazards)
    || !Array.isArray(result.categories)
    || result.categories.length !== 8
    || typeof result.overallScore !== 'number'
    || !Number.isFinite(result.overallScore)
    || result.overallScore < 0
    || result.overallScore > 100
    || result.formulaVersion !== PROVISIONAL_FORMULA_VERSION
    || result.categorySchemaVersion !== CATEGORY_SCHEMA_VERSION
    || result.hardRuleVersion !== HARD_RULE_VERSION
    || typeof result.calculatedAt !== 'number'
    || !Number.isFinite(result.calculatedAt)) return false;
  if (!result.categories.every(isRecord)) return false;
  const categoryIds = result.categories.map((category) => category.categoryId);
  if (new Set(categoryIds).size !== categoryIds.length
    || !categoryIds.every((categoryId) => EXPECTED_CATEGORY_IDS.has(categoryId))) return false;
  let weightedScore = 0;
  let highestCategoryRiskLevel: RiskLevel = 'Low';
  for (const category of result.categories) {
    if (!Number.isInteger(category.validatedLikelihood)
      || category.validatedLikelihood < 1 || category.validatedLikelihood > 5) return false;
    if (!Number.isInteger(category.validatedSeverity)
      || category.validatedSeverity < 1 || category.validatedSeverity > 5
      || category.matrixScore !== category.validatedLikelihood * category.validatedSeverity
      || category.normalizedScore !== category.matrixScore * 4
      || category.weight !== EXPECTED_CATEGORY_WEIGHT
      || category.weightedContribution !== round(category.normalizedScore * category.weight)
      || category.riskLevel !== hirarcRiskLevelFor(category.matrixScore)) return false;
    weightedScore += category.normalizedScore * category.weight;
    highestCategoryRiskLevel = higherRisk(highestCategoryRiskLevel, category.riskLevel);
  }
  const overallScore = round(weightedScore);
  const weightedRiskLevel = riskLevelFor(overallScore);
  return result.overallScore === overallScore
    && result.weightedRiskLevel === weightedRiskLevel
    && result.highestCategoryRiskLevel === highestCategoryRiskLevel
    && result.overallRiskLevel === higherRisk(weightedRiskLevel, highestCategoryRiskLevel);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function higherRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  const order: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2 };
  return order[left] >= order[right] ? left : right;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
