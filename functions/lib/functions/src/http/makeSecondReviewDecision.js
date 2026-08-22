"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSecondReviewDecision = void 0;
/**
 * makeSecondReviewDecision — admin-only callable (M3 Workstream 1).
 *
 * The pure aggregator (locked assumption A7). The admin cannot override
 * the officers' aggregated decision; this function:
 *   1. Reads all `assignments/{versionId}_{auth}` for the current version.
 *   2. Aggregates the decisions per the prototype rules (A8):
 *        - any Rejected -> aggregate Rejected
 *        - any AmendmentRequested -> aggregate AmendmentRequested
 *        - all Approved -> aggregate Approved
 *   3. Writes the final `events.status` + `events.secondReview` + audit.
 *   4. Notifies the organiser (FR-M3-08) with the officer's reason +
 *      suggestion verbatim when rejected.
 *   5. Decrements the assigned officers' `workloadCount` (their assignment
 *      is now done).
 *
 * The admin's "decision" param is the confirmed aggregate. The function
 * refuses to confirm a different status (A7: cannot override the aggregate).
 */
const firebase_admin_1 = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const notifications_1 = require("../utils/notifications");
const ADMIN_NOTE_MAX = 1000;
exports.makeSecondReviewDecision = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before confirming a second review.');
    const eventId = (request.data?.eventId ?? '').trim();
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    const confirmedDecision = request.data?.confirmedDecision;
    if (!isDecision(confirmedDecision)) {
        throw new https_1.HttpsError('invalid-argument', 'confirmedDecision is required.');
    }
    const adminNote = (request.data?.adminNote ?? '').trim();
    if (adminNote.length > ADMIN_NOTE_MAX) {
        throw new https_1.HttpsError('invalid-argument', `adminNote must be at most ${ADMIN_NOTE_MAX} characters.`);
    }
    const db = (0, firebase_admin_1.firestore)();
    const userSnap = await db.collection(types_1.COLLECTIONS.USERS).doc(request.auth.uid).get();
    const profile = userSnap.data();
    if (!profile || profile.role !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'Only admins can confirm a second review.');
    }
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists)
        throw new https_1.HttpsError('not-found', `Event ${eventId} not found.`);
    const event = eventSnap.data();
    const versionId = event.currentVersionId;
    if (!versionId)
        throw new https_1.HttpsError('failed-precondition', 'The application has no submitted version.');
    if (event.reviewStage !== 'second') {
        throw new https_1.HttpsError('failed-precondition', 'All officers have not yet completed their review.');
    }
    // Read all assignments for this version.
    const assignmentSnaps = await eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS).get();
    const assignments = assignmentSnaps.docs.map((d) => d.data());
    if (assignments.length === 0) {
        throw new https_1.HttpsError('failed-precondition', 'No assignments found.');
    }
    const required = event.requiredAuthorities ?? [];
    for (const auth of required) {
        if (!assignments.find((a) => a.authorityType === auth && a.status === 'completed')) {
            throw new https_1.HttpsError('failed-precondition', `${auth} officer has not yet completed their review.`);
        }
    }
    // Aggregate (A8).
    const aggregate = aggregateFromAssignments(assignments, required);
    if (aggregate !== confirmedDecision) {
        throw new https_1.HttpsError('failed-precondition', `Cannot override the aggregated decision. Aggregate is ${aggregate}; you confirmed ${confirmedDecision}.`);
    }
    const now = Date.now();
    // Pick the most informative officer reason+suggestion for the
    // organiser notification (priority: Rejected > AmendmentRequested > Approved).
    const reasonOfficer = pickFeaturedOfficer(assignments, aggregate);
    const notifType = aggregate === 'Approved' ? 'application_approved'
        : aggregate === 'Rejected' ? 'application_rejected'
            : 'amendment_requested';
    return db.runTransaction(async (tx) => {
        tx.update(eventRef, {
            status: aggregate,
            reviewStage: null,
            secondReview: {
                reviewerUid: request.auth.uid,
                decidedAt: now,
                confirmedDecision: aggregate,
                adminNote: adminNote || null,
                featuredOfficerUid: reasonOfficer?.officerUid ?? null,
            },
            updatedAt: now,
        });
        // Audit.
        const auditId = `second_review_${versionId}_${now}`;
        tx.create(eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), {
            id: auditId,
            eventId,
            versionId,
            action: 'decision_made',
            actorId: request.auth.uid,
            actorRole: 'admin',
            timestamp: now,
            previousStatus: event.status,
            newStatus: aggregate,
            notes: adminNote || null,
            metadata: {
                reviewStage: 'second',
                aggregate,
                featuredOfficerUid: reasonOfficer?.officerUid ?? null,
                featuredReason: reasonOfficer?.reason ?? null,
                featuredSuggestion: reasonOfficer?.suggestion ?? null,
            },
        });
        // Decrement workload for each assigned officer + mark assignment
        // history as 'completed' (the assignment doc is already 'completed'
        // from the officer action; this just clears workload).
        for (const a of assignments) {
            if (a.status === 'completed') {
                const officerRef = db.collection(types_1.COLLECTIONS.OFFICERS).doc(a.officerUid);
                tx.update(officerRef, {
                    workloadCount: firestore_1.FieldValue.increment(-1),
                    updatedAt: now,
                });
            }
        }
        return { aggregate, notifType, reasonOfficer };
    }).then(async (result) => {
        if (event.organizerId) {
            try {
                const recipientUid = await (0, notifications_1.resolveAuthUid)(event.organizerId);
                if (recipientUid) {
                    const title = result.aggregate === 'Approved' ? 'Application approved'
                        : result.aggregate === 'Rejected' ? 'Application rejected'
                            : 'Amendment requested';
                    const message = result.reasonOfficer
                        ? `${result.reasonOfficer.authorityType} ${result.reasonOfficer.reason}${result.reasonOfficer.suggestion ? '. ' + result.reasonOfficer.suggestion : ''}`
                        : `All required authorities have ${result.aggregate} the application.`;
                    // FR-M3-08: surface the featured officer's reason + suggestion
                    // as separate fields so the bell UI can render them on
                    // separate lines (instead of concatenating into the message).
                    await (0, notifications_1.createNotification)({
                        recipientUid,
                        eventId,
                        versionId,
                        type: result.notifType,
                        title,
                        message,
                        sourceActionId: `second_review_${versionId}`,
                        ...(result.reasonOfficer?.reason ? { reason: result.reasonOfficer.reason } : {}),
                        ...(result.reasonOfficer?.suggestion ? { suggestion: result.reasonOfficer.suggestion } : {}),
                    });
                }
            }
            catch (err) {
                console.warn('[makeSecondReviewDecision] organiser notification failed (non-fatal):', err);
            }
        }
        return { eventId, status: result.aggregate };
    });
});
function aggregateFromAssignments(assignments, required) {
    const byAuthority = new Map();
    for (const a of assignments) {
        if (a.status === 'completed' && a.decision)
            byAuthority.set(a.authorityType, a.decision);
    }
    for (const auth of required) {
        if (byAuthority.get(auth) === 'Rejected')
            return 'Rejected';
    }
    for (const auth of required) {
        if (byAuthority.get(auth) === 'AmendmentRequested')
            return 'AmendmentRequested';
    }
    if (required.length > 0 && required.every((auth) => byAuthority.get(auth) === 'Approved')) {
        return 'Approved';
    }
    return 'UnderReview';
}
function pickFeaturedOfficer(assignments, aggregate) {
    if (aggregate === 'Approved') {
        return assignments.find((a) => a.decision === 'Approved' && a.reason);
    }
    if (aggregate === 'Rejected') {
        return assignments.find((a) => a.decision === 'Rejected' && a.reason);
    }
    if (aggregate === 'AmendmentRequested') {
        return assignments.find((a) => a.decision === 'AmendmentRequested' && a.reason);
    }
    return undefined;
}
function isDecision(v) {
    return v === 'Approved' || v === 'Rejected' || v === 'AmendmentRequested';
}
//# sourceMappingURL=makeSecondReviewDecision.js.map