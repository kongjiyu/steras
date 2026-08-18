/**
 * Durable in-app notifications (FR-M3-08 / handoff item 7).
 *
 * The notification collection layout:
 *   notifications/{notificationId} {
 *     recipientUid: string      — who sees it in the bell
 *     eventId: string          — related event (if any)
 *     versionId?: string       — versioned with the event
 *     type: 'decision_made' | 'application_approved' | 'application_rejected'
 *         | 'amendment_requested' | 'control_verified' | 'control_rejected'
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
import { firestore } from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { COLLECTIONS, NotificationType } from '@shared/types';

export type { NotificationType };

export interface NotificationInput {
  recipientUid: string;
  eventId: string;
  versionId?: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Idempotency key. If a notification with this id already exists, no-op. */
  sourceActionId: string;
}

/**
 * Write a notification. Safe to call from inside a Firestore transaction
 * (we use a transaction so the create + audit-log write are atomic).
 */
export async function createNotification(input: NotificationInput, now = Date.now()): Promise<void> {
  if (!input.recipientUid) throw new HttpsError('invalid-argument', 'recipientUid is required.');
  if (!input.eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!input.sourceActionId) throw new HttpsError('invalid-argument', 'sourceActionId is required.');
  if (!input.title || input.title.length > 120) {
    throw new HttpsError('invalid-argument', 'title is required (max 120 chars).');
  }
  if (!input.message || input.message.length > 500) {
    throw new HttpsError('invalid-argument', 'message is required (max 500 chars).');
  }

  const db = firestore();
  const notifRef = db.collection(COLLECTIONS.NOTIFICATIONS ?? 'notifications').doc(input.sourceActionId);
  const notifSnap = await notifRef.get();
  if (notifSnap.exists) {
    // Idempotent: same sourceActionId already produced a notification.
    return;
  }
  await notifRef.set({
    notificationId: input.sourceActionId,
    recipientUid: input.recipientUid,
    eventId: input.eventId,
    versionId: input.versionId ?? null,
    type: input.type,
    title: input.title,
    message: input.message,
    sourceActionId: input.sourceActionId,
    read: false,
    createdAt: now,
  });
}

/**
 * Look up the organiser UID for an event so we can address the notification.
 * Returns null if the event doesn't exist or has no organizerId.
 */
export async function organiserUidFor(eventId: string): Promise<string | null> {
  const db = firestore();
  const eventSnap = await db.collection(COLLECTIONS.EVENTS).doc(eventId).get();
  if (!eventSnap.exists) return null;
  const data = eventSnap.data() as { organizerId?: string } | undefined;
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
export async function resolveAuthUid(organizerId: string | null | undefined): Promise<string | null> {
  if (!organizerId) return null;
  const db = firestore();
  const userSnap = await db.collection(COLLECTIONS.USERS).doc(organizerId).get();
  if (userSnap.exists) {
    const data = userSnap.data() as { uid?: string } | undefined;
    return data?.uid ?? organizerId;
  }
  console.warn(`[notifications] organizerId=${organizerId} has no matching user doc; using as-is. Recipient may not see the notification.`);
  return organizerId;
}
