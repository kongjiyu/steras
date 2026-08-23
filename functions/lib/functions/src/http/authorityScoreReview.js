"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testOnly = exports.retryOfficialFinalisation = exports.resolveAuthorityScoreConflict = exports.submitAuthorityScoreReview = void 0;
exports.retryOfficialFinalisationForAdmin = retryOfficialFinalisationForAdmin;
exports.submitScoreReviewForUser = submitScoreReviewForUser;
exports.resolveScoreConflictForAdmin = resolveScoreConflictForAdmin;
exports.finalizeStoredReviewState = finalizeStoredReviewState;
const node_crypto_1 = require("node:crypto");
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const resourceCutoverLock_1 = require("../config/resourceCutoverLock");
const authorityFinalisation_1 = require("../engines/authorityFinalisation");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const resourceContract_1 = require("../engines/resourceContract");
const ruleBased_1 = require("../engines/ruleBased");
const onEventCreated_1 = require("../triggers/onEventCreated");
exports.submitAuthorityScoreReview = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before reviewing an assessment.');
    return submitScoreReviewForUser(request.auth.uid, request.data);
});
exports.resolveAuthorityScoreConflict = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before resolving a score conflict.');
    return resolveScoreConflictForAdmin(request.auth.uid, request.data);
});
exports.retryOfficialFinalisation = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before retrying finalisation.');
    const eventId = requiredId(request.data?.eventId, 'eventId');
    return retryOfficialFinalisationForAdmin(request.auth.uid, eventId);
});
async function retryOfficialFinalisationForAdmin(uid, eventId, now = Date.now(), hooks = {}) {
    const identity = await readFinalizationIdentity(eventId);
    try {
        return await finalizeStoredReviewState(uid, eventId, true, now, identity);
    }
    catch (error) {
        await hooks.beforeFailureAudit?.();
        if (identity && shouldAuditFinalizationFailure(error)) {
            await recordFinalizationFailure(eventId, identity.versionId, identity.assessmentId, now, error);
        }
        throw error;
    }
}
async function submitScoreReviewForUser(uid, data, now = Date.now()) {
    const payload = isRecord(data) ? data : {};
    const eventId = requiredId(payload.eventId, 'eventId');
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const userRef = db.collection(types_1.COLLECTIONS.USERS).doc(uid);
    const persisted = await db.runTransaction(async (transaction) => {
        const [userSnap, eventSnap, lockSnap] = await Promise.all([
            transaction.get(userRef), transaction.get(eventRef), transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
        ]);
        assertNoCutover(lockSnap);
        const profile = userSnap.data();
        if (profile?.role !== 'authority' || !profile.authorityType)
            throw new https_1.HttpsError('permission-denied', 'Only assigned authority officers may submit score reviews.');
        const event = eventSnap.data();
        if (!event)
            throw new https_1.HttpsError('not-found', 'The event was not found.');
        const { versionId, assessmentId } = assertReviewableEvent(event, profile.authorityType);
        const assessmentRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessmentId);
        const summaryRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(versionId);
        const versionRef = eventRef.collection(types_1.COLLECTIONS.VERSIONS).doc(versionId);
        const [assessmentSnap, versionSnap, summarySnap] = await Promise.all([transaction.get(assessmentRef), transaction.get(versionRef), transaction.get(summaryRef)]);
        const assessment = assessmentSnap.data();
        const version = versionSnap.data();
        if (!version || version.eventId !== eventId || version.versionId !== versionId)
            throw new https_1.HttpsError('failed-precondition', 'The current immutable event version is missing.');
        if (!assessment || !(assessment.status === 'provisional_ready' || assessment.status === 'authority_review' || assessment.status === 'official_ready')) {
            throw new https_1.HttpsError('failed-precondition', 'A current provisional assessment is required.');
        }
        if (isManualOfficialAssessment(assessment))
            throw new https_1.HttpsError('failed-precondition', 'Admin manual official assessments do not accept authority score reviews.');
        if (!isCurrentAssessmentIdentity(assessment, eventId, assessmentId, version, versionId)) {
            throw new https_1.HttpsError('failed-precondition', 'The assessment contract is invalid or stale.');
        }
        if (assessment.authorityReviewState
            && (0, resourceCalculator_1.stableStringify)(assessment.authorityReviewState.requiredAuthorities) !== (0, resourceCalculator_1.stableStringify)(event.requiredAuthorities)) {
            throw new https_1.HttpsError('failed-precondition', 'The authority review assignment does not match the current event.');
        }
        const input = {
            categories: Array.isArray(payload.categories) ? payload.categories : [],
            rationale: typeof payload.rationale === 'string' ? payload.rationale : '',
            idempotencyKey: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : '',
        };
        const errors = (0, authorityFinalisation_1.validateScoreReviewInput)(input, assessment.aiProposal);
        if (errors.length)
            throw new https_1.HttpsError('invalid-argument', `Invalid score review: ${errors.join(', ')}.`);
        const reviewId = scoreReviewId(versionId, profile.authorityType, uid, input.idempotencyKey);
        const reviewRef = assessmentRef.collection(types_1.COLLECTIONS.SCORE_REVIEWS).doc(reviewId);
        const currentHeads = assessment.authorityReviewState?.activeReviewHeads ?? {};
        const headAuthorities = event.requiredAuthorities.filter((authority) => Boolean(currentHeads[authority]?.reviewId));
        const headRefs = headAuthorities.map((authority) => assessmentRef.collection(types_1.COLLECTIONS.SCORE_REVIEWS).doc(currentHeads[authority].reviewId));
        const [existingReviewSnap, ...remaining] = await Promise.all([
            transaction.get(reviewRef),
            ...(headRefs.length ? [transaction.getAll(...headRefs)] : [Promise.resolve([])]),
        ]);
        const headSnapshots = remaining[0];
        if (headSnapshots.some((snapshot, index) => !isReviewSnapshot(snapshot, headAuthorities[index]))) {
            throw new https_1.HttpsError('failed-precondition', 'The active authority review head is missing.');
        }
        const proposedReview = {
            reviewId,
            schemaVersion: types_1.SCORE_REVIEW_SCHEMA_VERSION,
            eventId,
            versionId,
            assessmentId,
            proposalId: assessment.aiProposal.proposalId,
            provisionalCalculatedAt: assessment.provisionalResult.calculatedAt,
            assessmentInputHash: assessment.inputHash,
            categorySchemaVersion: assessment.provisionalResult.categorySchemaVersion,
            authorityType: profile.authorityType,
            reviewerId: uid,
            categories: normalizedCategories(input.categories),
            rationale: input.rationale.trim(),
            idempotencyKey: input.idempotencyKey,
            ...(currentHeads[profile.authorityType]?.reviewId ? { supersedesReviewId: currentHeads[profile.authorityType].reviewId } : {}),
            createdAt: now,
        };
        const storedReview = existingReviewSnap.data();
        if (storedReview && !sameReviewRequest(storedReview, proposedReview)) {
            throw new https_1.HttpsError('already-exists', 'The idempotency key is already bound to a different review.');
        }
        if (assessment.status === 'official_ready') {
            if (!storedReview || !assessment.officialResult.reviewIds.includes(storedReview.reviewId)) {
                throw new https_1.HttpsError('failed-precondition', 'The official assessment is locked.');
            }
            await readAndValidateOfficialOutputInTransaction(transaction, eventRef, event, version, assessment);
            return { eventId, reviewId, status: 'official_ready', officialResourceId: event.currentResourceId, idempotent: true };
        }
        if (storedReview && currentHeads[profile.authorityType]?.reviewId !== storedReview.reviewId) {
            return {
                eventId,
                versionId,
                assessmentId,
                reviewId,
                status: 'authority_review',
                conflicts: assessment.authorityReviewState?.conflicts ?? [],
                shouldFinalize: false,
                idempotent: true,
            };
        }
        if (storedReview) {
            const currentState = assessment.authorityReviewState;
            const complete = Boolean(currentState && event.requiredAuthorities.every((authority) => currentState.activeReviewHeads[authority]?.reviewId));
            const shouldFinalize = Boolean(complete && currentState
                && (currentState.conflicts.length === 0 || currentState.activeResolutionId));
            return {
                eventId,
                versionId,
                assessmentId,
                reviewId,
                status: 'authority_review',
                conflicts: currentState?.conflicts ?? [],
                shouldFinalize,
                idempotent: true,
            };
        }
        const review = storedReview ?? proposedReview;
        const reviews = headSnapshots.map((snapshot) => snapshot.data())
            .filter((candidate) => candidate.authorityType !== profile.authorityType);
        reviews.push(review);
        const state = (0, authorityFinalisation_1.buildAuthorityReviewState)(event.requiredAuthorities, reviews, now);
        if (!existingReviewSnap.exists) {
            transaction.create(reviewRef, review);
            writeReviewAudit(transaction, eventRef, review, Boolean(review.supersedesReviewId));
        }
        transaction.set(assessmentRef, { status: 'authority_review', authorityReviewState: state }, { merge: true });
        transaction.update(eventRef, { updatedAt: now });
        if (summarySnap.exists)
            transaction.set(summaryRef, {
                status: 'authority_review',
                authorityReviewRequired: true,
                authorityReviewProgress: { completed: Object.keys(state.activeReviewHeads).length, required: event.requiredAuthorities.length },
                computedAt: now,
            }, { merge: true });
        if (reviews.length === event.requiredAuthorities.length && state.conflicts.length === 0) {
            return { eventId, versionId, assessmentId, reviewId, status: 'authority_review', shouldFinalize: true, idempotent: existingReviewSnap.exists };
        }
        if (!existingReviewSnap.exists && state.conflicts.length > 0)
            writeConflictAudit(transaction, eventRef, versionId, state, now);
        return { eventId, reviewId, status: 'authority_review', conflicts: state.conflicts, shouldFinalize: false, idempotent: existingReviewSnap.exists };
    });
    if (!('shouldFinalize' in persisted) || !persisted.shouldFinalize)
        return persisted;
    if (!persisted.versionId || !persisted.assessmentId)
        throw new https_1.HttpsError('failed-precondition', 'The finalized review identity is incomplete.');
    try {
        const finalized = await finalizeStoredReviewState(uid, eventId, false, now, {
            versionId: persisted.versionId,
            assessmentId: persisted.assessmentId,
        });
        return { ...persisted, status: 'official_ready', officialResourceId: finalized.officialResourceId };
    }
    catch (error) {
        if (persisted.versionId && persisted.assessmentId) {
            await recordFinalizationFailure(eventId, persisted.versionId, persisted.assessmentId, now, error);
        }
        throw error;
    }
}
async function resolveScoreConflictForAdmin(uid, data, now = Date.now()) {
    const eventId = requiredId(data?.eventId, 'eventId');
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const persisted = await db.runTransaction(async (transaction) => {
        const [userSnap, eventSnap, lockSnap] = await Promise.all([
            transaction.get(db.collection(types_1.COLLECTIONS.USERS).doc(uid)), transaction.get(eventRef), transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
        ]);
        assertNoCutover(lockSnap);
        if (userSnap.data()?.role !== 'admin')
            throw new https_1.HttpsError('permission-denied', 'Only an administrator may resolve score conflicts.');
        const event = eventSnap.data();
        if (!event?.currentVersionId || !event.currentAssessmentId
            || !isSafeDocumentId(event.currentVersionId) || !isSafeDocumentId(event.currentAssessmentId)
            || (event.currentResourceId !== undefined && !isSafeDocumentId(event.currentResourceId))
            || !['Pending', 'UnderReview'].includes(event.status)) {
            throw new https_1.HttpsError('failed-precondition', 'The event is not open for score resolution.');
        }
        if (!validRequiredAuthorities(event.requiredAuthorities))
            throw new https_1.HttpsError('failed-precondition', 'The assigned authority list is invalid.');
        const assessmentRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId);
        const versionRef = eventRef.collection(types_1.COLLECTIONS.VERSIONS).doc(event.currentVersionId);
        const [assessmentSnap, versionSnap] = await Promise.all([transaction.get(assessmentRef), transaction.get(versionRef)]);
        const assessment = assessmentSnap.data();
        const version = versionSnap.data();
        if (isManualOfficialAssessment(assessment)) {
            throw new https_1.HttpsError('failed-precondition', 'Admin manual official assessments do not accept score-conflict resolutions.');
        }
        if (!assessment || !version || !isCurrentAssessmentIdentity(assessment, eventId, event.currentAssessmentId, version, event.currentVersionId)) {
            throw new https_1.HttpsError('failed-precondition', 'The current assessment contract is invalid or stale.');
        }
        if (assessment.authorityReviewState
            && (0, resourceCalculator_1.stableStringify)(assessment.authorityReviewState.requiredAuthorities) !== (0, resourceCalculator_1.stableStringify)(event.requiredAuthorities)) {
            throw new https_1.HttpsError('failed-precondition', 'The authority review assignment does not match the current event.');
        }
        const resolutionId = scoreResolutionId(event.currentVersionId, uid, data);
        const resolutionRef = assessmentRef.collection(types_1.COLLECTIONS.SCORE_RESOLUTIONS).doc(resolutionId);
        if (assessment.status === 'official_ready') {
            const stored = (await transaction.get(resolutionRef)).data();
            if (!stored || assessment.officialResult.resolutionId !== resolutionId
                || !sameResolutionRequest(stored, uid, data, { resolutionId, eventId, versionId: event.currentVersionId, assessmentId: event.currentAssessmentId })) {
                throw new https_1.HttpsError('failed-precondition', 'The official assessment is locked.');
            }
            await readAndValidateOfficialOutputInTransaction(transaction, eventRef, event, version, assessment);
            return {
                eventId,
                resolutionId,
                status: 'official_ready',
                officialResourceId: event.currentResourceId,
                shouldFinalize: false,
                idempotent: true,
            };
        }
        if (assessment.status !== 'authority_review' || !assessment.authorityReviewState) {
            throw new https_1.HttpsError('failed-precondition', 'A current authority score conflict is required.');
        }
        const errors = (0, authorityFinalisation_1.validateResolutionInput)(data, assessment.authorityReviewState);
        if (errors.length)
            throw new https_1.HttpsError(errors.includes('stale-review-heads') ? 'aborted' : 'invalid-argument', `Invalid score resolution: ${errors.join(', ')}.`);
        const headIds = event.requiredAuthorities.map((authority) => assessment.authorityReviewState.activeReviewHeads[authority].reviewId);
        const headRefs = headIds.map((id) => assessmentRef.collection(types_1.COLLECTIONS.SCORE_REVIEWS).doc(id));
        const [reviewSnaps, existingResolutionSnap] = await Promise.all([
            transaction.getAll(...headRefs), transaction.get(resolutionRef),
        ]);
        if (reviewSnaps.some((snapshot, index) => !isReviewSnapshot(snapshot, event.requiredAuthorities[index]))) {
            throw new https_1.HttpsError('failed-precondition', 'The active authority reviews are missing.');
        }
        const reviews = reviewSnaps.map((snapshot) => snapshot.data());
        if (reviews.length !== event.requiredAuthorities.length)
            throw new https_1.HttpsError('failed-precondition', 'The active authority reviews are incomplete.');
        const proposedResolution = {
            resolutionId,
            schemaVersion: types_1.SCORE_RESOLUTION_SCHEMA_VERSION,
            eventId,
            versionId: event.currentVersionId,
            assessmentId: event.currentAssessmentId,
            reviewHeadIds: { ...data.reviewHeadIds },
            categories: data.categories.map((category) => ({ ...category, reason: category.reason.trim() })),
            resolvedBy: uid,
            rationale: data.rationale.trim(),
            createdAt: now,
        };
        const storedResolution = existingResolutionSnap.data();
        if (storedResolution && !sameResolutionRequest(storedResolution, uid, data, {
            resolutionId, eventId, versionId: event.currentVersionId, assessmentId: event.currentAssessmentId,
        })) {
            throw new https_1.HttpsError('already-exists', 'This resolution is already bound to different content.');
        }
        const resolution = storedResolution ?? proposedResolution;
        if (!existingResolutionSnap.exists)
            transaction.create(resolutionRef, resolution);
        const state = { ...assessment.authorityReviewState, activeResolutionId: resolutionId, updatedAt: now };
        if (!existingResolutionSnap.exists) {
            transaction.set(assessmentRef, { authorityReviewState: state }, { merge: true });
            transaction.update(eventRef, { updatedAt: now });
            const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${resolutionId}-resolved`);
            transaction.create(auditRef, auditRecord(auditRef.id, eventId, event.currentVersionId, 'score_conflict_resolved', uid, 'admin', resolution.createdAt, { resolutionId, reviewHeadIds: headIds }));
        }
        return {
            eventId,
            versionId: event.currentVersionId,
            assessmentId: event.currentAssessmentId,
            resolutionId,
            status: 'authority_review',
            shouldFinalize: true,
            idempotent: existingResolutionSnap.exists,
        };
    });
    if (!persisted.shouldFinalize)
        return persisted;
    if (!persisted.versionId || !persisted.assessmentId)
        throw new https_1.HttpsError('failed-precondition', 'The resolved review identity is incomplete.');
    try {
        const finalized = await finalizeStoredReviewState(uid, eventId, true, now, {
            versionId: persisted.versionId,
            assessmentId: persisted.assessmentId,
        });
        return { ...persisted, status: 'official_ready', officialResourceId: finalized.officialResourceId };
    }
    catch (error) {
        if (persisted.versionId && persisted.assessmentId) {
            await recordFinalizationFailure(eventId, persisted.versionId, persisted.assessmentId, now, error);
        }
        throw error;
    }
}
async function readAndValidateOfficialOutputInTransaction(transaction, eventRef, event, version, assessment) {
    const state = assessment.authorityReviewState;
    if (!state || !event.currentResourceId
        || !Array.isArray(state.requiredAuthorities)
        || !isRecord(state.activeReviewHeads)
        || !Array.isArray(state.conflicts)
        || (0, resourceCalculator_1.stableStringify)(state.requiredAuthorities) !== (0, resourceCalculator_1.stableStringify)(event.requiredAuthorities)) {
        throw new https_1.HttpsError('failed-precondition', 'The finalized official resource or review provenance is missing.');
    }
    const headIds = event.requiredAuthorities.map((authority) => state.activeReviewHeads[authority]?.reviewId);
    if (headIds.some((reviewId) => !reviewId)) {
        throw new https_1.HttpsError('failed-precondition', 'The finalized official review provenance is incomplete.');
    }
    const assessmentRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId);
    const reviewRefs = headIds.map((reviewId) => assessmentRef.collection(types_1.COLLECTIONS.SCORE_REVIEWS).doc(reviewId));
    const resolutionRef = state.activeResolutionId
        ? assessmentRef.collection(types_1.COLLECTIONS.SCORE_RESOLUTIONS).doc(state.activeResolutionId)
        : undefined;
    const historyQuery = eventRef.collection(types_1.COLLECTIONS.RESOURCES).where('versionId', '==', version.versionId);
    const summaryRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId);
    const resourceSnapshot = await transaction.get(eventRef.collection(types_1.COLLECTIONS.RESOURCES).doc(event.currentResourceId));
    const reviewSnapshots = await transaction.getAll(...reviewRefs);
    const resolutionSnapshot = resolutionRef ? await transaction.get(resolutionRef) : undefined;
    const historySnapshot = await transaction.get(historyQuery);
    const summarySnapshot = await transaction.get(summaryRef);
    if (reviewSnapshots.some((snapshot, index) => !isReviewSnapshot(snapshot, event.requiredAuthorities[index]))
        || (resolutionRef && (!resolutionSnapshot || !isResolutionSnapshot(resolutionSnapshot)))) {
        throw new https_1.HttpsError('failed-precondition', 'The finalized review provenance is missing or malformed.');
    }
    const resource = resourceSnapshot.data();
    if (!isIdempotentOfficialOutput(event, version, assessment, resource, reviewSnapshots.map((snapshot) => snapshot.data()), resolutionSnapshot?.data())) {
        throw new https_1.HttpsError('failed-precondition', 'The finalized official output is invalid or stale.');
    }
    const history = historySnapshot.docs.map((snapshot) => snapshot.data());
    if (historySnapshot.docs.some((snapshot, index) => snapshot.id !== history[index]?.resourceId)
        || history.some((candidate) => !(0, resourceContract_1.validateResourceRecommendation)(candidate).ok
            || candidate.eventId !== event.eventId || candidate.versionId !== version.versionId)
        || (0, resourceContract_1.validateResourceRevisionChain)(history, resource.resourceId).length > 0) {
        throw new https_1.HttpsError('failed-precondition', 'The finalized official resource history is invalid or stale.');
    }
    const expectedSummary = organizerSummary(assessment, resource, assessment.officialResult.finalizedAt);
    if (!summarySnapshot.exists || (0, resourceCalculator_1.stableStringify)(summarySnapshot.data()) !== (0, resourceCalculator_1.stableStringify)(expectedSummary)) {
        transaction.set(summaryRef, expectedSummary);
    }
    return resource;
}
async function finalizeStoredReviewState(uid, eventId, requireAdmin = true, now = Date.now(), expectedIdentity) {
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    return db.runTransaction(async (transaction) => {
        const [profileSnap, eventSnap, lockSnap] = await Promise.all([
            transaction.get(db.collection(types_1.COLLECTIONS.USERS).doc(uid)), transaction.get(eventRef), transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
        ]);
        const profile = profileSnap.data();
        if (requireAdmin && profile?.role !== 'admin')
            throw new https_1.HttpsError('permission-denied', 'Only an administrator may retry finalisation.');
        assertNoCutover(lockSnap);
        const event = eventSnap.data();
        if (!event?.currentVersionId || !event.currentAssessmentId
            || !isSafeDocumentId(event.currentVersionId) || !isSafeDocumentId(event.currentAssessmentId)
            || (event.currentResourceId !== undefined && !isSafeDocumentId(event.currentResourceId))
            || !['Pending', 'UnderReview'].includes(event.status)) {
            throw new https_1.HttpsError('failed-precondition', 'The current event assessment is not open for finalisation.');
        }
        if (expectedIdentity && (event.currentVersionId !== expectedIdentity.versionId || event.currentAssessmentId !== expectedIdentity.assessmentId)) {
            throw new https_1.HttpsError('aborted', 'The application version changed before authority finalisation completed.');
        }
        if (!validRequiredAuthorities(event.requiredAuthorities))
            throw new https_1.HttpsError('failed-precondition', 'The assigned authority list is invalid.');
        const assessmentRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId);
        const [assessmentSnap, versionSnap] = await Promise.all([
            transaction.get(assessmentRef), transaction.get(eventRef.collection(types_1.COLLECTIONS.VERSIONS).doc(event.currentVersionId)),
        ]);
        const assessment = assessmentSnap.data();
        const version = versionSnap.data();
        if (isManualOfficialAssessment(assessment)) {
            throw new https_1.HttpsError('failed-precondition', 'Admin manual official assessments use the manual finalisation retry.');
        }
        if (!assessment || !version || !isCurrentAssessmentIdentity(assessment, eventId, event.currentAssessmentId, version, event.currentVersionId)) {
            throw new https_1.HttpsError('failed-precondition', 'No finalisable authority review is available.');
        }
        if (assessment.authorityReviewState
            && (0, resourceCalculator_1.stableStringify)(assessment.authorityReviewState.requiredAuthorities) !== (0, resourceCalculator_1.stableStringify)(event.requiredAuthorities)) {
            throw new https_1.HttpsError('failed-precondition', 'The authority review assignment does not match the current event.');
        }
        if (assessment.status === 'official_ready') {
            const resource = await readAndValidateOfficialOutputInTransaction(transaction, eventRef, event, version, assessment);
            return { eventId, status: 'official_ready', officialResourceId: resource.resourceId, idempotent: true };
        }
        if (assessment.status !== 'authority_review' || !assessment.authorityReviewState) {
            throw new https_1.HttpsError('failed-precondition', 'No finalisable authority review is available.');
        }
        const headIds = event.requiredAuthorities.map((authority) => assessment.authorityReviewState.activeReviewHeads[authority]?.reviewId);
        if (headIds.some((id) => !id))
            throw new https_1.HttpsError('failed-precondition', 'All assigned authorities must submit a score review.');
        const headRefs = headIds.map((id) => assessmentRef.collection(types_1.COLLECTIONS.SCORE_REVIEWS).doc(id));
        const resolutionRef = assessment.authorityReviewState.activeResolutionId
            ? assessmentRef.collection(types_1.COLLECTIONS.SCORE_RESOLUTIONS).doc(assessment.authorityReviewState.activeResolutionId)
            : undefined;
        const historyQuery = eventRef.collection(types_1.COLLECTIONS.RESOURCES).where('versionId', '==', event.currentVersionId).where('stage', '==', 'official');
        const [reviewSnaps, resolutionSnap, historySnap] = await Promise.all([
            transaction.getAll(...headRefs), resolutionRef ? transaction.get(resolutionRef) : Promise.resolve(undefined), transaction.get(historyQuery),
        ]);
        if (reviewSnaps.some((snapshot, index) => !isReviewSnapshot(snapshot, event.requiredAuthorities[index]))
            || (resolutionRef && (!resolutionSnap || !isResolutionSnapshot(resolutionSnap)))) {
            throw new https_1.HttpsError('failed-precondition', 'The active authority review provenance is incomplete.');
        }
        if (historySnap.docs.some((snapshot) => {
            const resource = snapshot.data();
            return !resource || snapshot.id !== resource.resourceId
                || resource.eventId !== event.eventId || resource.versionId !== version.versionId
                || resource.stage !== 'official';
        }))
            throw new https_1.HttpsError('failed-precondition', 'Official resource history has an invalid document identity.');
        const reviews = reviewSnaps.map((snapshot) => snapshot.data());
        const resolution = resolutionSnap?.data();
        const finalized = finalizeInTransaction(transaction, eventRef, event, version, assessment, assessment.authorityReviewState, reviews, historySnap.docs.map((snapshot) => snapshot.data()), resolution, now, resolution ? resolution.resolvedBy : 'system');
        return { eventId, status: 'official_ready', officialResourceId: finalized.resourceId };
    });
}
function finalizeInTransaction(transaction, eventRef, event, version, assessment, state, reviews, officialHistory, resolution, now, finalizedBy) {
    const finalizedAt = now;
    const officialResult = (0, authorityFinalisation_1.buildOfficialAssessmentResult)({ assessment, eventDetails: version.eventDetails, requiredAuthorities: event.requiredAuthorities, reviews, resolution, finalizedAt, finalizedBy });
    const calculation = (0, resourceCalculator_1.computeResources)({ eventId: event.eventId, versionId: version.versionId, assessmentId: assessment.assessmentId, eventDetails: version.eventDetails, assessmentResult: officialResult });
    if (!calculation.ok)
        throw new https_1.HttpsError('failed-precondition', `Official resource calculation failed: ${calculation.code}.`);
    const validHistory = officialHistory.filter((resource) => (0, resourceContract_1.validateResourceRecommendation)(resource).ok);
    if (validHistory.length !== officialHistory.length)
        throw new https_1.HttpsError('failed-precondition', 'Official resource history is invalid.');
    const resourceId = (0, onEventCreated_1.resourceDocumentId)('official', version.versionId, calculation.resourceInputHash);
    const existing = validHistory.find((resource) => resource.resourceId === resourceId);
    const predecessorHistory = validHistory.filter((resource) => resource.resourceId !== resourceId);
    const tip = [...predecessorHistory].sort((a, b) => b.revision - a.revision)[0];
    if (tip && (0, resourceContract_1.validateResourceRevisionChain)(predecessorHistory, tip.resourceId).length)
        throw new https_1.HttpsError('failed-precondition', 'Official resource revision chain is invalid.');
    const items = Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, {
            ...calculation.items[key], confidence: 'authority_validated', authorityReviewRequired: false,
        }]));
    const expectedResource = {
        resourceId,
        eventId: event.eventId,
        versionId: version.versionId,
        assessmentId: assessment.assessmentId,
        schemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
        stage: 'official',
        revision: tip ? tip.revision + 1 : 1,
        supersedesResourceId: tip?.resourceId ?? null,
        assessmentReference: { stage: 'official', assessmentId: assessment.assessmentId, proposalId: assessment.aiProposal.proposalId, finalizedAt, finalizedBy },
        resourceInputHash: calculation.resourceInputHash,
        formulaVersion: types_1.RESOURCE_FORMULA_VERSION,
        configVersion: types_1.RESOURCE_CONFIG_VERSION,
        sourceRegistryVersion: types_1.RESOURCE_SOURCE_REGISTRY_VERSION,
        items,
        confidenceLevel: 'authority_validated',
        authorityReviewRequired: false,
        validationScope: 'official_risk_input_only',
        notes: 'Official deterministic planning ranges based on finalized human-reviewed risk scores.',
        computedAt: now,
    };
    if (existing && (0, resourceCalculator_1.stableStringify)(existing) !== (0, resourceCalculator_1.stableStringify)(expectedResource))
        throw new https_1.HttpsError('already-exists', 'Official resource identity collision.');
    const resource = existing ?? expectedResource;
    const { activeResolutionId: _staleResolutionId, ...reviewStateWithoutResolution } = state;
    void _staleResolutionId;
    const officialAssessment = {
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
    const assessmentRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessment.assessmentId);
    if (!existing)
        transaction.create(eventRef.collection(types_1.COLLECTIONS.RESOURCES).doc(resourceId), resource);
    transaction.set(assessmentRef, officialAssessment);
    transaction.update(eventRef, { currentResourceId: resourceId, updatedAt: now });
    transaction.set(eventRef.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(version.versionId), organizerSummary(officialAssessment, resource, now));
    const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${officialResult.officialInputHash}-official-finalized`);
    transaction.create(auditRef, auditRecord(auditRef.id, event.eventId, version.versionId, 'official_assessment_finalized', finalizedBy, finalizedBy === 'system' ? 'system' : 'admin', now, { reviewIds: officialResult.reviewIds, resolutionId: officialResult.resolutionId ?? null, resourceId, officialInputHash: officialResult.officialInputHash }));
    return { resourceId, officialResult };
}
function organizerSummary(assessment, resource, computedAt) {
    const result = assessment.officialResult;
    const projection = {
        resourceId: resource.resourceId,
        revision: resource.revision,
        stage: resource.stage,
        items: Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, { baseline: resource.items[key].baseline, planningRange: { ...resource.items[key].planningRange } }])),
        disclaimer: 'Planning ranges derived from an official risk assessment; resource ratios remain internal prototype inputs.',
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
        resourceQuantities: Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, resource.items[key].baseline])),
        resourceRecommendation: projection,
        computedAt,
    };
}
function isIdempotentOfficialOutput(event, version, assessment, resource, reviews, resolution) {
    try {
        const expectedResult = (0, authorityFinalisation_1.buildOfficialAssessmentResult)({
            assessment,
            eventDetails: version.eventDetails,
            requiredAuthorities: event.requiredAuthorities,
            reviews,
            resolution,
            finalizedAt: assessment.officialResult.finalizedAt,
            finalizedBy: assessment.officialResult.finalizedBy,
        });
        const calculation = (0, resourceCalculator_1.computeResources)({
            eventId: event.eventId,
            versionId: version.versionId,
            assessmentId: assessment.assessmentId,
            eventDetails: version.eventDetails,
            assessmentResult: assessment.officialResult,
        });
        if (!resource || !calculation.ok || !(0, resourceContract_1.validateResourceRecommendation)(resource).ok)
            return false;
        const expectedItems = Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, {
                ...calculation.items[key],
                confidence: 'authority_validated',
                authorityReviewRequired: false,
            }]));
        return (0, resourceCalculator_1.stableStringify)(expectedResult) === (0, resourceCalculator_1.stableStringify)(assessment.officialResult)
            && event.currentResourceId === resource.resourceId
            && resource.resourceId === (0, onEventCreated_1.resourceDocumentId)('official', version.versionId, calculation.resourceInputHash)
            && resource.eventId === event.eventId
            && resource.versionId === version.versionId
            && resource.assessmentId === assessment.assessmentId
            && resource.assessmentReference.assessmentId === assessment.assessmentId
            && resource.stage === 'official'
            && resource.formulaVersion === types_1.RESOURCE_FORMULA_VERSION
            && resource.configVersion === types_1.RESOURCE_CONFIG_VERSION
            && resource.sourceRegistryVersion === types_1.RESOURCE_SOURCE_REGISTRY_VERSION
            && resource.resourceInputHash === calculation.resourceInputHash
            && resource.assessmentReference.stage === 'official'
            && resource.assessmentReference.sourceKind !== 'admin_manual'
            && 'proposalId' in resource.assessmentReference
            && resource.assessmentReference.proposalId === assessment.officialResult.proposalId
            && resource.assessmentReference.finalizedAt === assessment.officialResult.finalizedAt
            && resource.assessmentReference.finalizedBy === assessment.officialResult.finalizedBy
            && (0, resourceCalculator_1.stableStringify)(resource.items) === (0, resourceCalculator_1.stableStringify)(expectedItems);
    }
    catch {
        return false;
    }
}
function assertReviewableEvent(event, authority) {
    if (!event?.currentVersionId || !event.currentAssessmentId
        || !isSafeDocumentId(event.currentVersionId) || !isSafeDocumentId(event.currentAssessmentId)
        || (event.currentResourceId !== undefined && !isSafeDocumentId(event.currentResourceId))
        || !['Pending', 'UnderReview'].includes(event.status))
        throw new https_1.HttpsError('failed-precondition', 'The event is not open for authority review.');
    if (!validRequiredAuthorities(event.requiredAuthorities))
        throw new https_1.HttpsError('failed-precondition', 'The assigned authority list is invalid.');
    if (!event.requiredAuthorities.includes(authority))
        throw new https_1.HttpsError('permission-denied', 'This authority is not assigned to the event.');
    return { versionId: event.currentVersionId, assessmentId: event.currentAssessmentId };
}
function validRequiredAuthorities(value) {
    const allowed = new Set(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);
    return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length
        && value.every((authority) => allowed.has(authority));
}
function assertNoCutover(snapshot) {
    if (snapshot.exists)
        throw new https_1.HttpsError('unavailable', 'Resource migration is in progress. Retry shortly.');
}
function scoreReviewId(versionId, authority, uid, key) {
    return `${versionId}-${authority}-${(0, node_crypto_1.createHash)('sha256').update(`${uid}:${key}`).digest('hex').slice(0, 24)}`;
}
function scoreResolutionId(versionId, uid, input) {
    return `${versionId}-resolution-${(0, node_crypto_1.createHash)('sha256').update((0, resourceCalculator_1.stableStringify)({ uid, input })).digest('hex').slice(0, 24)}`;
}
function normalizedCategories(categories) {
    return categories.map((category) => category.decision === 'overridden'
        ? { ...category, reason: category.reason.trim() }
        : { categoryId: category.categoryId, likelihood: category.likelihood, severity: category.severity, decision: 'confirmed' });
}
function sameReviewRequest(stored, proposed) {
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
        && (0, resourceCalculator_1.stableStringify)(stored.categories) === (0, resourceCalculator_1.stableStringify)(proposed.categories);
}
function sameResolutionRequest(stored, resolvedBy, input, identity) {
    if (!isRecord(stored) || !isRecord(input) || !Array.isArray(stored.categories) || !Array.isArray(input.categories)
        || !stored.categories.every((category) => isRecord(category) && typeof category.reason === 'string')
        || !input.categories.every((category) => isRecord(category) && typeof category.reason === 'string'))
        return false;
    return stored.schemaVersion === types_1.SCORE_RESOLUTION_SCHEMA_VERSION
        && stored.resolutionId === identity.resolutionId
        && stored.eventId === identity.eventId
        && stored.versionId === identity.versionId
        && stored.assessmentId === identity.assessmentId
        && stored.resolvedBy === resolvedBy
        && Number.isFinite(stored.createdAt) && stored.createdAt >= 0
        && stored.rationale === input.rationale.trim()
        && (0, resourceCalculator_1.stableStringify)(stored.reviewHeadIds) === (0, resourceCalculator_1.stableStringify)(input.reviewHeadIds)
        && (0, resourceCalculator_1.stableStringify)(stored.categories) === (0, resourceCalculator_1.stableStringify)(input.categories.map((category) => ({
            ...category,
            reason: category.reason.trim(),
        })));
}
function isCurrentAssessmentIdentity(assessment, eventId, assessmentId, version, versionId) {
    if (!assessment || typeof assessment !== 'object'
        || !('schemaVersion' in assessment) || !('aiProposal' in assessment) || !('provisionalResult' in assessment))
        return false;
    if (assessment.status !== 'provisional_ready' && assessment.status !== 'authority_review' && assessment.status !== 'official_ready')
        return false;
    if (assessment.aiProposal?.status !== 'success')
        return false;
    if (!assessment.provisionalResult || typeof assessment.provisionalResult !== 'object')
        return false;
    if (!(assessment.schemaVersion === types_1.ASSESSMENT_SCHEMA_VERSION
        && assessment.eventId === eventId
        && assessment.assessmentId === assessmentId
        && assessment.versionId === versionId
        && version.eventId === eventId
        && version.versionId === versionId
        && assessment.provisionalResult.proposalId === assessment.aiProposal.proposalId))
        return false;
    if (!Array.isArray(assessment.aiProposal.categories)
        || !Array.isArray(assessment.aiProposal.hazards)
        || !assessment.aiProposal.categories.every((category) => category && typeof category === 'object')
        || !assessment.aiProposal.hazards.every((hazard) => hazard && typeof hazard === 'object')
        || !Array.isArray(assessment.evidence)
        || !Array.isArray(assessment.contextEvidence) || assessment.contextEvidence.length === 0
        || new Set(assessment.contextEvidence.map((item) => item?.evidenceId)).size !== assessment.contextEvidence.length)
        return false;
    if ((0, resourceCalculator_1.validateProvisionalAssessmentResult)(assessment.provisionalResult).length > 0
        || (0, resourceCalculator_1.validateAssessmentResultAgainstProposal)(assessment.provisionalResult, assessment.aiProposal).length > 0)
        return false;
    if (assessment.status !== 'provisional_ready'
        && (!isRecord(assessment.authorityReviewState)
            || !Array.isArray(assessment.authorityReviewState.requiredAuthorities)
            || !isRecord(assessment.authorityReviewState.activeReviewHeads)
            || !Array.isArray(assessment.authorityReviewState.conflicts)
            || !Object.values(assessment.authorityReviewState.activeReviewHeads).every((head) => isRecord(head) && typeof head.reviewId === 'string' && Boolean(head.reviewId))))
        return false;
    if (assessment.authorityReviewState && isRecord(assessment.authorityReviewState.activeReviewHeads)) {
        const activeHeadIds = Object.values(assessment.authorityReviewState.activeReviewHeads)
            .filter(isRecord)
            .map((head) => head.reviewId)
            .filter((reviewId) => typeof reviewId === 'string');
        if (new Set(activeHeadIds).size !== activeHeadIds.length)
            return false;
    }
    const eligibleEvidence = new Set(assessment.evidence
        .filter((item) => item && item.eligibility === 'eligible' && item.quality !== 'missing'
        && typeof item.status === 'string'
        && !['unavailable', 'unmatched', 'missing'].includes(item.status.trim().toLowerCase()))
        .map((item) => item.key));
    if (assessment.provisionalResult.categories.some((category) => category.evidenceReferences.some((reference) => !eligibleEvidence.has(reference)))
        || assessment.provisionalResult.validatedHazards.some((hazard) => hazard.evidenceReferences.some((reference) => !eligibleEvidence.has(reference))))
        return false;
    try {
        const baseline = (0, ruleBased_1.computeCategoryBasedAssessment)({ eventId, eventDetails: version.eventDetails }, assessment.contextSnapshot, assessment.createdAt);
        if ((0, resourceCalculator_1.validateAssessmentResultAgainstHardRules)(assessment.provisionalResult, baseline).length > 0)
            return false;
    }
    catch {
        return false;
    }
    if (assessment.status === 'official_ready') {
        return Boolean(assessment.authorityReviewState
            && assessment.officialResult
            && assessment.officialResult.proposalId === assessment.aiProposal.proposalId
            && Array.isArray(assessment.officialResult.reviewIds)
            && Number.isFinite(assessment.officialResult.finalizedAt)
            && typeof assessment.officialResult.finalizedBy === 'string'
            && assessment.officialResult.finalizedBy.length > 0);
    }
    return true;
}
function isManualOfficialAssessment(value) {
    return Boolean(value && value.status === 'official_ready' && 'sourceKind' in value && value.sourceKind === 'admin_manual'
        && value.authorityReviewRequired === false
        && Number.isFinite(value.createdAt)
        && isSafeManualAssessmentId(value.activeManualAssessmentId)
        && value.officialResult?.sourceKind === 'admin_manual'
        && value.officialResult.manualAssessmentId === value.activeManualAssessmentId
        && (0, resourceCalculator_1.validateManualOfficialAssessmentResult)(value.officialResult).length === 0);
}
function isSafeManualAssessmentId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function isSafeDocumentId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function writeReviewAudit(transaction, eventRef, review, superseded) {
    const action = superseded ? 'authority_score_review_superseded' : 'authority_score_reviewed';
    const ref = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${review.reviewId}-${action}`);
    transaction.create(ref, auditRecord(ref.id, review.eventId, review.versionId, action, review.reviewerId, 'authority', review.createdAt, { reviewId: review.reviewId, authorityType: review.authorityType, supersedesReviewId: review.supersedesReviewId ?? null }));
}
function writeConflictAudit(transaction, eventRef, versionId, state, now) {
    const hash = (0, node_crypto_1.createHash)('sha256').update((0, resourceCalculator_1.stableStringify)(state.activeReviewHeads)).digest('hex').slice(0, 24);
    const ref = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${versionId}-${hash}-score-conflict`);
    transaction.create(ref, auditRecord(ref.id, eventRef.id, versionId, 'score_conflict_detected', 'system', 'system', now, { categoryIds: state.conflicts.map((conflict) => conflict.categoryId), reviewHeadIds: state.activeReviewHeads }));
}
function auditRecord(id, eventId, versionId, action, actorId, actorRole, timestamp, metadata) {
    return { id, eventId, versionId, action, actorId, actorRole, timestamp, metadata };
}
async function readFinalizationIdentity(eventId) {
    const event = (await (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.EVENTS).doc(eventId).get()).data();
    return event?.currentVersionId && event.currentAssessmentId
        ? { versionId: event.currentVersionId, assessmentId: event.currentAssessmentId }
        : undefined;
}
async function recordFinalizationFailure(eventId, expectedVersionId, expectedAssessmentId, timestamp, error) {
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const summary = error instanceof Error ? error.message.slice(0, 500) : 'Unknown official finalisation failure.';
    const id = `${expectedVersionId}-${timestamp}-${(0, node_crypto_1.createHash)('sha256').update(summary).digest('hex').slice(0, 16)}-official-failed`;
    await db.runTransaction(async (transaction) => {
        const [eventSnapshot, lockSnapshot] = await Promise.all([
            transaction.get(eventRef), transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
        ]);
        const event = eventSnapshot.data();
        if (lockSnapshot.exists
            || event?.currentVersionId !== expectedVersionId
            || event.currentAssessmentId !== expectedAssessmentId
            || !event
            || !['Pending', 'UnderReview'].includes(event.status))
            return;
        const assessment = (await transaction.get(eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(expectedAssessmentId))).data();
        if (assessment?.status === 'official_ready')
            return;
        transaction.create(eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(id), auditRecord(id, eventId, expectedVersionId, 'official_finalization_failed', 'system', 'system', timestamp, {
            errorSummary: summary,
            assessmentId: expectedAssessmentId,
        }));
    }).catch((writeError) => {
        const code = isRecord(writeError) ? writeError.code : undefined;
        if (code !== 6 && code !== 'already-exists')
            throw writeError;
    });
}
function requiredId(value, name) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
        throw new https_1.HttpsError('invalid-argument', `${name} is required.`);
    return value;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isReviewSnapshot(snapshot, authority) {
    const value = snapshot.data();
    return snapshot.exists && isRecord(value) && value.reviewId === snapshot.id
        && (authority === undefined || value.authorityType === authority);
}
function isResolutionSnapshot(snapshot) {
    const value = snapshot.data();
    return snapshot.exists && isRecord(value) && value.resolutionId === snapshot.id;
}
function shouldAuditFinalizationFailure(error) {
    return !(error instanceof https_1.HttpsError)
        || !['unauthenticated', 'permission-denied', 'invalid-argument', 'not-found', 'unavailable'].includes(error.code);
}
exports.__testOnly = { scoreReviewId, scoreResolutionId, normalizedCategories };
//# sourceMappingURL=authorityScoreReview.js.map