"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unassignAuthorityOfficers = void 0;
/**
 * unassignAuthorityOfficers — admin-only callable (M3 Workstream 1 polish).
 *
 * Reverses an `assignAuthorityOfficers` call. Use cases:
 *   - A15: backup officer swap — admin assigned the wrong officer and
 *     wants to re-pick before the officer has recorded a proposal.
 *   - Admin double-clicked Assign and wants to start over.
 *
 * Refuses if any of the targeted assignments has `status === 'completed'`
 * (the officer has already recorded a proposal). Once a proposal is in,
 * the data is significant — the admin must go through
 * `makeSecondReviewDecision` to close out the work. This prevents
 * accidentally dropping a recorded decision.
 *
 * Behaviour:
 *   - Reads assignments for the current version, optionally filtered by
 *     `authorityType`.
 *   - Refuses if `event.reviewStage !== 'authority'`.
 *   - Refuses if any targeted assignment is `completed`.
 *   - In a transaction:
 *       - For each targeted assignment, set `status: 'revoked'`,
 *         `revokedAt`, `revokedBy`.
 *       - Decrement the officer's `workloadCount`.
 *       - Write one `assignment_revoked` audit log per revocation.
 *       - If all assignments for the version are now revoked, set
 *         `event.reviewStage = null` (back to pre-assignment state).
 *   - Idempotent on re-call (revoking a revoked assignment is a no-op).
 */
const firebase_admin_1 = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
exports.unassignAuthorityOfficers = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before unassigning officers.');
    const eventId = (request.data?.eventId ?? '').trim();
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    // Profile check: admin only.
    const db = (0, firebase_admin_1.firestore)();
    const userSnap = await db.collection(types_1.COLLECTIONS.USERS).doc(request.auth.uid).get();
    const profile = userSnap.data();
    if (!profile || profile.role !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'Only admins can unassign officers.');
    }
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
        throw new https_1.HttpsError('not-found', `Event ${eventId} not found.`);
    }
    const event = eventSnap.data();
    const versionId = event.currentVersionId;
    if (!versionId) {
        throw new https_1.HttpsError('failed-precondition', 'The application has no submitted version.');
    }
    if (event.reviewStage !== 'authority') {
        throw new https_1.HttpsError('failed-precondition', 'No officers are currently assigned to this event version.');
    }
    // Read all assignments for the current version.
    const assignmentsSnap = await eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS).get();
    const allAssignments = assignmentsSnap.docs
        .map((d) => d.data())
        .filter((a) => a.versionId === versionId);
    if (allAssignments.length === 0) {
        throw new https_1.HttpsError('failed-precondition', 'No assignments found for the current version.');
    }
    // Filter to the targeted authorities (if specified). Without a
    // filter, target all assignments for the current version.
    const filterAuth = request.data?.authorityType;
    const targeted = filterAuth
        ? allAssignments.filter((a) => a.authorityType === filterAuth)
        : allAssignments;
    if (targeted.length === 0) {
        throw new https_1.HttpsError('not-found', `No assignment found for authority ${filterAuth}.`);
    }
    // Refuse if any targeted assignment is already completed (or
    // already revoked — that's just a no-op for that row, but we still
    // continue with the rest).
    const blocking = targeted.filter((a) => a.status === 'completed');
    if (blocking.length > 0) {
        const blockingList = blocking.map((a) => a.authorityType).join(', ');
        throw new https_1.HttpsError('failed-precondition', `Cannot unassign — these officers have already recorded a proposal: ${blockingList}. ` +
            'Wait for the second review to close out their work, or contact the M3 owner.');
    }
    const now = Date.now();
    return db.runTransaction(async (tx) => {
        // Reads first.
        // Re-read the event to make sure reviewStage hasn't moved to
        // 'second' (someone might have just recorded a final proposal).
        const evSnap = await tx.get(eventRef);
        const ev = evSnap.data();
        if (ev.reviewStage !== 'authority') {
            throw new https_1.HttpsError('failed-precondition', 'reviewStage moved while you were unassigning. Try again.');
        }
        // Read all officer refs in the read phase.
        const targetsToRevoke = targeted.filter((a) => a.status === 'pending' || a.status === 'in_progress');
        const officerRefs = [];
        for (const a of targetsToRevoke) {
            const ref = db.collection(types_1.COLLECTIONS.OFFICERS).doc(a.officerUid);
            const snap = await tx.get(ref);
            officerRefs.push({ auth: a.authorityType, officerUid: a.officerUid, ref, exists: snap.exists, data: snap.exists ? snap.data() : null });
        }
        // Validate (no writes yet).
        for (const t of officerRefs) {
            // Officer may have been deleted from the officers sub-collection
            // between assignment and now. We still proceed with the revoke
            // (the assignment is the source of truth) — we just skip the
            // workload decrement for the missing officer.
            if (!t.exists) {
                console.warn(`[unassignAuthorityOfficers] officer ${t.officerUid} no longer exists; skipping workload decrement.`);
            }
        }
        // Now writes.
        let revoked = 0;
        for (const t of officerRefs) {
            const assignmentRef = eventRef.collection(types_1.COLLECTIONS.ASSIGNMENTS).doc(`${versionId}_${t.auth}`);
            tx.update(assignmentRef, {
                status: 'revoked',
                revokedAt: now,
                revokedBy: request.auth.uid,
            });
            // Decrement officer workload (only if officer still exists).
            if (t.exists && t.data) {
                tx.update(t.ref, {
                    workloadCount: firestore_1.FieldValue.increment(-1),
                    updatedAt: now,
                });
            }
            // Audit log.
            const auditId = `assignment_revoked_${versionId}_${t.auth}_${now}`;
            tx.create(eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), {
                id: auditId,
                eventId,
                versionId,
                action: 'assignment_revoked',
                actorId: request.auth.uid,
                actorRole: 'admin',
                timestamp: now,
                notes: `Revoked ${t.auth} assignment for officer ${t.officerUid}`,
                metadata: {
                    authorityType: t.auth,
                    officerUid: t.officerUid,
                    reason: 'admin_unassign',
                    officerWorkloadDecremented: t.exists,
                },
            });
            revoked++;
        }
        // If every assignment for this version is now revoked, reset
        // reviewStage to null so the admin can re-assign from scratch.
        const allAssignmentsAfter = allAssignments.map((a) => {
            const wasTargeted = targetsToRevoke.some((t) => t.assignmentId === a.assignmentId);
            return wasTargeted ? { ...a, status: 'revoked' } : a;
        });
        const allRevoked = allAssignmentsAfter.every((a) => a.status === 'revoked');
        if (allRevoked) {
            tx.update(eventRef, {
                reviewStage: null,
                updatedAt: now,
            });
        }
        return { revoked, allRevoked };
    }).then((result) => {
        return {
            eventId,
            versionId,
            revoked: result.revoked,
            reviewStageReset: result.allRevoked,
        };
    });
});
//# sourceMappingURL=unassignAuthorityOfficers.js.map