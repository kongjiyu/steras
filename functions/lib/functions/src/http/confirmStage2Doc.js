"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmStage2Doc = void 0;
exports.confirmStage2DocForUser = confirmStage2DocForUser;
/**
 * confirmStage2Doc — public confirm of a published Stage 2 image
 * (FR-M3-27, FR-M3-28, UC-35, UC-37, Workstream 4).
 *
 *   Any signed-in public viewer can 👍 a Stage 2 image to indicate
 *   "yes, I can see this item at the venue." Per Q1 (locked 2026-08-19):
 *   one confirm per user per control (soft rate-limit; subsequent
 *   calls are no-ops).
 *
 *   - Caller is signed in.
 *   - The Stage 2 doc exists with `published === true`.
 *   - Per-user counter doc at `events/{id}/event_controls/{controlId}/
 *     stage2_confirms/{uid}` is the rate-limit. If it exists, the
 *     call is a no-op (idempotent).
 *
 *   - On first confirm: writes the counter doc + increments
 *     `publicConfirmCount` on the Stage 2 doc + writes a
 *     `stage2_confirmed` audit log entry.
 *
 *   - No notification (low signal; the count is the audit).
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const controlLifecycle_1 = require("../utils/controlLifecycle");
const stage2Counter_1 = require("../utils/stage2Counter");
exports.confirmStage2Doc = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before confirming.');
    try {
        return await confirmStage2DocForUser(request.auth.uid, request.data);
    }
    catch (err) {
        if (err instanceof https_1.HttpsError) {
            console.warn(`[confirmStage2Doc] HttpsError ${err.code}: ${err.message}`);
            throw err;
        }
        const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        console.error(`[confirmStage2Doc] unexpected error: ${message}`);
        throw new https_1.HttpsError('internal', 'Unable to record the Stage 2 confirmation. Retry shortly.');
    }
});
async function confirmStage2DocForUser(uid, data, now = Date.now()) {
    const eventId = (data.eventId ?? '').trim();
    const controlId = (data.controlId ?? '').trim();
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!controlId)
        throw new https_1.HttpsError('invalid-argument', 'controlId is required.');
    if (data.confirmed !== undefined && typeof data.confirmed !== 'boolean')
        throw new https_1.HttpsError('invalid-argument', 'confirmed must be a boolean.');
    const db = (0, firebase_admin_1.firestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const controlRef = eventRef.collection(types_1.COLLECTIONS.EVENT_CONTROLS).doc(controlId);
    const docId = `${controlId}-s2`;
    const docRef = controlRef.collection(types_1.COLLECTIONS.STAGE2_DOCS).doc(docId);
    const counterRef = controlRef.collection(types_1.COLLECTIONS.STAGE2_CONFIRMS).doc(uid);
    const publicRef = db.collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROLS)
        .doc(eventId)
        .collection(types_1.COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS)
        .doc(`${controlId}-stage2`);
    return db.runTransaction(async (tx) => {
        // Reads first.
        const [docSnap, counterSnap, eventSnap, publicSnap, userSnap, controlSnap, reportSnap] = await Promise.all([
            tx.get(docRef),
            tx.get(counterRef),
            tx.get(eventRef),
            tx.get(publicRef),
            tx.get(db.collection(types_1.COLLECTIONS.USERS).doc(uid)),
            tx.get(controlRef),
            tx.get(controlRef.collection(types_1.COLLECTIONS.STAGE2_REPORTS).doc(uid)),
        ]);
        const viewer = userSnap.data();
        if (!viewer || viewer.uid !== uid || viewer.role !== 'public') {
            throw new https_1.HttpsError('permission-denied', 'Only registered public viewer accounts can confirm published evidence.');
        }
        if (!docSnap.exists) {
            throw new https_1.HttpsError('not-found', `Stage 2 image not found for control ${controlId}.`);
        }
        const stage2 = docSnap.data();
        if (stage2.published !== true) {
            throw new https_1.HttpsError('failed-precondition', 'This Stage 2 image is not published yet.');
        }
        if (!eventSnap.exists)
            throw new https_1.HttpsError('not-found', 'Event not found.');
        const event = eventSnap.data();
        const versionId = event.currentVersionId;
        const control = controlSnap.data();
        const projection = publicSnap.data();
        if (!versionId || !controlSnap.exists || !(0, controlLifecycle_1.isActiveControlGeneration)(event, control, eventId)
            || !publicSnap.exists || projection?.eventId !== eventId
            || projection.versionId !== versionId || projection.controlId !== controlId || projection.docId !== docId) {
            throw new https_1.HttpsError('failed-precondition', 'This published evidence is not bound to the current application generation.');
        }
        if (data.confirmed === false) {
            const active = counterSnap.exists && (0, stage2Counter_1.counterMatchesStage2)(counterSnap.data(), stage2);
            const count = Math.max(0, (stage2.publicConfirmCount ?? 0) - (active ? 1 : 0));
            if (active) {
                tx.delete(counterRef);
                tx.update(docRef, { publicConfirmCount: count });
                tx.update(publicRef, { publicConfirmCount: count });
                const auditId = `${versionId}_${controlId}_confirmation_withdrawn_${uid}_${now}`;
                tx.set(eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), { id: auditId, eventId, versionId, actorId: uid, actorRole: 'public', action: 'stage2_confirmation_withdrawn', timestamp: now, metadata: { controlId } });
            }
            return { alreadyConfirmed: false, publicConfirmCount: count };
        }
        if (reportSnap.exists && (0, stage2Counter_1.counterMatchesStage2)(reportSnap.data(), stage2))
            throw new https_1.HttpsError('failed-precondition', 'Withdraw your report before confirming this image.');
        if (counterSnap.exists && (0, stage2Counter_1.counterMatchesStage2)(counterSnap.data(), stage2)) {
            // Idempotency never bypasses the current-generation authorization gate.
            return { alreadyConfirmed: true, publicConfirmCount: stage2.publicConfirmCount };
        }
        // First confirm — write the counter, increment the count, write the audit log.
        const newCount = (stage2.publicConfirmCount ?? 0) + 1;
        tx.set(counterRef, { uid, confirmedAt: now, stage2UploadedAt: stage2.uploadedAt, stage2PublishedAt: stage2.publishedAt });
        tx.update(docRef, { publicConfirmCount: newCount });
        if (publicSnap.exists)
            tx.update(publicRef, { publicConfirmCount: newCount });
        // Audit log (one per unique user, not per click — Q2 confirmed).
        const auditId = `${versionId}_${controlId}_stage2_confirmed_${uid}_${now}`;
        const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId);
        tx.create(auditRef, {
            id: auditId,
            eventId,
            versionId,
            action: 'stage2_confirmed',
            actorId: uid,
            actorRole: 'public',
            timestamp: now,
            metadata: {
                controlId,
                docId,
                publicConfirmCount: newCount,
            },
        });
        return { alreadyConfirmed: false, publicConfirmCount: newCount };
    });
}
//# sourceMappingURL=confirmStage2Doc.js.map