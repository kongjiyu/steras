"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordOfficerProposal = void 0;
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
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists)
        throw new https_1.HttpsError('not-found', `Event ${eventId} not found.`);
    const event = eventSnap.data();
    const versionId = event.currentVersionId;
    if (!versionId)
        throw new https_1.HttpsError('failed-precondition', 'The application has no submitted version.');
    const assessmentSnap = await eventRef.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(versionId).get();
    if (!['Pending', 'UnderReview'].includes(event.status)) {
        throw new https_1.HttpsError('failed-precondition', 'This application version is no longer open for officer review.');
    }
    if (event.initialReview?.decision !== 'Approved') {
        throw new https_1.HttpsError('failed-precondition', 'The admin initial review has not released this application for officer review.');
    }
    if (event.currentAssessmentId !== versionId || event.currentResourceId !== versionId) {
        throw new https_1.HttpsError('failed-precondition', 'Risk assessment and resources must be ready before recording a proposal.');
    }
    const assessment = assessmentSnap?.data();
    if (assessment?.complianceStatus === 'blocked' && decision === 'Approved') {
        throw new https_1.HttpsError('failed-precondition', 'This application cannot be approved while compliance checks are blocked.');
    }
    const readiness = assessment?.assessmentReadiness;
    if ((readiness === 'provisional' || readiness === 'insufficient_data') && reason.length < 80) {
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
        const allAssignmentsSnap = await tx.get(eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS));
        const all = allAssignmentsSnap.docs
            .map((d) => d.data())
            .filter((candidate) => candidate.versionId === versionId);
        // Treat the current assignment as if it's about to be completed
        // (so the last officer's proposal correctly triggers reviewStage='second').
        const allCompleted = all
            .map((a) => (a.assignmentId === assignmentId ? { ...a, status: 'completed' } : a))
            .every((a) => a.status === 'completed' || a.status === 'revoked');
        const statusSummary = all.map((a) => ({ auth: a.authorityType, status: a.status }));
        console.log(`[recordOfficerProposal] eventId=${eventId} assignmentId=${assignmentId} statuses=${JSON.stringify(statusSummary)} allCompleted=${allCompleted}`);
        // Writes.
        tx.update(assignmentRef, {
            status: 'completed',
            decision,
            reason,
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
    return v === 'Approved' || v === 'Rejected' || v === 'AmendmentRequested';
}
async function findFirstAdminUid(db) {
    const snap = await db.collection(types_1.COLLECTIONS.USERS).where('role', '==', 'admin').limit(1).get();
    if (snap.empty)
        return null;
    return snap.docs[0].id;
}
//# sourceMappingURL=recordOfficerProposal.js.map