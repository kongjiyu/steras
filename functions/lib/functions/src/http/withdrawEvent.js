"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withdrawEvent = void 0;
exports.validateWithdrawRequest = validateWithdrawRequest;
exports.withdrawEventForUser = withdrawEventForUser;
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
exports.withdrawEvent = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before withdrawing an event.');
    const { eventId, rationale } = validateWithdrawRequest(request.data);
    return withdrawEventForUser(request.auth.uid, eventId, rationale);
});
function validateWithdrawRequest(request) {
    const value = typeof request === 'object' && request !== null ? request : {};
    const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
    const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (rationale.length > 500)
        throw new https_1.HttpsError('invalid-argument', 'Rationale must be at most 500 characters.');
    return { eventId, ...(rationale ? { rationale } : {}) };
}
async function withdrawEventForUser(uid, eventId, rationale, now = Date.now()) {
    const db = (0, firebase_admin_1.firestore)();
    const eventReference = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(eventReference);
        if (!snapshot.exists)
            throw new https_1.HttpsError('not-found', 'Event was not found.');
        const event = { eventId, ...snapshot.data() };
        if (event.organizerId !== uid)
            throw new https_1.HttpsError('permission-denied', 'You do not own this event.');
        if (!['Draft', 'Pending'].includes(event.status))
            throw new https_1.HttpsError('failed-precondition', 'This event can no longer be withdrawn.');
        transaction.update(eventReference, { status: 'Withdrawn', editableVersionId: null, updatedAt: now });
        const auditReference = eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${now}-withdrawn`);
        transaction.create(auditReference, {
            id: auditReference.id,
            eventId,
            ...(event.currentVersionId ? { versionId: event.currentVersionId } : {}),
            action: 'event_withdrawn',
            actorId: uid,
            actorRole: 'organizer',
            timestamp: now,
            previousStatus: event.status,
            newStatus: 'Withdrawn',
            ...(rationale?.trim() ? { notes: rationale.trim() } : {}),
        });
        return { eventId, status: 'Withdrawn' };
    });
}
//# sourceMappingURL=withdrawEvent.js.map