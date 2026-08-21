import { createHash } from 'node:crypto';
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ASSESSMENT_SCHEMA_VERSION,
  AssessmentRecord,
  AuthorityReviewState,
  AuthorityScoreResolution,
  AuthorityScoreReview,
  AuthorityType,
  COLLECTIONS,
  EventRecord,
  EventVersion,
  OrganizerAssessmentSummary,
  OrganizerResourceRecommendation,
  OfficialRiskAssessment,
  RESOURCE_CONFIG_VERSION,
  RESOURCE_FORMULA_VERSION,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  RESOURCE_SOURCE_REGISTRY_VERSION,
  ResourceRecommendation,
  SCORE_RESOLUTION_SCHEMA_VERSION,
  SCORE_REVIEW_SCHEMA_VERSION,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { RESOURCE_CUTOVER_LOCK_PATH } from '../config/resourceCutoverLock';
import {
  ResolutionInput,
  ScoreReviewInput,
  buildAuthorityReviewState,
  buildOfficialAssessmentResult,
  validateResolutionInput,
  validateScoreReviewInput,
} from '../engines/authorityFinalisation';
import { computeResources, stableStringify } from '../engines/resourceCalculator';
import { validateResourceRecommendation, validateResourceRevisionChain } from '../engines/resourceContract';
import { resourceDocumentId } from '../triggers/onEventCreated';

interface SubmitReviewRequest extends ScoreReviewInput { eventId?: string }
interface ResolveConflictRequest extends ResolutionInput { eventId?: string }
interface RetryFinalisationRequest { eventId?: string }

export const submitAuthorityScoreReview = onCall<SubmitReviewRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before reviewing an assessment.');
  return submitScoreReviewForUser(request.auth.uid, request.data);
});

export const resolveAuthorityScoreConflict = onCall<ResolveConflictRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before resolving a score conflict.');
  return resolveScoreConflictForAdmin(request.auth.uid, request.data);
});

export const retryOfficialFinalisation = onCall<RetryFinalisationRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before retrying finalisation.');
  const eventId = requiredId(request.data?.eventId, 'eventId');
  return retryOfficialFinalisationForAdmin(request.auth.uid, eventId);
});

export async function retryOfficialFinalisationForAdmin(
  uid: string,
  eventId: string,
  now = Date.now(),
  hooks: { beforeFailureAudit?: () => Promise<void> } = {},
) {
  const identity = await readFinalizationIdentity(eventId);
  try {
    return await finalizeStoredReviewState(uid, eventId, true, now);
  } catch (error) {
    await hooks.beforeFailureAudit?.();
    if (identity && shouldAuditFinalizationFailure(error)) {
      await recordFinalizationFailure(eventId, identity.versionId, identity.assessmentId, now, error);
    }
    throw error;
  }
}

