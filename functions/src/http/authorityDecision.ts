import { createHash } from 'node:crypto';
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ASSESSMENT_SCHEMA_VERSION,
  AssessmentRecord,
  AuthorityScoreResolution,
  AuthorityScoreReview,
  AuthorityDecision,
  AuthorityType,
  COLLECTIONS,
  DecisionValue,
  EventRecord,
  EventVersion,
  RESOURCE_CONFIG_VERSION,
  RESOURCE_FORMULA_VERSION,
  RESOURCE_SOURCE_REGISTRY_VERSION,
  ResourceRecommendation,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { RESOURCE_CUTOVER_LOCK_PATH } from '../config/resourceCutoverLock';
import {
  computeResources,
  matchesDeterministicResourceItems,
  validateAssessmentResultAgainstHardRules,
  validateAssessmentResultAgainstProposal,
  validateProvisionalAssessmentResult,
} from '../engines/resourceCalculator';
import { stableStringify } from '../engines/resourceCalculator';
import { buildOfficialAssessmentResult } from '../engines/authorityFinalisation';
import { validateResourceRecommendation, validateResourceRevisionChain } from '../engines/resourceContract';
import { computeCategoryBasedAssessment } from '../engines/ruleBased';
import { evaluateCategoryHardRules } from '../engines/hardRuleEvaluator';

interface AuthorityDecisionRequest {
  eventId?: string;
  decision?: DecisionValue;
  rationale?: string;
  suggestion?: string;
  materialsReviewed?: boolean;
}

export const makeAuthorityDecision = onCall<AuthorityDecisionRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before reviewing an application.');
  return makeAuthorityDecisionForUser(request.auth.uid, request.data);
});

