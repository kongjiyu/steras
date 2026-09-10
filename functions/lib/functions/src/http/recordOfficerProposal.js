"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordOfficerProposal = void 0;
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
 *     `status` is `pending` or `in_progress`.
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
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const resourceContract_1 = require("../engines/resourceContract");
const notifications_1 = require("../utils/notifications");
const REASON_MIN = 10;
const REASON_MAX = 1000;
const SUGGESTION_MAX = 1000;
exports.recordOfficerProposal = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before recording a proposal.');
    const eventId = (request.data?.eventId ?? '').trim();
    const decision = request.data?.decision;
    const reason = (request.data?.reason ?? '').trim();
    const suggestion = (request.data?.suggestion ?? '').trim();
    const confirmedReview = request.data?.confirmedReview === true;
    const rejectionReasonCategory = request.data?.rejectionReasonCategory;
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!isDecision(decision))
        throw new https_1.HttpsError('invalid-argument', 'A valid decision is required.');
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
        throw new https_1.HttpsError('invalid-argument', `reason must be ${REASON_MIN}-${REASON_MAX} characters.`);
    }
    if (suggestion.length > SUGGESTION_MAX) {
        throw new https_1.HttpsError('invalid-argument', `suggestion must be at most ${SUGGESTION_MAX} characters.`);
    }
    if (decision === 'Rejected' && suggestion.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'A suggestion is required when rejecting.');
    }
    if (decision === 'Rejected' && !types_1.REJECTION_REASON_CATEGORIES.includes(rejectionReasonCategory)) {
        throw new https_1.HttpsError('invalid-argument', 'A valid rejectionReasonCategory is required when rejecting.');
    }
    // FR-M3-16: officer must confirm review of all listed materials
    // before approving. The UI checkbox drives this — server-side gate
    // is the source of truth.
    if (decision === 'Approved' && !confirmedReview) {
        throw new https_1.HttpsError('failed-precondition', 'You must confirm that you have reviewed the assessment, advisory, evidence, and resource recommendation before approving.');
    }
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
    if (!assessmentId || !resourceId || !safeDocumentId(assessmentId) || !safeDocumentId(resourceId)) {
        throw new https_1.HttpsError('failed-precondition', 'Risk assessment and resources must point to the current application assessment.');
    }
    const assessmentRef = eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessmentId);
    const resourceRef = eventRef.collection(types_1.COLLECTIONS.RESOURCES).doc(resourceId);
    const [assessmentSnap, resourceSnap] = await Promise.all([assessmentRef.get(), resourceRef.get()]);
    if (!['Pending', 'UnderReview'].includes(event.status)) {
        throw new https_1.HttpsError('failed-precondition', 'This application version is no longer open for officer review.');
    }
    if (event.initialReview?.decision !== 'Approved') {
        throw new https_1.HttpsError('failed-precondition', 'The admin initial review has not released this application for officer review.');
    }
    const resource = resourceSnap.data();
    const assessment = assessmentSnap.data();
    assertOfficerDecisionArtifacts(assessment, resource, eventId, versionId, assessmentId, resourceId, authorityType);
    const readyAssessment = assessment;
    if (readyAssessment.complianceStatus === 'blocked' && decision === 'Approved') {
        throw new https_1.HttpsError('failed-precondition', 'This application cannot be approved while compliance checks are blocked.');
    }
    const readiness = readyAssessment.assessmentReadiness;
    const finalizedAdminManual = readyAssessment.status === 'official_ready'
        && 'sourceKind' in readyAssessment && readyAssessment.sourceKind === 'admin_manual';
    if (!finalizedAdminManual && (readiness === 'provisional' || readiness === 'insufficient_data') && reason.length < 80) {
        throw new https_1.HttpsError('invalid-argument', `When the assessment is ${readiness}, the proposal reason must be at least 80 characters.`);
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
    if (assignment.status === 'completed') {
        throw new https_1.HttpsError('failed-precondition', 'You have already recorded a decision for this assignment.');
    }
    if (assignment.status === 'revoked') {
        throw new https_1.HttpsError('failed-precondition', 'This assignment was revoked.');
    }
    const now = Date.now();
    return db.runTransaction(async (tx) => {
        // Reads first (Firestore requires all reads before all writes).
        const [currentEventSnap, allAssignmentsSnap, currentAssessmentSnap, currentResourceSnap] = await Promise.all([
            tx.get(eventRef),
            tx.get(eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS)),
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
        assertOfficerDecisionArtifacts(currentAssessmentSnap.data(), currentResourceSnap.data(), eventId, versionId, assessmentId, resourceId, authorityType);
        const all = allAssignmentsSnap.docs
            .map((d) => d.data())
            .filter((candidate) => candidate.versionId === versionId);
        const transactionalAssignment = allAssignmentsSnap.docs
            .find((document) => document.id === assignmentId);
        assertCurrentOfficerAssignment(transactionalAssignment?.data(), assignmentId, eventId, versionId, authorityType, callerUid);
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
            reason,
            reviewStage: 'authority',
            ...(decision === 'Rejected' ? { rejectionReasonCategory } : {}),
            suggestion: suggestion || null,
            decidedAt: now,
        });
        if (allCompleted) {
            tx.update(eventRef, {
                reviewStage: 'second',
                updatedAt: now,
            });
        }
        return { assignmentId, decision, allCompleted };
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
        };
    });
});
function isDecision(v) {
    return v === 'Approved' || v === 'Rejected';
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
        || (assignment.status !== 'pending' && assignment.status !== 'in_progress')) {
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