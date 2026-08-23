import {
  ASSESSMENT_SCHEMA_VERSION,
  AssessmentJob,
  AssessmentRecord,
  AuthorityDecision,
  AuthorityScoreResolution,
  AuthorityScoreReview,
  AuthorityReviewState,
  CATEGORY_SCHEMA_VERSION,
  CalculatedAssessmentResult,
  HARD_RULE_VERSION,
  MANUAL_OFFICIAL_FORMULA_VERSION,
  OFFICIAL_FORMULA_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  ProvisionalAssessmentResult,
  EventRecord,
  EventVersion,
  OrganizerAssessmentSummary,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  ResourceRecommendation,
  RiskAssessment,
  RiskLevel,
  SCORE_RESOLUTION_SCHEMA_VERSION,
  SCORE_REVIEW_SCHEMA_VERSION,
  hirarcRiskLevelFor,
  riskLevelFor,
} from '@shared/types';
import { RESOURCE_FIELDS } from './m2Presentation';

const EXPECTED_CATEGORY_IDS = new Set([
  'crowd', 'venue_fire', 'weather_environment', 'public_health',
  'food_water_sanitation', 'medical_capacity', 'security_cbrn', 'transport_accessibility',
]);
const EXPECTED_CATEGORY_NAMES: Record<string, string> = {
  crowd: 'Crowd safety',
  venue_fire: 'Venue, fire and structural safety',
  weather_environment: 'Weather and environmental exposure',
  public_health: 'Public health and epidemiology',
  food_water_sanitation: 'Food, water and sanitation',
  medical_capacity: 'Medical and health-system capacity',
  security_cbrn: 'Security, behaviour and CBRN',
  transport_accessibility: 'Transport and accessibility',
};
const EXPECTED_CATEGORY_WEIGHT = 0.125;
const AUTHORITY_TYPES = new Set(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);
const EVENT_TYPES = new Set(['concert', 'festival', 'sports', 'cultural', 'religious', 'exhibition', 'fair', 'conference', 'other']);
const EVENT_ENVIRONMENTS = new Set(['indoor', 'outdoor', 'mixed']);
const VENUE_COVERAGES = new Set(['covered', 'partially_covered', 'uncovered']);
const SEATING_TYPES = new Set(['seated', 'standing', 'mixed']);

export interface ReviewIdentity {
  eventId?: string;
  versionId?: string;
  assessmentId?: string;
}

export function isSafeManualAssessmentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/**
 * Runtime guard for event documents consumed by authority/admin M2 views.
 * Firestore data is untrusted at the UI boundary; callers must not cast a
 * malformed event and then dereference eventDetails or assignment fields.
 */
export function isCurrentEventRecord(value: unknown, expectedEventId?: string): value is EventRecord {
  if (!isRecord(value)
    || typeof value.eventId !== 'string' || !value.eventId.trim()
    || (expectedEventId !== undefined && value.eventId !== expectedEventId)
    || typeof value.organizerId !== 'string' || !value.organizerId.trim()
    || !['Draft', 'Pending', 'UnderReview', 'Approved', 'Rejected', 'Withdrawn', 'Manual Review Required'].includes(String(value.status))
    || !Number.isSafeInteger(value.currentVersionNumber) || Number(value.currentVersionNumber) < 0
    || !Array.isArray(value.draftDocumentPaths)
    || !value.draftDocumentPaths.every((path) => typeof path === 'string')
    || !Array.isArray(value.requiredAuthorities)
    || (value.requiredAuthorities.length === 0 && value.status !== 'Draft')
    || new Set(value.requiredAuthorities).size !== value.requiredAuthorities.length
    || !value.requiredAuthorities.every((authority) => AUTHORITY_TYPES.has(String(authority)))
    || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)
    || !isEventDetails(value.eventDetails)) return false;
  const optionalIdentifiers = ['currentVersionId', 'currentAssessmentId', 'currentResourceId', 'editableVersionId'] as const;
  return optionalIdentifiers.every((field) => value[field] === undefined || value[field] === null || isSafeDocumentId(value[field]));
}

export function isCurrentEventVersion(value: unknown, expectedEventId?: string, expectedVersionId?: string): value is EventVersion {
  return isRecord(value)
    && isSafeDocumentId(value.versionId)
    && (expectedVersionId === undefined || value.versionId === expectedVersionId)
    && typeof value.eventId === 'string' && value.eventId.trim().length > 0
    && (expectedEventId === undefined || value.eventId === expectedEventId)
    && Number.isSafeInteger(value.versionNumber) && Number(value.versionNumber) >= 1
    && isEventDetails(value.eventDetails)
    && Array.isArray(value.documentPaths) && value.documentPaths.every((path) => typeof path === 'string')
    && typeof value.submittedBy === 'string' && value.submittedBy.trim().length > 0
    && Number.isFinite(value.submittedAt) && Number(value.submittedAt) >= 0
    && typeof value.inputHash === 'string' && /^[a-f0-9]{64}$/.test(value.inputHash)
    && (value.supersededAt === undefined || (typeof value.supersededAt === 'number' && Number.isFinite(value.supersededAt) && value.supersededAt >= 0));
}

