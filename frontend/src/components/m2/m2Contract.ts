import {
  ASSESSMENT_SCHEMA_VERSION,
  AssessmentJob,
  AssessmentRecord,
  CATEGORY_SCHEMA_VERSION,
  HARD_RULE_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  ProvisionalAssessmentResult,
  OrganizerAssessmentSummary,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
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
const AUTHORITY_TYPES = new Set(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);

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
    || value.resourceQuantities !== undefined
    || value.resourceRecommendation !== undefined) {
    return false;
  }
  if (value.resourceQuantities !== undefined) {
    const quantities = value.resourceQuantities;
    if (!isRecord(quantities)
      || !RESOURCE_FIELDS.every(({ key }) => Number.isSafeInteger(quantities[key])
        && Number(quantities[key]) >= 0)) return false;
  }
  if ((value.resourceQuantities === undefined) !== (value.resourceRecommendation === undefined)) return false;
  if (value.resourceRecommendation !== undefined) {
    const resource = value.resourceRecommendation;
    if (!isRecord(resource)
      || typeof resource.resourceId !== 'string' || !resource.resourceId
      || !Number.isSafeInteger(resource.revision) || Number(resource.revision) < 1
      || !['provisional', 'official'].includes(String(resource.stage))
      || typeof resource.disclaimer !== 'string' || !resource.disclaimer
      || !isRecord(resource.items)) return false;
    const resourceItems = resource.items;
    const quantities = isRecord(value.resourceQuantities) ? value.resourceQuantities : undefined;
    if (Object.keys(resourceItems).length !== RESOURCE_KEYS.length
      || !RESOURCE_KEYS.every((key) => {
        const item = resourceItems[key];
        if (!isRecord(item)
          || !Number.isSafeInteger(item.baseline) || Number(item.baseline) < 0
          || !isRecord(item.planningRange)
          || item.planningRange.min !== item.baseline
          || !Number.isSafeInteger(item.planningRange.max)
          || Number(item.planningRange.max) < Number(item.baseline)) return false;
        return quantities === undefined || quantities[key] === item.baseline;
      })) return false;
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
  if (!isRecord(value)) return false;
  if (RESOURCE_KEYS.some((key) => key in value) || 'rationales' in value || Array.isArray(value.items)) return false;
  if (value.schemaVersion !== RESOURCE_SCHEMA_VERSION
    || typeof value.resourceId !== 'string' || !value.resourceId
    || typeof value.eventId !== 'string' || !value.eventId
    || typeof value.versionId !== 'string' || !value.versionId
    || typeof value.assessmentId !== 'string' || !value.assessmentId
    || !['provisional', 'official'].includes(String(value.stage))
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !(value.supersedesResourceId === null || (typeof value.supersedesResourceId === 'string' && value.supersedesResourceId.length > 0))
    || ((value.revision === 1) !== (value.supersedesResourceId === null))
    || typeof value.resourceInputHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.resourceInputHash)
    || value.resourceId !== `${String(value.stage)}-${String(value.versionId)}-${String(value.resourceInputHash)}`
    || typeof value.formulaVersion !== 'string' || !value.formulaVersion
    || typeof value.configVersion !== 'string' || !value.configVersion
    || typeof value.sourceRegistryVersion !== 'string' || !value.sourceRegistryVersion
    || !['prototype', 'low', 'medium', 'authority_validated'].includes(String(value.confidenceLevel))
    || typeof value.authorityReviewRequired !== 'boolean'
    || typeof value.computedAt !== 'number' || !Number.isFinite(value.computedAt)
    || !isRecord(value.assessmentReference)
    || value.assessmentReference.stage !== value.stage
    || value.assessmentReference.assessmentId !== value.assessmentId
    || typeof value.assessmentReference.proposalId !== 'string' || !value.assessmentReference.proposalId
    || !isRecord(value.items)) return false;
  if (value.stage === 'official'
    && (value.confidenceLevel !== 'authority_validated'
      || value.authorityReviewRequired !== false
      || typeof value.assessmentReference.finalizedAt !== 'number'
      || !Number.isFinite(value.assessmentReference.finalizedAt)
      || typeof value.assessmentReference.finalizedBy !== 'string'
      || !value.assessmentReference.finalizedBy)) return false;
  if (value.stage === 'provisional'
    && (value.confidenceLevel === 'authority_validated' || value.authorityReviewRequired !== true)) return false;
  const itemKeys = Object.keys(value.items);
  if (itemKeys.length !== RESOURCE_KEYS.length
    || !itemKeys.every((key) => (RESOURCE_KEYS as readonly string[]).includes(key))) return false;
  const items = value.items;
  return RESOURCE_KEYS.every((key) => {
    const item = items[key];
    return isRecord(item)
      && isResourceItem(item, key)
      && (value.stage !== 'official'
        || (item.confidence === 'authority_validated'
          && item.authorityReviewRequired === false))
      && (value.stage !== 'provisional'
        || (item.confidence !== 'authority_validated'
          && item.authorityReviewRequired === true));
  });
}

