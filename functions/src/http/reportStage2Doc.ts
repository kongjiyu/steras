/**
 * reportStage2Doc — public report of a published Stage 2 image
 * (FR-M3-29 first half, UC-36, UC-38, Workstream 4).
 *
 *   Any signed-in public viewer can 🚩 a Stage 2 image to indicate
 *   "this doesn't look right." Per A30: 1 report per user per control
 *   (rate-limit; subsequent calls are no-ops).
 *
 *   - Caller is signed in.
 *   - The Stage 2 doc exists with `published === true`.
 *   - Per-user counter doc at `events/{id}/event_controls/{controlId}/
 *     stage2_reports/{uid}` is the rate-limit. If it exists, the call
 *     is a no-op (idempotent — returns the existing ticketId).
 *
 *   - On first report: writes the counter doc + creates a
 *     `public_reports/{ticketId}` doc with `outcome: 'under_review'`
 *     + sets `m4TicketId` + `reportedAt` on the Stage 2 doc + writes
 *     a `stage2_reported` audit log entry + notifies the assigned
 *     officer + all admins + the event organiser.
 *
 *   Workstream 6 (M4 outcome trigger) handles the M4 side: when M4
 *   updates `public_reports/{id}.outcome`, M3 listens and updates
 *   the Stage 2 doc's `label` accordingly.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  AuthorityType,
  COLLECTIONS,
  EventControl,
  EventRecord,
  PublicReport,
  Stage2Doc,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { createNotification, resolveAuthUid } from '../utils/notifications';

const REPORT_CATEGORIES = ['item_not_at_venue', 'wrong_venue', 'low_quality_image', 'other'] as const;
type ReportCategory = typeof REPORT_CATEGORIES[number];
const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 500;

interface ReportStage2DocRequest {
  eventId?: string;
  controlId?: string;
  category?: string;
  description?: string;
  evidencePaths?: string[];
}

interface ReportStage2DocResponse {
  ticketId: string;
  alreadyReported: boolean;
  reportedAt: number;
}

export const reportStage2Doc = onCall<ReportStage2DocRequest, Promise<ReportStage2DocResponse>>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before reporting.');
  try {
    return await reportStage2DocForUser(request.auth.uid, request.data);
  } catch (err) {
    if (err instanceof HttpsError) {
      console.warn(`[reportStage2Doc] HttpsError ${err.code}: ${err.message}`);
      throw err;
    }
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(`[reportStage2Doc] unexpected error: ${message}`);
    throw new HttpsError('internal', message.slice(0, 500));
  }
});

export async function reportStage2DocForUser(
  uid: string,
  data: ReportStage2DocRequest,
  now = Date.now(),
): Promise<ReportStage2DocResponse> {
  const eventId = (data.eventId ?? '').trim();
  const controlId = (data.controlId ?? '').trim();
  const category = (data.category ?? '').trim() as ReportCategory;
  const description = (data.description ?? '').trim();

  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!controlId) throw new HttpsError('invalid-argument', 'controlId is required.');
  if (!REPORT_CATEGORIES.includes(category)) {
    throw new HttpsError('invalid-argument', `category must be one of: ${REPORT_CATEGORIES.join(', ')}.`);
  }
  if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    throw new HttpsError('invalid-argument', `description must be between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters.`);
  }

  const db = firestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const controlRef = eventRef.collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const docId = `${controlId}-s2`;
  const docRef = controlRef.collection(COLLECTIONS.STAGE2_DOCS).doc(docId);
  const counterRef = controlRef.collection(COLLECTIONS.STAGE2_REPORTS).doc(uid);
  const publicRef = db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS)
    .doc(eventId)
    .collection(COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS)
    .doc(`${controlId}-stage2`);

  const { ticketId, alreadyReported, reportedAt, controlName, authorityType, versionId, eventOrganizerUid } = await db.runTransaction(async (tx) => {
    // Reads first.
    const [docSnap, counterSnap, controlSnap, eventSnap, publicSnap, userSnap] = await Promise.all([
      tx.get(docRef),
      tx.get(counterRef),
      tx.get(controlRef),
      tx.get(eventRef),
      tx.get(publicRef),
      tx.get(db.collection(COLLECTIONS.USERS).doc(uid)),
    ]);
    const viewer = userSnap.data() as UserProfile | undefined;
    if (!viewer || viewer.uid !== uid || viewer.role !== 'public') {
      throw new HttpsError('permission-denied', 'Only registered public viewer accounts can report published evidence.');
    }
    if (!docSnap.exists) {
      throw new HttpsError('not-found', `Stage 2 image not found for control ${controlId}.`);
    }
    const stage2 = docSnap.data() as Stage2Doc;
    if (stage2.published !== true) {
      throw new HttpsError('failed-precondition', 'This Stage 2 image is not published yet.');
    }
    if (!controlSnap.exists) {
      throw new HttpsError('not-found', `Control ${controlId} not found.`);
    }
    const control = controlSnap.data() as EventControl;
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found.');
    const event = eventSnap.data() as EventRecord;
    const versionIdInner = event.currentVersionId;
    const projection = publicSnap.data() as { eventId?: string; versionId?: string; controlId?: string; docId?: string } | undefined;
    if (!versionIdInner || control.eventId !== eventId || control.versionId !== versionIdInner
      || control.activityClosed === true || !publicSnap.exists || projection?.eventId !== eventId
      || projection.versionId !== versionIdInner || projection.controlId !== controlId || projection.docId !== docId
      || typeof stage2.publishedAt !== 'number') {
      throw new HttpsError('failed-precondition', 'This published evidence is not bound to the current application generation.');
    }

    if (counterSnap.exists) {
      // Already reported — return the existing ticket info.
      const existing = counterSnap.data() as { ticketId: string; reportedAt: number };
      return {
        ticketId: existing.ticketId,
        alreadyReported: true,
        reportedAt: existing.reportedAt,
        controlName: control.controlName,
        authorityType: control.authority as AuthorityType,
        versionId: versionIdInner,
        eventOrganizerUid: event.organizerId,
      };
    }

    // First report. Build the ticket id + write the counter + the report.
    const newTicketId = `${eventId}_${controlId}_${uid}_${now}`;
    const ticketRef = db.collection(COLLECTIONS.PUBLIC_REPORTS).doc(newTicketId);
    const evidencePaths = (data.evidencePaths ?? []).filter((p) => typeof p === 'string' && p.length > 0);
    const reportDoc: PublicReport = {
      ticketId: newTicketId,
      eventId,
      controlId,
      docId,
      versionId: versionIdInner,
      stage2PublishedAt: stage2.publishedAt,
      reporterUid: uid,
      category,
      description,
      ...(evidencePaths.length > 0 ? { evidencePaths } : {}),
      outcome: 'under_review',
      createdAt: now,
      updatedAt: now,
    };
    tx.set(ticketRef, reportDoc);
    tx.set(counterRef, { uid, ticketId: newTicketId, reportedAt: now, category });
    tx.update(docRef, { m4TicketId: newTicketId, reportedAt: now });
    if (publicSnap.exists) tx.update(publicRef, { reported: true });

    // Audit log.
    const auditId = `${versionIdInner}_${controlId}_stage2_reported_${uid}_${now}`;
    const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId);
    tx.create(auditRef, {
      id: auditId,
      eventId,
      versionId: versionIdInner,
      action: 'stage2_reported',
      actorId: uid,
      actorRole: 'public',
      timestamp: now,
      notes: `${category}: ${description.slice(0, 80)}${description.length > 80 ? '...' : ''}`,
      metadata: {
        controlId,
        docId,
        ticketId: newTicketId,
        category,
      },
    });

    return {
      ticketId: newTicketId,
      alreadyReported: false,
      reportedAt: now,
      controlName: control.controlName,
      authorityType: control.authority as AuthorityType,
      versionId: versionIdInner,
      eventOrganizerUid: event.organizerId,
    };
  });

  // Notifications (outside the transaction).
  await fireReportNotifications({
    eventId,
    controlId,
    docId,
    versionId,
    authorityType,
    controlName,
    ticketId,
    reportedAt,
    organizerUid: eventOrganizerUid,
  });

  return { ticketId, alreadyReported, reportedAt };
}

async function fireReportNotifications(args: {
  eventId: string;
  controlId: string;
  docId: string;
  versionId: string;
  authorityType: AuthorityType;
  controlName: string;
  ticketId: string;
  reportedAt: number;
  organizerUid: string;
}): Promise<void> {
  const db = firestore();
  const title = 'Stage 2 image reported';
  const baseMessage = `Public viewer reported a Stage 2 issue for ${args.authorityType} "${args.controlName}". Ticket ${args.ticketId}. Awaiting M4 investigation.`;
  const sourceActionId = args.ticketId; // public_reports doc id is the natural idempotency key

  // Find the assigned officer for this authority + version.
  const assignmentId = `${args.versionId}_${args.authorityType}`;
  const assignmentRef = db.collection(COLLECTIONS.EVENTS).doc(args.eventId).collection(COLLECTIONS.ASSIGNMENTS).doc(assignmentId);
  const assignmentSnap = await assignmentRef.get();
  const officerUid = assignmentSnap.exists ? ((assignmentSnap.data() as { officerUid?: string }).officerUid ?? null) : null;

  // Find all admin users.
  const adminsSnap = await db.collection(COLLECTIONS.USERS).where('role', '==', 'admin').get();
  const adminUids = adminsSnap.docs.map((d) => d.id);

  // Resolve the event organizer's auth uid (organizerId may be the doc id or a uid).
  const eventOrganizerAuthUid = await resolveAuthUid(args.organizerUid);

  const recipients = new Set<string>();
  if (officerUid) recipients.add(officerUid);
  for (const uid of adminUids) recipients.add(uid);
  if (eventOrganizerAuthUid) recipients.add(eventOrganizerAuthUid);

  if (recipients.size === 0) {
    console.warn(`[reportStage2Doc] no recipients for ticket ${args.ticketId}: no officer, no admins, no organizer auth uid found.`);
    return;
  }

  await Promise.all([...recipients].map(async (recipientUid) => {
    try {
      await createNotification({
        recipientUid,
        eventId: args.eventId,
        versionId: args.versionId,
        type: 'stage2_reported',
        title,
        message: baseMessage,
        sourceActionId,
        // One doc per recipient (otherwise the writes overwrite each
        // other since sourceActionId alone is the doc id).
        notificationId: `${sourceActionId}_${recipientUid}`,
      });
    } catch (err) {
      console.warn(`[reportStage2Doc] notification to ${recipientUid} failed (non-fatal):`, err);
    }
  }));
}
