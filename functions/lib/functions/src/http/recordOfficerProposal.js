"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordOfficerProposal = void 0;
exports.validateOfficerRejectionRationale = validateOfficerRejectionRationale;
exports.validateOfficerProposalRequest = validateOfficerProposalRequest;
exports.assertOfficerDecisionArtifacts = assertOfficerDecisionArtifacts;
exports.assertCurrentOfficerAssignment = assertCurrentOfficerAssignment;
exports.allRequiredAssignmentsCompleted = allRequiredAssignmentsCompleted;
/**
 * recordOfficerProposal — officer-only callable (M3 Workstream 1).
 *
 * Replaces the officer's role in `makeAuthorityDecision` for the new
 * multi-stage flow. The officer's decision is now a *proposal* recorded
 * on their `assignments/{assignmentId}` doc — not a final status change.
 * The event's `status` is set to the aggregate only when the admin
 * confirms in second review.
 *
 * Behaviour:
 *   - Officer must have an `assignments/{versionId}_{authorityType}` doc
 *     for this event+version where `officerUid === request.auth.uid` and
  *     `status` is `pending` or `in_progress`; a completed assignment may
  *     be amended while the event remains in Authority Review.
 *   - Writes `decision`, `reason`, `suggestion`, `decidedAt`, sets
 *     `status: 'completed'` on the assignment.
 *   - Does NOT change `events.status`. (The old `makeAuthorityDecision`
 *     still does; this function is the new path.)
 *   - When all assignments are completed, sets
 *     `events/{eventId}.reviewStage = 'second'` and emits a notification
 *     to the admin. The organiser is notified only after the admin records
 *     the final second-review outcome.
 *   - Reason and suggestion are split per FR-M3-05.
 *
 * FR-M3-15 (officer reject with reason + suggestion) and FR-M3-16
 * (officer approve) are realised here.
 */
