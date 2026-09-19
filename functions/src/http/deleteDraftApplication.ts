import { firestore } from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { COLLECTIONS, EventRecord, UserProfile } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { validateEventId } from './applicationLifecycle';

const DELETION_RECEIPTS = 'draft_deletion_receipts';
const INCIDENT_NOTIFICATION_OUTBOX = 'incident_notification_outbox';

type DeletionReceiptState = 'deleting' | 'completed';

interface DeleteDraftApplicationRequest {
  eventId?: string;
}

export interface DeleteDraftApplicationResponse {
  eventId: string;
  deleted: true;
  alreadyDeleted: boolean;
}

interface DraftDeletionReceipt {
  eventId: string;
  organizerUid: string;
  statusAtDeletion: 'Draft';
  state: DeletionReceiptState;
  requestedAt: number;
  updatedAt: number;
  completedAt?: number;
}

interface DeleteTransactionResult {
  shouldCleanup: boolean;
  alreadyDeleted: boolean;
}

export const deleteDraftApplication = onCall<DeleteDraftApplicationRequest>(
  { region: FUNCTION_REGION, timeoutSeconds: 120, memory: '512MiB' },
  async (request): Promise<DeleteDraftApplicationResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before deleting a Draft.');
    const eventId = validateDeleteDraftApplicationRequest(request.data);
    return deleteDraftApplicationForUser(request.auth.uid, eventId);
  },
);

/** Keep request validation shared with the callable wrapper and unit tests. */
export function validateDeleteDraftApplicationRequest(value: unknown): string {
  return validateEventId(value);
}

export function assertCanDeleteDraft(
  uid: string,
  profile: Pick<UserProfile, 'role'> | undefined,
  event: Pick<EventRecord, 'organizerId' | 'status'>,
): void {
  if (profile?.role !== 'organizer') {
    throw new HttpsError('permission-denied', 'Only organizer accounts can delete Draft applications.');
  }
  if (event.organizerId !== uid) {
    throw new HttpsError('permission-denied', 'You do not own this event.');
  }
  if (event.status !== 'Draft') {
    throw new HttpsError('failed-precondition', 'Only Draft applications can be deleted.');
  }
}

export function deletionStoragePrefixes(eventId: string): string[] {
  return [`event_documents/${eventId}/`, `events/${eventId}/`];
}

export async function deleteDraftApplicationForUser(
  uid: string,
  eventId: string,
  now = Date.now(),
): Promise<DeleteDraftApplicationResponse> {
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userRef = db.collection(COLLECTIONS.USERS).doc(uid);
  const receiptRef = db.collection(DELETION_RECEIPTS).doc(eventId);

  const transactionResult = await db.runTransaction(async (transaction): Promise<DeleteTransactionResult> => {
    const [eventSnapshot, userSnapshot, receiptSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(userRef),
      transaction.get(receiptRef),
    ]);
    const profile = userSnapshot.data() as Pick<UserProfile, 'role'> | undefined;
    if (receiptSnapshot.exists) {
      const receipt = receiptSnapshot.data() as Partial<DraftDeletionReceipt>;
      if (receipt.organizerUid !== uid) {
        throw new HttpsError('permission-denied', 'You do not own this event.');
      }
      if (receipt.state === 'completed') {
        if (profile?.role !== 'organizer') {
          throw new HttpsError('permission-denied', 'Only organizer accounts can delete Draft applications.');
        }
        return { shouldCleanup: false, alreadyDeleted: true };
      }
      if (receipt.state !== 'deleting' || receipt.statusAtDeletion !== 'Draft') {
        throw new HttpsError('failed-precondition', 'The Draft deletion receipt is invalid.');
      }
      if (eventSnapshot.exists) {
        const event = { eventId, ...eventSnapshot.data() } as EventRecord;
        assertCanDeleteDraft(uid, profile, event);
        transaction.delete(eventRef);
      } else if (profile?.role !== 'organizer') {
        throw new HttpsError('permission-denied', 'Only organizer accounts can delete Draft applications.');
      }
      transaction.set(receiptRef, { updatedAt: now }, { merge: true });
      return { shouldCleanup: true, alreadyDeleted: false };
    }

    if (!eventSnapshot.exists) throw new HttpsError('not-found', 'Event application was not found.');
    const event = { eventId, ...eventSnapshot.data() } as EventRecord;
    assertCanDeleteDraft(uid, profile, event);
    const receipt: DraftDeletionReceipt = {
      eventId,
      organizerUid: uid,
      statusAtDeletion: 'Draft',
      state: 'deleting',
      requestedAt: now,
      updatedAt: now,
    };
    transaction.create(receiptRef, receipt);
    // The root delete is in the same transaction as the Draft/status check.
    // A submit transaction and this deletion transaction therefore cannot both
    // commit for the same application generation.
    transaction.delete(eventRef);
    return { shouldCleanup: true, alreadyDeleted: false };
  });

  if (transactionResult.alreadyDeleted) {
    return { eventId, deleted: true, alreadyDeleted: true };
  }

  try {
    await cleanupDraftApplicationData(eventId);
    await receiptRef.set({ state: 'completed', completedAt: now, updatedAt: now }, { merge: true });
    return { eventId, deleted: true, alreadyDeleted: false };
  } catch (error) {
    // The receipt deliberately remains in `deleting`. A later identical call
    // can resume the cleanup without restoring or exposing the application.
    logger.error('[deleteDraftApplication] cleanup failed', { eventId, uid, error });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unavailable', 'The Draft could not be fully deleted. Please retry shortly.');
  }
}

async function cleanupDraftApplicationData(eventId: string): Promise<void> {
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const bucket = getStorage().bucket();
  const [documentsPrefix, eventPrefix] = deletionStoragePrefixes(eventId);

  await Promise.all([
    db.recursiveDelete(eventRef),
    db.recursiveDelete(db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId)),
    db.recursiveDelete(db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId)),
    deleteQueryDocuments(db, db.collection(COLLECTIONS.NOTIFICATIONS).where('eventId', '==', eventId)),
    deleteQueryDocuments(db, db.collection(COLLECTIONS.INCIDENTS).where('eventId', '==', eventId)),
    deleteQueryDocuments(db, db.collection(COLLECTIONS.PUBLIC_REPORTS).where('eventId', '==', eventId)),
    deleteQueryDocuments(db, db.collection(INCIDENT_NOTIFICATION_OUTBOX).where('input.eventId', '==', eventId)),
    deleteStoragePrefix(bucket, documentsPrefix),
    deleteStoragePrefix(bucket, eventPrefix),
  ]);
}

async function deleteQueryDocuments(
  db: FirebaseFirestore.Firestore,
  query: FirebaseFirestore.Query,
): Promise<void> {
  const snapshot = await query.get();
  for (let offset = 0; offset < snapshot.docs.length; offset += 50) {
    await Promise.all(snapshot.docs.slice(offset, offset + 50).map((document) => db.recursiveDelete(document.ref)));
  }
}

async function deleteStoragePrefix(
  bucket: { deleteFiles: (options: { prefix: string; force: boolean }) => Promise<unknown> },
  prefix: string,
): Promise<void> {
  try {
    await bucket.deleteFiles({ prefix, force: true });
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code !== 404 && code !== '404') throw error;
  }
}
