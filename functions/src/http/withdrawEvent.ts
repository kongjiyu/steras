import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, EventRecord } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

interface WithdrawEventRequest {
  eventId?: string;
  rationale?: string;
}

export const withdrawEvent = onCall<WithdrawEventRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before withdrawing an event.');
  const { eventId, rationale } = validateWithdrawRequest(request.data);
  return withdrawEventForUser(request.auth.uid, eventId, rationale);
});

export function validateWithdrawRequest(request: unknown): { eventId: string; rationale?: string } {
  const value = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {};
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (rationale.length > 500) throw new HttpsError('invalid-argument', 'Rationale must be at most 500 characters.');
  return { eventId, ...(rationale ? { rationale } : {}) };
}

export async function withdrawEventForUser(uid: string, eventId: string, rationale?: string, now = Date.now()) {
  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(eventReference);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Event was not found.');
    const event = { eventId, ...snapshot.data() } as EventRecord;
    if (event.organizerId !== uid) throw new HttpsError('permission-denied', 'You do not own this event.');
    if (!['Draft', 'Pending'].includes(event.status)) throw new HttpsError('failed-precondition', 'This event can no longer be withdrawn.');
    transaction.update(eventReference, { status: 'Withdrawn', editableVersionId: null, updatedAt: now });
    const auditReference = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${now}-withdrawn`);
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
    return { eventId, status: 'Withdrawn' as const };
  });
}
