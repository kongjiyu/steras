"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markAllNotificationsRead = exports.markNotificationRead = exports.listMyNotifications = void 0;
exports.unreadNotificationDocuments = unreadNotificationDocuments;
exports.validateNotificationListLimit = validateNotificationListLimit;
exports.validateNotificationId = validateNotificationId;
/**
 * Notification access Cloud Functions (read/mark).
 *
 * Listing is scoped to the caller's UID — a user can only see their own
 * notifications. Marking read is similarly scoped.
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const MAX_LIST = 50;
exports.listMyNotifications = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in to view notifications.');
    const db = (0, firebase_admin_1.firestore)();
    const limit = validateNotificationListLimit(request.data?.limit);
    const snap = await db.collection(types_1.COLLECTIONS.NOTIFICATIONS)
        .where('recipientUid', '==', request.auth.uid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
    const items = snap.docs.map((d) => d.data());
    const unread = items.filter((n) => !n.read).length;
    return { items, unread };
});
exports.markNotificationRead = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in to update notifications.');
    const id = validateNotificationId(request.data?.notificationId);
    if (request.data?.read !== undefined && typeof request.data.read !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'read must be a boolean.');
    }
    const read = request.data?.read !== false; // default true
    const db = (0, firebase_admin_1.firestore)();
    const ref = db.collection(types_1.COLLECTIONS.NOTIFICATIONS).doc(id);
    const snap = await ref.get();
    if (!snap.exists)
        return { ok: true, idempotent: true };
    const data = snap.data();
    if (data.recipientUid !== request.auth.uid) {
        throw new https_1.HttpsError('permission-denied', 'You cannot modify another user\'s notification.');
    }
    await ref.update({ read, readAt: read ? Date.now() : null });
    return { ok: true, idempotent: false };
});
exports.markAllNotificationsRead = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in to update notifications.');
    const db = (0, firebase_admin_1.firestore)();
    const snapshot = await db.collection(types_1.COLLECTIONS.NOTIFICATIONS)
        .where('recipientUid', '==', request.auth.uid)
        .get();
    const unread = unreadNotificationDocuments(snapshot.docs);
    const readAt = Date.now();
    for (let offset = 0; offset < unread.length; offset += 500) {
        const batch = db.batch();
        for (const document of unread.slice(offset, offset + 500))
            batch.update(document.ref, { read: true, readAt });
        await batch.commit();
    }
    return { ok: true, updated: unread.length };
});
function unreadNotificationDocuments(documents) {
    return documents.filter((document) => document.data().read !== true);
}
function validateNotificationListLimit(value) {
    if (value === undefined)
        return MAX_LIST;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_LIST) {
        throw new https_1.HttpsError('invalid-argument', `limit must be an integer from 1 to ${MAX_LIST}.`);
    }
    return value;
}
function validateNotificationId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.trim())) {
        throw new https_1.HttpsError('invalid-argument', 'notificationId is invalid.');
    }
    return value.trim();
}
//# sourceMappingURL=notifications.js.map