export async function submitScoreReviewForUser(uid: string, data: SubmitReviewRequest, now = Date.now()) {
  const eventId = requiredId(data?.eventId, 'eventId');
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userRef = db.collection(COLLECTIONS.USERS).doc(uid);
  const persisted = await db.runTransaction(async (transaction) => {
    const [userSnap, eventSnap, lockSnap] = await Promise.all([
      transaction.get(userRef), transaction.get(eventRef), transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    assertNoCutover(lockSnap);
    const profile = userSnap.data() as UserProfile | undefined;
    if (profile?.role !== 'authority' || !profile.authorityType) throw new HttpsError('permission-denied', 'Only assigned authority officers may submit score reviews.');
    const event = eventSnap.data() as EventRecord | undefined;
    if (!event) throw new HttpsError('not-found', 'The event was not found.');
    const { versionId, assessmentId } = assertReviewableEvent(event, profile.authorityType);
    const assessmentRef = eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(assessmentId);
    const summaryRef = eventRef.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(versionId);
    const versionRef = eventRef.collection(COLLECTIONS.VERSIONS).doc(versionId);
    const [assessmentSnap, versionSnap, summarySnap] = await Promise.all([transaction.get(assessmentRef), transaction.get(versionRef), transaction.get(summaryRef)]);
    const assessment = assessmentSnap.data() as AssessmentRecord | undefined;
    const version = versionSnap.data() as EventVersion | undefined;
    if (!version || version.eventId !== eventId || version.versionId !== versionId) throw new HttpsError('failed-precondition', 'The current immutable event version is missing.');
    if (!assessment || !(assessment.status === 'provisional_ready' || assessment.status === 'authority_review' || assessment.status === 'official_ready')) {
      throw new HttpsError('failed-precondition', 'A current provisional assessment is required.');
    }
    if (assessment.schemaVersion !== ASSESSMENT_SCHEMA_VERSION || assessment.assessmentId !== assessmentId
      || assessment.eventId !== eventId || assessment.versionId !== versionId || assessment.aiProposal.status !== 'success') {
      throw new HttpsError('failed-precondition', 'The assessment contract is invalid or stale.');
    }
    const input: ScoreReviewInput = { categories: data.categories, rationale: data.rationale, idempotencyKey: data.idempotencyKey };
    const errors = validateScoreReviewInput(input, assessment.aiProposal);
    if (errors.length) throw new HttpsError('invalid-argument', `Invalid score review: ${errors.join(', ')}.`);
    const reviewId = scoreReviewId(versionId, profile.authorityType, uid, data.idempotencyKey);
    const reviewRef = assessmentRef.collection(COLLECTIONS.SCORE_REVIEWS).doc(reviewId);
    const currentHeads = assessment.authorityReviewState?.activeReviewHeads ?? {};
    const headRefs = event.requiredAuthorities.flatMap((authority) => {
      const id = currentHeads[authority]?.reviewId;
      return id ? [assessmentRef.collection(COLLECTIONS.SCORE_REVIEWS).doc(id)] : [];
    });
    const [existingReviewSnap, ...remaining] = await Promise.all([
      transaction.get(reviewRef),
      ...(headRefs.length ? [transaction.getAll(...headRefs)] : [Promise.resolve([])]),
    ]);
    const headSnapshots = remaining[0] as FirebaseFirestore.DocumentSnapshot[];
    const proposedReview: AuthorityScoreReview = {
      reviewId,
      schemaVersion: SCORE_REVIEW_SCHEMA_VERSION,
      eventId,
      versionId,
      assessmentId,
      proposalId: assessment.aiProposal.proposalId,
      provisionalCalculatedAt: assessment.provisionalResult.calculatedAt,
      assessmentInputHash: assessment.inputHash,
      categorySchemaVersion: assessment.provisionalResult.categorySchemaVersion,
      authorityType: profile.authorityType,
      reviewerId: uid,
      categories: normalizedCategories(data.categories),
      rationale: data.rationale.trim(),
      idempotencyKey: data.idempotencyKey,
      ...(currentHeads[profile.authorityType]?.reviewId ? { supersedesReviewId: currentHeads[profile.authorityType]!.reviewId } : {}),
      createdAt: now,
    };
    const storedReview = existingReviewSnap.data() as AuthorityScoreReview | undefined;
    if (storedReview && !sameReviewRequest(storedReview, proposedReview)) {
      throw new HttpsError('already-exists', 'The idempotency key is already bound to a different review.');
    }
    if (assessment.status === 'official_ready') {
      if (!storedReview || !assessment.officialResult.reviewIds.includes(storedReview.reviewId)) {
        throw new HttpsError('failed-precondition', 'The official assessment is locked.');
      }
      return { eventId, reviewId, status: 'official_ready' as const, officialResourceId: event.currentResourceId, idempotent: true };
    }
    if (storedReview && currentHeads[profile.authorityType]?.reviewId !== storedReview.reviewId) {
      return {
        eventId,
        versionId,
        assessmentId,
        reviewId,
        status: 'authority_review' as const,
        conflicts: assessment.authorityReviewState?.conflicts ?? [],
        shouldFinalize: false,
        idempotent: true,
      };
    }
    if (storedReview) {
      const currentState = assessment.authorityReviewState;
      const complete = Boolean(currentState && event.requiredAuthorities.every(
        (authority) => currentState.activeReviewHeads[authority]?.reviewId,
      ));
      const shouldFinalize = Boolean(complete && currentState
        && (currentState.conflicts.length === 0 || currentState.activeResolutionId));
      return {
        eventId,
        versionId,
        assessmentId,
        reviewId,
        status: 'authority_review' as const,
        conflicts: currentState?.conflicts ?? [],
        shouldFinalize,
        idempotent: true,
      };
    }
    const review = storedReview ?? proposedReview;
    const reviews = headSnapshots.map((snapshot) => snapshot.data() as AuthorityScoreReview)
      .filter((candidate) => candidate.authorityType !== profile.authorityType);
    reviews.push(review);
    const state = buildAuthorityReviewState(event.requiredAuthorities, reviews, now);
    if (!existingReviewSnap.exists) {
      transaction.create(reviewRef, review);
      writeReviewAudit(transaction, eventRef, review, Boolean(review.supersedesReviewId));
    }
    transaction.set(assessmentRef, { status: 'authority_review', authorityReviewState: state }, { merge: true });
    transaction.update(eventRef, { updatedAt: now });
    if (summarySnap.exists) transaction.set(summaryRef, {
      status: 'authority_review',
      authorityReviewRequired: true,
      authorityReviewProgress: { completed: Object.keys(state.activeReviewHeads).length, required: event.requiredAuthorities.length },
      computedAt: now,
    }, { merge: true });
    if (reviews.length === event.requiredAuthorities.length && state.conflicts.length === 0) {
      return { eventId, versionId, assessmentId, reviewId, status: 'authority_review' as const, shouldFinalize: true, idempotent: existingReviewSnap.exists };
    }
    if (!existingReviewSnap.exists && state.conflicts.length > 0) writeConflictAudit(transaction, eventRef, versionId, state, now);
    return { eventId, reviewId, status: 'authority_review' as const, conflicts: state.conflicts, shouldFinalize: false, idempotent: existingReviewSnap.exists };
  });
  if (!('shouldFinalize' in persisted) || !persisted.shouldFinalize) return persisted;
  try {
    const finalized = await finalizeStoredReviewState(uid, eventId, false, now);
    return { ...persisted, status: 'official_ready' as const, officialResourceId: finalized.officialResourceId };
  } catch (error) {
    if (persisted.versionId && persisted.assessmentId) {
      await recordFinalizationFailure(eventId, persisted.versionId, persisted.assessmentId, now, error);
    }
    throw error;
  }
}

export async function resolveScoreConflictForAdmin(uid: string, data: ResolveConflictRequest, now = Date.now()) {
  const eventId = requiredId(data?.eventId, 'eventId');
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const persisted = await db.runTransaction(async (transaction) => {
    const [userSnap, eventSnap, lockSnap] = await Promise.all([
      transaction.get(db.collection(COLLECTIONS.USERS).doc(uid)), transaction.get(eventRef), transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    assertNoCutover(lockSnap);
    if ((userSnap.data() as UserProfile | undefined)?.role !== 'admin') throw new HttpsError('permission-denied', 'Only an administrator may resolve score conflicts.');
    const event = eventSnap.data() as EventRecord | undefined;
    if (!event?.currentVersionId || !event.currentAssessmentId || !['Pending', 'UnderReview'].includes(event.status)) {
      throw new HttpsError('failed-precondition', 'The event is not open for score resolution.');
    }
    if (!validRequiredAuthorities(event.requiredAuthorities)) throw new HttpsError('failed-precondition', 'The assigned authority list is invalid.');
    const assessmentRef = eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId);
    const versionRef = eventRef.collection(COLLECTIONS.VERSIONS).doc(event.currentVersionId);
    const [assessmentSnap, versionSnap] = await Promise.all([transaction.get(assessmentRef), transaction.get(versionRef)]);
    const assessment = assessmentSnap.data() as AssessmentRecord | undefined;
    const version = versionSnap.data() as EventVersion | undefined;
    if (!assessment || !version || !isCurrentAssessmentIdentity(assessment, eventId, event.currentAssessmentId, version, event.currentVersionId)) {
      throw new HttpsError('failed-precondition', 'The current assessment contract is invalid or stale.');
    }
    const resolutionId = scoreResolutionId(event.currentVersionId, uid, data);
    const resolutionRef = assessmentRef.collection(COLLECTIONS.SCORE_RESOLUTIONS).doc(resolutionId);
    if (assessment.status === 'official_ready') {
      const stored = (await transaction.get(resolutionRef)).data() as AuthorityScoreResolution | undefined;
      if (!stored || assessment.officialResult.resolutionId !== resolutionId
        || !sameResolutionRequest(stored, uid, data, { resolutionId, eventId, versionId: event.currentVersionId, assessmentId: event.currentAssessmentId })) {
        throw new HttpsError('failed-precondition', 'The official assessment is locked.');
      }
      return {
        eventId,
        resolutionId,
        status: 'official_ready' as const,
        officialResourceId: event.currentResourceId,
        shouldFinalize: false,
        idempotent: true,
      };
    }
    if (assessment.status !== 'authority_review' || !assessment.authorityReviewState) {
      throw new HttpsError('failed-precondition', 'A current authority score conflict is required.');
    }
    const errors = validateResolutionInput(data, assessment.authorityReviewState);
    if (errors.length) throw new HttpsError(errors.includes('stale-review-heads') ? 'aborted' : 'invalid-argument', `Invalid score resolution: ${errors.join(', ')}.`);
    const headIds = event.requiredAuthorities.map((authority) => assessment.authorityReviewState!.activeReviewHeads[authority]!.reviewId);
    const headRefs = headIds.map((id) => assessmentRef.collection(COLLECTIONS.SCORE_REVIEWS).doc(id));
    const [reviewSnaps, existingResolutionSnap] = await Promise.all([
      transaction.getAll(...headRefs), transaction.get(resolutionRef),
    ]);
    const reviews = reviewSnaps.map((snapshot) => snapshot.data() as AuthorityScoreReview);
    if (reviews.length !== event.requiredAuthorities.length) throw new HttpsError('failed-precondition', 'The active authority reviews are incomplete.');
    const proposedResolution: AuthorityScoreResolution = {
      resolutionId,
      schemaVersion: SCORE_RESOLUTION_SCHEMA_VERSION,
      eventId,
      versionId: event.currentVersionId,
      assessmentId: event.currentAssessmentId,
      reviewHeadIds: { ...data.reviewHeadIds },
      categories: data.categories.map((category) => ({ ...category, reason: category.reason.trim() })),
      resolvedBy: uid,
      rationale: data.rationale.trim(),
      createdAt: now,
    };
    const storedResolution = existingResolutionSnap.data() as AuthorityScoreResolution | undefined;
    if (storedResolution && !sameResolutionRequest(storedResolution, uid, data, {
      resolutionId, eventId, versionId: event.currentVersionId, assessmentId: event.currentAssessmentId,
    })) {
      throw new HttpsError('already-exists', 'This resolution is already bound to different content.');
    }
    const resolution = storedResolution ?? proposedResolution;
    if (!existingResolutionSnap.exists) transaction.create(resolutionRef, resolution);
    const state: AuthorityReviewState = { ...assessment.authorityReviewState, activeResolutionId: resolutionId, updatedAt: now };
    if (!existingResolutionSnap.exists) {
      transaction.set(assessmentRef, { authorityReviewState: state }, { merge: true });
      transaction.update(eventRef, { updatedAt: now });
      const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${resolutionId}-resolved`);
      transaction.create(auditRef, auditRecord(auditRef.id, eventId, event.currentVersionId, 'score_conflict_resolved', uid, 'admin', resolution.createdAt, { resolutionId, reviewHeadIds: headIds }));
    }
    return {
      eventId,
      versionId: event.currentVersionId,
      assessmentId: event.currentAssessmentId,
      resolutionId,
      status: 'authority_review' as const,
      shouldFinalize: true,
      idempotent: existingResolutionSnap.exists,
    };
  });
  if (!persisted.shouldFinalize) return persisted;
  try {
    const finalized = await finalizeStoredReviewState(uid, eventId, true, now);
    return { ...persisted, status: 'official_ready' as const, officialResourceId: finalized.officialResourceId };
  } catch (error) {
    if (persisted.versionId && persisted.assessmentId) {
      await recordFinalizationFailure(eventId, persisted.versionId, persisted.assessmentId, now, error);
    }
    throw error;
  }
}

export async function finalizeStoredReviewState(uid: string, eventId: string, requireAdmin = true, now = Date.now()) {
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  return db.runTransaction(async (transaction) => {
    const [profileSnap, eventSnap, lockSnap] = await Promise.all([
      transaction.get(db.collection(COLLECTIONS.USERS).doc(uid)), transaction.get(eventRef), transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    const profile = profileSnap.data() as UserProfile | undefined;
    if (requireAdmin && profile?.role !== 'admin') throw new HttpsError('permission-denied', 'Only an administrator may retry finalisation.');
    assertNoCutover(lockSnap);
    const event = eventSnap.data() as EventRecord | undefined;
    if (!event?.currentVersionId || !event.currentAssessmentId || !['Pending', 'UnderReview'].includes(event.status)) {
      throw new HttpsError('failed-precondition', 'The current event assessment is not open for finalisation.');
    }
    if (!validRequiredAuthorities(event.requiredAuthorities)) throw new HttpsError('failed-precondition', 'The assigned authority list is invalid.');
    const assessmentRef = eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId);
    const [assessmentSnap, versionSnap] = await Promise.all([
      transaction.get(assessmentRef), transaction.get(eventRef.collection(COLLECTIONS.VERSIONS).doc(event.currentVersionId)),
    ]);
    const assessment = assessmentSnap.data() as AssessmentRecord | undefined;
    const version = versionSnap.data() as EventVersion | undefined;
    if (!assessment || !version || !isCurrentAssessmentIdentity(assessment, eventId, event.currentAssessmentId, version, event.currentVersionId)) {
      throw new HttpsError('failed-precondition', 'No finalisable authority review is available.');
    }
    if (assessment.status === 'official_ready') {
      const officialState = assessment.authorityReviewState;
      const officialHeadIds = event.requiredAuthorities.map((authority) => officialState.activeReviewHeads[authority]?.reviewId);
      if (!event.currentResourceId || officialHeadIds.some((reviewId) => !reviewId)) {
        throw new HttpsError('failed-precondition', 'The finalized official resource or review provenance is missing.');
      }
      const officialReviewRefs = officialHeadIds.map((reviewId) => assessmentRef.collection(COLLECTIONS.SCORE_REVIEWS).doc(reviewId!));
      const officialResolutionRef = officialState.activeResolutionId
        ? assessmentRef.collection(COLLECTIONS.SCORE_RESOLUTIONS).doc(officialState.activeResolutionId)
        : undefined;
      const [resourceSnap, officialReviewSnaps, officialResolutionSnap] = await Promise.all([
        transaction.get(eventRef.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId)),
        transaction.getAll(...officialReviewRefs),
        officialResolutionRef ? transaction.get(officialResolutionRef) : Promise.resolve(undefined),
      ]);
      const resource = resourceSnap.data() as ResourceRecommendation | undefined;
      if (!isIdempotentOfficialOutput(
        event,
        version,
        assessment,
        resource,
        officialReviewSnaps.map((snapshot) => snapshot.data() as AuthorityScoreReview),
        officialResolutionSnap?.data() as AuthorityScoreResolution | undefined,
      )) {
        throw new HttpsError('failed-precondition', 'The finalized official output is invalid or stale.');
      }
      return { eventId, status: 'official_ready' as const, officialResourceId: resource.resourceId, idempotent: true };
    }
    if (assessment.status !== 'authority_review' || !assessment.authorityReviewState) {
      throw new HttpsError('failed-precondition', 'No finalisable authority review is available.');
    }
    const headIds = event.requiredAuthorities.map((authority) => assessment.authorityReviewState!.activeReviewHeads[authority]?.reviewId);
    if (headIds.some((id) => !id)) throw new HttpsError('failed-precondition', 'All assigned authorities must submit a score review.');
    const headRefs = headIds.map((id) => assessmentRef.collection(COLLECTIONS.SCORE_REVIEWS).doc(id!));
    const resolutionRef = assessment.authorityReviewState.activeResolutionId
      ? assessmentRef.collection(COLLECTIONS.SCORE_RESOLUTIONS).doc(assessment.authorityReviewState.activeResolutionId)
      : undefined;
    const historyQuery = eventRef.collection(COLLECTIONS.RESOURCES).where('versionId', '==', event.currentVersionId).where('stage', '==', 'official');
    const [reviewSnaps, resolutionSnap, historySnap] = await Promise.all([
      transaction.getAll(...headRefs), resolutionRef ? transaction.get(resolutionRef) : Promise.resolve(undefined), transaction.get(historyQuery),
    ]);
    const reviews = reviewSnaps.map((snapshot) => snapshot.data() as AuthorityScoreReview);
    const resolution = resolutionSnap?.data() as AuthorityScoreResolution | undefined;
    const finalized = finalizeInTransaction(transaction, eventRef, event, version, assessment, assessment.authorityReviewState, reviews, historySnap.docs.map((snapshot) => snapshot.data() as ResourceRecommendation), resolution, now, resolution ? resolution.resolvedBy : 'system');
    return { eventId, status: 'official_ready' as const, officialResourceId: finalized.resourceId };
  });
}

function finalizeInTransaction(
  transaction: FirebaseFirestore.Transaction,
  eventRef: FirebaseFirestore.DocumentReference,
  event: EventRecord,
  version: EventVersion,
  assessment: Extract<AssessmentRecord, { status: 'provisional_ready' | 'authority_review' }>,
  state: AuthorityReviewState,
  reviews: AuthorityScoreReview[],
  officialHistory: ResourceRecommendation[],
  resolution: AuthorityScoreResolution | undefined,
  now: number,
  finalizedBy: string,
) {
  const finalizedAt = now;
  const officialResult = buildOfficialAssessmentResult({ assessment, eventDetails: version.eventDetails, requiredAuthorities: event.requiredAuthorities, reviews, resolution, finalizedAt, finalizedBy });
  const calculation = computeResources({ eventId: event.eventId, versionId: version.versionId, assessmentId: assessment.assessmentId, eventDetails: version.eventDetails, assessmentResult: officialResult });
  if (!calculation.ok) throw new HttpsError('failed-precondition', `Official resource calculation failed: ${calculation.code}.`);
  const validHistory = officialHistory.filter((resource) => validateResourceRecommendation(resource).ok);
  if (validHistory.length !== officialHistory.length) throw new HttpsError('failed-precondition', 'Official resource history is invalid.');
  const resourceId = resourceDocumentId('official', version.versionId, calculation.resourceInputHash);
  const existing = validHistory.find((resource) => resource.resourceId === resourceId);
  const predecessorHistory = validHistory.filter((resource) => resource.resourceId !== resourceId);
  const tip = [...predecessorHistory].sort((a, b) => b.revision - a.revision)[0];
  if (tip && validateResourceRevisionChain(predecessorHistory, tip.resourceId).length) throw new HttpsError('failed-precondition', 'Official resource revision chain is invalid.');
  const items = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, {
    ...calculation.items[key], confidence: 'authority_validated' as const, authorityReviewRequired: false,
  }])) as ResourceRecommendation['items'];
  const expectedResource: ResourceRecommendation = {
    resourceId,
    eventId: event.eventId,
    versionId: version.versionId,
    assessmentId: assessment.assessmentId,
    schemaVersion: RESOURCE_SCHEMA_VERSION,
    stage: 'official',
    revision: tip ? tip.revision + 1 : 1,
    supersedesResourceId: tip?.resourceId ?? null,
    assessmentReference: { stage: 'official', assessmentId: assessment.assessmentId, proposalId: assessment.aiProposal.proposalId, finalizedAt, finalizedBy },
    resourceInputHash: calculation.resourceInputHash,
    formulaVersion: RESOURCE_FORMULA_VERSION,
    configVersion: RESOURCE_CONFIG_VERSION,
    sourceRegistryVersion: RESOURCE_SOURCE_REGISTRY_VERSION,
    items,
    confidenceLevel: 'authority_validated',
    authorityReviewRequired: false,
    notes: 'Official deterministic planning ranges based on finalized human-reviewed risk scores.',
    computedAt: now,
  };
  if (existing && stableStringify(existing) !== stableStringify(expectedResource)) throw new HttpsError('already-exists', 'Official resource identity collision.');
  const resource = existing ?? expectedResource;
  const { activeResolutionId: _staleResolutionId, ...reviewStateWithoutResolution } = state;
  void _staleResolutionId;
  const officialAssessment: OfficialRiskAssessment = {
    ...assessment,
    status: 'official_ready',
    authorityReviewRequired: false,
    authorityReviewState: {
      ...reviewStateWithoutResolution,
      ...(resolution ? { activeResolutionId: resolution.resolutionId } : {}),
      updatedAt: now,
    },
    officialResult,
  };
  const assessmentRef = eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId);
  if (!existing) transaction.create(eventRef.collection(COLLECTIONS.RESOURCES).doc(resourceId), resource);
  transaction.set(assessmentRef, officialAssessment);
  transaction.update(eventRef, { currentResourceId: resourceId, updatedAt: now });
  transaction.set(eventRef.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId), organizerSummary(officialAssessment, resource, now));
  const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${officialResult.officialInputHash}-official-finalized`);
  transaction.create(auditRef, auditRecord(auditRef.id, event.eventId, version.versionId, 'official_assessment_finalized', finalizedBy, finalizedBy === 'system' ? 'system' : 'admin', now, { reviewIds: officialResult.reviewIds, resolutionId: officialResult.resolutionId ?? null, resourceId, officialInputHash: officialResult.officialInputHash }));
  return { resourceId, officialResult };
}

function organizerSummary(assessment: OfficialRiskAssessment, resource: ResourceRecommendation, computedAt: number): OrganizerAssessmentSummary {
  const result = assessment.officialResult;
  const projection: OrganizerResourceRecommendation = {
    resourceId: resource.resourceId,
    revision: resource.revision,
    stage: resource.stage,
    items: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, { baseline: resource.items[key].baseline, planningRange: { ...resource.items[key].planningRange } }])) as OrganizerResourceRecommendation['items'],
    disclaimer: 'Official authority-validated planning ranges for the finalized assessment.',
  };
  return {
    assessmentId: assessment.assessmentId, eventId: assessment.eventId, versionId: assessment.versionId,
    schemaVersion: assessment.schemaVersion, status: assessment.status, overallScore: result.overallScore,
    overallRiskLevel: result.overallRiskLevel,
    categories: result.categories.map((category) => ({ categoryId: category.categoryId, categoryName: category.categoryName, normalizedScore: category.normalizedScore, riskLevel: category.riskLevel })),
    assessmentReadiness: assessment.assessmentReadiness, complianceStatus: assessment.complianceStatus,
    authorityReviewRequired: false,
    authorityReviewProgress: {
      completed: assessment.authorityReviewState.requiredAuthorities.length,
      required: assessment.authorityReviewState.requiredAuthorities.length,
    },
    resourceQuantities: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, resource.items[key].baseline])) as unknown as OrganizerAssessmentSummary['resourceQuantities'],
    resourceRecommendation: projection,
    computedAt,
  };
}

