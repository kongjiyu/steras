"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markNotificationRead = exports.listMyNotifications = void 0;
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
    const limit = Math.min(Math.max(request.data?.limit ?? MAX_LIST, 1), MAX_LIST);
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
    const id = (request.data?.notificationId ?? '').trim();
    if (!id)
        throw new https_1.HttpsError('invalid-argument', 'notificationId is required.');
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
//# sourceMappingURL=notifications.js.map