export function isCurrentAuthorityDecision(value: unknown, expectedEventId?: string, expectedDecisionId?: string): value is AuthorityDecision {
  return isRecord(value)
    && typeof value.decisionId === 'string' && value.decisionId.trim().length > 0
    && (expectedDecisionId === undefined || value.decisionId === expectedDecisionId)
    && typeof value.eventId === 'string' && value.eventId.trim().length > 0
    && (expectedEventId === undefined || value.eventId === expectedEventId)
    && isSafeDocumentId(value.versionId)
    && AUTHORITY_TYPES.has(String(value.authorityType))
    && ['Approved', 'Rejected'].includes(String(value.decision))
    && typeof value.rationale === 'string' && value.rationale.trim().length >= 10
    && (value.suggestion === undefined || (typeof value.suggestion === 'string' && value.suggestion.trim().length >= 10))
    && (value.materialsReviewed === undefined || typeof value.materialsReviewed === 'boolean')
    && typeof value.reviewerId === 'string' && value.reviewerId.trim().length > 0
    && Number.isFinite(value.decidedAt) && Number(value.decidedAt) >= 0
    && typeof value.current === 'boolean';
}

function isEventDetails(value: unknown): value is EventRecord['eventDetails'] {
  if (!isRecord(value)
    || typeof value.name !== 'string' || !value.name.trim()
    || !EVENT_TYPES.has(String(value.type))
    || typeof value.venueName !== 'string' || !value.venueName.trim()
    || typeof value.venueAddress !== 'string' || !value.venueAddress.trim()
    || !Number.isFinite(value.venueCapacity) || Number(value.venueCapacity) < 0
    || !Number.isFinite(value.expectedAttendance) || Number(value.expectedAttendance) < 0
    || !EVENT_ENVIRONMENTS.has(String(value.environment))
    || !VENUE_COVERAGES.has(String(value.coverage))
    || !SEATING_TYPES.has(String(value.seating))
    || !Number.isFinite(value.startDatetime) || !Number.isFinite(value.endDatetime)
    || Number(value.endDatetime) < Number(value.startDatetime)
    || typeof value.emergencyPlanSummary !== 'string'
    || typeof value.organizerName !== 'string' || !value.organizerName.trim()
    || typeof value.organizerEmail !== 'string' || !value.organizerEmail.trim()
    || typeof value.organizerPhone !== 'string' || !value.organizerPhone.trim()) return false;
  return true;
}

function isSafeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function isAuthorityScoreReview(
  value: unknown,
  expectedReviewId?: string,
  identity: ReviewIdentity = {},
): value is AuthorityScoreReview {
  if (!isRecord(value)
    || value.schemaVersion !== SCORE_REVIEW_SCHEMA_VERSION
    || typeof value.reviewId !== 'string' || !value.reviewId.trim()
    || (expectedReviewId !== undefined && value.reviewId !== expectedReviewId)
    || typeof value.eventId !== 'string' || !value.eventId.trim()
    || (identity.eventId !== undefined && value.eventId !== identity.eventId)
    || typeof value.versionId !== 'string' || !value.versionId.trim()
    || (identity.versionId !== undefined && value.versionId !== identity.versionId)
    || typeof value.assessmentId !== 'string' || !value.assessmentId.trim()
    || (identity.assessmentId !== undefined && value.assessmentId !== identity.assessmentId)
    || typeof value.proposalId !== 'string' || !value.proposalId.trim()
    || typeof value.assessmentInputHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.assessmentInputHash)
    || value.categorySchemaVersion !== CATEGORY_SCHEMA_VERSION
    || !AUTHORITY_TYPES.has(String(value.authorityType))
    || typeof value.reviewerId !== 'string' || !value.reviewerId.trim()
    || typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim()
    || !Number.isFinite(value.provisionalCalculatedAt) || !Number.isFinite(value.createdAt)
    || typeof value.rationale !== 'string' || value.rationale.trim().length < 10
    || !Array.isArray(value.categories) || value.categories.length !== EXPECTED_CATEGORY_IDS.size) return false;
  const seen = new Set<string>();
  return value.categories.every((category) => {
    if (!isRecord(category)
      || typeof category.categoryId !== 'string'
      || !EXPECTED_CATEGORY_IDS.has(category.categoryId)
      || seen.has(category.categoryId)
      || !Number.isInteger(category.likelihood) || Number(category.likelihood) < 1 || Number(category.likelihood) > 5
      || !Number.isInteger(category.severity) || Number(category.severity) < 1 || Number(category.severity) > 5) return false;
    seen.add(category.categoryId);
    return category.decision === 'confirmed'
      || (category.decision === 'overridden' && typeof category.reason === 'string' && category.reason.trim().length >= 10);
  }) && (value.supersedesReviewId === undefined
    || (typeof value.supersedesReviewId === 'string' && Boolean(value.supersedesReviewId.trim())));
}

