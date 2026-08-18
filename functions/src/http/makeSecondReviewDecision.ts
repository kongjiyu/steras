/**
 * makeSecondReviewDecision — admin-only callable (M3 Workstream 1).
 *
 * The pure aggregator (locked assumption A7). The admin cannot override
 * the officers' aggregated decision; this function:
 *   1. Reads all `assignments/{versionId}_{auth}` for the current version.
 *   2. Aggregates the decisions per the prototype rules (A8):
 *        - any Rejected -> aggregate Rejected
 *        - any AmendmentRequested -> aggregate AmendmentRequested
 *        - all Approved -> aggregate Approved
 *   3. Writes the final `events.status` + `events.secondReview` + audit.
 *   4. Notifies the organiser (FR-M3-08) with the officer's reason +
 *      suggestion verbatim when rejected.
 *   5. Decrements the assigned officers' `workloadCount` (their assignment
 *      is now done).
 *
 * The admin's "decision" param is the confirmed aggregate. The function
 * refuses to confirm a different status (A7: cannot override the aggregate).
 */
import { firestore } from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Assignment,
  AuthorityType,
  COLLECTIONS,
  DecisionValue,
  EventRecord,
  NotificationType,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { createNotification, resolveAuthUid } from '../utils/notifications';

interface MakeSecondReviewDecisionRequest {
  eventId?: string;
  /** Admin's confirmation. Must equal the aggregated aggregate. */
  confirmedDecision?: DecisionValue;
  /** Optional reason from the admin (for the audit log). */
  adminNote?: string;
}

const ADMIN_NOTE_MAX = 1000;

