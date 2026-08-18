/**
 * recordOfficerProposal — officer-only callable (M3 Workstream 1).
 *
 * Replaces the officer's role in `makeAuthorityDecision` for the new
 * multi-stage flow. The officer's decision is now a *proposal* recorded
 * on their `assignments/{assignmentId}` doc — not a final status change.
 * The event's `status` is set to the aggregate only when the admin
 * confirms in second review.
 *
 * Behaviour:
 *   - Officer must have an `assignments/{versionId}_{authorityType}` doc
 *     for this event+version where `officerUid === request.auth.uid` and
 *     `status` is `pending` or `in_progress`.
 *   - Writes `decision`, `reason`, `suggestion`, `decidedAt`, sets
 *     `status: 'completed'` on the assignment.
 *   - Does NOT change `events.status`. (The old `makeAuthorityDecision`
 *     still does; this function is the new path.)
 *   - When all assignments are completed, sets
 *     `events/{eventId}.reviewStage = 'second'` and emits a notification
 *     to the admin.
 *   - Reason and suggestion are split per FR-M3-05.
 *
 * FR-M3-15 (officer reject with reason + suggestion) and FR-M3-16
 * (officer approve) are realised here.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Assignment,
  COLLECTIONS,
  DecisionValue,
  EventRecord,
  NotificationType,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { createNotification, resolveAuthUid } from '../utils/notifications';

interface RecordOfficerProposalRequest {
  eventId?: string;
  decision?: DecisionValue;
  reason?: string;
  suggestion?: string;
  /**
   * FR-M3-16: when approving, the officer must tick a checkbox
   * confirming review of the assessment, advisory, evidence, and
   * resource recommendation. Required when `decision === 'Approved'`;
   * ignored otherwise. Defaults to false.
   */
  confirmedReview?: boolean;
}

const REASON_MIN = 10;
const REASON_MAX = 1000;
const SUGGESTION_MAX = 1000;