function isIdempotentOfficialOutput(
  event: EventRecord,
  version: EventVersion,
  assessment: OfficialRiskAssessment,
  resource: ResourceRecommendation | undefined,
  reviews: AuthorityScoreReview[],
  resolution: AuthorityScoreResolution | undefined,
): resource is ResourceRecommendation {
  try {
    const expectedResult = buildOfficialAssessmentResult({
      assessment,
      eventDetails: version.eventDetails,
      requiredAuthorities: event.requiredAuthorities,
      reviews,
      resolution,
      finalizedAt: assessment.officialResult.finalizedAt,
      finalizedBy: assessment.officialResult.finalizedBy,
    });
    const calculation = computeResources({
      eventId: event.eventId,
      versionId: version.versionId,
      assessmentId: assessment.assessmentId,
      eventDetails: version.eventDetails,
      assessmentResult: assessment.officialResult,
    });
    if (!resource || !calculation.ok || !validateResourceRecommendation(resource).ok) return false;
    const expectedItems = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, {
      ...calculation.items[key],
      confidence: 'authority_validated' as const,
      authorityReviewRequired: false,
    }])) as ResourceRecommendation['items'];
    return stableStringify(expectedResult) === stableStringify(assessment.officialResult)
      && event.currentResourceId === resource.resourceId
      && resource.resourceId === resourceDocumentId('official', version.versionId, calculation.resourceInputHash)
      && resource.eventId === event.eventId
      && resource.versionId === version.versionId
      && resource.assessmentId === assessment.assessmentId
      && resource.stage === 'official'
      && resource.formulaVersion === RESOURCE_FORMULA_VERSION
      && resource.configVersion === RESOURCE_CONFIG_VERSION
      && resource.sourceRegistryVersion === RESOURCE_SOURCE_REGISTRY_VERSION
      && resource.resourceInputHash === calculation.resourceInputHash
      && resource.assessmentReference.finalizedAt === assessment.officialResult.finalizedAt
      && resource.assessmentReference.finalizedBy === assessment.officialResult.finalizedBy
      && stableStringify(resource.items) === stableStringify(expectedItems);
  } catch {
    return false;
  }
}

