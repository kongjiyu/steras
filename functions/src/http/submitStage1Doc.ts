/**
 * submitStage1Doc — server-mediated Stage 1 document submission by the
 * event's organiser (FR-M3-20, FR-M3-26, UC-28, UC-29).
 *
 * Two paths:
 *   1. UPLOAD (the common case). The organiser picks a file (JPEG / PNG
 *      / PDF, <= 700 KB binary). The server writes the Stage 1 doc with
 *      `status: 'pending_verification'`, stashing the bytes as a data
 *      URL in `filePath` (per the project convention: base64 in
 *      Firestore, NOT Firebase Storage).
 *   2. USE PREVIOUS (the receipt shortcut). Per the M3 owner decision
 *      2026-08-19 (and the dropped-A26 decision from 2026-08-17), this
 *      is a one-click flag on `docType: 'receipt'` slots. No
 *      source-event picker, no sourceEventId. Stage 2 is the public
 *      verification backstop. The audit log records the rationale.
 *
 * Validation:
 *   - Caller is signed in.
 *   - `event.controlListGenerated === true`.
 *   - Caller is the event's organiser (looked up via `resolveAuthUid`).
 *   - The target `event_controls/{controlId}` exists for the current
 *     `versionId`.
 *   - `docId` is in the control's `stage1Requirements` template (i.e.
 *     the organiser cannot add new doc slots; the admin committed the
 *     list).
 *   - Existing doc's `status` is NOT 'verified' (organiser cannot
 *     re-upload after an officer approved without admin involvement).
 *   - For the upload path: file size, mime type, base64 sanity.
 *   - For the use_previous path: `docType === 'receipt'`.
 *
 * Behaviour:
 *   - Writes the `stage1_docs/{docId}` doc with the new status.
 *   - Recomputes the parent control's aggregate `label` via
 *     `aggregateLabel()` (so the UI immediately reflects the new state).
 *   - Writes a `stage1_doc_submitted` audit log entry.
 *   - Notifies the assigned officer (if any) + all admin users
 *     (`type: 'stage1_doc_submitted'`).
 *
 * Idempotency:
 *   - The doc id is composite (the requirement's docId). Re-submitting
 *     overwrites in place.
 *   - The notification sourceActionId is `${eventId}_${controlId}_${docId}_${now}`
 *     so retries within the same `now` window are deduped.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  EventControl,
  EventRecord,
  Stage1Doc,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { createNotification } from '../utils/notifications';
import { aggregateLabel } from '../utils/controlAggregate';

interface SubmitStage1DocRequest {
  eventId?: string;
  controlId?: string;
  docId?: string;
  // UPLOAD path
  fileName?: string;
  mimeType?: string;
  fileBase64?: string;
  label?: string;
  // USE PREVIOUS path (one-click flag, no source event)
  usePrevious?: boolean;
}

const MAX_FILE_BYTES = 700 * 1024; // 700 KB binary (~940 KB base64; under the 1 MB Firestore doc limit)
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export const submitStage1Doc = onCall<SubmitStage1DocRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before submitting a Stage 1 document.');
  try {
    return await submitStage1DocForUser(request.auth.uid, request.data);
  } catch (err) {
    if (err instanceof HttpsError) {
      console.warn(`[submitStage1Doc] HttpsError ${err.code}: ${err.message}`);
      throw err;
    }
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(`[submitStage1Doc] unexpected error: ${message}`);
    throw new HttpsError('internal', message.slice(0, 500));
  }
});

export async function submitStage1DocForUser(
  uid: string,
  data: SubmitStage1DocRequest,
  now = Date.now(),
) {
  const eventId = (data.eventId ?? '').trim();
  const controlId = (data.controlId ?? '').trim();
  const docId = (data.docId ?? '').trim();
  const usePrevious = data.usePrevious === true;

  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!controlId) throw new HttpsError('invalid-argument', 'controlId is required.');
  if (!docId) throw new HttpsError('invalid-argument', 'docId is required.');

  if (usePrevious) {
    // Use-previous: no file params expected, but tolerate them.
  } else {
    if (!data.fileName) throw new HttpsError('invalid-argument', 'fileName is required for upload.');
    if (!data.mimeType || !ALLOWED_MIME.has(data.mimeType)) {
      throw new HttpsError('invalid-argument', `mimeType must be one of: ${[...ALLOWED_MIME].join(', ')}.`);
    }
    if (!data.fileBase64) throw new HttpsError('invalid-argument', 'fileBase64 is required for upload.');
  }

  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const docRef = controlRef.collection(COLLECTIONS.STAGE1_DOCS).doc(docId);
  const userRef = db.collection(COLLECTIONS.USERS).doc(uid);

  const result = await db.runTransaction(async (tx) => {
    // Reads first.
    const [userSnap, eventSnap, controlSnap, docSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(eventRef),
      tx.get(controlRef),
      tx.get(docRef),
    ]);

    const profile = userSnap.data() as UserProfile | undefined;
    if (!profile || profile.role !== 'organizer') {
      throw new HttpsError('permission-denied', 'Only the event organiser can submit Stage 1 documents.');
    }
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event application was not found.');
    const event = eventSnap.data() as EventRecord;
    // Match by auth UID against the organizer's stored id. Convention:
    // the event's `organizerId` is the same as the auth UID (the user
    // doc id is the auth UID).
    if (event.organizerId !== uid) {
      throw new HttpsError('permission-denied', 'You are not the organiser of this event.');
    }
    if (event.controlListGenerated !== true) {
      throw new HttpsError('failed-precondition', 'The admin has not published the control list yet. Nothing to submit against.');
    }
    if (!controlSnap.exists) {
      throw new HttpsError('not-found', `Control ${controlId} was not found for this event.`);
    }
    const control = controlSnap.data() as EventControl;
    const versionId = event.currentVersionId ?? 'v1';
    if (control.versionId !== versionId) {
      throw new HttpsError('failed-precondition', `Control ${controlId} is for a prior version (${control.versionId}). The admin must re-commit the list for the current version.`);
    }
    // The docSlot must be in the control's stage1Requirements template.
    const requirement = control.stage1Requirements.find((r) => `${controlId}-s1-${r.docType}` === docId);
    if (!requirement) {
      throw new HttpsError('failed-precondition', `docId ${docId} is not in the control's Stage 1 requirements template.`);
    }
    if (usePrevious && requirement.docType !== 'receipt') {
      throw new HttpsError('failed-precondition', `"Use Previous" is only allowed for purchase receipts (A25). This slot is ${requirement.docType}.`);
    }
    const existingDoc = docSnap.exists ? (docSnap.data() as Stage1Doc) : null;
    if (existingDoc && existingDoc.status === 'verified') {
      throw new HttpsError('failed-precondition', 'This Stage 1 document has already been verified. Contact the admin to reopen.');
    }

    // Build the new doc payload.
    const newDoc: Stage1Doc = {
      docId,
      docType: requirement.docType,
      label: (data.label ?? '').trim() || requirement.label,
      uploadedAt: now,
      uploadedBy: uid,
      status: usePrevious ? 'use_previous' : 'pending_verification',
    };
    if (!usePrevious) {
      // File size validation (decode the base64 to byte count).
      const approxBytes = approxBase64DecodedBytes(data.fileBase64!);
      if (approxBytes > MAX_FILE_BYTES) {
        throw new HttpsError('invalid-argument', `File too large: ${approxBytes} bytes. Max ${MAX_FILE_BYTES} bytes (~700 KB). Compress and re-upload.`);
      }
      newDoc.filePath = `data:${data.mimeType};base64,${data.fileBase64}`;
    } else {
      // Use-previous: don't set filePath. The doc has no bytes.
      delete (newDoc as { filePath?: string }).filePath;
    }
    // If the prior status was 'rejected', keep the rejection data on the
    // doc so the officer sees the history on the next pass. (Q4 confirmed.)
    // Only set the fields when defined — Firestore rejects `undefined`
    // values (we'd need ignoreUndefinedProperties on the Admin SDK to
    // allow it, and the rule for this collection is strict).
    if (existingDoc && existingDoc.status === 'rejected') {
      if (existingDoc.rejectionReason) newDoc.rejectionReason = existingDoc.rejectionReason;
      if (existingDoc.rejectionSuggestion) newDoc.rejectionSuggestion = existingDoc.rejectionSuggestion;
    }
    // If switching from 'use_previous' to an upload (or vice-versa),
    // explicitly drop the other path's state.
    if (!usePrevious) {
      delete (newDoc as { usePreviousSourceEventId?: string }).usePreviousSourceEventId;
    }

    // Reads — all stage1_docs for this control to recompute the aggregate.
    const allDocsSnap = await tx.get(controlRef.collection(COLLECTIONS.STAGE1_DOCS));
    const allDocs = allDocsSnap.docs.map((d) => d.data() as Stage1Doc);
    // Merge in our update for the label computation.
    const othersFiltered = allDocs.filter((d) => d.docId !== docId);
    const merged = [...othersFiltered, newDoc];
    const newAggregateLabel = aggregateLabel(merged);

    // Writes.
    tx.set(docRef, newDoc, { merge: true });
    tx.update(controlRef, { label: newAggregateLabel, updatedAt: now });

    // Audit log.
    const auditId = `${versionId}_${controlId}_${docId}_submitted_${now}`;
    const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId);
    const notes = usePrevious
      ? 'Use Previous: organizer asserted item already procured; Stage 2 is the verification backstop.'
      : (data.label ?? '').trim() || data.fileName || 'Stage 1 document submitted';
    const metadata: Record<string, unknown> = {
      controlId,
      docId,
      docType: requirement.docType,
      path: usePrevious ? 'use_previous' : 'upload',
    };
    if (!usePrevious) {
      metadata.fileName = data.fileName;
      metadata.mimeType = data.mimeType;
      metadata.fileSizeBytes = approxBase64DecodedBytes(data.fileBase64!);
    }
    tx.create(auditRef, {
      id: auditId,
      eventId,
      versionId,
      action: 'stage1_doc_submitted',
      actorId: uid,
      actorRole: 'organizer',
      timestamp: now,
      notes,
      metadata,
    });

    return {
      eventId,
      controlId,
      docId,
      versionId,
      organizerId: event.organizerId,
      authorityType: control.authority,
      controlName: control.controlName,
      docLabel: newDoc.label,
      usePrevious,
      uploadedAt: now,
      newAggregateLabel,
    };
  });

  // Notifications — outside the transaction. Notify the assigned officer
  // (if any) and all admin users.
  await fireSubmitNotifications({
    eventId: result.eventId,
    controlId: result.controlId,
    docId: result.docId,
    versionId: result.versionId,
    authorityType: result.authorityType,
    controlName: result.controlName,
    docLabel: result.docLabel,
    usePrevious: result.usePrevious,
    uploadedAt: result.uploadedAt,
  });

  return {
    eventId: result.eventId,
    controlId: result.controlId,
    docId: result.docId,
    status: result.usePrevious ? 'use_previous' : 'pending_verification',
    uploadedAt: result.uploadedAt,
  };
}

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

async function fireSubmitNotifications(args: {
  eventId: string;
  controlId: string;
  docId: string;
  versionId: string;
  authorityType: string;
  controlName: string;
  docLabel: string;
  usePrevious: boolean;
  uploadedAt: number;
}): Promise<void> {
  const db = firestore();
  const title = args.usePrevious ? 'Stage 1 receipt marked as Use Previous' : 'Stage 1 document submitted';
  const baseMessage = args.usePrevious
    ? `${args.authorityType}: organizer marked "${args.docLabel}" as Use Previous. Awaiting officer acknowledgement.`
    : `${args.authorityType}: organizer submitted "${args.docLabel}" for control "${args.controlName}". Awaiting officer verification.`;
  const sourceActionId = `${args.eventId}_${args.controlId}_${args.docId}_submitted_${args.uploadedAt}`;

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
    console.warn(`[submitStage1Doc] no recipients: no officer assigned to ${args.authorityType} for ${args.eventId} v${args.versionId}; no admin users in users/`);
    return;
  }

  await Promise.all([...recipients].map(async (recipientUid) => {
    try {
      await createNotification({
        recipientUid,
        eventId: args.eventId,
        versionId: args.versionId,
        type: 'stage1_doc_submitted',
        title,
        message: baseMessage,
        sourceActionId,
      });
    } catch (err) {
      console.warn(`[submitStage1Doc] notification to ${recipientUid} failed (non-fatal):`, err);
    }
  }));
}