export async function makeAuthorityDecisionForUser(
  uid: string,
  request: AuthorityDecisionRequest,
  now = Date.now(),
) {
  const { eventId, decision, rationale, suggestion, materialsReviewed } = validateDecisionRequest(request);

  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userReference = db.collection(COLLECTIONS.USERS).doc(uid);

  return db.runTransaction(async (transaction) => {
    const [userSnapshot, eventSnapshot, cutoverLockSnapshot] = await Promise.all([
      transaction.get(userReference),
      transaction.get(eventReference),
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    if (cutoverLockSnapshot.exists) {
      throw new HttpsError('unavailable', 'Resource migration is in progress. Retry the decision shortly.');
    }
    const profile = userSnapshot.data() as UserProfile | undefined;
    if (!profile || profile.role !== 'authority' || !profile.authorityType) {
      throw new HttpsError('permission-denied', 'Only provisioned authority accounts can make decisions.');
    }
    if (!eventSnapshot.exists) throw new HttpsError('not-found', 'Event application was not found.');
    const event = { eventId, ...eventSnapshot.data() } as EventRecord;
    const versionId = event.currentVersionId;
    const assessmentId = event.currentAssessmentId;
    if (!versionId || !assessmentId) throw new HttpsError('failed-precondition', 'The application has no current submitted assessment.');
    if (!event.requiredAuthorities.includes(profile.authorityType)) {
      throw new HttpsError('permission-denied', 'Your authority is not assigned to this application.');
    }

    const decisionId = currentDecisionId(versionId, profile.authorityType);
    const currentReference = eventReference.collection(COLLECTIONS.DECISIONS).doc(decisionId);
    const versionReference = eventReference.collection(COLLECTIONS.VERSIONS).doc(versionId);
    const assessmentReference = eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(assessmentId);
    const resourceReference = eventReference.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId ?? '__missing_resource__');
    const resourceHistoryQuery = eventReference.collection(COLLECTIONS.RESOURCES)
      .where('versionId', '==', versionId);
    const [currentSnapshot, versionSnapshot, assessmentSnapshot, resourceSnapshot, resourceHistorySnapshot] = await Promise.all([
      transaction.get(currentReference),
      transaction.get(versionReference),
      transaction.get(assessmentReference),
      transaction.get(resourceReference),
      transaction.get(resourceHistoryQuery),
    ]);
    const current = currentSnapshot.data() as AuthorityDecision | undefined;
    const version = versionSnapshot.data() as EventVersion | undefined;
    const assessmentValue = assessmentSnapshot.data() as AssessmentRecord | undefined;
    const reviewIds = assessmentValue?.status === 'official_ready' ? assessmentValue.officialResult.reviewIds : [];
    const reviewReferences = reviewIds.map((reviewId) => assessmentReference.collection(COLLECTIONS.SCORE_REVIEWS).doc(reviewId));
    const reviewSnapshots = reviewReferences.length ? await transaction.getAll(...reviewReferences) : [];
    const resolutionSnapshot = assessmentValue?.status === 'official_ready' && assessmentValue.officialResult.resolutionId
      ? await transaction.get(assessmentReference.collection(COLLECTIONS.SCORE_RESOLUTIONS).doc(assessmentValue.officialResult.resolutionId))
      : undefined;
    assertOfficialAssessmentReady(
      event,
      versionId,
      assessmentValue,
      resourceSnapshot.data() as ResourceRecommendation | undefined,
      version,
      resourceHistorySnapshot.docs.map((document) => document.data() as ResourceRecommendation),
      reviewSnapshots.map((snapshot) => snapshot.data() as AuthorityScoreReview),
      resolutionSnapshot?.data() as AuthorityScoreResolution | undefined,
    );
    const currentAssessment = assessmentSnapshot.data() as AssessmentRecord | undefined;
    if (decision === 'Approved' && currentAssessment && 'complianceStatus' in currentAssessment && currentAssessment.complianceStatus === 'blocked') {
      throw new HttpsError('failed-precondition', 'Blocked compliance prevents approval. Record a rejection or amendment recommendation instead.');
    }
    if (current && current.decision === decision && current.rationale === rationale
      && current.suggestion === suggestion && current.materialsReviewed === materialsReviewed && current.reviewerId === uid) {
      return { eventId, versionId, decisionId, decision, status: event.status, idempotent: true };
    }
    if (!['Pending', 'UnderReview'].includes(event.status)) {
      throw new HttpsError('failed-precondition', 'This application version is no longer open for review.');
    }
    if (!versionSnapshot.exists) throw new HttpsError('failed-precondition', 'The immutable application version is missing.');

    const decisionReferences = event.requiredAuthorities.map((authority) =>
      eventReference.collection(COLLECTIONS.DECISIONS).doc(currentDecisionId(versionId, authority)));
    const decisionSnapshots = await transaction.getAll(...decisionReferences);
    const decisions = new Map<AuthorityType, DecisionValue>();
    decisionSnapshots.forEach((snapshot) => {
      const value = snapshot.data() as AuthorityDecision | undefined;
      if (value?.versionId === versionId && value.current) decisions.set(value.authorityType, value.decision);
    });
    decisions.set(profile.authorityType, decision);
    const allOfficersCompleted = event.requiredAuthorities.every((authority) => decisions.has(authority));
    const aggregateStatus = aggregateDecisionStatus(event.requiredAuthorities, decisions);
    if (!version) throw new HttpsError('failed-precondition', 'The immutable application version is missing.');
    const authorityDecision: AuthorityDecision = {
      decisionId,
      eventId,
      versionId,
      authorityType: profile.authorityType,
      decision,
      rationale,
      ...(suggestion ? { suggestion } : {}),
      ...(decision === 'Approved' ? { materialsReviewed: true } : {}),
      reviewerId: uid,
      decidedAt: now,
      current: true,
    };
    const historyId = `${decisionId}_${now}_${createHash('sha256').update(stableStringify({ decision, rationale, suggestion, materialsReviewed })).digest('hex').slice(0, 12)}`;
    const historyReference = eventReference.collection(COLLECTIONS.DECISION_HISTORY).doc(historyId);
    const auditReference = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${historyId}_decision`);

    transaction.set(currentReference, authorityDecision);
    transaction.create(historyReference, { ...authorityDecision, decisionId: historyId, current: false });
    transaction.update(eventReference, {
      status: aggregateStatus,
      authorityReviewCompletedAt: allOfficersCompleted ? now : firestore.FieldValue.delete(),
      authorityReviewCompletedVersionId: allOfficersCompleted ? versionId : firestore.FieldValue.delete(),
      updatedAt: now,
    });
    transaction.create(auditReference, {
      id: auditReference.id,
      eventId,
      versionId,
      action: 'decision_made',
      actorId: uid,
      actorRole: 'authority',
      timestamp: now,
      previousStatus: event.status,
      newStatus: aggregateStatus,
      notes: rationale,
      metadata: { authorityType: profile.authorityType, decision, suggestion: suggestion ?? null, materialsReviewed: materialsReviewed ?? false, readyForSecondReview: allOfficersCompleted },
    });

    return { eventId, versionId, decisionId, decision, status: aggregateStatus, idempotent: false };
  });
}

export function assertOfficialAssessmentReady(
  event: Pick<EventRecord, 'eventId' | 'currentAssessmentId' | 'currentResourceId' | 'requiredAuthorities'>,
  versionId: string,
  assessment: AssessmentRecord | undefined,
  resources: ResourceRecommendation | undefined,
  version: EventVersion | undefined,
  resourceHistory: ResourceRecommendation[] = resources ? [resources] : [],
  reviews: AuthorityScoreReview[] = [],
  resolution?: AuthorityScoreResolution,
): void {
  const validAssessment = isValidOfficialAssessment(
    assessment,
    event.eventId,
    event.currentAssessmentId,
    versionId,
    event.requiredAuthorities,
    version,
    reviews,
    resolution,
  );
  const validHardRuleFloors = assessment?.status === 'official_ready' && version
    ? assessmentSatisfiesCurrentHardRules(assessment, event.eventId, version)
    : false;
  const officialAssessment = assessment?.status === 'official_ready' ? assessment : undefined;
  const expectedCalculation = officialAssessment && version
    ? computeResources({
        eventId: event.eventId,
        versionId,
        assessmentId: officialAssessment.assessmentId,
        eventDetails: version.eventDetails,
        assessmentResult: officialAssessment.officialResult,
      })
    : undefined;
  const expectedHash = expectedCalculation?.ok ? expectedCalculation.resourceInputHash : undefined;
  const validResources = isValidOfficialResources(
    resources,
    event.eventId,
    versionId,
    officialAssessment?.assessmentId,
    expectedHash,
    expectedCalculation?.ok ? expectedCalculation.items : undefined,
  );
  const official = isRecord(assessment) && isRecord(assessment.officialResult) ? assessment.officialResult : undefined;
  const proposal = isRecord(assessment) && isRecord(assessment.aiProposal) ? assessment.aiProposal : undefined;
  const reference = resources?.assessmentReference;
  const boundToAssessment = Boolean(reference?.stage === 'official'
    && reference.assessmentId === assessment?.assessmentId
    && reference.proposalId === proposal?.proposalId
    && reference.finalizedAt === official?.finalizedAt
    && reference.finalizedBy === official?.finalizedBy);
  if (!event.currentAssessmentId
    || event.currentAssessmentId !== assessment?.assessmentId
    || !event.currentResourceId
    || event.currentResourceId !== resources?.resourceId
    || version?.eventId !== event.eventId
    || version?.versionId !== versionId
    || !validAssessment
    || !validHardRuleFloors
    || !validResources
    || validateResourceRevisionChain(resourceHistory, resources?.resourceId ?? '').length > 0
    || !boundToAssessment) {
    throw new HttpsError('failed-precondition', 'An official risk assessment and resources are required before a final decision.');
  }
}

function assessmentSatisfiesCurrentHardRules(
  assessment: Extract<AssessmentRecord, { status: 'official_ready' }>,
  eventId: string,
  version: EventVersion,
): boolean {
  try {
    if (!assessment.contextSnapshot) return false;
    const baseline = computeCategoryBasedAssessment(
      { eventId, eventDetails: version.eventDetails } as EventRecord,
      assessment.contextSnapshot,
      assessment.createdAt,
    );
    const floors = new Map<string, ReturnType<typeof evaluateCategoryHardRules>[number]>(
      evaluateCategoryHardRules(baseline).map((rule) => [rule.categoryId, rule]),
    );
    return validateAssessmentResultAgainstProposal(assessment.provisionalResult, assessment.aiProposal).length === 0
      && validateAssessmentResultAgainstHardRules(assessment.provisionalResult, baseline).length === 0
      && [assessment.provisionalResult, assessment.officialResult].every((result) =>
      result.categories.every((category) => {
        const floor = floors.get(category.categoryId);
        return Boolean(floor
          && category.validatedLikelihood >= floor.likelihoodFloor
          && category.validatedSeverity >= floor.severityFloor);
      }));
  } catch {
    return false;
  }
}

function isValidOfficialAssessment(
  assessment: AssessmentRecord | undefined,
  eventId: string,
  assessmentId: string | undefined,
  versionId: string,
  requiredAuthorities: AuthorityType[],
  version: EventVersion | undefined,
  reviews: AuthorityScoreReview[],
  resolution?: AuthorityScoreResolution,
): boolean {
  if (!assessment || assessment.status !== 'official_ready' || !version) return false;
  if (assessment.schemaVersion !== ASSESSMENT_SCHEMA_VERSION
    || assessment.assessmentId !== assessmentId
    || assessment.eventId !== eventId
    || assessment.versionId !== versionId
    || assessment.aiProposal.status !== 'success'
    || assessment.provisionalResult.proposalId !== assessment.aiProposal.proposalId
    || assessment.officialResult.proposalId !== assessment.aiProposal.proposalId
    || !assessment.authorityReviewState
    || stableStringify(assessment.authorityReviewState.requiredAuthorities) !== stableStringify(requiredAuthorities)
    || assessment.authorityReviewState.requiredAuthorities.length === 0
    || validateProvisionalAssessmentResult(assessment.provisionalResult).length > 0
    || validateAssessmentResultAgainstProposal(assessment.provisionalResult, assessment.aiProposal).length > 0) return false;
  try {
    const expected = buildOfficialAssessmentResult({
      assessment,
      eventDetails: version.eventDetails,
      requiredAuthorities: assessment.authorityReviewState.requiredAuthorities,
      reviews,
      resolution,
      finalizedAt: assessment.officialResult.finalizedAt,
      finalizedBy: assessment.officialResult.finalizedBy,
    });
    const expectedHeads = new Set(Object.values(assessment.authorityReviewState.activeReviewHeads).map((head) => head?.reviewId));
    return reviews.length === assessment.authorityReviewState.requiredAuthorities.length
      && reviews.every((review) => expectedHeads.has(review.reviewId))
      && assessment.officialResult.reviewIds.every((reviewId) => expectedHeads.has(reviewId))
      && assessment.authorityReviewState.conflicts.length === (resolution ? resolution.categories.length : 0)
      && assessment.authorityReviewState.activeResolutionId === resolution?.resolutionId
      && stableStringify(expected) === stableStringify(assessment.officialResult);
  } catch {
    return false;
  }
}

function isValidOfficialResources(
  resources: ResourceRecommendation | undefined,
  eventId: string,
  versionId: string,
  assessmentId: string | undefined,
  expectedHash: string | undefined,
  expectedItems: ResourceRecommendation['items'] | undefined,
): boolean {
  return Boolean(resources
    && expectedHash
    && resources.eventId === eventId
    && resources.versionId === versionId
    && resources.assessmentId === assessmentId
    && resources.stage === 'official'
    && resources.formulaVersion === RESOURCE_FORMULA_VERSION
    && resources.configVersion === RESOURCE_CONFIG_VERSION
    && resources.sourceRegistryVersion === RESOURCE_SOURCE_REGISTRY_VERSION
    && resources.resourceInputHash === expectedHash
    && expectedItems
    && matchesDeterministicResourceItems(resources.items, expectedItems)
    && validateResourceRecommendation(resources).ok);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateDecisionRequest(request: unknown): {
  eventId: string;
  decision: DecisionValue;
  rationale: string;
  suggestion?: string;
  materialsReviewed?: boolean;
} {
  const value = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {};
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
  const decision = value.decision;
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!isDecision(decision)) throw new HttpsError('invalid-argument', 'A valid decision is required.');
  if (rationale.length < 10 || rationale.length > 1_000) {
    throw new HttpsError('invalid-argument', 'Rationale must be between 10 and 1,000 characters.');
  }
  if (decision === 'Approved' && value.materialsReviewed !== true) {
    throw new HttpsError('invalid-argument', 'Confirm review of all listed materials before approval.');
  }
  const suggestion = typeof value.suggestion === 'string' ? value.suggestion.trim() : '';
  if (decision !== 'Approved' && (suggestion.length < 10 || suggestion.length > 1_000)) {
    throw new HttpsError('invalid-argument', 'A suggestion between 10 and 1,000 characters is required.');
  }
  return {
    eventId,
    decision,
    rationale,
    ...(decision === 'Approved' ? { materialsReviewed: true } : { suggestion }),
  };
}

export function aggregateDecisionStatus(
  requiredAuthorities: AuthorityType[],
  decisions: ReadonlyMap<AuthorityType, DecisionValue>,
): EventRecord['status'] {
  void requiredAuthorities;
  void decisions;
  return 'UnderReview';
}

function currentDecisionId(versionId: string, authorityType: AuthorityType): string {
  return `${versionId}_${authorityType}`;
}

function isDecision(value: unknown): value is DecisionValue {
  return value === 'Approved' || value === 'Rejected' || value === 'AmendmentRequested';
}
