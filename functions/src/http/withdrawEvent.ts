import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, EventRecord, UserProfile } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { hasCanonicalCurrentVersion, isMatchingSubmittedVersion } from './applicationLifecycle';

interface WithdrawEventRequest {
  eventId?: string;
  rationale?: string;
}

export const withdrawEvent = onCall<WithdrawEventRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before withdrawing an event.');
  const { eventId, rationale } = validateWithdrawRequest(request.data);
  return withdrawEventForUser(request.auth.uid, eventId, rationale);
});

export function validateWithdrawRequest(request: unknown): { eventId: string; rationale: string } {
  const value = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {};
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new HttpsError('invalid-argument', 'A valid eventId is required.');
  if (Object.keys(value).some((key) => key !== 'eventId' && key !== 'rationale')) throw new HttpsError('invalid-argument', 'The request contains unsupported fields.');
  if (rationale.length < 10 || rationale.length > 500) throw new HttpsError('invalid-argument', 'Withdrawal rationale must be 10–500 characters.');
  return { eventId, rationale };
}

export async function withdrawEventForUser(uid: string, eventId: string, rationale: string, now = Date.now()) {
  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const publicEventReference = db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId);
  const userReference = db.collection(COLLECTIONS.USERS).doc(uid);
  return db.runTransaction(async (transaction) => {
    const [snapshot, userSnapshot] = await Promise.all([transaction.get(eventReference), transaction.get(userReference)]);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Event was not found.');
    const event = { eventId, ...snapshot.data() } as EventRecord;
    const user = userSnapshot.data() as UserProfile | undefined;
    if (user?.role !== 'organizer') throw new HttpsError('permission-denied', 'Only organizer accounts can withdraw applications.');
    if (event.organizerId !== uid) throw new HttpsError('permission-denied', 'You do not own this event.');
    if (event.status === 'Withdrawn') return { eventId, status: 'Withdrawn' as const };
    if (!['UnderReview', 'Approved', 'Manual Review Required'].includes(event.status)) {
      throw new HttpsError('failed-precondition', 'This application is not eligible for withdrawal. Cancel a Pending application before Admin review instead.');
    }
    if (!hasCanonicalCurrentVersion(event) || !event.currentVersionId) {
      throw new HttpsError('failed-precondition', 'The submitted application version is invalid.');
    }
    const sourceVersionSnapshot = await transaction.get(eventReference.collection(COLLECTIONS.VERSIONS).doc(event.currentVersionId));
    if (!sourceVersionSnapshot.exists || !isMatchingSubmittedVersion(eventId, event, sourceVersionSnapshot.data())) {
      throw new HttpsError('failed-precondition', 'The immutable submitted application version is missing or invalid.');
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
    const auditReference = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`event_withdrawn_${event.currentVersionId ?? 'unversioned'}`);
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
    return { eventId, status: 'Withdrawn' as const };
  });
}