export function isAuthorityScoreResolution(
  value: unknown,
  expectedResolutionId?: string,
  identity: ReviewIdentity = {},
): value is AuthorityScoreResolution {
  if (!isRecord(value)
    || value.schemaVersion !== SCORE_RESOLUTION_SCHEMA_VERSION
    || typeof value.resolutionId !== 'string' || !value.resolutionId.trim()
    || (expectedResolutionId !== undefined && value.resolutionId !== expectedResolutionId)
    || typeof value.eventId !== 'string' || !value.eventId.trim()
    || (identity.eventId !== undefined && value.eventId !== identity.eventId)
    || typeof value.versionId !== 'string' || !value.versionId.trim()
    || (identity.versionId !== undefined && value.versionId !== identity.versionId)
    || typeof value.assessmentId !== 'string' || !value.assessmentId.trim()
    || (identity.assessmentId !== undefined && value.assessmentId !== identity.assessmentId)
    || typeof value.resolvedBy !== 'string' || !value.resolvedBy.trim()
    || typeof value.rationale !== 'string' || value.rationale.trim().length < 10
    || !Number.isFinite(value.createdAt)
    || !isRecord(value.reviewHeadIds) || Object.keys(value.reviewHeadIds).length === 0
    || !Object.keys(value.reviewHeadIds).every((authority) => AUTHORITY_TYPES.has(authority))
    || !Object.values(value.reviewHeadIds).every((reviewId) => typeof reviewId === 'string' && Boolean(reviewId.trim()))
    || new Set(Object.values(value.reviewHeadIds)).size !== Object.keys(value.reviewHeadIds).length
    || !Array.isArray(value.categories) || value.categories.length < 1 || value.categories.length > EXPECTED_CATEGORY_IDS.size) return false;
  const seen = new Set<string>();
  return value.categories.every((category) => {
    if (!isRecord(category)
      || typeof category.categoryId !== 'string'
      || !EXPECTED_CATEGORY_IDS.has(category.categoryId)
      || seen.has(category.categoryId)
      || !Number.isInteger(category.likelihood) || Number(category.likelihood) < 1 || Number(category.likelihood) > 5
      || !Number.isInteger(category.severity) || Number(category.severity) < 1 || Number(category.severity) > 5
      || typeof category.reason !== 'string' || category.reason.trim().length < 10) return false;
    seen.add(category.categoryId);
    return true;
  });
}

