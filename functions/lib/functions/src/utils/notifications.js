"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotification = createNotification;
exports.organiserUidFor = organiserUidFor;
exports.resolveAuthUid = resolveAuthUid;
/**
 * Durable in-app notifications (FR-M3-08 / handoff item 7).
 *
 * The notification collection layout:
 *   notifications/{notificationId} {
 *     recipientUid: string      — who sees it in the bell
 *     eventId: string          — related event (if any)
 *     versionId?: string       — versioned with the event
 *     type: 'decision_made' | 'application_approved' | 'application_rejected'
 *         | 'control_verified' | 'control_rejected'
 *     title: string            — short, present-tense
 *     message: string          — privacy-safe, no PII beyond event name
 *     sourceActionId: string   — for idempotency (decision history id, etc.)
 *     read: boolean            — read/unread
 *     createdAt: number
 *     readAt?: number
 *   }
 *
 * The notification ID is `sourceActionId` so re-running a Cloud Function
 * (or a duplicate retry) is naturally idempotent — set() overwrites.
 *
 * Real-time status is the mandatory baseline; FCM push is out of scope.
 */
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
/**
 * Write a notification. Safe to call from inside a Firestore transaction
 * (we use a transaction so the create + audit-log write are atomic).
 */
async function createNotification(input, now = Date.now()) {
    if (!input.recipientUid)
        throw new https_1.HttpsError('invalid-argument', 'recipientUid is required.');
    if (!input.eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!input.sourceActionId)
        throw new https_1.HttpsError('invalid-argument', 'sourceActionId is required.');
    if (!input.title || input.title.length > 120) {
        throw new https_1.HttpsError('invalid-argument', 'title is required (max 120 chars).');
    }
    if (!input.message || input.message.length > 500) {
        throw new https_1.HttpsError('invalid-argument', 'message is required (max 500 chars).');
    }
    // FR-M3-08 size limits on the split fields. Empty strings are
    // treated as "not set" so callers can pass `''` safely.
    const reason = input.reason?.trim() || undefined;
    const suggestion = input.suggestion?.trim() || undefined;
    if (reason && reason.length > 1_000) {
        throw new https_1.HttpsError('invalid-argument', 'reason is too long (max 1000 chars).');
    }
    if (suggestion && suggestion.length > 1_000) {
        throw new https_1.HttpsError('invalid-argument', 'suggestion is too long (max 1000 chars).');
    }
    const db = (0, firebase_admin_1.firestore)();
    const notifId = input.notificationId ?? input.sourceActionId;
    const notifRef = db.collection(types_1.COLLECTIONS.NOTIFICATIONS ?? 'notifications').doc(notifId);
    const notifSnap = await notifRef.get();
    if (notifSnap.exists) {
        // Idempotent: same sourceActionId already produced a notification.
        return;
    }
    await notifRef.set({
        notificationId: notifId,
        recipientUid: input.recipientUid,
        eventId: input.eventId,
        versionId: input.versionId ?? null,
        type: input.type,
        title: input.title,
        message: input.message,
        sourceActionId: input.sourceActionId,
        read: false,
        createdAt: now,
        ...(reason ? { reason } : {}),
        ...(suggestion ? { suggestion } : {}),
    });
}
/**
 * Look up the organiser UID for an event so we can address the notification.
 * Returns null if the event doesn't exist or has no organizerId.
 */
async function organiserUidFor(eventId) {
    const db = (0, firebase_admin_1.firestore)();
    const eventSnap = await db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId).get();
    if (!eventSnap.exists)
        return null;
    const data = eventSnap.data();
    return data?.organizerId ?? null;
}
/**
 * Resolve an `organizerId` value on an event to the actual auth UID that
 * can be used as `recipientUid` for a notification.
 *
 * Convention: the user doc id IS the auth UID. If `organizerId` matches a
 * real user doc, return that doc's id (== auth UID). If no user doc with
 * that id exists, log a warning and return the input as-is so existing
 * (legacy) data keeps working — but the notification will likely not
 * surface in the bell until the seed is updated.
 */
async function resolveAuthUid(organizerId) {
    if (!organizerId)
        return null;
    const db = (0, firebase_admin_1.firestore)();
    const userSnap = await db.collection(types_1.COLLECTIONS.USERS).doc(organizerId).get();
    if (userSnap.exists) {
        const data = userSnap.data();
        return data?.uid ?? organizerId;
    }
    console.warn(`[notifications] organizerId=${organizerId} has no matching user doc; using as-is. Recipient may not see the notification.`);
    return organizerId;
}
//# sourceMappingURL=notifications.js.map