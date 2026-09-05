/**
 * unpublishStage2Doc — admin-only Stage 2 reject / unpublish
 * (Workstream 5, FR-M3-21, UC-15).
 *
 *   Two flows share this function:
 *     - Reject: organizer uploaded a pending image; admin sees
 *       something wrong, clicks "Reject" with a reason. Doc stays at
 *       `published: false`, with the reason persisted. Organizer
 *       sees the reason in the bell and can re-upload.
 *     - Unpublish: admin already published; changed their mind (or
 *       a public report needs the doc pulled). Doc flips back to
 *       `published: false` and is hidden from the public view. No
 *       reason is required (the public_reports doc carries the
 *       report details for the M4 trail).
 *
 *   The caller passes a `reason` only for the reject flow; the
 *   unpublish flow passes an empty string. Both write a
 *   `stage2_doc_rejected` audit log entry; the notification text
 *   differs.
 *
 *   - Caller is signed in + is the admin for the project.
 *   - The Stage 2 doc exists for the current `versionId` AND the
 *     control requires Stage 2.
 *   - For the reject path: refuses if `m4TicketId` is set (a public
 *     report is open — let M4 resolve it before admin unpublishes;
 *     see `publishStage2Doc` for the symmetric check).
 *   - Sets `published: false` + (reject only) `rejectionReason`,
 *     `rejectionAt`, `rejectedBy`. Also clears `publishedAt` /
 *     `publishedBy` so the doc looks "pending" again.
 *   - Notifies the organizer with the reason in the message.
 */
import { firestore } from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  AuthorityType,
  COLLECTIONS,
  EventControl,
  EventRecord,
  Stage2Doc,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { createNotification, resolveAuthUid } from '../utils/notifications';

interface UnpublishStage2DocRequest {
  eventId?: string;
  controlId?: string;
  /** Optional. If present, the action is treated as a reject (not an unpublish)
   *  and the reason is persisted on the doc + shown in the organizer notification.
   *  Max 500 chars. */
  reason?: string;
}

interface UnpublishStage2DocResponse {
  published: false;
  reason?: string;
  rejectedAt: number;
}

const REASON_MAX = 500;

export const unpublishStage2Doc = onCall<UnpublishStage2DocRequest, Promise<UnpublishStage2DocResponse>>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before rejecting / unpublishing.');
  try {
    return await unpublishStage2DocForUser(request.auth.uid, request.data);
  } catch (err) {
    if (err instanceof HttpsError) {
      console.warn(`[unpublishStage2Doc] HttpsError ${err.code}: ${err.message}`);
      throw err;
    }
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(`[unpublishStage2Doc] unexpected error: ${message}`);
    throw new HttpsError('internal', 'Unable to update Stage 2 publication state. Retry shortly.');
  }
});

