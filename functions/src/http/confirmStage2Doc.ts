/**
 * confirmStage2Doc — public confirm of a published Stage 2 image
 * (FR-M3-27, FR-M3-28, UC-35, UC-37, Workstream 4).
 *
 *   Any signed-in public viewer can 👍 a Stage 2 image to indicate
 *   "yes, I can see this item at the venue." Per Q1 (locked 2026-08-19):
 *   one confirm per user per control (soft rate-limit; subsequent
 *   calls are no-ops).
 *
 *   - Caller is signed in.
 *   - The Stage 2 doc exists with `published === true`.
 *   - Per-user counter doc at `events/{id}/event_controls/{controlId}/
 *     stage2_confirms/{uid}` is the rate-limit. If it exists, the
 *     call is a no-op (idempotent).
 *
 *   - On first confirm: writes the counter doc + increments
 *     `publicConfirmCount` on the Stage 2 doc + writes a
 *     `stage2_confirmed` audit log entry.
 *
 *   - No notification (low signal; the count is the audit).
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  EventControl,
  EventRecord,
  Stage2Doc,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { isActiveControlGeneration } from '../utils/controlLifecycle';
import { counterMatchesStage2 } from '../utils/stage2Counter';

interface ConfirmStage2DocRequest {
  eventId?: string;
  controlId?: string;
}

interface ConfirmStage2DocResponse {
  alreadyConfirmed: boolean;
  publicConfirmCount: number;
}

export const confirmStage2Doc = onCall<ConfirmStage2DocRequest, Promise<ConfirmStage2DocResponse>>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before confirming.');
  try {
    return await confirmStage2DocForUser(request.auth.uid, request.data);
  } catch (err) {
    if (err instanceof HttpsError) {
      console.warn(`[confirmStage2Doc] HttpsError ${err.code}: ${err.message}`);
      throw err;
    }
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(`[confirmStage2Doc] unexpected error: ${message}`);
    throw new HttpsError('internal', 'Unable to record the Stage 2 confirmation. Retry shortly.');
  }
});

export async function confirmStage2DocForUser(
  uid: string,
  data: ConfirmStage2DocRequest,
  now = Date.now(),
): Promise<ConfirmStage2DocResponse> {
  const eventId = (data.eventId ?? '').trim();
  const controlId = (data.controlId ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!controlId) throw new HttpsError('invalid-argument', 'controlId is required.');

  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const docId = `${controlId}-s2`;
  const docRef = controlRef.collection(COLLECTIONS.STAGE2_DOCS).doc(docId);
  const counterRef = controlRef.collection(COLLECTIONS.STAGE2_CONFIRMS).doc(uid);
  const publicRef = db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS)
    .doc(eventId)
    .collection(COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS)
    .doc(`${controlId}-stage2`);

  return db.runTransaction(async (tx) => {
    // Reads first.
    const [docSnap, counterSnap, eventSnap, publicSnap, userSnap, controlSnap] = await Promise.all([
      tx.get(docRef),
      tx.get(counterRef),
      tx.get(eventRef),
      tx.get(publicRef),
      tx.get(db.collection(COLLECTIONS.USERS).doc(uid)),
      tx.get(controlRef),
    ]);
    const viewer = userSnap.data() as UserProfile | undefined;
    if (!viewer || viewer.uid !== uid || viewer.role !== 'public') {
      throw new HttpsError('permission-denied', 'Only registered public viewer accounts can confirm published evidence.');
    }
    if (!docSnap.exists) {
      throw new HttpsError('not-found', `Stage 2 image not found for control ${controlId}.`);
    }
    const stage2 = docSnap.data() as Stage2Doc;
    if (stage2.published !== true) {
      throw new HttpsError('failed-precondition', 'This Stage 2 image is not published yet.');
    }
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found.');
    const event = eventSnap.data() as EventRecord;
    const versionId = event.currentVersionId;
    const control = controlSnap.data() as { eventId?: string; versionId?: string; activityClosed?: boolean } | undefined;
    const projection = publicSnap.data() as { eventId?: string; versionId?: string; controlId?: string; docId?: string } | undefined;
    if (!versionId || !controlSnap.exists || !isActiveControlGeneration(event, control as EventControl, eventId)
      || !publicSnap.exists || projection?.eventId !== eventId
      || projection.versionId !== versionId || projection.controlId !== controlId || projection.docId !== docId) {
      throw new HttpsError('failed-precondition', 'This published evidence is not bound to the current application generation.');
    }
    if (counterSnap.exists && counterMatchesStage2(counterSnap.data(), stage2)) {
      // Idempotency never bypasses the current-generation authorization gate.
      return { alreadyConfirmed: true, publicConfirmCount: stage2.publicConfirmCount };
    }

    // First confirm — write the counter, increment the count, write the audit log.
    const newCount = (stage2.publicConfirmCount ?? 0) + 1;
    tx.set(counterRef, { uid, confirmedAt: now, stage2UploadedAt: stage2.uploadedAt });
    tx.update(docRef, { publicConfirmCount: newCount });
    if (publicSnap.exists) tx.update(publicRef, { publicConfirmCount: newCount });

    // Audit log (one per unique user, not per click — Q2 confirmed).
    const auditId = `${versionId}_${controlId}_stage2_confirmed_${uid}_${now}`;
    const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId);
    tx.create(auditRef, {
      id: auditId,
      eventId,
      versionId,
      action: 'stage2_confirmed',
      actorId: uid,
      actorRole: 'public',
      timestamp: now,
      metadata: {
        controlId,
        docId,
        publicConfirmCount: newCount,
      },
    });

    return { alreadyConfirmed: false, publicConfirmCount: newCount };
  });
}
