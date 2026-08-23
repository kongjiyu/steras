/**
 * publishStage2Doc — admin-only Stage 2 publish (Workstream 5, FR-M3-21, UC-14).
 *
 *   The admin reviews the organizer's Stage 2 image and either
 *   publishes it (makes it visible to the public) or rejects it (with
 *   a reason; the organizer can re-upload). This is the admin publish
 *   gate that lets us tighten the `stage2_docs` Firestore rule back to
 *   a per-doc `published == true` check.
 *
 *   - Caller is signed in + is the admin for the project.
 *   - The Stage 2 doc exists for the current `versionId` AND the
 *     control requires Stage 2.
 *   - Sets `published: true` + `publishedAt` + `publishedBy` on the
 *     Stage 2 doc.
 *   - Clears any prior rejection fields (so a publish-after-reject
 *     leaves a clean slate).
 *   - Writes a `stage2_doc_published` audit log entry.
 *   - Notifies the organizer.
 *
 *   The companion function `unpublishStage2Doc` handles the reject /
 *   unpublish side (sets `published: false` + rejection fields + a
 *   `stage2_doc_rejected` audit + organizer notification).
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  AuthorityType,
  COLLECTIONS,
  EventControl,
  EventRecord,
  PublicEventControl,
  Stage2Doc,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { createNotification, resolveAuthUid } from '../utils/notifications';

interface PublishStage2DocRequest {
  eventId?: string;
  controlId?: string;
}

interface PublishStage2DocResponse {
  published: true;
  publishedAt: number;
}

export const publishStage2Doc = onCall<PublishStage2DocRequest, Promise<PublishStage2DocResponse>>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before publishing.');
  try {
    return await publishStage2DocForUser(request.auth.uid, request.data);
  } catch (err) {
    if (err instanceof HttpsError) {
      console.warn(`[publishStage2Doc] HttpsError ${err.code}: ${err.message}`);
      throw err;
    }
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(`[publishStage2Doc] unexpected error: ${message}`);
    throw new HttpsError('internal', message.slice(0, 500));
  }
});

export async function publishStage2DocForUser(
  uid: string,
  data: PublishStage2DocRequest,
  now = Date.now(),
): Promise<PublishStage2DocResponse> {
  const eventId = (data.eventId ?? '').trim();
  const controlId = (data.controlId ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!controlId) throw new HttpsError('invalid-argument', 'controlId is required.');

  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const docId = `${controlId}-s2`;
  const docRef = controlRef.collection(COLLECTIONS.STAGE2_DOCS).doc(docId);
  const publicControlId = `${controlId}-stage2`;
  const publicRef = db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS)
    .doc(eventId)
    .collection(COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS)
    .doc(publicControlId);
  const userRef = db.collection(COLLECTIONS.USERS).doc(uid);

  const result = await db.runTransaction(async (tx) => {
    const [userSnap, eventSnap, controlSnap, docSnap, publicSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(eventRef),
      tx.get(controlRef),
      tx.get(docRef),
      tx.get(publicRef),
    ]);

    if (!userSnap.exists) throw new HttpsError('permission-denied', 'User profile not found.');
    const profile = userSnap.data() as UserProfile;
    if (profile.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only an admin can publish Stage 2 images.');
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
    if (stage2.published === true) {
      // Idempotent: already published, return the existing publishedAt.
      if (!publicSnap.exists) {
        tx.set(publicRef, buildPublicEventControl({
          publicControlId,
          eventId,
          versionId,
          controlId,
          docId,
          control,
          stage2,
          publishedAt: stage2.publishedAt ?? now,
          publishedBy: stage2.publishedBy ?? uid,
          sanitizedAt: stage2.publishedAt ?? now,
        }));
      }
      return {
        alreadyPublished: true as const,
        publishedAt: stage2.publishedAt ?? now,
        organizerUid: event.organizerId,
        authorityType: control.authority as AuthorityType,
        controlName: control.controlName,
        versionId,
      };
    }
    if (stage2.m4TicketId) {
      throw new HttpsError('failed-precondition', 'A public report is open for this Stage 2 image. Wait for M4 to resolve the ticket before publishing.');
    }

    // Publish: set the published flags, clear any prior rejection fields.
    tx.update(docRef, {
      published: true,
      publishedAt: now,
      publishedBy: uid,
      // Clear rejection fields so the organizer + admin UI sees a clean slate.
      rejectionReason: firestore.FieldValue.delete(),
      rejectionAt: firestore.FieldValue.delete(),
      rejectedBy: firestore.FieldValue.delete(),
    });

    // Public viewers read this sanitised projection, never the private
    // organiser/officer document. The image is explicitly selected by the
    // admin at this boundary; no organiser identity or private metadata is
    // copied into the public record.
    tx.set(publicRef, buildPublicEventControl({
      publicControlId,
      eventId,
      versionId,
      controlId,
      docId,
      control,
      stage2,
      publishedAt: now,
      publishedBy: uid,
      sanitizedAt: now,
    }));

    // Audit log.
    const auditId = `${versionId}_${controlId}_stage2_published_${uid}_${now}`;
    const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId);
    tx.create(auditRef, {
      id: auditId,
      eventId,
      versionId,
      action: 'stage2_doc_published',
      actorId: uid,
      actorRole: 'admin',
      timestamp: now,
      notes: `Published Stage 2 image for ${control.authority}.`,
      metadata: {
        controlId,
        docId,
        authorityType: control.authority,
      },
    });

    return {
      alreadyPublished: false as const,
      publishedAt: now,
      organizerUid: event.organizerId,
      authorityType: control.authority as AuthorityType,
      controlName: control.controlName,
      versionId,
    };
  });

  // Notify the organizer (outside the transaction). No-op if the doc
  // was already published (idempotent path).
  if (!result.alreadyPublished) {
    const organizerAuthUid = await resolveAuthUid(result.organizerUid);
    if (organizerAuthUid) {
      const sourceActionId = `${eventId}_${controlId}_stage2_published_${result.publishedAt}`;
      try {
        await createNotification({
          recipientUid: organizerAuthUid,
          eventId,
          versionId: result.versionId,
          type: 'stage2_doc_published',
          title: 'Stage 2 image published',
          message: `${result.authorityType}: your Stage 2 image for "${result.controlName}" has been published. Public verification (👍 confirm / 🚩 report) is now open.`,
          sourceActionId,
          notificationId: `${sourceActionId}_${organizerAuthUid}`,
        });
      } catch (err) {
        console.warn(`[publishStage2Doc] organizer notification failed (non-fatal):`, err);
      }
    }
  }

  return { published: true, publishedAt: result.publishedAt };
}

export function buildPublicEventControl(args: {
  publicControlId: string;
  eventId: string;
  versionId: string;
  controlId: string;
  docId: string;
  control: EventControl;
  stage2: Stage2Doc;
  publishedAt: number;
  publishedBy: string;
  sanitizedAt: number;
}): PublicEventControl {
  return {
    publicControlId: args.publicControlId,
    eventId: args.eventId,
    versionId: args.versionId,
    controlId: args.controlId,
    docId: args.docId,
    authority: args.control.authority,
    controlName: args.control.controlName,
    stage2Label: args.control.stage2Requirement?.label ?? 'Visual evidence',
    imageUrl: args.stage2.imageUrl,
    publicConfirmCount: args.stage2.publicConfirmCount ?? 0,
    ...(args.stage2.m4TicketId ? { reported: true } : { reported: false }),
    publishedAt: args.publishedAt,
    sanitized: true,
    sanitizedAt: args.sanitizedAt,
    // Do not expose the admin's auth UID in a public document.
    sanitizedBy: 'system',
  };
}
