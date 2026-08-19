/**
 * submitStage2Doc — server-mediated Stage 2 image upload by the
 * event's organiser (FR-M3-20 second half, UC-35..38 pre-reqs, Workstream 4).
 *
 *   Stage 2 is the *visual evidence* of the control at the venue
 *   (e.g. a photo of the PDRM officer on site). It's uploaded by the
 *   organiser and publicly verifiable.
 *
 *   Per the Workstream 4 design, the organizer's upload is the publish
 *   event — the image goes out with `published: true` immediately.
 *   Workstream 5 adds the admin "Publish to public" step (with
 *   sanitisation), at which point the admin can unpublish + republish.
 *
 * Behaviour:
 *   - Caller is signed in + is the event's organiser.
 *   - The target EventControl exists for the current `versionId` AND
 *     has a `stage2Requirement` (i.e. the control requires Stage 2).
 *   - The doc is a singleton per control: docId = `${controlId}-s2`.
 *   - File size <= 700 KB binary; mime in {image/jpeg, image/png}.
 *   - The image is stored as a data: URL in `imageUrl` (per project
 *     convention: base64 in Firestore, NOT Firebase Storage).
 *   - On re-upload: overwrite the prior doc; preserve `m4TicketId`
 *     if it exists (so M4's investigation stays anchored to the
 *     same control; the new image becomes the "resubmitted" version).
 *   - Refuse re-upload if the current `m4TicketId` is set
 *     (Q4 confirmed: organizer must wait for M4's outcome to clear
 *     the ticket before re-uploading).
 *
 *   - Writes a `stage2_doc_submitted` audit log entry.
 *   - Notifies the assigned officer (if any) + all admins.
 *
 * Idempotency: the docId is composite (singleton per control). Re-
 * upload overwrites in place.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  AuthorityType,
  COLLECTIONS,
  EventControl,
  EventRecord,
  Stage2Doc,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { createNotification } from '../utils/notifications';

interface SubmitStage2DocRequest {
  eventId?: string;
  controlId?: string;
  fileName?: string;
  mimeType?: string;
  fileBase64?: string;
  label?: string;
}

const MAX_FILE_BYTES = 700 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);

/** Estimate the decoded size of a base64 string (4 chars -> 3 bytes,
 *  with padding). Used for the file-size gate. */
function approxBase64DecodedBytes(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  // Strip any data URL prefix if present (defensive).
  const comma = b64.indexOf(',');
  const clean = comma >= 0 ? b64.slice(comma + 1) : b64;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

export const submitStage2Doc = onCall<SubmitStage2DocRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before submitting a Stage 2 image.');
  try {
    return await submitStage2DocForUser(request.auth.uid, request.data);
  } catch (err) {
    if (err instanceof HttpsError) {
      console.warn(`[submitStage2Doc] HttpsError ${err.code}: ${err.message}`);
      throw err;
    }
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(`[submitStage2Doc] unexpected error: ${message}`);
    throw new HttpsError('internal', message.slice(0, 500));
  }
});