function assertReviewableEvent(event: EventRecord | undefined, authority: AuthorityType) {
  if (!event?.currentVersionId || !event.currentAssessmentId || !['Pending', 'UnderReview'].includes(event.status)) throw new HttpsError('failed-precondition', 'The event is not open for authority review.');
  if (!validRequiredAuthorities(event.requiredAuthorities)) throw new HttpsError('failed-precondition', 'The assigned authority list is invalid.');
  if (!event.requiredAuthorities.includes(authority)) throw new HttpsError('permission-denied', 'This authority is not assigned to the event.');
  return { versionId: event.currentVersionId, assessmentId: event.currentAssessmentId };
}

function validRequiredAuthorities(value: unknown): value is AuthorityType[] {
  const allowed = new Set<AuthorityType>(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);
  return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length
    && value.every((authority) => allowed.has(authority));
}

function assertNoCutover(snapshot: FirebaseFirestore.DocumentSnapshot) {
  if (snapshot.exists) throw new HttpsError('unavailable', 'Resource migration is in progress. Retry shortly.');
}

function scoreReviewId(versionId: string, authority: AuthorityType, uid: string, key: string) {
  return `${versionId}-${authority}-${createHash('sha256').update(`${uid}:${key}`).digest('hex').slice(0, 24)}`;
}