export function isCurrentRiskAssessment(value: unknown): value is RiskAssessment {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RiskAssessment>;
  if (record.schemaVersion !== ASSESSMENT_SCHEMA_VERSION) return false;
  if (![record.assessmentId, record.eventId, record.versionId, record.inputHash].every((item) => typeof item === 'string' && item.trim().length > 0)) return false;
  if (!Number.isFinite(record.createdAt)) return false;
  if (!['manual_review_required', 'provisional_ready', 'authority_review', 'official_ready'].includes(record.status ?? '')) return false;
  if (!['complete', 'provisional', 'insufficient_data'].includes(String(record.assessmentReadiness))
    || !['pass', 'review_required', 'blocked'].includes(String(record.complianceStatus))
    || !Number.isFinite(record.dataConfidenceScore)
    || !['low', 'medium', 'high'].includes(String(record.dataConfidenceLevel))) return false;
  if (!isAssessmentContext(record.contextSnapshot)
    || !Array.isArray(record.evidence)
    || !record.evidence.every(isAssessmentEvidence)
    || !Array.isArray(record.contextEvidence) || record.contextEvidence.length === 0
    || !record.contextEvidence.every(isContextEvidence)
    || new Set(record.contextEvidence.map((item) => item.evidenceId)).size !== record.contextEvidence.length
    || !Array.isArray(record.warnings)
    || !record.warnings.every(isAssessmentWarning)) return false;
  if (record.status !== 'official_ready' && record.authorityReviewRequired !== true) return false;
  if (record.status === 'authority_review' && !isPartialAuthorityReviewState(record.authorityReviewState)) return false;
  if (record.status === 'manual_review_required') return (record.aiProposal === null
      ? record.assessmentReadiness === 'insufficient_data'
      : isManualFailureAttempt(record.aiProposal))
    && typeof record.manualReviewReason === 'string' && record.manualReviewReason.trim().length > 0
    && (record.activeManualAssessmentId === undefined
      || isSafeManualAssessmentId(record.activeManualAssessmentId));
  if (record.status === 'official_ready' && 'sourceKind' in record && record.sourceKind === 'admin_manual') {
    const manualRecord = record as Partial<import('@shared/types').AdminManualOfficialRiskAssessment>;
    const result = manualRecord.officialResult;
    const manualAttempt = manualRecord.aiProposal;
    return record.authorityReviewRequired === false
      && (manualAttempt === null
        ? manualRecord.assessmentReadiness === 'insufficient_data'
        : isManualFailureAttempt(manualAttempt))
      && typeof manualRecord.manualReviewReason === 'string' && manualRecord.manualReviewReason.trim().length > 0
      && isSafeManualAssessmentId(manualRecord.activeManualAssessmentId)
      && result?.sourceKind === 'admin_manual'
      && result.manualAssessmentId === manualRecord.activeManualAssessmentId
      && result.formulaVersion === MANUAL_OFFICIAL_FORMULA_VERSION
      && result.categorySchemaVersion === CATEGORY_SCHEMA_VERSION
      && result.hardRuleVersion === HARD_RULE_VERSION
      && isManualCalculatedResult(result)
      && manualEvidenceReferencesAreEligible(result, record.evidence)
      && typeof result.officialInputHash === 'string' && /^[a-f0-9]{64}$/.test(result.officialInputHash)
      && Number.isFinite(result.calculatedAt) && Number.isFinite(result.finalizedAt)
      && typeof result.finalizedBy === 'string' && result.finalizedBy.trim().length > 0;
  }
  const calculated = record as Partial<RiskAssessment & { provisionalResult: ProvisionalAssessmentResult }>;
  if (!isSuccessfulProposal(record.aiProposal)
    || !isCalculatedResult(calculated.provisionalResult, record.aiProposal.proposalId)
    || !manualEvidenceReferencesAreEligible(calculated.provisionalResult, record.evidence)) return false;
  if (record.status !== 'official_ready') return true;
  const officialResult = record.officialResult;
  const aiRecord = record as Partial<import('@shared/types').OfficialRiskAssessment>;
  const reviewState = aiRecord.authorityReviewState;
  return isCalculatedResult(officialResult, record.aiProposal.proposalId)
    && manualEvidenceReferencesAreEligible(officialResult, record.evidence)
    && record.authorityReviewRequired === false
    && isAuthorityReviewState(reviewState)
    && officialResult.officialFormulaVersion === OFFICIAL_FORMULA_VERSION
    && typeof officialResult.officialInputHash === 'string'
    && /^[a-f0-9]{64}$/.test(officialResult.officialInputHash)
    && Array.isArray(officialResult.reviewIds)
    && officialResult.reviewIds.length === reviewState.requiredAuthorities.length
    && new Set(officialResult.reviewIds).size === officialResult.reviewIds.length
    && reviewState.activeResolutionId === officialResult.resolutionId
    && (officialResult.resolutionId !== undefined || reviewState.conflicts.length === 0)
    && officialResult.categories.every((category) => Number.isInteger(category.authorityLikelihood)
      && category.authorityLikelihood >= 1 && category.authorityLikelihood <= 5
      && Number.isInteger(category.authoritySeverity) && category.authoritySeverity >= 1 && category.authoritySeverity <= 5
      && Array.isArray(category.sourceReviewIds) && category.sourceReviewIds.length === officialResult.reviewIds.length
      && category.sourceReviewIds.every((reviewId) => officialResult.reviewIds.includes(reviewId))
      && (category.resolutionId === undefined || category.resolutionId === officialResult.resolutionId))
    && Number.isFinite(officialResult.finalizedAt)
    && typeof officialResult.finalizedBy === 'string'
    && officialResult.finalizedBy.trim().length > 0;
}

export function isAuthorityReviewState(value: unknown): value is AuthorityReviewState {
  if (!isRecord(value) || !Array.isArray(value.requiredAuthorities) || value.requiredAuthorities.length === 0
    || new Set(value.requiredAuthorities).size !== value.requiredAuthorities.length
    || !value.requiredAuthorities.every((authority) => AUTHORITY_TYPES.has(String(authority)))
    || !isRecord(value.activeReviewHeads) || !Array.isArray(value.conflicts) || !Number.isFinite(value.updatedAt)) return false;
  const authorities = value.requiredAuthorities as unknown[];
  const headKeys = Object.keys(value.activeReviewHeads);
  if (headKeys.length !== authorities.length || !headKeys.every((authority) => authorities.includes(authority))) return false;
  if (!Object.values(value.activeReviewHeads).every((head) => isRecord(head)
    && typeof head.reviewId === 'string' && Boolean(head.reviewId)
    && Number.isFinite(head.createdAt))) return false;
  const headIds = Object.values(value.activeReviewHeads).map((head) => (head as Record<string, unknown>).reviewId);
  if (new Set(headIds).size !== headIds.length) return false;
  const conflicts = value.conflicts as unknown[];
  const categoryIds = conflicts.map((conflict) => isRecord(conflict) ? conflict.categoryId : undefined);
  return new Set(categoryIds).size === categoryIds.length && conflicts.every((conflict) => isRecord(conflict)
    && typeof conflict.categoryId === 'string' && EXPECTED_CATEGORY_IDS.has(conflict.categoryId)
    && Array.isArray(conflict.reviewIds) && conflict.reviewIds.length === authorities.length
    && conflict.reviewIds.every((reviewId) => typeof reviewId === 'string' && Boolean(reviewId)));
}

