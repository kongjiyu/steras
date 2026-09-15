/**
 * Notification access Cloud Functions (read/mark).
 *
 * Listing is scoped to the caller's UID — a user can only see their own
 * notifications. Marking read is similarly scoped.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, Notification } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

const MAX_LIST = 50;

interface NotificationDocumentLike {
  data: () => { read?: unknown };
}

export const listMyNotifications = onCall<{ limit?: number } | undefined>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to view notifications.');
  const db = firestore();
  const limit = validateNotificationListLimit(request.data?.limit);
  const snap = await db.collection(COLLECTIONS.NOTIFICATIONS)
    .where('recipientUid', '==', request.auth.uid)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  const items: Notification[] = snap.docs.map((d) => d.data() as Notification);
  const unread = items.filter((n) => !n.read).length;
  return { items, unread };
});

export const markNotificationRead = onCall<{ notificationId?: string; read?: boolean }>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to update notifications.');
  const id = validateNotificationId(request.data?.notificationId);
  if (request.data?.read !== undefined && typeof request.data.read !== 'boolean') {
    throw new HttpsError('invalid-argument', 'read must be a boolean.');
  }
  const read = request.data?.read !== false; // default true
  const db = firestore();
  const ref = db.collection(COLLECTIONS.NOTIFICATIONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, idempotent: true };
  const data = snap.data() as Notification;
  if (data.recipientUid !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You cannot modify another user\'s notification.');
  }
  await ref.update({ read, readAt: read ? Date.now() : null });
  return { ok: true, idempotent: false };
});

export const markAllNotificationsRead = onCall({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to update notifications.');
  const db = firestore();
  const snapshot = await db.collection(COLLECTIONS.NOTIFICATIONS)
    .where('recipientUid', '==', request.auth.uid)
    .get();
  const unread = unreadNotificationDocuments(snapshot.docs);
  const readAt = Date.now();
  for (let offset = 0; offset < unread.length; offset += 500) {
    const batch = db.batch();
    for (const document of unread.slice(offset, offset + 500)) batch.update(document.ref, { read: true, readAt });
    await batch.commit();
  }
  return { ok: true, updated: unread.length };
});

export function unreadNotificationDocuments<T extends NotificationDocumentLike>(documents: readonly T[]): T[] {
  return documents.filter((document) => document.data().read !== true);
}

export function validateNotificationListLimit(value: unknown): number {
  if (value === undefined) return MAX_LIST;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_LIST) {
    throw new HttpsError('invalid-argument', `limit must be an integer from 1 to ${MAX_LIST}.`);
  }
  return value;
}

export function validateNotificationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.trim())) {
    throw new HttpsError('invalid-argument', 'notificationId is invalid.');
  }
  return value.trim();
}
