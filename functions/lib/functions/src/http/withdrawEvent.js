"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withdrawEvent = void 0;
exports.validateWithdrawRequest = validateWithdrawRequest;
exports.withdrawEventForUser = withdrawEventForUser;
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const applicationLifecycle_1 = require("./applicationLifecycle");
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
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId))
        throw new https_1.HttpsError('invalid-argument', 'A valid eventId is required.');
    if (Object.keys(value).some((key) => key !== 'eventId' && key !== 'rationale'))
        throw new https_1.HttpsError('invalid-argument', 'The request contains unsupported fields.');
    if (rationale.length < 10 || rationale.length > 500)
        throw new https_1.HttpsError('invalid-argument', 'Withdrawal rationale must be 10–500 characters.');
    return { eventId, rationale };
}
async function withdrawEventForUser(uid, eventId, rationale, now = Date.now()) {
    const db = (0, firebase_admin_1.firestore)();
    const eventReference = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const publicEventReference = db.collection(types_1.COLLECTIONS.PUBLIC_EVENTS).doc(eventId);
    const userReference = db.collection(types_1.COLLECTIONS.USERS).doc(uid);
    return db.runTransaction(async (transaction) => {
        const [snapshot, userSnapshot] = await Promise.all([transaction.get(eventReference), transaction.get(userReference)]);
        if (!snapshot.exists)
            throw new https_1.HttpsError('not-found', 'Event was not found.');
        const event = { eventId, ...snapshot.data() };
        const user = userSnapshot.data();
        if (user?.role !== 'organizer')
            throw new https_1.HttpsError('permission-denied', 'Only organizer accounts can withdraw applications.');
        if (event.organizerId !== uid)
            throw new https_1.HttpsError('permission-denied', 'You do not own this event.');
        if (event.status === 'Withdrawn')
            return { eventId, status: 'Withdrawn' };
        if (!['UnderReview', 'Approved', 'Manual Review Required'].includes(event.status)) {
            throw new https_1.HttpsError('failed-precondition', 'This application is not eligible for withdrawal. Cancel a Pending application before Admin review instead.');
        }
        if (!(0, applicationLifecycle_1.hasCanonicalCurrentVersion)(event) || !event.currentVersionId) {
            throw new https_1.HttpsError('failed-precondition', 'The submitted application version is invalid.');
        }
        const sourceVersionSnapshot = await transaction.get(eventReference.collection(types_1.COLLECTIONS.VERSIONS).doc(event.currentVersionId));
        if (!sourceVersionSnapshot.exists || !(0, applicationLifecycle_1.isMatchingSubmittedVersion)(eventId, event, sourceVersionSnapshot.data())) {
            throw new https_1.HttpsError('failed-precondition', 'The immutable submitted application version is missing or invalid.');
        }
        transaction.update(eventReference, {
            status: 'Withdrawn',
            withdrawnAt: now,
            withdrawnFromStatus: event.status,
            withdrawalRationale: rationale,
            editableVersionId: null,
            updatedAt: now,
        });
        transaction.delete(publicEventReference);
        const auditReference = eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`event_withdrawn_${event.currentVersionId ?? 'unversioned'}`);
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
            notes: rationale,
        });
        return { eventId, status: 'Withdrawn' };
    });
}
//# sourceMappingURL=withdrawEvent.js.map