function isPartialAuthorityReviewState(value: unknown): value is AuthorityReviewState {
  if (!isRecord(value) || !Array.isArray(value.requiredAuthorities) || value.requiredAuthorities.length === 0
    || new Set(value.requiredAuthorities).size !== value.requiredAuthorities.length
    || !value.requiredAuthorities.every((authority) => AUTHORITY_TYPES.has(String(authority)))
    || !isRecord(value.activeReviewHeads) || !Array.isArray(value.conflicts) || !Number.isFinite(value.updatedAt)) return false;
  const authorities = value.requiredAuthorities as unknown[];
  const headKeys = Object.keys(value.activeReviewHeads);
  if (headKeys.some((authority) => !authorities.includes(authority))) return false;
  if (!Object.values(value.activeReviewHeads).every((head) => isRecord(head)
    && typeof head.reviewId === 'string' && Boolean(head.reviewId)
    && Number.isFinite(head.createdAt))) return false;
  const headIds = Object.values(value.activeReviewHeads).map((head) => (head as Record<string, unknown>).reviewId);
  if (new Set(headIds).size !== headIds.length) return false;
  const conflicts = value.conflicts as unknown[];
  const categoryIds = conflicts.map((conflict) => isRecord(conflict) ? conflict.categoryId : undefined);
  return new Set(categoryIds).size === categoryIds.length && conflicts.every((conflict) => isRecord(conflict)
    && typeof conflict.categoryId === 'string' && EXPECTED_CATEGORY_IDS.has(conflict.categoryId)
    && Array.isArray(conflict.reviewIds) && conflict.reviewIds.length === authorities.length
    && conflict.reviewIds.every((reviewId) => typeof reviewId === 'string' && Boolean(reviewId)))
    && (headKeys.length === authorities.length || (conflicts.length === 0 && value.activeResolutionId === undefined))
    && (value.activeResolutionId === undefined
      || (typeof value.activeResolutionId === 'string' && Boolean(value.activeResolutionId)));
}

export function isCurrentAssessmentJob(value: unknown): value is AssessmentJob {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<AssessmentJob>;
  return (record.status === 'processing' || record.status === 'failed')
    && typeof record.assessmentId === 'string' && record.assessmentId.trim().length > 0
    && typeof record.eventId === 'string' && record.eventId.trim().length > 0
    && typeof record.versionId === 'string' && record.versionId.trim().length > 0
    && typeof record.inputHash === 'string' && record.inputHash.trim().length > 0
    && typeof record.claimId === 'string' && record.claimId.trim().length > 0
    && Number.isFinite(record.claimedAt)
    && Number.isFinite(record.leaseExpiresAt)
    && Number.isFinite(record.createdAt);
}

export function isCurrentAssessmentRecord(value: unknown): value is AssessmentRecord {
  return isCurrentRiskAssessment(value) || isCurrentAssessmentJob(value);
}

