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

export const listMyNotifications = onCall<{ limit?: number } | undefined>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to view notifications.');
  const db = firestore();
  const limit = Math.min(Math.max(request.data?.limit ?? MAX_LIST, 1), MAX_LIST);
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
  const id = (request.data?.notificationId ?? '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'notificationId is required.');
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
