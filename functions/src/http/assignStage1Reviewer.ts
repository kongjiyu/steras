import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Assignment, AuthorityType, COLLECTIONS, EventControl, EventRecord, UserProfile } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { createNotification } from '../utils/notifications';
import { isActiveControlGeneration } from '../utils/controlLifecycle';

interface AssignStage1ReviewerRequest {
  eventId?: string;
  controlId?: string;
  reviewerUid?: string;
}

export const assignStage1Reviewer = onCall<AssignStage1ReviewerRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before assigning a Stage 1 reviewer.');
  const eventId = (request.data?.eventId ?? '').trim();
  const controlId = (request.data?.controlId ?? '').trim();
  const reviewerUid = (request.data?.reviewerUid ?? '').trim();
  if (!eventId || !controlId || !reviewerUid) throw new HttpsError('invalid-argument', 'eventId, controlId and reviewerUid are required.');
  const db = firestore();
  const adminSnap = await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get();
  if ((adminSnap.data() as UserProfile | undefined)?.role !== 'admin') throw new HttpsError('permission-denied', 'Only admins can assign Stage 1 reviewers.');

  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const reviewerRef = db.collection(COLLECTIONS.USERS).doc(reviewerUid);
  const officerRef = db.collection(COLLECTIONS.OFFICERS).doc(reviewerUid);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const [eventSnap, controlSnap, reviewerSnap, officerSnap, assignmentsSnap] = await Promise.all([
      tx.get(eventRef), tx.get(controlRef), tx.get(reviewerRef), tx.get(officerRef), tx.get(eventRef.collection(COLLECTIONS.ASSIGNMENTS)),
    ]);
    if (!eventSnap.exists || !controlSnap.exists) throw new HttpsError('not-found', 'Application or control item was not found.');
    const event = eventSnap.data() as EventRecord;
    const control = controlSnap.data() as EventControl;
    if (!isActiveControlGeneration(event, control, eventId)) throw new HttpsError('failed-precondition', 'Only current approved control items can be assigned.');
    const reviewer = reviewerSnap.data() as UserProfile | undefined;
    const officer = officerSnap.data() as { uid?: string; authorityType?: AuthorityType; active?: boolean } | undefined;
    if (!reviewer || reviewer.role !== 'authority' || reviewer.authorityType !== control.authority || !officer || officer.uid !== reviewerUid || officer.authorityType !== control.authority || officer.active !== true) {
      throw new HttpsError('failed-precondition', `Reviewer must be an active ${control.authority} officer.`);
    }
    const originalAssignment = assignmentsSnap.docs.map((item) => item.data() as Assignment)
      .find((assignment) => assignment.versionId === event.currentVersionId && assignment.authorityType === control.authority && assignment.status !== 'revoked');
    const nextAssigned = [...new Set([...(event.assignedOfficerUids ?? []), reviewerUid])];
    tx.set(controlRef, { stage1ReviewerUid: reviewerUid, stage1ReviewerAssignedAt: now, updatedAt: now }, { merge: true });
    tx.update(eventRef, { assignedOfficerUids: nextAssigned, updatedAt: now });
    const auditId = `stage1_reviewer_assigned_${event.currentVersionId}_${controlId}_${now}`;
    tx.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), {
      id: auditId, eventId, versionId: event.currentVersionId, action: 'stage1_reviewer_assigned', actorId: request.auth!.uid, actorRole: 'admin', timestamp: now,
      notes: `Assigned ${reviewerUid} to review ${controlId}.`, metadata: { controlId, authorityType: control.authority, reviewerUid, previousReviewerUid: control.stage1ReviewerUid ?? originalAssignment?.officerUid ?? null },
    });
    return { event, control, versionId: event.currentVersionId!, previousReviewerUid: control.stage1ReviewerUid ?? originalAssignment?.officerUid };
  });
  try {
    await createNotification({ recipientUid: reviewerUid, eventId, versionId: result.versionId, type: 'stage1_reviewer_assigned', title: 'Stage 1 review assigned', message: `You are assigned to review ${result.control.controlName}.`, sourceActionId: `stage1_reviewer_assigned_${eventId}_${controlId}_${now}` });
  } catch (error) { console.warn('[assignStage1Reviewer] notification failed', error); }
  return { eventId, controlId, reviewerUid, previousReviewerUid: result.previousReviewerUid ?? null };
});