function isResourceItem(value: unknown, expectedKey: string): boolean {
  if (!isRecord(value)
    || value.status !== 'ready'
    || value.resource !== expectedKey
    || !Number.isSafeInteger(value.baseline) || Number(value.baseline) < 0
    || !isRecord(value.planningRange)
    || !Number.isSafeInteger(value.planningRange.min)
    || !Number.isSafeInteger(value.planningRange.max)
    || value.planningRange.min !== value.baseline
    || Number(value.planningRange.max) < Number(value.planningRange.min)
    || !Array.isArray(value.inputReferences) || value.inputReferences.length === 0
    || !Array.isArray(value.assumptions) || value.assumptions.length === 0
    || !Array.isArray(value.appliedRules) || value.appliedRules.length === 0
    || !Array.isArray(value.sourceSnapshots) || value.sourceSnapshots.length === 0
    || !isRecord(value.authoritySource)
    || !['not_supplied', 'supplied'].includes(String(value.authoritySource.status))
    || !['prototype', 'low', 'medium', 'authority_validated'].includes(String(value.confidence))
    || !AUTHORITY_TYPES.has(String(value.reviewingAuthority))
    || typeof value.authorityReviewRequired !== 'boolean') return false;
  if (!hasUniqueIds(value.inputReferences, 'inputId') || !value.inputReferences.every((input) => isRecord(input)
    && typeof input.inputId === 'string' && Boolean(input.inputId)
    && ['event_field', 'assessment_overall', 'assessment_category'].includes(String(input.kind))
    && typeof input.path === 'string' && Boolean(input.path)
    && (typeof input.value === 'string' || typeof input.value === 'boolean'
      || (typeof input.value === 'number' && Number.isFinite(input.value))))) return false;
  if (!hasUniqueIds(value.assumptions, 'assumptionId') || !value.assumptions.every((assumption) => isRecord(assumption)
    && typeof assumption.assumptionId === 'string' && Boolean(assumption.assumptionId)
    && typeof assumption.statement === 'string' && Boolean(assumption.statement)
    && Array.isArray(assumption.sourceIds) && assumption.sourceIds.length > 0)) return false;
  if (!hasUniqueIds(value.appliedRules, 'ruleId') || !value.appliedRules.every((rule) => isRecord(rule)
    && typeof rule.ruleId === 'string' && Boolean(rule.ruleId)
    && typeof rule.description === 'string' && Boolean(rule.description)
    && Array.isArray(rule.inputReferenceIds) && rule.inputReferenceIds.length > 0
    && Array.isArray(rule.sourceIds) && rule.sourceIds.length > 0
    && Number.isSafeInteger(rule.contribution) && Number(rule.contribution) >= 0)) return false;
  if (!hasUniqueIds(value.sourceSnapshots, 'sourceId') || !value.sourceSnapshots.every(isResourceSource)) return false;
  const inputIds = new Set(value.inputReferences.map((input) => input.inputId));
  const sourceIds = new Set(value.sourceSnapshots.map((source) => source.sourceId));
  if (!value.assumptions.every((assumption) => assumption.sourceIds.every(
    (sourceId: unknown) => typeof sourceId === 'string' && sourceIds.has(sourceId),
  ))) return false;
  if (!value.appliedRules.every((rule) => rule.inputReferenceIds.every(
    (inputId: unknown) => typeof inputId === 'string' && inputIds.has(inputId),
  ) && rule.sourceIds.every(
    (sourceId: unknown) => typeof sourceId === 'string' && sourceIds.has(sourceId),
  ))) return false;
  if (value.authoritySource.status === 'not_supplied') {
    return typeof value.authoritySource.reason === 'string' && Boolean(value.authoritySource.reason);
  }
  const authoritySource = value.authoritySource.source;
  if (!(isResourceSource(authoritySource)
    && authoritySource.verificationStatus === 'verified'
    && (authoritySource.kind === 'law' || authoritySource.kind === 'official_guidance'))) return false;
  const authoritySourceId = authoritySource.sourceId;
  const canonicalSnapshot = value.sourceSnapshots.find((source) => source.sourceId === authoritySourceId);
  return sourceIds.has(authoritySourceId)
    && stableValue(canonicalSnapshot) === stableValue(authoritySource)
    && (value.assumptions.some((assumption) => assumption.sourceIds.includes(authoritySourceId))
      || value.appliedRules.some((rule) => rule.sourceIds.includes(authoritySourceId)));
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hasUniqueIds(values: unknown[], field: string): boolean {
  const ids = values.map((value) => isRecord(value) ? value[field] : undefined);
  return ids.every((id) => typeof id === 'string' && id.length > 0) && new Set(ids).size === ids.length;
}

function isResourceSource(source: unknown): source is Record<string, unknown> {
  if (!isRecord(source)) return false;
  if (typeof source.sourceId !== 'string' || !source.sourceId
    || typeof source.title !== 'string' || !source.title
    || typeof source.issuer !== 'string' || !source.issuer
    || typeof source.locator !== 'string' || !source.locator
    || typeof source.version !== 'string' || !source.version
    || typeof source.retrievedAt !== 'number' || !Number.isFinite(source.retrievedAt) || source.retrievedAt < 0
    || !['internal_prototype', 'law', 'official_guidance', 'voluntary_standard'].includes(String(source.kind))
    || !['prototype_unverified', 'verified'].includes(String(source.verificationStatus))) return false;
  return source.verificationStatus !== 'prototype_unverified' || source.kind === 'internal_prototype';
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