const firebase_admin_1 = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const applicationState_1 = require("../../../shared/applicationState");
const runtime_1 = require("../config/runtime");
const resourceContract_1 = require("../engines/resourceContract");
const notifications_1 = require("../utils/notifications");
const REASON_MIN = 10;
const REASON_MAX = 1000;
const SUGGESTION_MAX = 1000;
exports.recordOfficerProposal = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before recording a proposal.');
    const { eventId, decision, reason, suggestion, confirmedReview, rejectionReasonCategory } = validateOfficerProposalRequest(request.data);
    const db = (0, firebase_admin_1.firestore)();
    const userSnap = await db.collection(types_1.COLLECTIONS.USERS).doc(request.auth.uid).get();
    const profile = userSnap.data();
    if (!profile || profile.role !== 'authority' || !profile.authorityType) {
        throw new https_1.HttpsError('permission-denied', 'Only provisioned authority accounts can record proposals.');
    }
    const authorityType = profile.authorityType;
    const callerUid = request.auth.uid;
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists)
        throw new https_1.HttpsError('not-found', `Event ${eventId} not found.`);
    const event = eventSnap.data();
    const versionId = event.currentVersionId;
    if (!versionId)
        throw new https_1.HttpsError('failed-precondition', 'The application has no submitted version.');
    const assessmentId = event.currentAssessmentId;
    const resourceId = event.currentResourceId;
    if (event.status !== 'UnderReview' || event.reviewStage !== 'authority') {
        throw new https_1.HttpsError('failed-precondition', 'This application version is no longer open for officer review.');
    }
    if (event.initialReview?.decision !== 'Approved') {
        throw new https_1.HttpsError('failed-precondition', 'The admin initial review has not released this application for officer review.');
    }
    // Find this officer's assignment.
    const assignmentId = `${versionId}_${profile.authorityType}`;
    const assignmentRef = eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS).doc(assignmentId);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) {
        throw new https_1.HttpsError('permission-denied', `You are not assigned to this event for ${profile.authorityType}.`);
    }
    const assignment = assignmentSnap.data();
    if (assignment.officerUid !== request.auth.uid) {
        throw new https_1.HttpsError('permission-denied', 'This assignment belongs to another officer.');
    }
    if (assignment.status === 'revoked') {
        throw new https_1.HttpsError('failed-precondition', 'This assignment was revoked.');
    }
    // Load only safe pointer targets. The readiness resolver intentionally runs
    // before the defensive artifact fence so an actionable score-review blocker
    // is never hidden by a stale or missing resource pointer.
    const assessmentRef = safeDocumentId(assessmentId)
        ? eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessmentId)
        : null;
    const resourceRef = safeDocumentId(resourceId)
        ? eventRef.collection(types_1.COLLECTIONS.RESOURCES).doc(resourceId)
        : null;
    const [assessmentSnap, resourceSnap] = await Promise.all([
        assessmentRef ? assessmentRef.get() : Promise.resolve(null),
        resourceRef ? resourceRef.get() : Promise.resolve(null),
    ]);
    const resource = resourceSnap?.data();
    const assessment = assessmentSnap?.data();
    const assignmentReadiness = (0, applicationState_1.resolveOfficerDecisionReadiness)({
        eventId, versionId, assessmentId, resourceId, authorityType,
        officerUid: callerUid, eventStatus: event.status, reviewStage: event.reviewStage,
        assignment, assessment, resource, requiredAuthorities: event.requiredAuthorities ?? [],
    });
    if (!assignmentReadiness.ready)
        throw new https_1.HttpsError('failed-precondition', assignmentReadiness.message);
    const finalizedAdminManual = assessment?.status === 'official_ready'
        && Boolean(assessment && 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual');
    validateOfficerRejectionRationale(decision, assessment?.assessmentReadiness, finalizedAdminManual, reason);
    if (!assessmentId || !resourceId || !assessmentRef || !resourceRef || !assessmentSnap || !resourceSnap) {
        throw new https_1.HttpsError('failed-precondition', 'Risk assessment and resources must point to the current application assessment.');
    }
    assertOfficerDecisionArtifacts(assessment, resource, eventId, versionId, assessmentId, resourceId, authorityType);
    const now = Date.now();
    return db.runTransaction(async (tx) => {
        // Reads first (Firestore requires all reads before all writes).
        const currentDecisionRef = eventRef.collection(types_1.COLLECTIONS.DECISIONS).doc(assignmentId);
        const [currentEventSnap, allAssignmentsSnap, currentDecisionSnap, currentAssessmentSnap, currentResourceSnap] = await Promise.all([
            tx.get(eventRef),
            tx.get(eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS)),
            tx.get(currentDecisionRef),
            tx.get(assessmentRef),
            tx.get(resourceRef),
        ]);
        const currentEvent = currentEventSnap.data();
        if (!currentEventSnap.exists || currentEvent?.currentVersionId !== versionId
            || currentEvent.currentAssessmentId !== assessmentId || currentEvent.currentResourceId !== resourceId
            || currentEvent.status !== 'UnderReview' || currentEvent.reviewStage !== 'authority'
            || currentEvent.assignedOfficerByAuthority?.[authorityType] !== callerUid) {
            throw new https_1.HttpsError('aborted', 'The application generation changed before the proposal was recorded.');
        }
        const all = allAssignmentsSnap.docs
            .map((d) => ({ ...d.data(), assignmentId: d.id }))
            .filter((candidate) => candidate.versionId === versionId);
        const currentAssignment = all.find((candidate) => candidate.assignmentId === assignmentId);
        if (!currentAssignment || currentAssignment.officerUid !== request.auth.uid
            || currentAssignment.authorityType !== profile.authorityType
            || currentAssignment.status === 'revoked') {
            throw new https_1.HttpsError('permission-denied', 'This assignment is no longer yours to review.');
        }
        const currentAssessment = currentAssessmentSnap.data();
        const currentResource = currentResourceSnap.data();
        const transactionReadiness = (0, applicationState_1.resolveOfficerDecisionReadiness)({
            eventId, versionId, assessmentId, resourceId, authorityType,
            officerUid: request.auth.uid, eventStatus: currentEvent.status, reviewStage: currentEvent.reviewStage,
            assignment: currentAssignment, assessment: currentAssessment, resource: currentResource,
            requiredAuthorities: currentEvent.requiredAuthorities ?? [],
        });
        if (!transactionReadiness.ready)
            throw new https_1.HttpsError('aborted', transactionReadiness.message);
        assertOfficerDecisionArtifacts(currentAssessmentSnap.data(), currentResourceSnap.data(), eventId, versionId, assessmentId, resourceId, authorityType);
        const isAmendment = currentAssignment.status === 'completed';
        const previousReason = currentAssignment.reason ?? '';
        const previousSuggestion = currentAssignment.suggestion ?? '';
        const previousDecisionRecord = currentDecisionSnap.data();
        if (isAmendment && currentAssignment.decision === decision
            && previousReason === reason && previousSuggestion === suggestion) {
            return { assignmentId, decision, allCompleted: false, amended: false, idempotent: true };
        }
        // Treat the current assignment as if it's about to be completed
        // (so the last officer's proposal correctly triggers reviewStage='second').
        const afterCurrentProposal = all
            .map((candidate) => candidate.assignmentId === assignmentId
            ? { ...candidate, status: 'completed' }
            : candidate);
        const allCompleted = allRequiredAssignmentsCompleted(afterCurrentProposal, currentEvent.requiredAuthorities ?? [], currentEvent.assignedOfficerByAuthority ?? {}, versionId);
        const statusSummary = all.map((a) => ({ auth: a.authorityType, status: a.status }));
        console.log(`[recordOfficerProposal] eventId=${eventId} assignmentId=${assignmentId} statuses=${JSON.stringify(statusSummary)} allCompleted=${allCompleted}`);
        // Writes.
        tx.update(assignmentRef, {
            status: 'completed',
            decision,
            ...(reason ? { reason } : { reason: firestore_1.FieldValue.delete() }),
            ...(suggestion ? { suggestion } : { suggestion: firestore_1.FieldValue.delete() }),
            reviewStage: 'authority',
            ...(decision === 'Rejected' ? { rejectionReasonCategory } : { rejectionReasonCategory: firestore_1.FieldValue.delete() }),
            decidedAt: now,
            ...(decision === 'Approved' ? { confirmedReview: true } : { confirmedReview: firestore_1.FieldValue.delete() }),
        });
        // Older clients wrote a current decision document in addition to the
        // assignment. Keep that legacy projection in sync when amending, while
        // leaving the new assignment-first schema unchanged for fresh proposals.
        if (isAmendment && currentDecisionSnap.exists && previousDecisionRecord?.current === true) {
            tx.set(currentDecisionRef, {
                ...previousDecisionRecord,
                decisionId: assignmentId,
                eventId,
                versionId,
                authorityType: currentAssignment.authorityType,
                decision,
                rationale: reason,
                ...(suggestion ? { suggestion } : { suggestion: firestore_1.FieldValue.delete() }),
                ...(decision === 'Approved' ? { materialsReviewed: true } : { materialsReviewed: firestore_1.FieldValue.delete() }),
                reviewerId: request.auth.uid,
                decidedAt: now,
                current: true,
            }, { merge: true });
        }
        if (allCompleted && !isAmendment) {
            tx.update(eventRef, {
                reviewStage: 'second',
                updatedAt: now,
            });
        }
        if (isAmendment && currentAssignment.decision && currentAssignment.decidedAt) {
            const archivedDecision = previousDecisionRecord?.decision ?? currentAssignment.decision;
            const archivedReason = previousDecisionRecord?.rationale ?? previousReason;
            const archivedSuggestion = previousDecisionRecord?.suggestion ?? previousSuggestion;
            const archivedReviewer = previousDecisionRecord?.reviewerId ?? currentAssignment.officerUid;
            const archivedAt = previousDecisionRecord?.decidedAt ?? currentAssignment.decidedAt;
            const historyId = `${assignmentId}_amended_${now}_${historySuffix({
                decision: archivedDecision,
                reason: archivedReason,
                suggestion: archivedSuggestion,
            })}`;
            const historyReference = eventRef.collection(types_1.COLLECTIONS.DECISION_HISTORY).doc(historyId);
            tx.create(historyReference, {
                decisionId: historyId,
                eventId,
                versionId,
                authorityType: currentAssignment.authorityType,
                decision: archivedDecision,
                rationale: archivedReason,
                ...(archivedSuggestion ? { suggestion: archivedSuggestion } : {}),
                reviewerId: archivedReviewer,
                decidedAt: archivedAt,
                current: false,
                amendedAt: now,
                amendedBy: request.auth.uid,
            });
            const auditReference = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${historyId}_audit`);
            tx.create(auditReference, {
                id: auditReference.id,
                eventId,
                versionId,
                action: 'decision_amended',
                actorId: request.auth.uid,
                actorRole: 'authority',
                timestamp: now,
                notes: reason || 'Approval rationale omitted after reviewed-material confirmation.',
                metadata: {
                    authorityType: currentAssignment.authorityType,
                    previousDecision: archivedDecision,
                    previousReason: archivedReason,
                    previousSuggestion: archivedSuggestion || null,
                    decision,
                    reason: reason || null,
                    suggestion: suggestion || null,
                    confirmedReview,
                },
            });
        }
        return { assignmentId, decision, allCompleted, amended: isAmendment, idempotent: false };
    }).then(async (result) => {
        // Fire-and-forget notification to the admin when all officers are done.
        if (result.allCompleted) {
            try {
                const adminUid = await findFirstAdminUid(db);
                if (adminUid) {
                    await (0, notifications_1.createNotification)({
                        recipientUid: adminUid,
                        eventId,
                        versionId,
                        type: 'decision_made',
                        title: 'All officers have decided',
                        message: `All assigned officers have recorded their decisions. Ready for second review.`,
                        sourceActionId: `all-officers-done_${versionId}`,
                    });
                }
            }
            catch (err) {
                console.warn('[recordOfficerProposal] admin notification failed (non-fatal):', err);
            }
        }
        // Do not notify the organiser yet: this is an officer proposal, not a
        // final application outcome. `makeSecondReviewDecision` sends the one
        // authoritative result after the admin completes second review.
        return {
            eventId,
            versionId,
            assignmentId: result.assignmentId,
            decision: result.decision,
            allCompleted: result.allCompleted,
            amended: result.amended,
            ...(result.idempotent ? { idempotent: true } : {}),
        };
    });
});
function historySuffix(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url').slice(0, 16);
}
/** Apply the longer rationale rule only to adverse officer proposals while
 * the assessment is provisional or lacks sufficient data. */
function validateOfficerRejectionRationale(decision, readiness, finalizedAdminManual, reason) {
    if (decision === 'Rejected' && !finalizedAdminManual
        && (readiness === 'provisional' || readiness === 'insufficient_data') && reason.trim().length < 80) {
        throw new https_1.HttpsError('invalid-argument', `When the assessment is ${readiness}, the proposal reason must be at least 80 characters.`);
    }
}
function isDecision(v) {
    return v === 'Approved' || v === 'Rejected';
}
/** Validate and normalise the officer-facing proposal contract. */
function validateOfficerProposalRequest(request) {
    const value = typeof request === 'object' && request !== null ? request : {};
    const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
    const decision = value.decision;
    const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
    const suggestion = typeof value.suggestion === 'string' ? value.suggestion.trim() : '';
    const confirmedReview = value.confirmedReview === true;
    const rejectionReasonCategory = value.rejectionReasonCategory;
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!isDecision(decision))
        throw new https_1.HttpsError('invalid-argument', 'A valid decision is required.');
    // Approval rationale is optional after the officer confirms that all
    // required review materials were considered. Rejections still need a
    // meaningful reason.
    if (decision === 'Rejected' && (reason.length < REASON_MIN || reason.length > REASON_MAX)) {
        throw new https_1.HttpsError('invalid-argument', `reason must be ${REASON_MIN}-${REASON_MAX} characters when rejecting.`);
    }
    if (decision === 'Approved' && reason.length > REASON_MAX) {
        throw new https_1.HttpsError('invalid-argument', `reason must be at most ${REASON_MAX} characters.`);
    }
    if (suggestion.length > SUGGESTION_MAX) {
        throw new https_1.HttpsError('invalid-argument', `suggestion must be at most ${SUGGESTION_MAX} characters.`);
    }
    if (decision === 'Rejected' && (suggestion.length < REASON_MIN || suggestion.length > SUGGESTION_MAX)) {
        throw new https_1.HttpsError('invalid-argument', `suggestion must be ${REASON_MIN}-${SUGGESTION_MAX} characters when rejecting.`);
    }
    if (decision === 'Rejected' && !types_1.REJECTION_REASON_CATEGORIES.includes(rejectionReasonCategory)) {
        throw new https_1.HttpsError('invalid-argument', 'A valid rejectionReasonCategory is required when rejecting.');
    }
    if (decision === 'Approved' && !confirmedReview) {
        throw new https_1.HttpsError('failed-precondition', 'You must confirm that you have reviewed the assessment, advisory, evidence, and resource recommendation before approving.');
    }
    return {
        eventId,
        decision,
        reason,
        suggestion,
        confirmedReview,
        ...(decision === 'Rejected' ? { rejectionReasonCategory: rejectionReasonCategory } : {}),
    };
}
function safeDocumentId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function assertOfficerDecisionArtifacts(assessment, resource, eventId, versionId, assessmentId, resourceId, authorityType) {
    if (!assessment || assessment.assessmentId !== assessmentId
        || assessment.eventId !== eventId || assessment.versionId !== versionId
        || !resource || !(0, resourceContract_1.validateResourceRecommendation)(resource).ok
        || resource.resourceId !== resourceId || resource.eventId !== eventId
        || resource.versionId !== versionId || resource.assessmentId !== assessmentId) {
        throw new https_1.HttpsError('failed-precondition', 'Risk assessment and resources must be ready before recording a proposal.');
    }
    if (assessment.status !== 'official_ready' || resource.stage !== 'official') {
        throw new https_1.HttpsError('failed-precondition', 'Officer decisions require the current official assessment and official resource revision.');
    }
    if ('sourceKind' in assessment && assessment.sourceKind === 'admin_manual')
        return;
    const aiOfficial = assessment;
    const head = aiOfficial.authorityReviewState?.activeReviewHeads?.[authorityType];
    const officialReviewIds = Array.isArray(aiOfficial.officialResult.reviewIds)
        ? aiOfficial.officialResult.reviewIds : [];
    if (!head?.reviewId || !officialReviewIds.includes(head.reviewId)) {
        throw new https_1.HttpsError('failed-precondition', 'Submit and finalize your eight-category score review before recording an application proposal.');
    }
}
async function findFirstAdminUid(db) {
    const snap = await db.collection(types_1.COLLECTIONS.USERS).where('role', '==', 'admin').limit(1).get();
    if (snap.empty)
        return null;
    return snap.docs[0].id;
}
/** Transactional authorization fence for revoke/reassign races. */
function assertCurrentOfficerAssignment(value, assignmentId, eventId, versionId, authorityType, officerUid) {
    if (!value || typeof value !== 'object') {
        throw new https_1.HttpsError('aborted', 'The officer assignment changed before the proposal was recorded.');
    }
    const assignment = value;
    if (assignment.assignmentId !== assignmentId
        || assignment.eventId !== eventId
        || assignment.versionId !== versionId
        || assignment.authorityType !== authorityType
        || assignment.officerUid !== officerUid
        || !['pending', 'in_progress', 'completed'].includes(assignment.status ?? '')) {
        throw new https_1.HttpsError('aborted', 'The officer assignment changed before the proposal was recorded.');
    }
}
function allRequiredAssignmentsCompleted(assignments, requiredAuthorities, assignedOfficerByAuthority, versionId) {
    return requiredAuthorities.length > 0 && requiredAuthorities.every((authority) => {
        const assignment = assignments.find((candidate) => candidate.authorityType === authority
            && candidate.versionId === versionId
            && assignedOfficerByAuthority[authority] === candidate.officerUid);
        return assignment?.status === 'completed';
    });
}
//# sourceMappingURL=recordOfficerProposal.js.map