import { createHash } from 'node:crypto';
import {
  AISuccessfulProposal,
  AuthorityReviewState,
  AuthorityScoreConflict,
  AuthorityScoreResolution,
  AuthorityScoreReview,
  AuthorityType,
  EventDetails,
  EventRecord,
  HARD_RULE_VERSION,
  OFFICIAL_FORMULA_VERSION,
  OfficialAssessmentResult,
  PROVISIONAL_FORMULA_VERSION,
  ProvisionalRiskAssessment,
  OfficialRiskAssessment,
  SCORE_RESOLUTION_SCHEMA_VERSION,
  SCORE_REVIEW_SCHEMA_VERSION,
  ScoreRating,
  hirarcRiskLevelFor,
  riskLevelFor,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { computeCategoryBasedAssessment } from './ruleBased';
import { evaluateCategoryHardRules } from './hardRuleEvaluator';
import { stableStringify } from './resourceCalculator';

const CATEGORY_IDS = ACTIVE_CATEGORY_SCHEMA.categories.map((category) => category.id);
const CATEGORY_ID_SET = new Set<string>(CATEGORY_IDS);

export interface ScoreReviewInput {
  categories: AuthorityScoreReview['categories'];
  rationale: string;
  idempotencyKey: string;
}

export interface ResolutionInput {
  reviewHeadIds: Partial<Record<AuthorityType, string>>;
  categories: AuthorityScoreResolution['categories'];
  rationale: string;
}

export function validateScoreReviewInput(
  input: ScoreReviewInput,
  proposal: AISuccessfulProposal,
): string[] {
  const errors: string[] = [];
  if (!validText(input.rationale, 10, 1_000)) errors.push('review-rationale');
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) {
    errors.push('idempotency-key');
  }
  if (!Array.isArray(input.categories) || input.categories.length !== CATEGORY_IDS.length) return [...errors, 'category-count'];
  const proposalByCategory = new Map(proposal.categories.map((category) => [category.categoryId, category]));
  const seen = new Set<string>();
  for (const category of input.categories) {
    const proposed = proposalByCategory.get(category?.categoryId);
    if (!category || !CATEGORY_ID_SET.has(category.categoryId) || seen.has(category.categoryId) || !proposed) {
      errors.push('category-identity');
      continue;
    }
    seen.add(category.categoryId);
    if (!isScore(category.likelihood) || !isScore(category.severity)) errors.push(`score-${category.categoryId}`);
    if (category.decision === 'confirmed') {
      if (category.likelihood !== proposed.likelihood || category.severity !== proposed.severity || 'reason' in category) {
        errors.push(`confirmation-${category.categoryId}`);
      }
    } else if (category.decision === 'overridden') {
      if (!validText(category.reason, 10, 500)) errors.push(`override-reason-${category.categoryId}`);
    } else {
      errors.push('decision');
    }
  }
  if (seen.size !== CATEGORY_IDS.length) errors.push('missing-category');
  return [...new Set(errors)];
}

export function buildAuthorityReviewState(
  requiredAuthorities: AuthorityType[],
  reviews: AuthorityScoreReview[],
  updatedAt: number,
): AuthorityReviewState {
  const byAuthority = new Map(reviews.map((review) => [review.authorityType, review]));
  const activeReviewHeads: AuthorityReviewState['activeReviewHeads'] = {};
  for (const authority of requiredAuthorities) {
    const review = byAuthority.get(authority);
    if (review) activeReviewHeads[authority] = {
      reviewId: review.reviewId,
      createdAt: review.createdAt,
    };
  }
  return {
    requiredAuthorities: [...requiredAuthorities],
    activeReviewHeads,
    conflicts: reviews.length === requiredAuthorities.length ? detectScoreConflicts(requiredAuthorities, reviews) : [],
    updatedAt,
  };
}

export function detectScoreConflicts(
  requiredAuthorities: AuthorityType[],
  reviews: AuthorityScoreReview[],
): AuthorityScoreConflict[] {
  if (reviews.length !== requiredAuthorities.length) return [];
  const byAuthority = new Map(reviews.map((review) => [review.authorityType, review]));
  if (requiredAuthorities.some((authority) => !byAuthority.has(authority))) return [];
  return CATEGORY_IDS.flatMap((categoryId) => {
    const submittedScores = requiredAuthorities.map((authorityType) => {
      const category = byAuthority.get(authorityType)!.categories.find((item) => item.categoryId === categoryId)!;
      return { authorityType, likelihood: category.likelihood, severity: category.severity };
    });
    const pairs = new Set(submittedScores.map((score) => `${score.likelihood}:${score.severity}`));
    return pairs.size > 1 ? [{
      categoryId,
      reviewIds: requiredAuthorities.map((authority) => byAuthority.get(authority)!.reviewId),
    }] : [];
  });
}

