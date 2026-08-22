"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unpublishStage2Doc = void 0;
exports.unpublishStage2DocForUser = unpublishStage2DocForUser;
/**
 * unpublishStage2Doc — admin-only Stage 2 reject / unpublish
 * (Workstream 5, FR-M3-21, UC-15).
 *
 *   Two flows share this function:
 *     - Reject: organizer uploaded a pending image; admin sees
 *       something wrong, clicks "Reject" with a reason. Doc stays at
 *       `published: false`, with the reason persisted. Organizer
 *       sees the reason in the bell and can re-upload.
 *     - Unpublish: admin already published; changed their mind (or
 *       a public report needs the doc pulled). Doc flips back to
 *       `published: false` and is hidden from the public view. No
 *       reason is required (the public_reports doc carries the
 *       report details for the M4 trail).
 *
 *   The caller passes a `reason` only for the reject flow; the
 *   unpublish flow passes an empty string. Both write a
 *   `stage2_doc_rejected` audit log entry; the notification text
 *   differs.
 *
 *   - Caller is signed in + is the admin for the project.
 *   - The Stage 2 doc exists for the current `versionId` AND the
 *     control requires Stage 2.
 *   - For the reject path: refuses if `m4TicketId` is set (a public
 *     report is open — let M4 resolve it before admin unpublishes;
 *     see `publishStage2Doc` for the symmetric check).
 *   - Sets `published: false` + (reject only) `rejectionReason`,
 *     `rejectionAt`, `rejectedBy`. Also clears `publishedAt` /
 *     `publishedBy` so the doc looks "pending" again.
 *   - Notifies the organizer with the reason in the message.
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const notifications_1 = require("../utils/notifications");
const REASON_MAX = 500;
exports.unpublishStage2Doc = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before rejecting / unpublishing.');
    try {
        return await unpublishStage2DocForUser(request.auth.uid, request.data);
    }
    catch (err) {
        if (err instanceof https_1.HttpsError) {
            console.warn(`[unpublishStage2Doc] HttpsError ${err.code}: ${err.message}`);
            throw err;
        }
        const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        console.error(`[unpublishStage2Doc] unexpected error: ${message}`);
        throw new https_1.HttpsError('internal', message.slice(0, 500));
    }
});
async function unpublishStage2DocForUser(uid, data, now = Date.now()) {
    const eventId = (data.eventId ?? '').trim();
    const controlId = (data.controlId ?? '').trim();
    const reason = (data.reason ?? '').trim();
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!controlId)
        throw new https_1.HttpsError('invalid-argument', 'controlId is required.');
    if (reason.length > REASON_MAX) {
        throw new https_1.HttpsError('invalid-argument', `reason must be at most ${REASON_MAX} characters.`);
    }
    const isReject = reason.length > 0;
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const controlRef = eventRef.collection(types_1.COLLECTIONS.EVENT_CONTROLS).doc(controlId);
    const docId = `${controlId}-s2`;
    const docRef = controlRef.collection(types_1.COLLECTIONS.STAGE2_DOCS).doc(docId);
    const userRef = db.collection(types_1.COLLECTIONS.USERS).doc(uid);
    const result = await db.runTransaction(async (tx) => {
        const [userSnap, eventSnap, controlSnap, docSnap] = await Promise.all([
            tx.get(userRef),
            tx.get(eventRef),
            tx.get(controlRef),
            tx.get(docRef),
        ]);
        if (!userSnap.exists)
            throw new https_1.HttpsError('permission-denied', 'User profile not found.');
        const profile = userSnap.data();
        if (profile.role !== 'admin') {
            throw new https_1.HttpsError('permission-denied', 'Only an admin can reject / unpublish Stage 2 images.');
        }
        if (!eventSnap.exists)
            throw new https_1.HttpsError('not-found', 'Event not found.');
        const event = eventSnap.data();
        const versionId = event.currentVersionId ?? 'v1';
        if (!controlSnap.exists)
            throw new https_1.HttpsError('not-found', `Control ${controlId} not found.`);
        const control = controlSnap.data();
        if (control.versionId !== versionId) {
            throw new https_1.HttpsError('failed-precondition', `Control ${controlId} is for a prior version. The admin must re-commit the list.`);
        }
        if (!control.stage2Requirement) {
            throw new https_1.HttpsError('failed-precondition', `Control ${controlId} does not require Stage 2.`);
        }
        if (!docSnap.exists) {
            throw new https_1.HttpsError('not-found', 'No Stage 2 image has been uploaded yet for this control.');
        }
        const stage2 = docSnap.data();
        if (stage2.m4TicketId) {
            throw new https_1.HttpsError('failed-precondition', 'A public report is open for this Stage 2 image. Wait for M4 to resolve the ticket before changing publish state.');
        }
        if (stage2.published !== true && !isReject) {
            // Unpublish on an already-pending doc: idempotent no-op. We return
            // the current state so the UI can confirm.
            return {
                noop: true,
                organizerUid: event.organizerId,
                authorityType: control.authority,
                controlName: control.controlName,
                versionId,
            };
        }
        // Build the update.
        const update = {
            published: false,
        };
        if (isReject) {
            update.rejectionReason = reason;
            update.rejectionAt = now;
            update.rejectedBy = uid;
        }
        // Clear the published fields so the doc looks "pending" again.
        update.publishedAt = firebase_admin_1.firestore.FieldValue.delete();
        update.publishedBy = firebase_admin_1.firestore.FieldValue.delete();
        tx.update(docRef, update);
        // Audit log.
        const auditAction = 'stage2_doc_rejected';
        const auditId = `${versionId}_${controlId}_${auditAction}_${uid}_${now}`;
        const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId);
        tx.create(auditRef, {
            id: auditId,
            eventId,
            versionId,
            action: auditAction,
            actorId: uid,
            actorRole: 'admin',
            timestamp: now,
            notes: isReject ? `Reject: ${reason.slice(0, 200)}` : `Unpublish: removed from public view.`,
            metadata: {
                controlId,
                docId,
                authorityType: control.authority,
                ...(isReject ? { reason } : {}),
                wasPublished: stage2.published === true,
            },
        });
        return {
            noop: false,
            organizerUid: event.organizerId,
            authorityType: control.authority,
            controlName: control.controlName,
            versionId,
            reason: isReject ? reason : undefined,
            rejectedAt: now,
        };
    });
    if (!result.noop) {
        const organizerAuthUid = await (0, notifications_1.resolveAuthUid)(result.organizerUid);
        if (organizerAuthUid) {
            const sourceActionId = `${eventId}_${controlId}_stage2_rejected_${result.rejectedAt}`;
            const title = isReject ? 'Stage 2 image rejected' : 'Stage 2 image unpublished';
            const baseMessage = isReject
                ? `${result.authorityType}: admin rejected your Stage 2 image for "${result.controlName}". Reason: ${reason}. You can re-upload a corrected image.`
                : `${result.authorityType}: admin unpublished your Stage 2 image for "${result.controlName}". The image is hidden from the public view. Re-upload to restart the review.`;
            try {
                await (0, notifications_1.createNotification)({
                    recipientUid: organizerAuthUid,
                    eventId,
                    versionId: result.versionId,
                    type: 'stage2_doc_rejected',
                    title,
                    message: baseMessage,
                    sourceActionId,
                    notificationId: `${sourceActionId}_${organizerAuthUid}`,
                });
            }
            catch (err) {
                console.warn(`[unpublishStage2Doc] organizer notification failed (non-fatal):`, err);
            }
        }
    }
    return {
        published: false,
        ...(isReject ? { reason } : {}),
        rejectedAt: 'rejectedAt' in result && typeof result.rejectedAt === 'number' ? result.rejectedAt : now,
    };
}
//# sourceMappingURL=unpublishStage2Doc.js.map