function scoreResolutionId(versionId: string, uid: string, input: ResolutionInput) {
  return `${versionId}-resolution-${createHash('sha256').update(stableStringify({ uid, input })).digest('hex').slice(0, 24)}`;
}

function normalizedCategories(categories: AuthorityScoreReview['categories']): AuthorityScoreReview['categories'] {
  return categories.map((category) => category.decision === 'overridden'
    ? { ...category, reason: category.reason.trim() }
    : { categoryId: category.categoryId, likelihood: category.likelihood, severity: category.severity, decision: 'confirmed' as const });
}

function sameReviewRequest(stored: AuthorityScoreReview, proposed: AuthorityScoreReview): boolean {
  return stored.reviewId === proposed.reviewId
    && stored.schemaVersion === proposed.schemaVersion
    && stored.eventId === proposed.eventId
    && stored.versionId === proposed.versionId
    && stored.assessmentId === proposed.assessmentId
    && stored.proposalId === proposed.proposalId
    && stored.provisionalCalculatedAt === proposed.provisionalCalculatedAt
    && stored.assessmentInputHash === proposed.assessmentInputHash
    && stored.categorySchemaVersion === proposed.categorySchemaVersion
    && stored.authorityType === proposed.authorityType
    && stored.reviewerId === proposed.reviewerId
    && stored.rationale === proposed.rationale
    && stored.idempotencyKey === proposed.idempotencyKey
    && stableStringify(stored.categories) === stableStringify(proposed.categories);
}