export function validateResolutionInput(
  input: ResolutionInput,
  state: AuthorityReviewState,
): string[] {
  const errors: string[] = [];
  if (!isRecord(input) || !isRecord(input.reviewHeadIds)) return ['review-heads'];
  if (!validText(input.rationale, 10, 1_000)) errors.push('resolution-rationale');
  const expectedHeads = state.requiredAuthorities.map((authority) => [authority, state.activeReviewHeads[authority]?.reviewId] as const);
  if (expectedHeads.some(([authority, reviewId]) => !reviewId || input.reviewHeadIds[authority] !== reviewId)
    || Object.keys(input.reviewHeadIds).some((authority) => !state.requiredAuthorities.includes(authority as AuthorityType))) {
    errors.push('stale-review-heads');
  }
  const conflicts = new Set(state.conflicts.map((conflict) => conflict.categoryId));
  if (conflicts.size === 0) errors.push('no-conflicts');
  if (!Array.isArray(input.categories) || input.categories.length !== conflicts.size) return [...errors, 'resolution-category-count'];
  const seen = new Set<string>();
  for (const category of input.categories) {
    if (!category || !conflicts.has(category.categoryId) || seen.has(category.categoryId)) errors.push('resolution-category');
    else seen.add(category.categoryId);
    if (!isScore(category?.likelihood) || !isScore(category?.severity)) errors.push(`resolution-score-${category?.categoryId ?? 'unknown'}`);
    if (!validText(category?.reason, 10, 500)) errors.push(`resolution-reason-${category?.categoryId ?? 'unknown'}`);
  }
  if ([...conflicts].some((category) => !seen.has(category))) errors.push('missing-resolution-category');
  return [...new Set(errors)];
}

export function buildOfficialAssessmentResult(args: {
  assessment: ProvisionalRiskAssessment | OfficialRiskAssessment;
  eventDetails: EventDetails;
  requiredAuthorities: AuthorityType[];
  reviews: AuthorityScoreReview[];
  resolution?: AuthorityScoreResolution;
  finalizedAt: number;
  finalizedBy: string;
}): OfficialAssessmentResult {
  const { assessment, eventDetails, requiredAuthorities, reviews, resolution, finalizedAt, finalizedBy } = args;
  assertStoredReviews(assessment, requiredAuthorities, reviews);
  const conflicts = detectScoreConflicts(requiredAuthorities, reviews);
  if (conflicts.length > 0) {
    if (!resolution || resolution.schemaVersion !== SCORE_RESOLUTION_SCHEMA_VERSION) throw new Error('score-conflict-resolution-required');
    if (resolution.eventId !== assessment.eventId
      || resolution.versionId !== assessment.versionId
      || resolution.assessmentId !== assessment.assessmentId
      || typeof resolution.resolutionId !== 'string' || resolution.resolutionId.length === 0
      || typeof resolution.resolvedBy !== 'string' || resolution.resolvedBy.length === 0
      || !Number.isFinite(resolution.createdAt) || resolution.createdAt < 0
      || finalizedBy !== resolution.resolvedBy) {
      throw new Error('invalid-score-resolution-identity');
    }
    const state = buildAuthorityReviewState(requiredAuthorities, reviews, resolution.createdAt);
    const resolutionErrors = validateResolutionInput(resolution, state);
    if (resolutionErrors.length > 0) throw new Error(`invalid-score-resolution:${resolutionErrors.join(',')}`);
  } else if (resolution) {
    throw new Error('unexpected-score-resolution');
  }
  const reviewsByAuthority = new Map(reviews.map((review) => [review.authorityType, review]));
  const resolutionByCategory = new Map(resolution?.categories.map((category) => [category.categoryId, category]) ?? []);
  const baseline = computeCategoryBasedAssessment(
    { eventId: assessment.eventId, eventDetails } as EventRecord,
    assessment.contextSnapshot,
    assessment.createdAt,
  );
  const constraints = new Map(evaluateCategoryHardRules(baseline).map((rule) => [rule.categoryId, rule]));
  let weightedScore = 0;
  let highestCategoryRiskLevel: OfficialAssessmentResult['highestCategoryRiskLevel'] = 'Low';
  const categories = assessment.provisionalResult.categories.map((provisional) => {
    const submitted = requiredAuthorities.map((authority) => {
      const category = reviewsByAuthority.get(authority)!.categories.find((item) => item.categoryId === provisional.categoryId)!;
      return category;
    });
    const resolved = resolutionByCategory.get(provisional.categoryId);
    const authorityLikelihood = resolved?.likelihood ?? submitted[0].likelihood;
    const authoritySeverity = resolved?.severity ?? submitted[0].severity;
    const constraint = constraints.get(provisional.categoryId as typeof CATEGORY_IDS[number]);
    if (!constraint) throw new Error(`missing-hard-rule:${provisional.categoryId}`);
    const validatedLikelihood = Math.max(authorityLikelihood, constraint.likelihoodFloor) as ScoreRating;
    const validatedSeverity = Math.max(authoritySeverity, constraint.severityFloor) as ScoreRating;
    const appliedHardRules = [];
    if (validatedLikelihood > authorityLikelihood) appliedHardRules.push({
      ruleId: `${constraint.ruleId}.likelihood`,
      categoryId: provisional.categoryId,
      axis: 'likelihood' as const,
      proposedValue: authorityLikelihood,
      constrainedValue: validatedLikelihood,
      rationale: `${constraint.rationale} The likelihood floor is ${constraint.likelihoodFloor}.`,
      guidelineReferences: [...constraint.guidelineReferences],
    });
    if (validatedSeverity > authoritySeverity) appliedHardRules.push({
      ruleId: `${constraint.ruleId}.severity`,
      categoryId: provisional.categoryId,
      axis: 'severity' as const,
      proposedValue: authoritySeverity,
      constrainedValue: validatedSeverity,
      rationale: `${constraint.rationale} The severity floor is ${constraint.severityFloor}.`,
      guidelineReferences: [...constraint.guidelineReferences],
    });
    const matrixScore = validatedLikelihood * validatedSeverity;
    const normalizedScore = matrixScore * 4;
    const weightedContribution = round(normalizedScore * provisional.weight);
    const riskLevel = hirarcRiskLevelFor(matrixScore);
    weightedScore += normalizedScore * provisional.weight;
    highestCategoryRiskLevel = higherRisk(highestCategoryRiskLevel, riskLevel);
    return {
      ...provisional,
      validatedLikelihood,
      validatedSeverity,
      matrixScore,
      normalizedScore,
      weightedContribution,
      riskLevel,
      appliedHardRules,
      authorityLikelihood,
      authoritySeverity,
      sourceReviewIds: requiredAuthorities.map((authority) => reviewsByAuthority.get(authority)!.reviewId),
      ...(resolved ? { resolutionId: resolution!.resolutionId } : {}),
    };
  });
  const overallScore = round(weightedScore);
  const weightedRiskLevel = riskLevelFor(overallScore);
  const reviewIds = requiredAuthorities.map((authority) => reviewsByAuthority.get(authority)!.reviewId);
  const officialInputHash = createHash('sha256').update(stableStringify({
    formulaVersion: OFFICIAL_FORMULA_VERSION,
    provisionalFormulaVersion: PROVISIONAL_FORMULA_VERSION,
    hardRuleVersion: HARD_RULE_VERSION,
    categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    assessmentSchemaVersion: assessment.schemaVersion,
    assessmentInputHash: assessment.inputHash,
    proposal: assessment.aiProposal,
    provisionalResult: assessment.provisionalResult,
    reviews: reviewIds.map((reviewId) => reviews.find((review) => review.reviewId === reviewId)),
    resolution: resolution ?? null,
  })).digest('hex');
  return {
    proposalId: assessment.provisionalResult.proposalId,
    validatedHazards: assessment.provisionalResult.validatedHazards,
    categories,
    overallScore,
    weightedRiskLevel,
    highestCategoryRiskLevel,
    overallRiskLevel: higherRisk(weightedRiskLevel, highestCategoryRiskLevel),
    formulaVersion: PROVISIONAL_FORMULA_VERSION,
    categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    hardRuleVersion: HARD_RULE_VERSION,
    calculatedAt: finalizedAt,
    reviewIds,
    ...(resolution ? { resolutionId: resolution.resolutionId } : {}),
    officialInputHash,
    officialFormulaVersion: OFFICIAL_FORMULA_VERSION,
    finalizedAt,
    finalizedBy,
  };
}