export async function unpublishStage2DocForUser(
  uid: string,
  data: UnpublishStage2DocRequest,
  now = Date.now(),
): Promise<UnpublishStage2DocResponse> {
  const eventId = (data.eventId ?? '').trim();
  const controlId = (data.controlId ?? '').trim();
  const reason = (data.reason ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!controlId) throw new HttpsError('invalid-argument', 'controlId is required.');
  if (reason.length > REASON_MAX) {
    throw new HttpsError('invalid-argument', `reason must be at most ${REASON_MAX} characters.`);
  }
  const isReject = reason.length > 0;

  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const docId = `${controlId}-s2`;
  const docRef = controlRef.collection(COLLECTIONS.STAGE2_DOCS).doc(docId);
  const publicRef = db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS)
    .doc(eventId)
    .collection(COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS)
    .doc(`${controlId}-stage2`);
  const userRef = db.collection(COLLECTIONS.USERS).doc(uid);

  const result = await db.runTransaction(async (tx) => {
    const [userSnap, eventSnap, controlSnap, docSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(eventRef),
      tx.get(controlRef),
      tx.get(docRef),
    ]);

    if (!userSnap.exists) throw new HttpsError('permission-denied', 'User profile not found.');
    const profile = userSnap.data() as UserProfile;
    if (profile.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only an admin can reject / unpublish Stage 2 images.');
    }
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found.');
    const event = eventSnap.data() as EventRecord;
    const versionId = event.currentVersionId ?? 'v1';
    if (!controlSnap.exists) throw new HttpsError('not-found', `Control ${controlId} not found.`);
    const control = controlSnap.data() as EventControl;
    if (control.versionId !== versionId) {
      throw new HttpsError('failed-precondition', `Control ${controlId} is for a prior version. The admin must re-commit the list.`);
    }
    if (!control.stage2Requirement) {
      throw new HttpsError('failed-precondition', `Control ${controlId} does not require Stage 2.`);
    }
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'No Stage 2 image has been uploaded yet for this control.');
    }
    const stage2 = docSnap.data() as Stage2Doc;
    if (stage2.m4TicketId) {
      throw new HttpsError('failed-precondition', 'A public report is open for this Stage 2 image. Wait for the incident investigation to resolve the ticket before changing publish state.');
    }
    if (stage2.published !== true && !isReject) {
      // Unpublish on an already-pending doc: idempotent no-op. We return
      // the current state so the UI can confirm.
      return {
        noop: true as const,
        organizerUid: event.organizerId,
        authorityType: control.authority as AuthorityType,
        controlName: control.controlName,
        versionId,
      };
    }

    // Build the update.
    const update: Record<string, unknown> = {
      published: false,
    };
    if (isReject) {
      update.rejectionReason = reason;
      update.rejectionAt = now;
      update.rejectedBy = uid;
    }
    // Clear the published fields so the doc looks "pending" again.
    update.publishedAt = FieldValue.delete();
    update.publishedBy = FieldValue.delete();

    tx.update(docRef, update);
    // Remove the sanitised public projection at the same atomic boundary so
    // an unpublished or rejected image can never remain publicly visible.
    tx.delete(publicRef);

    // Audit log.
    const auditAction = 'stage2_doc_rejected';
    const auditId = `${versionId}_${controlId}_${auditAction}_${uid}_${now}`;
    const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId);
    tx.create(auditRef, {
      id: auditId,
      eventId,
      versionId,
      action: auditAction,
      actorId: uid,
      actorRole: 'admin',
      timestamp: now,
      notes: isReject ? `Reject: ${reason.slice(0, 200)}` : `Unpublish: removed from public view.`,
      metadata: {
        controlId,
        docId,
        authorityType: control.authority,
        ...(isReject ? { reason } : {}),
        wasPublished: stage2.published === true,
      },
    });

    return {
      noop: false as const,
      organizerUid: event.organizerId,
      authorityType: control.authority as AuthorityType,
      controlName: control.controlName,
      versionId,
      reason: isReject ? reason : undefined,
      rejectedAt: now,
    };
  });

  if (!result.noop) {
    const organizerAuthUid = await resolveAuthUid(result.organizerUid);
    if (organizerAuthUid) {
      const sourceActionId = `${eventId}_${controlId}_stage2_rejected_${result.rejectedAt}`;
      const title = isReject ? 'Stage 2 image rejected' : 'Stage 2 image unpublished';
      const baseMessage = isReject
        ? `${result.authorityType}: admin rejected your Stage 2 image for "${result.controlName}". Reason: ${reason}. You can re-upload a corrected image.`
        : `${result.authorityType}: admin unpublished your Stage 2 image for "${result.controlName}". The image is hidden from the public view. Re-upload to restart the review.`;
      try {
        await createNotification({
          recipientUid: organizerAuthUid,
          eventId,
          versionId: result.versionId,
          type: 'stage2_doc_rejected',
          title,
          message: baseMessage,
          sourceActionId,
          notificationId: `${sourceActionId}_${organizerAuthUid}`,
        });
      } catch (err) {
        console.warn(`[unpublishStage2Doc] organizer notification failed (non-fatal):`, err);
      }
    }
  }

  return {
    published: false,
    ...(isReject ? { reason } : {}),
    rejectedAt: 'rejectedAt' in result && typeof result.rejectedAt === 'number' ? result.rejectedAt : now,
  };
}