export const recordOfficerProposal = onCall<RecordOfficerProposalRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before recording a proposal.');
  const eventId = (request.data?.eventId ?? '').trim();
  const decision = request.data?.decision;
  const reason = (request.data?.reason ?? '').trim();
  const suggestion = (request.data?.suggestion ?? '').trim();
  const confirmedReview = request.data?.confirmedReview === true;

  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!isDecision(decision)) throw new HttpsError('invalid-argument', 'A valid decision is required.');
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    throw new HttpsError('invalid-argument', `reason must be ${REASON_MIN}-${REASON_MAX} characters.`);
  }
  if (suggestion.length > SUGGESTION_MAX) {
    throw new HttpsError('invalid-argument', `suggestion must be at most ${SUGGESTION_MAX} characters.`);
  }
  if (decision === 'Rejected' && suggestion.length === 0) {
    throw new HttpsError('invalid-argument', 'A suggestion is required when rejecting.');
  }
  // FR-M3-16: officer must confirm review of all listed materials
  // before approving. The UI checkbox drives this — server-side gate
  // is the source of truth.
  if (decision === 'Approved' && !confirmedReview) {
    throw new HttpsError(
      'failed-precondition',
      'You must confirm that you have reviewed the assessment, advisory, evidence, and resource recommendation before approving.',
    );
  }

  const db = firestore();
  const userSnap = await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get();
  const profile = userSnap.data() as UserProfile | undefined;
  if (!profile || profile.role !== 'authority' || !profile.authorityType) {
    throw new HttpsError('permission-denied', 'Only provisioned authority accounts can record proposals.');
  }

  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError('not-found', `Event ${eventId} not found.`);
  const event = eventSnap.data() as EventRecord;
  const versionId = event.currentVersionId;
  if (!versionId) throw new HttpsError('failed-precondition', 'The application has no submitted version.');

  // Find this officer's assignment.
  const assignmentId = `${versionId}_${profile.authorityType}`;
  const assignmentRef = eventRef.collection(COLLECTIONS.ASSIGNMENTS).doc(assignmentId);
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists) {
    throw new HttpsError('permission-denied', `You are not assigned to this event for ${profile.authorityType}.`);
  }
  const assignment = assignmentSnap.data() as Assignment;
  if (assignment.officerUid !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'This assignment belongs to another officer.');
  }
  if (assignment.status === 'completed') {
    throw new HttpsError('failed-precondition', 'You have already recorded a decision for this assignment.');
  }
  if (assignment.status === 'revoked') {
    throw new HttpsError('failed-precondition', 'This assignment was revoked.');
  }

  const now = Date.now();
  return db.runTransaction(async (tx) => {
    // Reads first (Firestore requires all reads before all writes).
    const allAssignmentsSnap = await tx.get(eventRef.collection(COLLECTIONS.ASSIGNMENTS));
    const all = allAssignmentsSnap.docs.map((d) => d.data() as Assignment);
    // Treat the current assignment as if it's about to be completed
    // (so the last officer's proposal correctly triggers reviewStage='second').
    const allCompleted = all
      .map((a) => (a.assignmentId === assignmentId ? { ...a, status: 'completed' as const } : a))
      .every((a) => a.status === 'completed' || a.status === 'revoked');
    const statusSummary = all.map((a) => ({ auth: a.authorityType, status: a.status }));
    console.log(`[recordOfficerProposal] eventId=${eventId} assignmentId=${assignmentId} statuses=${JSON.stringify(statusSummary)} allCompleted=${allCompleted}`);

    // Writes.
    tx.update(assignmentRef, {
      status: 'completed',
      decision,
      reason,
      suggestion: suggestion || null,
      decidedAt: now,
    });

    if (allCompleted) {
      tx.update(eventRef, {
        reviewStage: 'second',
        updatedAt: now,
      });
    }

    return { assignmentId, decision, allCompleted };
  }).then(async (result) => {
    // Fire-and-forget notification to the admin when all officers are done.
    if (result.allCompleted) {
      try {
        const adminUid = await findFirstAdminUid(db);
        if (adminUid) {
          await createNotification({
            recipientUid: adminUid,
            eventId,
            versionId,
            type: 'decision_made',
            title: 'All officers have decided',
            message: `All assigned officers have recorded their decisions. Ready for second review.`,
            sourceActionId: `all-officers-done_${versionId}`,
          });
        }
      } catch (err) {
        console.warn('[recordOfficerProposal] admin notification failed (non-fatal):', err);
      }
    }
    // Notify the organiser (FR-M3-08) — wraps the legacy notification.
    // FR-M3-08: rejection notifications carry reason + suggestion as
    // separate fields so the bell UI can surface them structurally
    // (not just mashed into the message).
    if (event.organizerId) {
      try {
        const recipientUid = await resolveAuthUid(event.organizerId);
        if (recipientUid) {
          const notifType: NotificationType =
            decision === 'Approved' ? 'application_approved'
            : decision === 'Rejected' ? 'application_rejected'
            : 'amendment_requested';
          await createNotification({
            recipientUid,
            eventId,
            versionId,
            type: notifType,
            title: `${profile.authorityType} recorded ${decision}`,
            message: `${profile.authorityType} ${decision} (officer proposal). Final decision pending second review.`,
            sourceActionId: `proposal_${assignmentId}`,
            ...(decision === 'Rejected' ? { reason, suggestion: suggestion || undefined } : {}),
            ...(decision === 'AmendmentRequested' && suggestion ? { reason, suggestion } : {}),
          });
        }
      } catch (err) {
        console.warn('[recordOfficerProposal] organiser notification failed (non-fatal):', err);
      }
    }
    return {
      eventId,
      versionId,
      assignmentId: result.assignmentId,
      decision: result.decision,
      allCompleted: result.allCompleted,
    };
  });
});

function isDecision(v: unknown): v is DecisionValue {
  return v === 'Approved' || v === 'Rejected' || v === 'AmendmentRequested';
}

async function findFirstAdminUid(db: FirebaseFirestore.Firestore): Promise<string | null> {
  const snap = await db.collection(COLLECTIONS.USERS).where('role', '==', 'admin').limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}