function assertStoredReviews(
  assessment: ProvisionalRiskAssessment | OfficialRiskAssessment,
  requiredAuthorities: AuthorityType[],
  reviews: AuthorityScoreReview[],
): void {
  if (requiredAuthorities.length === 0 || reviews.length !== requiredAuthorities.length) throw new Error('incomplete-authority-reviews');
  const byAuthority = new Map<AuthorityType, AuthorityScoreReview>();
  for (const review of reviews) {
    if (!isRecord(review)
      || byAuthority.has(review.authorityType)
      || !requiredAuthorities.includes(review.authorityType)
      || review.schemaVersion !== SCORE_REVIEW_SCHEMA_VERSION
      || review.eventId !== assessment.eventId
      || review.versionId !== assessment.versionId
      || review.assessmentId !== assessment.assessmentId
      || review.proposalId !== assessment.aiProposal.proposalId
      || review.provisionalCalculatedAt !== assessment.provisionalResult.calculatedAt
      || review.assessmentInputHash !== assessment.inputHash
      || review.categorySchemaVersion !== assessment.provisionalResult.categorySchemaVersion
      || validateScoreReviewInput(review, assessment.aiProposal).length > 0) throw new Error('invalid-authority-review');
    byAuthority.set(review.authorityType, review);
  }
  if (requiredAuthorities.some((authority) => !byAuthority.has(authority))) throw new Error('incomplete-authority-reviews');
}

function validText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScore(value: unknown): value is ScoreRating {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function higherRisk(left: 'Low' | 'Medium' | 'High', right: 'Low' | 'Medium' | 'High') {
  const order = { Low: 0, Medium: 1, High: 2 } as const;
  return order[left] >= order[right] ? left : right;
}