function sameResolutionRequest(
  stored: AuthorityScoreResolution,
  resolvedBy: string,
  input: ResolutionInput,
  identity: Pick<AuthorityScoreResolution, 'resolutionId' | 'eventId' | 'versionId' | 'assessmentId'>,
): boolean {
  return stored.schemaVersion === SCORE_RESOLUTION_SCHEMA_VERSION
    && stored.resolutionId === identity.resolutionId
    && stored.eventId === identity.eventId
    && stored.versionId === identity.versionId
    && stored.assessmentId === identity.assessmentId
    && stored.resolvedBy === resolvedBy
    && Number.isFinite(stored.createdAt) && stored.createdAt >= 0
    && stored.rationale === input.rationale.trim()
    && stableStringify(stored.reviewHeadIds) === stableStringify(input.reviewHeadIds)
    && stableStringify(stored.categories) === stableStringify(input.categories.map((category) => ({
      ...category,
      reason: category.reason.trim(),
    })));
}

function isCurrentAssessmentIdentity(
  assessment: AssessmentRecord,
  eventId: string,
  assessmentId: string,
  version: EventVersion,
  versionId: string,
): boolean {
  if (!('schemaVersion' in assessment) || !('aiProposal' in assessment)) return false;
  return assessment.schemaVersion === ASSESSMENT_SCHEMA_VERSION
    && assessment.eventId === eventId
    && assessment.assessmentId === assessmentId
    && assessment.versionId === versionId
    && version.eventId === eventId
    && version.versionId === versionId
    && assessment.aiProposal?.status === 'success';
}

