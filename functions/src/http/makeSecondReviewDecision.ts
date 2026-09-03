/**
 * makeSecondReviewDecision — admin-only callable (M3 Workstream 1).
 *
 * Officers submit proposals and the admin records the final decision. The
 * aggregate remains visible for audit and is a useful recommendation, but
 * the admin may choose a different final outcome after considering the
 * proposals and admin note. This function:
 *   1. Reads all `assignments/{versionId}_{auth}` for the current version.
 *   2. Aggregates the decisions per the prototype rules (A8):
 *        - any Rejected -> aggregate Rejected
 *        - all Approved -> aggregate Approved
 *   3. Writes the final `events.status` + `events.secondReview` + audit.
 *   4. Notifies the organiser (FR-M3-08) with the officer's reason +
 *      suggestion verbatim when rejected.
 *   5. Decrements the assigned officers' `workloadCount` (their assignment
 *      is now done).
 *
 * `finalDecision` is the admin's final decision. `confirmedDecision` is
 * accepted as a backwards-compatible alias for older clients.
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
  PublicEvent,
  REJECTION_REASON_CATEGORIES,
  RejectionReasonCategory,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { resolveAuthUid } from '../utils/notifications';

interface MakeSecondReviewDecisionRequest {
  eventId?: string;
  /** Admin's final decision. It may differ from the officer aggregate. */
  finalDecision?: DecisionValue;
  /** Backwards-compatible alias used by the first admin UI revision. */
  confirmedDecision?: DecisionValue;
  /** Required reason when the admin rejects the application. */
  reason?: string;
  /** Required suggestion when the admin rejects the application. */
  suggestion?: string;
  /** Optional note retained for approval context and backwards compatibility. */
  adminNote?: string;
  rejectionReasonCategory?: RejectionReasonCategory;
}

const ADMIN_NOTE_MAX = 1000;
const REASON_MIN = 10;
const REASON_MAX = 1000;
const SUGGESTION_MAX = 1000;