export function isOrganizerAssessmentSummary(value: unknown, expectedEventId?: string, expectedVersionId?: string): value is OrganizerAssessmentSummary {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== ASSESSMENT_SCHEMA_VERSION
    || typeof value.assessmentId !== 'string' || !value.assessmentId
    || typeof value.eventId !== 'string' || !value.eventId
    || (expectedEventId !== undefined && value.eventId !== expectedEventId)
    || typeof value.versionId !== 'string' || !value.versionId
    || (expectedVersionId !== undefined && value.versionId !== expectedVersionId)
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
  if (value.authorityReviewProgress !== undefined && (!isRecord(value.authorityReviewProgress)
    || !Number.isSafeInteger(value.authorityReviewProgress.completed)
    || !Number.isSafeInteger(value.authorityReviewProgress.required)
    || Number(value.authorityReviewProgress.completed) < 0
    || Number(value.authorityReviewProgress.required) < 1
    || Number(value.authorityReviewProgress.completed) > Number(value.authorityReviewProgress.required))) return false;
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
        || category.categoryName !== EXPECTED_CATEGORY_NAMES[category.categoryId]
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
      || Object.keys(quantities).length !== RESOURCE_KEYS.length
      || !RESOURCE_FIELDS.every(({ key }) => Number.isSafeInteger(quantities[key])
        && Number(quantities[key]) >= 0)) return false;
  }
  if ((value.resourceQuantities === undefined) !== (value.resourceRecommendation === undefined)) return false;
  if (value.resourceRecommendation !== undefined) {
    const resource = value.resourceRecommendation;
    if (!isRecord(resource)
      || typeof resource.resourceId !== 'string' || !isSafeDocumentId(resource.resourceId)
      || !Number.isSafeInteger(resource.revision) || Number(resource.revision) < 1
      || !['provisional', 'official'].includes(String(resource.stage))
      || typeof resource.disclaimer !== 'string' || !resource.disclaimer
      || !isRecord(resource.items)) return false;
    if (resource.stage !== (value.status === 'official_ready' ? 'official' : 'provisional')) return false;
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

export function assessmentResult(assessment: RiskAssessment): CalculatedAssessmentResult | undefined {
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
    || value.validationScope !== (value.stage === 'official' ? 'official_risk_input_only' : 'provisional_risk_input')
    || typeof value.computedAt !== 'number' || !Number.isFinite(value.computedAt)
    || !isRecord(value.assessmentReference)
    || value.assessmentReference.stage !== value.stage
    || value.assessmentReference.assessmentId !== value.assessmentId
    || !isRecord(value.items)) return false;
  const reference = value.assessmentReference;
  if (reference.sourceKind !== undefined && reference.sourceKind !== 'ai_authority' && reference.sourceKind !== 'admin_manual') return false;
  if (reference.stage === 'provisional'
    && (typeof reference.proposalId !== 'string' || !reference.proposalId || reference.sourceKind !== undefined)) return false;
  if (reference.stage === 'official') {
    const manual = reference.sourceKind === 'admin_manual';
    if (manual
      ? !isSafeManualAssessmentId(reference.manualAssessmentId) || 'proposalId' in reference
      : typeof reference.proposalId !== 'string' || !reference.proposalId || 'manualAssessmentId' in reference) return false;
  }
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

function isManualCalculatedResult(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.categories) || value.categories.length !== EXPECTED_CATEGORY_IDS.size
    || !Array.isArray(value.manualHazards) || value.manualHazards.length < 1 || value.manualHazards.length > 40
    || typeof value.overallScore !== 'number' || !Number.isFinite(value.overallScore)
    || !['Low', 'Medium', 'High'].includes(String(value.overallRiskLevel))) return false;
  const ids = value.categories.map((category) => isRecord(category) ? category.categoryId : undefined);
  const hazards = value.manualHazards as unknown[];
  const hazardIds = hazards.map((hazard) => isRecord(hazard) ? hazard.hazardId : undefined);
  let weighted = 0;
  let highest: RiskLevel = 'Low';
  const validCategories = value.categories.every((category) => {
    if (!isRecord(category)
      || !Number.isInteger(category.manualLikelihood) || Number(category.manualLikelihood) < 1 || Number(category.manualLikelihood) > 5
      || !Number.isInteger(category.manualSeverity) || Number(category.manualSeverity) < 1 || Number(category.manualSeverity) > 5
      || !Number.isInteger(category.validatedLikelihood) || Number(category.validatedLikelihood) < Number(category.manualLikelihood) || Number(category.validatedLikelihood) > 5
      || !Number.isInteger(category.validatedSeverity) || Number(category.validatedSeverity) < Number(category.manualSeverity) || Number(category.validatedSeverity) > 5
      || category.matrixScore !== Number(category.validatedLikelihood) * Number(category.validatedSeverity)
      || category.normalizedScore !== Number(category.matrixScore) * 4
      || category.categoryName !== EXPECTED_CATEGORY_NAMES[String(category.categoryId)]
      || category.weight !== EXPECTED_CATEGORY_WEIGHT
      || category.weightedContribution !== round(Number(category.normalizedScore) * EXPECTED_CATEGORY_WEIGHT)
      || category.riskLevel !== hirarcRiskLevelFor(Number(category.matrixScore))
      || typeof category.rationale !== 'string' || !category.rationale.trim()
      || typeof category.missingInformation !== 'string'
      || !Array.isArray(category.evidenceReferences)
      || new Set(category.evidenceReferences).size !== category.evidenceReferences.length
      || category.evidenceReferences.some((reference) => typeof reference !== 'string')
      || (category.evidenceReferences.length === 0 && category.missingInformation.trim().length < 10)
      || !Array.isArray(category.appliedHardRules)
      || !category.appliedHardRules.every(isAppliedHardRule)) return false;
    weighted += Number(category.normalizedScore) * EXPECTED_CATEGORY_WEIGHT;
    highest = higherRisk(highest, category.riskLevel as RiskLevel);
    return true;
  });
  const score = round(weighted);
  return new Set(ids).size === ids.length && ids.every((id) => EXPECTED_CATEGORY_IDS.has(String(id)))
    && new Set(hazardIds).size === hazardIds.length && hazards.every((hazard) => isRecord(hazard)
      && typeof hazard.hazardId === 'string' && Boolean(hazard.hazardId)
      && typeof hazard.hazardName === 'string' && Boolean(hazard.hazardName)
      && EXPECTED_CATEGORY_IDS.has(String(hazard.categoryId))
      && Array.isArray(hazard.evidenceReferences)
      && typeof hazard.rationale === 'string' && Boolean(hazard.rationale))
    && validCategories && value.overallScore === score
    && value.weightedRiskLevel === riskLevelFor(score)
    && value.highestCategoryRiskLevel === highest
    && value.overallRiskLevel === higherRisk(riskLevelFor(score), highest);
}