function writeReviewAudit(transaction: FirebaseFirestore.Transaction, eventRef: FirebaseFirestore.DocumentReference, review: AuthorityScoreReview, superseded: boolean) {
  const action = superseded ? 'authority_score_review_superseded' : 'authority_score_reviewed';
  const ref = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${review.reviewId}-${action}`);
  transaction.create(ref, auditRecord(ref.id, review.eventId, review.versionId, action, review.reviewerId, 'authority', review.createdAt, { reviewId: review.reviewId, authorityType: review.authorityType, supersedesReviewId: review.supersedesReviewId ?? null }));
}

function writeConflictAudit(transaction: FirebaseFirestore.Transaction, eventRef: FirebaseFirestore.DocumentReference, versionId: string, state: AuthorityReviewState, now: number) {
  const hash = createHash('sha256').update(stableStringify(state.activeReviewHeads)).digest('hex').slice(0, 24);
  const ref = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-${hash}-score-conflict`);
  transaction.create(ref, auditRecord(ref.id, eventRef.id, versionId, 'score_conflict_detected', 'system', 'system', now, { categoryIds: state.conflicts.map((conflict) => conflict.categoryId), reviewHeadIds: state.activeReviewHeads }));
}

function auditRecord(id: string, eventId: string, versionId: string, action: string, actorId: string, actorRole: string, timestamp: number, metadata: Record<string, unknown>) {
  return { id, eventId, versionId, action, actorId, actorRole, timestamp, metadata };
}