export const makeSecondReviewDecision = onCall<MakeSecondReviewDecisionRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before confirming a second review.');
  const eventId = (request.data?.eventId ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  const requestedFinalDecision = request.data?.finalDecision;
  const requestedConfirmedDecision = request.data?.confirmedDecision;
  if (requestedFinalDecision && requestedConfirmedDecision && requestedFinalDecision !== requestedConfirmedDecision) {
    throw new HttpsError('invalid-argument', 'finalDecision and confirmedDecision must match when both are provided.');
  }
  const finalDecision = requestedFinalDecision ?? requestedConfirmedDecision;
  if (!isDecision(finalDecision)) {
    throw new HttpsError('invalid-argument', 'finalDecision is required.');
  }
  const reason = (request.data?.reason ?? '').trim();
  const suggestion = (request.data?.suggestion ?? '').trim();
  const adminNote = (request.data?.adminNote ?? '').trim();
  const rejectionReasonCategory = request.data?.rejectionReasonCategory;
  if (reason.length > REASON_MAX || (reason.length > 0 && reason.length < REASON_MIN)) {
    throw new HttpsError('invalid-argument', `reason must be ${REASON_MIN}-${REASON_MAX} characters when provided.`);
  }
  if (suggestion.length > SUGGESTION_MAX) {
    throw new HttpsError('invalid-argument', `suggestion must be at most ${SUGGESTION_MAX} characters.`);
  }
  if (finalDecision === 'Rejected' && (reason.length < REASON_MIN || suggestion.length === 0)) {
    throw new HttpsError('invalid-argument', 'A rejection requires both a reason and a suggestion.');
  }
  if (finalDecision === 'Rejected' && !REJECTION_REASON_CATEGORIES.includes(rejectionReasonCategory as RejectionReasonCategory)) {
    throw new HttpsError('invalid-argument', 'A valid rejectionReasonCategory is required when rejecting.');
  }
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
  const assignments = assignmentSnaps.docs
    .map((d) => d.data() as Assignment)
    .filter((assignment) => assignment.versionId === versionId);
  if (assignments.length === 0) {
    throw new HttpsError('failed-precondition', 'No assignments found.');
  }
  const versionSnap = await eventRef.collection(COLLECTIONS.VERSIONS).doc(versionId).get();
  if (!versionSnap.exists) throw new HttpsError('failed-precondition', 'The immutable application version is missing.');
  const required = event.requiredAuthorities ?? [];
  for (const auth of required) {
    if (!assignments.find((a) => a.authorityType === auth && a.status === 'completed')) {
      throw new HttpsError('failed-precondition', `${auth} officer has not yet completed their review.`);
    }
  }

  // Aggregate (A8).
  const aggregate = aggregateFromAssignments(assignments, required);
  const now = Date.now();
  // Pick the most informative officer reason+suggestion for the
  // organiser notification when the admin did not provide a rejection detail.
  const reasonOfficer = pickFeaturedOfficer(assignments, finalDecision);
  const notifType: NotificationType =
    finalDecision === 'Approved' ? 'application_approved'
    : 'application_rejected';
  const organizerRecipientUid = await resolveAuthUid(event.organizerId);

  return db.runTransaction(async (tx) => {
    const [currentEventSnap, currentAssignmentsSnap, currentVersionSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(eventRef.collection(COLLECTIONS.ASSIGNMENTS)),
      tx.get(eventRef.collection(COLLECTIONS.VERSIONS).doc(versionId)),
    ]);
    const currentEvent = currentEventSnap.data() as EventRecord | undefined;
    const currentAssignments = currentAssignmentsSnap.docs
      .map((document) => document.data() as Assignment)
      .filter((assignment) => assignment.versionId === versionId);
    if (!currentEventSnap.exists || currentEvent?.currentVersionId !== versionId
      || currentEvent.reviewStage !== 'second' || !currentVersionSnap.exists
      || (currentEvent as EventRecord & { secondReview?: unknown }).secondReview
      || required.some((authority) => !currentAssignments.some((assignment) => assignment.authorityType === authority && assignment.status === 'completed'))
      || aggregateFromAssignments(currentAssignments, required) !== aggregate) {
      throw new HttpsError('aborted', 'The second-review inputs changed or another Admin already finalized this application.');
    }
    tx.update(eventRef, {
      status: finalDecision,
      reviewStage: finalDecision === 'Rejected' ? 'closed' : null,
      ...(finalDecision === 'Rejected'
        ? { assignedOfficerUids: [], assignedOfficerByAuthority: {}, editableVersionId: FieldValue.delete() }
        : {}),
      secondReview: {
        reviewerUid: request.auth!.uid,
        decidedAt: now,
        confirmedDecision: finalDecision,
        aggregateDecision: aggregate,
        reviewStage: 'second',
        rejectionReasonCategory: finalDecision === 'Rejected' ? rejectionReasonCategory : null,
        reason: reason || (finalDecision === 'Rejected' ? reasonOfficer?.reason : undefined) || null,
        suggestion: suggestion || (finalDecision === 'Rejected' ? reasonOfficer?.suggestion : undefined) || null,
        adminNote: adminNote || null,
        featuredOfficerUid: reasonOfficer?.officerUid ?? null,
        officerFeedback: assignments
          .filter((assignment) => assignment.status === 'completed' && assignment.decision && assignment.reason)
          .map((assignment) => ({
            authorityType: assignment.authorityType,
            officerUid: assignment.officerUid,
            decision: assignment.decision,
            reason: assignment.reason,
            suggestion: assignment.suggestion ?? null,
            decidedAt: assignment.decidedAt ?? null,
          })),
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
      newStatus: finalDecision,
      notes: reason || adminNote || null,
      metadata: {
        reviewStage: 'second',
        aggregate,
        finalDecision,
        featuredOfficerUid: reasonOfficer?.officerUid ?? null,
        featuredReason: reasonOfficer?.reason ?? null,
        featuredSuggestion: reasonOfficer?.suggestion ?? null,
        reason: reason || null,
        suggestion: suggestion || null,
        rejectionReasonCategory: finalDecision === 'Rejected' ? rejectionReasonCategory : null,
      },
    });

    const publicRef = db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId);
    if (finalDecision === 'Approved') {
      const details = (versionSnap.data() as { eventDetails: EventRecord['eventDetails'] }).eventDetails;
      const publicEvent: PublicEvent = {
        eventId,
        versionId,
        eventName: details.name,
        venueName: details.venueName,
        eventType: details.type,
        startDatetime: details.startDatetime,
        endDatetime: details.endDatetime,
        approvedBy: event.requiredAuthorities,
        publicStatus: 'approved',
      };
      tx.set(publicRef, publicEvent);
      const publishAudit = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${versionId}_public_published`);
      tx.set(publishAudit, {
        id: publishAudit.id,
        eventId,
        versionId,
        action: 'public_published',
        actorId: request.auth!.uid,
        actorRole: 'admin',
        timestamp: now,
        metadata: { approvedBy: event.requiredAuthorities, reviewStage: 'second' },
      });
    } else {
      tx.delete(publicRef);
    }

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

    if (organizerRecipientUid) {
      const notificationId = `second_review_${versionId}`;
      const notificationReason = reason || reasonOfficer?.reason || adminNote || undefined;
      const notificationSuggestion = suggestion || reasonOfficer?.suggestion || undefined;
      tx.set(db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId), {
        notificationId,
        recipientUid: organizerRecipientUid,
        eventId,
        versionId,
        type: notifType,
        title: finalDecision === 'Approved' ? 'Application approved' : 'Application rejected',
        message: notificationReason ?? `The admin recorded ${finalDecision} after second review.`,
        sourceActionId: notificationId,
        read: false,
        createdAt: now,
        ...(notificationReason ? { reason: notificationReason } : {}),
        ...(notificationSuggestion ? { suggestion: notificationSuggestion } : {}),
      }, { merge: false });
    }

    return { aggregate, finalDecision, notifType, reasonOfficer };
  }).then(async (result) => {
    return { eventId, status: result.finalDecision, aggregate: result.aggregate };
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
  if (required.length > 0 && required.every((auth) => byAuthority.get(auth) === 'Approved')) {
    return 'Approved';
  }
  return 'UnderReview';
}

function pickFeaturedOfficer(assignments: Assignment[], decision: DecisionValue): Assignment | undefined {
  if (decision === 'Approved') {
    return assignments.find((a) => a.decision === 'Approved' && a.reason);
  }
  if (decision === 'Rejected') {
    return assignments.find((a) => a.decision === 'Rejected' && a.reason);
  }
  return undefined;
}

function isDecision(v: unknown): v is DecisionValue {
  return v === 'Approved' || v === 'Rejected';
}
