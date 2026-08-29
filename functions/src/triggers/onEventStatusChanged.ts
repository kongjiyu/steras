/**
 * M1 → M3 withdrawal boundary (FR-M3-01).
 *
 * A withdrawal keeps the application and audit history but closes active
 * authority assignments and removes all public projections. The trigger is
 * intentionally idempotent so retries cannot lose records or create duplicate
 * audit entries.
 */
import { firestore } from 'firebase-admin';
import { logger } from 'firebase-functions/logger';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { COLLECTIONS, EventControl, EventRecord, Stage2Doc } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

export const onEventStatusChanged = onDocumentUpdated(
  { document: `${COLLECTIONS.EVENTS}/{eventId}`, region: FUNCTION_REGION },
  async (change) => {
    const before = change.data?.before.data() as EventRecord | undefined;
    const after = change.data?.after.data() as EventRecord | undefined;
    if (!after || after.status !== 'Withdrawn' || before?.status === 'Withdrawn') return;
    await cleanupWithdrawnEvent(change.params.eventId);
  },
);

export async function cleanupWithdrawnEvent(eventId: string, now = Date.now()): Promise<void> {
  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const [eventSnap, controlsSnap, assignmentsSnap, publicItemsSnap] = await Promise.all([
    eventRef.get(),
    eventRef.collection(COLLECTIONS.EVENT_CONTROLS).get(),
    eventRef.collection(COLLECTIONS.ASSIGNMENTS).get(),
    db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId).collection(COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS).get(),
  ]);
  if (!eventSnap.exists) return;
  const event = eventSnap.data() as EventRecord;

  // Keep each batch comfortably below Firestore's 500-write limit. All
  // operations are updates/deletes, so running them again is safe.
  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  for (const assignment of assignmentsSnap.docs) {
    operations.push((batch) => batch.set(assignment.ref, {
      status: 'revoked',
      revokedAt: now,
      revokedBy: 'system:withdrawn',
    }, { merge: true }));
  }
  for (const control of controlsSnap.docs) {
    const controlData = control.data() as EventControl;
    operations.push((batch) => batch.set(control.ref, {
      activityClosed: true,
      updatedAt: now,
      labelRemovedAt: now,
    }, { merge: true }));
    const stage2Docs = await control.ref.collection(COLLECTIONS.STAGE2_DOCS).get();
    for (const stage2 of stage2Docs.docs) {
      const data = stage2.data() as Stage2Doc;
      if (data.published === true) {
        operations.push((batch) => batch.set(stage2.ref, { published: false }, { merge: true }));
      }
      operations.push((batch) => batch.delete(
        db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS)
          .doc(eventId)
          .collection(COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS)
          .doc(`${controlData.controlId}-stage2`),
      ));
    }
  }
  for (const publicItem of publicItemsSnap.docs) operations.push((batch) => batch.delete(publicItem.ref));

  for (let index = 0; index < operations.length; index += 400) {
    const batch = db.batch();
    for (const operation of operations.slice(index, index + 400)) operation(batch);
    await batch.commit();
  }

  const finalBatch = db.batch();
  finalBatch.set(eventRef, {
    reviewStage: 'closed',
    assignedOfficerUids: [],
    assignedOfficerByAuthority: {},
    updatedAt: now,
  }, { merge: true });
  finalBatch.delete(db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId));
  const cleanupAuditId = `withdrawn_cleanup_${event.currentVersionId ?? 'unversioned'}`;
  finalBatch.set(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(cleanupAuditId), {
    id: cleanupAuditId,
    eventId,
    versionId: event.currentVersionId,
    action: 'withdrawn_cleanup',
    actorId: 'system',
    actorRole: 'system',
    timestamp: now,
    previousStatus: event.withdrawnFromStatus ?? event.status,
    newStatus: 'Withdrawn',
    notes: 'Closed pending assignments and unpublished event-control projections after withdrawal.',
    metadata: {
      assignmentsClosed: assignmentsSnap.size,
      controlsClosed: controlsSnap.size,
      publicItemsRemoved: publicItemsSnap.size,
    },
  }, { merge: true });
  await finalBatch.commit();
  logger.info('[onEventStatusChanged] withdrawal cleanup complete', { eventId, assignments: assignmentsSnap.size, controls: controlsSnap.size });
}