async function readFinalizationIdentity(eventId: string): Promise<{ versionId: string; assessmentId: string } | undefined> {
  const event = (await firestore().collection(COLLECTIONS.EVENTS).doc(eventId).get()).data() as EventRecord | undefined;
  return event?.currentVersionId && event.currentAssessmentId
    ? { versionId: event.currentVersionId, assessmentId: event.currentAssessmentId }
    : undefined;
}

async function recordFinalizationFailure(
  eventId: string,
  expectedVersionId: string,
  expectedAssessmentId: string,
  timestamp: number,
  error: unknown,
): Promise<void> {
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const summary = error instanceof Error ? error.message.slice(0, 500) : 'Unknown official finalisation failure.';
  const id = `${expectedVersionId}-${timestamp}-${createHash('sha256').update(summary).digest('hex').slice(0, 16)}-official-failed`;
  await db.runTransaction(async (transaction) => {
    const [eventSnapshot, lockSnapshot] = await Promise.all([
      transaction.get(eventRef), transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
    ]);
    const event = eventSnapshot.data() as EventRecord | undefined;
    if (lockSnapshot.exists
      || event?.currentVersionId !== expectedVersionId
      || event.currentAssessmentId !== expectedAssessmentId) return;
    transaction.create(
      eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(id),
      auditRecord(id, eventId, expectedVersionId, 'official_finalization_failed', 'system', 'system', timestamp, {
        errorSummary: summary,
        assessmentId: expectedAssessmentId,
      }),
    );
  }).catch((writeError: unknown) => {
    const code = isRecord(writeError) ? writeError.code : undefined;
    if (code !== 6 && code !== 'already-exists') throw writeError;
  });
}

function requiredId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new HttpsError('invalid-argument', `${name} is required.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shouldAuditFinalizationFailure(error: unknown): boolean {
  return !(error instanceof HttpsError)
    || !['unauthenticated', 'permission-denied', 'invalid-argument', 'not-found', 'unavailable'].includes(error.code);
}

export const __testOnly = { scoreReviewId, scoreResolutionId, normalizedCategories };
