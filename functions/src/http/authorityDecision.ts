import { createHash } from 'node:crypto';
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ASSESSMENT_SCHEMA_VERSION,
  AdminManualAssessment,
  AdminManualOfficialRiskAssessment,
  AssessmentRecord,
  AuthorityScoreResolution,
  AuthorityScoreReview,
  AuthorityDecision,
  AuthorityType,
  COLLECTIONS,
  DecisionValue,
  EventRecord,
  EventVersion,
  PublicEvent,
  RiskAssessment,
  ManualReviewRiskAssessment,
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
  validateManualOfficialAssessmentResult,
  validateProvisionalAssessmentResult,
} from '../engines/resourceCalculator';
import { stableStringify } from '../engines/resourceCalculator';
import { buildOfficialAssessmentResult } from '../engines/authorityFinalisation';
import { validateResourceRecommendation, validateResourceRevisionChain } from '../engines/resourceContract';
import { computeCategoryBasedAssessment } from '../engines/ruleBased';
import { evaluateCategoryHardRules } from '../engines/hardRuleEvaluator';
import { buildManualOfficialAssessmentResult } from '../engines/manualFinalisation';
import { createNotification, resolveAuthUid } from '../utils/notifications';

interface AuthorityDecisionRequest {
  eventId?: string;
  decision?: DecisionValue;
  rationale?: string;
  /**
   * FR-M3-16: required when `decision === 'Approved'` (officer must
   * confirm review of all listed materials). Defensive gate on the
   * legacy path; the new officer flow uses `recordOfficerProposal`
   * which has the same gate. Defaults to false.
   */
  confirmedReview?: boolean;
  suggestion?: string;
  materialsReviewed?: boolean;
}

/** Minimum rationale length when the assessment is provisional / insufficient. */
const PROVISIONAL_MIN_RATIONALE = 80;
/** Standard rationale length floor (FR-M3-16: 10–1000 chars). */
const STANDARD_MIN_RATIONALE = 10;