function isAssessmentContext(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const weather = value.weather;
  const calendar = value.calendar;
  const venue = value.venue;
  const history = value.incidentHistory;
  const weatherDataValid = isRecord(weather) && (isRecord(weather.data)
    ? weather.measurementStatus === 'available'
      && typeof weather.data.forecast === 'string' && Boolean(weather.data.forecast.trim())
      && finiteRange(weather.data.temperature, -100, 70)
      && finiteRange(weather.data.humidity, 0, 100)
      && finiteRange(weather.data.windSpeed, 0, Number.MAX_SAFE_INTEGER)
      && finiteRange(weather.data.precipitationProbability, 0, 100)
      && typeof weather.data.severeAlert === 'boolean'
    : weather.data === null && weather.measurementStatus === 'unavailable'
      && ['outside_forecast_horizon', 'provider_unavailable'].includes(String(weather.unavailableReason)));
  return weatherDataValid
    && Number.isFinite(weather.fetchedAt)
    && isRecord(calendar)
    && typeof calendar.localDate === 'string'
    && typeof calendar.dayOfWeek === 'string'
    && typeof calendar.isWeekend === 'boolean'
    && typeof calendar.isHolidayOrAdjacent === 'boolean'
    && Number.isFinite(calendar.sourceTimestamp)
    && ['verified', 'unsupported_year'].includes(String(calendar.coverageStatus))
    && isRecord(venue)
    && typeof venue.matched === 'boolean'
    && Number.isFinite(venue.submittedCapacity)
    && Number.isFinite(venue.fetchedAt)
    && isRecord(history)
    && typeof history.matched === 'boolean'
    && Number.isFinite(history.total)
    && isRecord(history.bySeverity)
    && Number.isFinite(history.bySeverity.high)
    && ['none', 'partial', 'all'].includes(String(history.syntheticStatus))
    && Number.isFinite(history.fetchedAt);
}

function finiteRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isAssessmentEvidence(value: unknown): boolean {
  return isRecord(value)
    && typeof value.key === 'string'
    && typeof value.description === 'string'
    && typeof value.source === 'string'
    && typeof value.status === 'string'
    && ['eligible', 'ineligible', 'missing'].includes(String(value.eligibility))
    && ['none', 'partial', 'all'].includes(String(value.syntheticStatus))
    && Number.isFinite(value.sourceTimestamp);
}

function isContextEvidence(value: unknown): boolean {
  return isRecord(value)
    && typeof value.evidenceId === 'string' && Boolean(value.evidenceId)
    && typeof value.evidenceKey === 'string'
    && ['external_api', 'official_registry', 'official_dataset', 'submitted_document', 'submitted_declaration', 'derived'].includes(String(value.sourceKind))
    && typeof value.sourceLocator === 'string' && Boolean(value.sourceLocator)
    && Number.isFinite(value.retrievedAt)
    && typeof value.sourceVersion === 'string' && Boolean(value.sourceVersion)
    && ['eligible', 'ineligible', 'missing'].includes(String(value.eligibility))
    && typeof value.synthetic === 'boolean'
    && ['authority_only', 'organizer_safe'].includes(String(value.visibility));
}

function isAssessmentWarning(value: unknown): boolean {
  return isRecord(value)
    && typeof value.warningId === 'string'
    && typeof value.code === 'string'
    && typeof value.message === 'string'
    && Array.isArray(value.evidenceReferences)
    && value.evidenceReferences.every((reference) => typeof reference === 'string');
}

function isManualFailureAttempt(value: unknown): boolean {
  return isRecord(value)
    && ['unavailable', 'timeout', 'invalid'].includes(String(value.status))
    && typeof value.model === 'string' && Boolean(value.model.trim())
    && typeof value.promptVersion === 'string' && Boolean(value.promptVersion.trim())
    && typeof value.responseSchemaVersion === 'string' && Boolean(value.responseSchemaVersion.trim())
    && typeof value.retryable === 'boolean'
    && typeof value.errorSummary === 'string' && Boolean(value.errorSummary.trim())
    && value.cacheStatus === 'not-applicable'
    && Number.isFinite(value.generatedAt);
}