export const makeSecondReviewDecision = onCall<MakeSecondReviewDecisionRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before confirming a second review.');
  const eventId = (request.data?.eventId ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  const confirmedDecision = request.data?.confirmedDecision;
  if (!isDecision(confirmedDecision)) {
    throw new HttpsError('invalid-argument', 'confirmedDecision is required.');
  }
  const adminNote = (request.data?.adminNote ?? '').trim();
  if (adminNote.length > ADMIN_NOTE_MAX) {
    throw new HttpsError('invalid-argument', `adminNote must be at most ${ADMIN_NOTE_MAX} characters.`);
  }

  const db = firestore();
  const userSnap = await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get();
  const profile = userSnap.data() as UserProfile | undefined;
  if (!profile || profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can confirm a second review.');
  }

  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError('not-found', `Event ${eventId} not found.`);
  const event = eventSnap.data() as EventRecord;
  const versionId = event.currentVersionId;
  if (!versionId) throw new HttpsError('failed-precondition', 'The application has no submitted version.');
  if (event.reviewStage !== 'second') {
    throw new HttpsError('failed-precondition', 'All officers have not yet completed their review.');
  }

  // Read all assignments for this version.
  const assignmentSnaps = await eventRef.collection(COLLECTIONS.ASSIGNMENTS).get();
  const assignments = assignmentSnaps.docs.map((d) => d.data() as Assignment);
  if (assignments.length === 0) {
    throw new HttpsError('failed-precondition', 'No assignments found.');
  }
  const required = event.requiredAuthorities ?? [];
  for (const auth of required) {
    if (!assignments.find((a) => a.authorityType === auth && a.status === 'completed')) {
      throw new HttpsError('failed-precondition', `${auth} officer has not yet completed their review.`);
    }
  }

  // Aggregate (A8).
  const aggregate = aggregateFromAssignments(assignments, required);
  if (aggregate !== confirmedDecision) {
    throw new HttpsError(
      'failed-precondition',
      `Cannot override the aggregated decision. Aggregate is ${aggregate}; you confirmed ${confirmedDecision}.`,
    );
  }

  const now = Date.now();
  // Pick the most informative officer reason+suggestion for the
  // organiser notification (priority: Rejected > AmendmentRequested > Approved).
  const reasonOfficer = pickFeaturedOfficer(assignments, aggregate);
  const notifType: NotificationType =
    aggregate === 'Approved' ? 'application_approved'
    : aggregate === 'Rejected' ? 'application_rejected'
    : 'amendment_requested';

  return db.runTransaction(async (tx) => {
    tx.update(eventRef, {
      status: aggregate,
      reviewStage: null,
      secondReview: {
        reviewerUid: request.auth!.uid,
        decidedAt: now,
        confirmedDecision: aggregate,
        adminNote: adminNote || null,
        featuredOfficerUid: reasonOfficer?.officerUid ?? null,
      },
      updatedAt: now,
    });

    // Audit.
    const auditId = `second_review_${versionId}_${now}`;
    tx.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), {
      id: auditId,
      eventId,
      versionId,
      action: 'decision_made',
      actorId: request.auth!.uid,
      actorRole: 'admin',
      timestamp: now,
      previousStatus: event.status,
      newStatus: aggregate,
      notes: adminNote || null,
      metadata: {
        reviewStage: 'second',
        aggregate,
        featuredOfficerUid: reasonOfficer?.officerUid ?? null,
        featuredReason: reasonOfficer?.reason ?? null,
        featuredSuggestion: reasonOfficer?.suggestion ?? null,
      },
    });

    // Decrement workload for each assigned officer + mark assignment
    // history as 'completed' (the assignment doc is already 'completed'
    // from the officer action; this just clears workload).
    for (const a of assignments) {
      if (a.status === 'completed') {
        const officerRef = db.collection(COLLECTIONS.OFFICERS).doc(a.officerUid);
        tx.update(officerRef, {
          workloadCount: FieldValue.increment(-1),
          updatedAt: now,
        });
      }
    }

    return { aggregate, notifType, reasonOfficer };
  }).then(async (result) => {
    if (event.organizerId) {
      try {
        const recipientUid = await resolveAuthUid(event.organizerId);
        if (recipientUid) {
          const title =
            result.aggregate === 'Approved' ? 'Application approved'
            : result.aggregate === 'Rejected' ? 'Application rejected'
            : 'Amendment requested';
          const message = result.reasonOfficer
            ? `${result.reasonOfficer.authorityType} ${result.reasonOfficer.reason}${result.reasonOfficer.suggestion ? '. ' + result.reasonOfficer.suggestion : ''}`
            : `All required authorities have ${result.aggregate} the application.`;
          // FR-M3-08: surface the featured officer's reason + suggestion
          // as separate fields so the bell UI can render them on
          // separate lines (instead of concatenating into the message).
          await createNotification({
            recipientUid,
            eventId,
            versionId,
            type: result.notifType,
            title,
            message,
            sourceActionId: `second_review_${versionId}`,
            ...(result.reasonOfficer?.reason ? { reason: result.reasonOfficer.reason } : {}),
            ...(result.reasonOfficer?.suggestion ? { suggestion: result.reasonOfficer.suggestion } : {}),
          });
        }
      } catch (err) {
        console.warn('[makeSecondReviewDecision] organiser notification failed (non-fatal):', err);
      }
    }
    return { eventId, status: result.aggregate };
  });
});

function aggregateFromAssignments(assignments: Assignment[], required: AuthorityType[]): EventRecord['status'] {
  const byAuthority = new Map<AuthorityType, DecisionValue>();
  for (const a of assignments) {
    if (a.status === 'completed' && a.decision) byAuthority.set(a.authorityType, a.decision);
  }
  for (const auth of required) {
    if (byAuthority.get(auth) === 'Rejected') return 'Rejected';
  }
  for (const auth of required) {
    if (byAuthority.get(auth) === 'AmendmentRequested') return 'AmendmentRequested';
  }
  if (required.length > 0 && required.every((auth) => byAuthority.get(auth) === 'Approved')) {
    return 'Approved';
  }
  return 'UnderReview';
}

function pickFeaturedOfficer(assignments: Assignment[], aggregate: DecisionValue): Assignment | undefined {
  if (aggregate === 'Approved') {
    return assignments.find((a) => a.decision === 'Approved' && a.reason);
  }
  if (aggregate === 'Rejected') {
    return assignments.find((a) => a.decision === 'Rejected' && a.reason);
  }
  if (aggregate === 'AmendmentRequested') {
    return assignments.find((a) => a.decision === 'AmendmentRequested' && a.reason);
  }
  return undefined;
}

function isDecision(v: unknown): v is DecisionValue {
  return v === 'Approved' || v === 'Rejected' || v === 'AmendmentRequested';
}