export async function submitStage2DocForUser(
  uid: string,
  data: SubmitStage2DocRequest,
  now = Date.now(),
) {
  const eventId = (data.eventId ?? '').trim();
  const controlId = (data.controlId ?? '').trim();
  const fileName = (data.fileName ?? '').trim();
  const mimeType = (data.mimeType ?? '').trim();
  const fileBase64 = (data.fileBase64 ?? '').trim();
  const label = (data.label ?? '').trim();

  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!controlId) throw new HttpsError('invalid-argument', 'controlId is required.');
  if (!fileName) throw new HttpsError('invalid-argument', 'fileName is required.');
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    throw new HttpsError('invalid-argument', `mimeType must be one of: ${[...ALLOWED_MIME].join(', ')}.`);
  }
  if (!fileBase64) throw new HttpsError('invalid-argument', 'fileBase64 is required.');

  const approxBytes = approxBase64DecodedBytes(fileBase64);
  if (approxBytes > MAX_FILE_BYTES) {
    throw new HttpsError('invalid-argument', `File too large: ${approxBytes} bytes. Max ${MAX_FILE_BYTES} bytes (~700 KB). Compress and re-upload.`);
  }

  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const docId = `${controlId}-s2`;
  const docRef = controlRef.collection(COLLECTIONS.STAGE2_DOCS).doc(docId);
  const userRef = db.collection(COLLECTIONS.USERS).doc(uid);

  const result = await db.runTransaction(async (tx) => {
    // Reads.
    const [userSnap, eventSnap, controlSnap, docSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(eventRef),
      tx.get(controlRef),
      tx.get(docRef),
    ]);

    if (!userSnap.exists) throw new HttpsError('permission-denied', 'User profile not found.');
    const profile = userSnap.data() as { role?: string };
    if (profile.role !== 'organizer') {
      throw new HttpsError('permission-denied', 'Only the event organiser can submit Stage 2 images.');
    }
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event application was not found.');
    const event = eventSnap.data() as EventRecord;
    if (event.organizerId !== uid) {
      throw new HttpsError('permission-denied', 'You are not the organiser of this event.');
    }
    if (event.controlListGenerated !== true) {
      throw new HttpsError('failed-precondition', 'The admin has not published the control list yet.');
    }
    if (!controlSnap.exists) {
      throw new HttpsError('not-found', `Control ${controlId} was not found for this event.`);
    }
    const control = controlSnap.data() as EventControl;
    const versionId = event.currentVersionId ?? 'v1';
    if (control.versionId !== versionId) {
      throw new HttpsError('failed-precondition', `Control ${controlId} is for a prior version. The admin must re-commit the list.`);
    }
    if (!control.stage2Requirement) {
      throw new HttpsError('failed-precondition', `Control ${controlId} does not require Stage 2.`);
    }
    const existingDoc = docSnap.exists ? (docSnap.data() as Stage2Doc) : null;
    if (existingDoc && existingDoc.m4TicketId) {
      throw new HttpsError('failed-precondition', 'A report is open for this Stage 2 image. Wait for M4 to resolve the ticket before replacing.');
    }

    // Build the new doc.
    const newDoc: Stage2Doc = {
      docId,
      imageUrl: `data:${mimeType};base64,${fileBase64}`,
      uploadedAt: now,
      uploadedBy: uid,
      publicConfirmCount: 0, // fresh on every upload — the prior image's confirms don't carry over
      published: true,
      publishedAt: now,
      publishedBy: uid,
    };
    // Preserve m4TicketId if it existed (it can't per the Q4 check above, but be defensive).
    if (existingDoc?.m4TicketId) newDoc.m4TicketId = existingDoc.m4TicketId;
    if (existingDoc?.reportedAt) newDoc.reportedAt = existingDoc.reportedAt;

    // Writes.
    tx.set(docRef, newDoc, { merge: true });

    // Audit log.
    const auditId = `${versionId}_${controlId}_stage2_submitted_${now}`;
    const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId);
    tx.create(auditRef, {
      id: auditId,
      eventId,
      versionId,
      action: 'stage2_doc_submitted',
      actorId: uid,
      actorRole: 'organizer',
      timestamp: now,
      notes: label || fileName,
      metadata: {
        controlId,
        docId,
        authorityType: control.authority,
        fileName,
        mimeType,
        fileSizeBytes: approxBytes,
        replaced: existingDoc !== null,
      },
    });

    return {
      eventId,
      controlId,
      docId,
      versionId,
      organizerId: event.organizerId,
      authorityType: control.authority as AuthorityType,
      controlName: control.controlName,
      fileName,
      mimeType,
      fileSizeBytes: approxBytes,
      uploadedAt: now,
    };
  });

  // Notifications.
  await fireSubmitStage2Notifications(result);

  return {
    eventId: result.eventId,
    controlId: result.controlId,
    docId: result.docId,
    status: 'published' as const,
    uploadedAt: result.uploadedAt,
  };
}

async function fireSubmitStage2Notifications(args: {
  eventId: string;
  controlId: string;
  versionId: string;
  authorityType: AuthorityType;
  controlName: string;
  fileName: string;
  uploadedAt: number;
}): Promise<void> {
  const db = firestore();
  const sourceActionId = `${args.eventId}_${args.controlId}_stage2_submitted_${args.uploadedAt}`;
  const title = 'Stage 2 image submitted';
  const baseMessage = `${args.authorityType}: organizer submitted a Stage 2 image for "${args.controlName}". File: ${args.fileName}. Public verification can now begin.`;

  // Find the assigned officer for this authority + version.
  const assignmentId = `${args.versionId}_${args.authorityType}`;
  const assignmentRef = db.collection(COLLECTIONS.EVENTS).doc(args.eventId).collection(COLLECTIONS.ASSIGNMENTS).doc(assignmentId);
  const assignmentSnap = await assignmentRef.get();
  const officerUid = assignmentSnap.exists ? ((assignmentSnap.data() as { officerUid?: string }).officerUid ?? null) : null;

  // Find all admin users.
  const adminsSnap = await db.collection(COLLECTIONS.USERS).where('role', '==', 'admin').get();
  const adminUids = adminsSnap.docs.map((d) => d.id);

  const recipients = new Set<string>();
  if (officerUid) recipients.add(officerUid);
  for (const uid of adminUids) recipients.add(uid);

  if (recipients.size === 0) {
    console.warn(`[submitStage2Doc] no recipients: no officer assigned to ${args.authorityType} for ${args.eventId} v${args.versionId}; no admin users in users/`);
    return;
  }

  await Promise.all([...recipients].map(async (recipientUid) => {
    try {
      await createNotification({
        recipientUid,
        eventId: args.eventId,
        versionId: args.versionId,
        type: 'stage2_doc_submitted',
        title,
        message: baseMessage,
        sourceActionId,
        // One doc per recipient (otherwise the writes overwrite each
        // other since sourceActionId alone is the doc id).
        notificationId: `${sourceActionId}_${recipientUid}`,
      });
    } catch (err) {
      console.warn(`[submitStage2Doc] notification to ${recipientUid} failed (non-fatal):`, err);
    }
  }));
}