function manualEvidenceReferencesAreEligible(result: unknown, evidence: unknown[]): boolean {
  if (!isRecord(result)) return false;
  const eligible = new Set(evidence
    .filter((item): item is Record<string, unknown> => isRecord(item)
      && item.quality !== 'missing'
      && typeof item.status === 'string'
      && !['unavailable', 'unmatched', 'missing'].includes(item.status.trim().toLowerCase()))
    .map((item) => item.key)
    .filter((key): key is string => typeof key === 'string'));
  const hazards = Array.isArray(result.manualHazards) ? result.manualHazards : [];
  const categories = Array.isArray(result.categories) ? result.categories : [];
  return [...hazards, ...categories].every((item) => isRecord(item)
    && Array.isArray(item.evidenceReferences)
    && new Set(item.evidenceReferences).size === item.evidenceReferences.length
    && item.evidenceReferences.every((reference) => typeof reference === 'string' && eligible.has(reference)));
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
  if (!result.categories.every(isRecord)
    || !result.validatedHazards.every(isValidatedHazard)) return false;
  const categoryIds = result.categories.map((category) => category.categoryId);
  if (new Set(categoryIds).size !== categoryIds.length
    || !categoryIds.every((categoryId) => EXPECTED_CATEGORY_IDS.has(categoryId))) return false;
  let weightedScore = 0;
  let highestCategoryRiskLevel: RiskLevel = 'Low';
  for (const category of result.categories) {
    if (category.categoryName !== EXPECTED_CATEGORY_NAMES[category.categoryId]
      || !Number.isInteger(category.proposedLikelihood) || category.proposedLikelihood < 1 || category.proposedLikelihood > 5
      || !Number.isInteger(category.proposedSeverity) || category.proposedSeverity < 1 || category.proposedSeverity > 5
      || !Array.isArray(category.evidenceReferences)
      || new Set(category.evidenceReferences).size !== category.evidenceReferences.length
      || !category.evidenceReferences.every((reference) => typeof reference === 'string')
      || typeof category.rationale !== 'string' || !category.rationale.trim()
      || !['low', 'medium', 'high'].includes(String(category.confidence))
      || !isStringArray(category.concerns) || !isStringArray(category.missingInformation)
      || !isStringArray(category.guidelineChecks)
      || !Array.isArray(category.appliedHardRules)
      || !category.appliedHardRules.every(isAppliedHardRule)
      || !Number.isInteger(category.validatedLikelihood)
      || category.validatedLikelihood < 1 || category.validatedLikelihood > 5) return false;
    if (!Number.isInteger(category.validatedSeverity)
      || category.validatedSeverity < 1 || category.validatedSeverity > 5
      || category.validatedLikelihood < category.proposedLikelihood
      || category.validatedSeverity < category.proposedSeverity
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

function isSuccessfulProposal(value: unknown): value is {
  status: 'success';
  proposalId: string;
  model: string;
  promptVersion: string;
  responseSchemaVersion: string;
  hazards: unknown[];
  categories: unknown[];
  cacheStatus: 'hit' | 'miss' | 'not-applicable';
  generatedAt: number;
} {
  if (!isRecord(value)
    || value.status !== 'success'
    || typeof value.proposalId !== 'string' || !value.proposalId.trim()
    || typeof value.model !== 'string' || !value.model.trim()
    || typeof value.promptVersion !== 'string' || !value.promptVersion.trim()
    || typeof value.responseSchemaVersion !== 'string' || !value.responseSchemaVersion.trim()
    || !['hit', 'miss', 'not-applicable'].includes(String(value.cacheStatus))
    || !Number.isFinite(value.generatedAt)
    || !Array.isArray(value.hazards) || !Array.isArray(value.categories)
    || value.categories.length !== EXPECTED_CATEGORY_IDS.size
    || !value.categories.every(isProposalCategory)
    || !value.hazards.every(isValidatedHazard)) return false;
  const categoryIds = value.categories.map((category) => (category as Record<string, unknown>).categoryId);
  const hazardIds = value.hazards.map((hazard) => (hazard as Record<string, unknown>).hazardId);
  return new Set(categoryIds).size === categoryIds.length
    && categoryIds.every((id) => typeof id === 'string' && EXPECTED_CATEGORY_IDS.has(id))
    && new Set(hazardIds).size === hazardIds.length;
}

function isProposalCategory(value: unknown): boolean {
  return isRecord(value)
    && typeof value.categoryId === 'string'
    && EXPECTED_CATEGORY_IDS.has(value.categoryId)
    && Number.isInteger(value.likelihood) && Number(value.likelihood) >= 1 && Number(value.likelihood) <= 5
    && Number.isInteger(value.severity) && Number(value.severity) >= 1 && Number(value.severity) <= 5
    && Array.isArray(value.evidenceReferences)
    && new Set(value.evidenceReferences).size === value.evidenceReferences.length
    && value.evidenceReferences.every((reference) => typeof reference === 'string')
    && typeof value.rationale === 'string' && Boolean(value.rationale.trim())
    && ['low', 'medium', 'high'].includes(String(value.confidence))
    && isStringArray(value.concerns) && isStringArray(value.missingInformation);
}

function isValidatedHazard(value: unknown): boolean {
  return isRecord(value)
    && typeof value.hazardId === 'string' && Boolean(value.hazardId.trim())
    && typeof value.hazardName === 'string' && Boolean(value.hazardName.trim())
    && typeof value.categoryId === 'string' && EXPECTED_CATEGORY_IDS.has(value.categoryId)
    && Array.isArray(value.evidenceReferences)
    && new Set(value.evidenceReferences).size === value.evidenceReferences.length
    && value.evidenceReferences.every((reference) => typeof reference === 'string')
    && typeof value.rationale === 'string' && Boolean(value.rationale.trim());
}

function isAppliedHardRule(value: unknown): boolean {
  return isRecord(value)
    && typeof value.ruleId === 'string' && Boolean(value.ruleId.trim())
    && typeof value.categoryId === 'string' && EXPECTED_CATEGORY_IDS.has(value.categoryId)
    && (value.axis === 'likelihood' || value.axis === 'severity')
    && Number.isInteger(value.proposedValue) && Number(value.proposedValue) >= 1 && Number(value.proposedValue) <= 5
    && Number.isInteger(value.constrainedValue) && Number(value.constrainedValue) >= 1 && Number(value.constrainedValue) <= 5
    && Number(value.constrainedValue) >= Number(value.proposedValue)
    && typeof value.rationale === 'string' && Boolean(value.rationale.trim())
    && isStringArray(value.guidelineReferences);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
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