export const makeAuthorityDecision = onCall<AuthorityDecisionRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before reviewing an application.');
  try {
    return await makeAuthorityDecisionForUser(request.auth.uid, request.data);
  } catch (err) {
    if (err instanceof HttpsError) {
      console.warn(`[makeAuthorityDecision] HttpsError ${err.code}: ${err.message}`);
      throw err;
    }
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(`[makeAuthorityDecision] unexpected error: ${message}`);
    throw new HttpsError('internal', message.slice(0, 500));
  }
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
  const publicReference = db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId);

  // Capture for the post-transaction notification step.
  let notifCtxOut: { organizerId: string; aggregateStatus: EventRecord['status']; authorityType: AuthorityType; versionId: string } | null = null;

  const result = await db.runTransaction(async (transaction) => {
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
    // The named-officer workflow is the only supported approval path once
    // an event has been assigned. Keeping the legacy callable closed here
    // prevents a stale client (or direct callable invocation) from bypassing
    // officer proposals and the admin's second-review decision.
    if ((event.assignedOfficerUids?.length ?? 0) > 0 || event.reviewStage === 'authority' || event.reviewStage === 'second') {
      throw new HttpsError(
        'failed-precondition',
        'This application uses named officer proposals. Record the proposal from the authority review workspace.',
      );
    }
    const versionId = event.currentVersionId;
    const assessmentId = event.currentAssessmentId;
    if (!isSafeDocumentId(versionId) || !isSafeDocumentId(assessmentId)
      || (event.currentResourceId !== undefined && !isSafeDocumentId(event.currentResourceId))) {
      throw new HttpsError('failed-precondition', 'The application current-generation pointers are invalid.');
    }
    if (!validRequiredAuthorities(event.requiredAuthorities) || !event.requiredAuthorities.includes(profile.authorityType)) {
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
    const manualOfficial = isManualOfficialAssessment(assessmentValue);
    if (assessmentValue?.status === 'official_ready' && 'sourceKind' in assessmentValue && assessmentValue.sourceKind === 'admin_manual' && !manualOfficial) {
      throw new HttpsError('failed-precondition', 'The manual official assessment contract is invalid.');
    }
    const reviewIds = assessmentValue?.status === 'official_ready' && !manualOfficial
      && isRecord(assessmentValue.officialResult) && Array.isArray(assessmentValue.officialResult.reviewIds)
      ? assessmentValue.officialResult.reviewIds : [];
    const reviewReferences = reviewIds.map((reviewId) => assessmentReference.collection(COLLECTIONS.SCORE_REVIEWS).doc(reviewId));
    const reviewSnapshots = reviewReferences.length ? await transaction.getAll(...reviewReferences) : [];
    const resolutionSnapshot = assessmentValue?.status === 'official_ready' && !manualOfficial
      && isRecord(assessmentValue.officialResult) && assessmentValue.officialResult.resolutionId
      ? await transaction.get(assessmentReference.collection(COLLECTIONS.SCORE_RESOLUTIONS).doc(assessmentValue.officialResult.resolutionId))
      : undefined;
    const manualSnapshot = manualOfficial
      ? await transaction.get(assessmentReference.collection(COLLECTIONS.MANUAL_ASSESSMENTS).doc(assessmentValue.activeManualAssessmentId))
      : undefined;
    if (resourceHistorySnapshot.docs.some((document) => {
      const resource = document.data();
      return resource?.resourceId !== document.id || resource.eventId !== eventId || resource.versionId !== versionId;
    })) {
      throw new HttpsError('failed-precondition', 'The official resource revision history is invalid.');
    }
    if (reviewSnapshots.some((snapshot) => snapshot.data()?.reviewId !== snapshot.id)
      || (resolutionSnapshot && resolutionSnapshot.data()?.resolutionId !== resolutionSnapshot.id)
      || (manualSnapshot && manualSnapshot.data()?.manualAssessmentId !== manualSnapshot.id)) {
      throw new HttpsError('failed-precondition', 'The official provenance document identities are invalid.');
    }
    assertOfficialAssessmentReady(
      event,
      versionId,
      assessmentValue,
      resourceSnapshot.data() as ResourceRecommendation | undefined,
      version,
      resourceHistorySnapshot.docs.map((document) => document.data() as ResourceRecommendation),
      reviewSnapshots.map((snapshot) => snapshot.data() as AuthorityScoreReview),
      resolutionSnapshot?.data() as AuthorityScoreResolution | undefined,
      manualSnapshot?.data() as AdminManualAssessment | undefined,
    );
    const currentAssessment = assessmentSnapshot.data() as AssessmentRecord | undefined;
    if (decision === 'Approved' && currentAssessment && 'complianceStatus' in currentAssessment && currentAssessment.complianceStatus === 'blocked') {
      throw new HttpsError('failed-precondition', 'Blocked compliance prevents approval. Record a rejection instead.');
    }
    if (current && current.decision === decision && current.rationale === rationale
      && current.suggestion === suggestion && current.materialsReviewed === materialsReviewed && current.reviewerId === uid) {
      return { eventId, versionId, decisionId, decision, status: event.status, idempotent: true };
    }
    if (!['Pending', 'UnderReview'].includes(event.status)) {
      throw new HttpsError('failed-precondition', 'This application version is no longer open for review.');
    }
    if (!versionSnapshot.exists) throw new HttpsError('failed-precondition', 'The immutable application version is missing.');

    // ---- M3 gates: compliance + readiness (FR-M3-14, FR-M3-03 handoff) ----
    const assessment = assessmentSnapshot.data() as RiskAssessment | undefined;
    if (assessment?.complianceStatus === 'blocked' && decision === 'Approved') {
      throw new HttpsError(
        'failed-precondition',
        'This application cannot be approved while M2 compliance status is "blocked". ' +
        'Resolve the blocking compliance checks first or choose Reject.',
      );
    }
    const readiness = assessment?.assessmentReadiness;
    const isProvisional = readiness === 'provisional' || readiness === 'insufficient_data';
    const finalizedAdminManual = assessment?.status === 'official_ready'
      && 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual';
    if (!finalizedAdminManual && isProvisional && rationale.trim().length < PROVISIONAL_MIN_RATIONALE) {
      throw new HttpsError(
        'invalid-argument',
        `When the assessment is ${readiness}, the decision rationale must explain the gap ` +
        `(at least ${PROVISIONAL_MIN_RATIONALE} characters).`,
      );
    }
    // ---- end M3 gates ----

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
      metadata: {
        authorityType: profile.authorityType,
        decision,
        suggestion: suggestion ?? null,
        materialsReviewed: materialsReviewed ?? false,
        readyForSecondReview: allOfficersCompleted,
        complianceStatus: assessment?.complianceStatus ?? null,
        assessmentReadiness: assessment?.assessmentReadiness ?? null,
      },
    });

    if (aggregateStatus === 'Approved') {
      const details = version.eventDetails;
      const publicEvent: PublicEvent = {
        eventId,
        versionId,
        eventName: details.name,
        venueName: details.venueName,
        eventType: details.type,
        startDatetime: details.startDatetime,
        endDatetime: details.endDatetime,
        approvedBy: event.requiredAuthorities,
        publicStatus: 'approved',
      };
      transaction.set(publicReference, publicEvent);
      const publishAudit = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}_public_published`);
      transaction.set(publishAudit, {
        id: publishAudit.id, eventId, versionId, action: 'public_published', actorId: 'system', actorRole: 'system', timestamp: now,
        metadata: { approvedBy: event.requiredAuthorities },
      });
    } else {
      transaction.delete(publicReference);
    }

    if (event.organizerId) {
      const ctx: { organizerId: string; aggregateStatus: EventRecord['status']; authorityType: AuthorityType; versionId: string } = {
        organizerId: event.organizerId,
        aggregateStatus,
        authorityType: profile.authorityType,
        versionId,
      };
      notifCtxOut = ctx;
    }

    return { eventId, versionId, decisionId, decision, status: aggregateStatus, idempotent: false };
  });

  // ---- Notify the organiser (FR-M3-08, handoff item 7) ----
  // Idempotent on sourceActionId. A notification write failure MUST NOT
  // roll back a recorded decision.
  const notif = notifCtxOut as { organizerId: string; aggregateStatus: EventRecord['status']; authorityType: AuthorityType; versionId: string } | null;
  if (notif) {
    try {
      // Resolve the auth UID from the user doc (legacy organizerId format
      // like "usr-org-002" doesn't match any real user; convention is
      // userDocId === authUid, so we look up the user doc).
      const recipientUid = await resolveAuthUid(notif.organizerId);
      if (!recipientUid) {
        console.warn(`[makeAuthorityDecision] skipping notification: no recipientUid for organizerId=${notif.organizerId}`);
      } else {
      const notifType =
        notif.aggregateStatus === 'Approved' ? 'application_approved'
        : notif.aggregateStatus === 'Rejected' ? 'application_rejected'
        : 'decision_made';
      const notifTitle =
        notif.aggregateStatus === 'Approved' ? 'Application approved'
        : notif.aggregateStatus === 'Rejected' ? 'Application rejected'
        : 'Decision recorded';
      await createNotification({
        recipientUid,
        eventId,
        versionId: notif.versionId,
        type: notifType,
        title: notifTitle,
        message: `${notif.authorityType} ${decision} the application. See audit trail for rationale.`,
        sourceActionId: `${result.decisionId}_notif`,
      });
      }
    } catch (err) {
      console.warn('[makeAuthorityDecision] notification write failed (non-fatal):', err);
    }
  }

  return result;
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
  manualAssessment?: AdminManualAssessment,
): void {
  if (!validRequiredAuthorities(event.requiredAuthorities)) {
    throw new HttpsError('failed-precondition', 'The assigned authority list is invalid.');
  }
  if (!isSafeDocumentId(event.currentAssessmentId) || !isSafeDocumentId(versionId)
    || (event.currentResourceId !== undefined && !isSafeDocumentId(event.currentResourceId))) {
    throw new HttpsError('failed-precondition', 'The application current-generation pointers are invalid.');
  }
  const validAssessment = isValidOfficialAssessment(
    assessment,
    event.eventId,
    event.currentAssessmentId,
    versionId,
    event.requiredAuthorities,
    version,
    reviews,
    resolution,
    manualAssessment,
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
    && (reference.sourceKind === 'admin_manual'
      ? isManualOfficialAssessment(assessment) && reference.manualAssessmentId === assessment.activeManualAssessmentId
      : reference.proposalId === proposal?.proposalId)
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
    || resourceHistory.some((resource) => resource.eventId !== event.eventId || resource.versionId !== versionId)
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
    if (isManualOfficialAssessment(assessment)) {
      return assessment.officialResult.categories.every((category) => category.validatedLikelihood >= category.manualLikelihood
        && category.validatedSeverity >= category.manualSeverity);
    }
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
  manualAssessment?: AdminManualAssessment,
): boolean {
  if (!assessment || assessment.status !== 'official_ready' || assessment.authorityReviewRequired !== false || !version) return false;
  if (isManualOfficialAssessment(assessment)) {
    if (!manualAssessment || assessment.schemaVersion !== ASSESSMENT_SCHEMA_VERSION
      || assessment.assessmentId !== assessmentId || assessment.eventId !== eventId || assessment.versionId !== versionId
      || !(assessment.aiProposal === null
        ? assessment.assessmentReadiness === 'insufficient_data'
        : isRecord(assessment.aiProposal) && String(assessment.aiProposal.status) !== 'success')
      || assessment.activeManualAssessmentId !== manualAssessment.manualAssessmentId) return false;
    try {
      const expected = buildManualOfficialAssessmentResult({
        assessment: assessment as unknown as ManualReviewRiskAssessment,
        manualAssessment, eventDetails: version.eventDetails, eventVersionInputHash: version.inputHash,
        finalizedAt: assessment.officialResult.finalizedAt, finalizedBy: assessment.officialResult.finalizedBy,
      });
      return stableStringify(expected) === stableStringify(assessment.officialResult);
    } catch { return false; }
  }
  if (!isRecord(assessment.aiProposal)
    || assessment.aiProposal.status !== 'success'
    || !isRecord(assessment.provisionalResult)
    || !isRecord(assessment.officialResult)
    || !isRecord(assessment.authorityReviewState)
    || !Array.isArray(assessment.aiProposal.categories)
    || !Array.isArray(assessment.aiProposal.hazards)
    || !assessment.aiProposal.categories.every((category) => isRecord(category))
    || !assessment.aiProposal.hazards.every((hazard) => isRecord(hazard))
    || !Array.isArray(assessment.provisionalResult.categories)
    || !Array.isArray(assessment.provisionalResult.validatedHazards)
    || !Array.isArray(assessment.officialResult.categories)
    || !Array.isArray(assessment.authorityReviewState.requiredAuthorities)
    || !isRecord(assessment.authorityReviewState.activeReviewHeads)
    || !Array.isArray(assessment.authorityReviewState.conflicts)) return false;
  const activeHeadIds = Object.values(assessment.authorityReviewState.activeReviewHeads)
    .map((head) => isRecord(head) ? head.reviewId : undefined);
  if (activeHeadIds.length !== assessment.authorityReviewState.requiredAuthorities.length
    || activeHeadIds.some((reviewId) => typeof reviewId !== 'string' || !reviewId)
    || new Set(activeHeadIds).size !== activeHeadIds.length) return false;
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

function isManualOfficialAssessment(value: AssessmentRecord | undefined): value is AdminManualOfficialRiskAssessment {
  return Boolean(value && value.status === 'official_ready' && 'sourceKind' in value && value.sourceKind === 'admin_manual'
    && value.authorityReviewRequired === false
    && ['complete', 'provisional', 'insufficient_data'].includes(value.assessmentReadiness)
    && ['pass', 'review_required', 'blocked'].includes(value.complianceStatus)
    && Number.isFinite(value.dataConfidenceScore)
    && Number.isFinite(value.createdAt)
    && ['low', 'medium', 'high'].includes(value.dataConfidenceLevel)
    && isSafeManualAssessmentId(value.activeManualAssessmentId)
    && value.officialResult?.sourceKind === 'admin_manual'
    && value.officialResult.manualAssessmentId === value.activeManualAssessmentId
    && validateManualOfficialAssessmentResult(value.officialResult).length === 0);
}

function isSafeManualAssessmentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isSafeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isValidOfficialResources(
  resources: ResourceRecommendation | undefined,
  eventId: string,
  versionId: string,
  assessmentId: string | undefined,
  expectedHash: string | undefined,
  expectedItems: ResourceRecommendation['items'] | undefined,
): boolean {
  return Boolean(isRecord(resources)
    && expectedHash
    && resources.eventId === eventId
    && resources.versionId === versionId
    && resources.assessmentId === assessmentId
    && resources.stage === 'official'
    && resources.formulaVersion === RESOURCE_FORMULA_VERSION
    && resources.configVersion === RESOURCE_CONFIG_VERSION
    && resources.sourceRegistryVersion === RESOURCE_SOURCE_REGISTRY_VERSION
    && resources.resourceInputHash === expectedHash
    && resources.resourceId === `official-${versionId}-${expectedHash}`
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
  if (!isSafeDocumentId(eventId)) throw new HttpsError('invalid-argument', 'eventId must be a valid document id.');
  if (!isDecision(decision)) throw new HttpsError('invalid-argument', 'A valid decision is required.');
  if (rationale.length < STANDARD_MIN_RATIONALE || rationale.length > 1_000) {
    throw new HttpsError('invalid-argument', `Rationale must be between ${STANDARD_MIN_RATIONALE} and 1,000 characters.`);
  }
  if (decision === 'Approved' && value.materialsReviewed !== true && value.confirmedReview !== true) {
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
  return value === 'Approved' || value === 'Rejected';
}

function validRequiredAuthorities(value: unknown): value is AuthorityType[] {
  const allowed = new Set<AuthorityType>(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);
  return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length
    && value.every((authority) => allowed.has(authority));
}
