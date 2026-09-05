/**
 * unassignAuthorityOfficers — admin-only callable (M3 Workstream 1 polish).
 *
 * Reverses an `assignAuthorityOfficers` call. Use cases:
 *   - A15: backup officer swap — admin assigned the wrong officer and
 *     wants to re-pick before the officer has recorded a proposal.
 *   - Admin double-clicked Assign and wants to start over.
 *
 * Refuses if any of the targeted assignments has `status === 'completed'`
 * (the officer has already recorded a proposal). Once a proposal is in,
 * the data is significant — the admin must go through
 * `makeSecondReviewDecision` to close out the work. This prevents
 * accidentally dropping a recorded decision.
 *
 * Behaviour:
 *   - Reads assignments for the current version, optionally filtered by
 *     `authorityType`.
 *   - Refuses if `event.reviewStage !== 'authority'`.
 *   - Refuses if any targeted assignment is `completed`.
 *   - In a transaction:
 *       - For each targeted assignment, set `status: 'revoked'`,
 *         `revokedAt`, `revokedBy`.
 *       - Decrement the officer's `workloadCount`.
 *       - Write one `assignment_revoked` audit log per revocation.
 *       - If all assignments for the version are now revoked, set
 *         `event.reviewStage = null` (back to pre-assignment state).
 *   - Idempotent on re-call (revoking a revoked assignment is a no-op).
 */
import { firestore } from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Assignment,
  AuthorityType,
  COLLECTIONS,
  EventRecord,
  OfficerProfile,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

interface UnassignAuthorityOfficersRequest {
  eventId?: string;
  /**
   * Optional. If provided, only revoke this authority's assignment for
   * the current version. If omitted (or null/undefined), revoke all
   * assignments for the current version.
   */
  authorityType?: AuthorityType;
}

export const unassignAuthorityOfficers = onCall<UnassignAuthorityOfficersRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before unassigning officers.');
  const eventId = (request.data?.eventId ?? '').trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');

  // Profile check: admin only.
  const db = firestore();
  const userSnap = await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get();
  const profile = userSnap.data() as UserProfile | undefined;
  if (!profile || profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can unassign officers.');
  }

  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw new HttpsError('not-found', `Event ${eventId} not found.`);
  }
  const event = eventSnap.data() as EventRecord;
  const versionId = event.currentVersionId;
  if (!versionId) {
    throw new HttpsError('failed-precondition', 'The application has no submitted version.');
  }
  if (event.reviewStage !== 'authority') {
    throw new HttpsError('failed-precondition', 'No officers are currently assigned to this event version.');
  }

  // Read all assignments for the current version.
  const assignmentsSnap = await eventRef.collection(COLLECTIONS.ASSIGNMENTS).get();
  const allAssignments = assignmentsSnap.docs
    .map((d) => d.data() as Assignment)
    .filter((a) => a.versionId === versionId);

  if (allAssignments.length === 0) {
    throw new HttpsError('failed-precondition', 'No assignments found for the current version.');
  }

  // Filter to the targeted authorities (if specified). Without a
  // filter, target all assignments for the current version.
  const filterAuth = request.data?.authorityType;
  const targeted = filterAuth
    ? allAssignments.filter((a) => a.authorityType === filterAuth)
    : allAssignments;
  if (targeted.length === 0) {
    throw new HttpsError('not-found', `No assignment found for authority ${filterAuth}.`);
  }

  // Refuse if any targeted assignment is already completed (or
  // already revoked — that's just a no-op for that row, but we still
  // continue with the rest).
  const blocking = targeted.filter((a) => a.status === 'completed');
  if (blocking.length > 0) {
    const blockingList = blocking.map((a) => a.authorityType).join(', ');
    throw new HttpsError(
      'failed-precondition',
      `Cannot unassign — these officers have already recorded a proposal: ${blockingList}. ` +
        'Wait for the second review to close out their work, or contact an administrator.',
    );
  }

  const now = Date.now();
  return db.runTransaction(async (tx) => {
    // Reads first.
    // Re-read both event and assignments. An officer proposal can complete an
    // assignment without moving reviewStage to `second` when other officers
    // are still pending, so checking the event alone is not a sufficient
    // concurrency fence.
    const [evSnap, currentAssignmentsSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(eventRef.collection(COLLECTIONS.ASSIGNMENTS)),
    ]);
    const ev = evSnap.data() as EventRecord | undefined;
    const currentAssignments = currentAssignmentsSnap.docs
      .map((document) => ({ id: document.id, value: document.data() as Assignment }))
      .filter(({ value }) => value.versionId === versionId);
    const currentTargeted = validateUnassignmentSnapshot(
      evSnap.exists ? ev : undefined,
      eventId,
      versionId,
      currentAssignments,
      filterAuth,
    );

    // Read all officer refs in the read phase.
    const targetsToRevoke = currentTargeted.filter((a) => a.status === 'pending' || a.status === 'in_progress');
    const officerRefs: Array<{ auth: AuthorityType; officerUid: string; ref: FirebaseFirestore.DocumentReference; exists: boolean; data: OfficerProfile | null }> = [];
    for (const a of targetsToRevoke) {
      const ref = db.collection(COLLECTIONS.OFFICERS).doc(a.officerUid);
      const snap = await tx.get(ref);
      officerRefs.push({ auth: a.authorityType, officerUid: a.officerUid, ref, exists: snap.exists, data: snap.exists ? snap.data() as OfficerProfile : null });
    }

    // Validate (no writes yet).
    for (const t of officerRefs) {
      // Officer may have been deleted from the officers sub-collection
      // between assignment and now. We still proceed with the revoke
      // (the assignment is the source of truth) — we just skip the
      // workload decrement for the missing officer.
      if (!t.exists) {
        console.warn(`[unassignAuthorityOfficers] officer ${t.officerUid} no longer exists; skipping workload decrement.`);
      }
    }

    // Now writes.
    let revoked = 0;
    for (const t of officerRefs) {
      const assignmentRef = eventRef.collection(COLLECTIONS.ASSIGNMENTS).doc(`${versionId}_${t.auth}`);
      tx.update(assignmentRef, {
        status: 'revoked',
        revokedAt: now,
        revokedBy: request.auth!.uid,
      });

      // Decrement officer workload (only if officer still exists).
      if (t.exists && t.data) {
        tx.update(t.ref, {
          workloadCount: FieldValue.increment(-1),
          updatedAt: now,
        });
      }

      // Audit log.
      const auditId = `assignment_revoked_${versionId}_${t.auth}_${now}`;
      tx.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), {
        id: auditId,
        eventId,
        versionId,
        action: 'assignment_revoked',
        actorId: request.auth!.uid,
        actorRole: 'admin',
        timestamp: now,
        notes: `Revoked ${t.auth} assignment for officer ${t.officerUid}`,
        metadata: {
          authorityType: t.auth,
          officerUid: t.officerUid,
          reason: 'admin_unassign',
          officerWorkloadDecremented: t.exists,
        },
      });
      revoked++;
    }

    // If every assignment for this version is now revoked, reset
    // reviewStage to null so the admin can re-assign from scratch.
    const allAssignmentsAfter = currentAssignments.map(({ value: a }) => {
      const wasTargeted = targetsToRevoke.some((t) => t.assignmentId === a.assignmentId);
      return wasTargeted ? { ...a, status: 'revoked' as const } : a;
    });
    const allRevoked = allAssignmentsAfter.every((a) => a.status === 'revoked');
    const activeAssignments = allAssignmentsAfter.filter((a) => a.status !== 'revoked');
    const assignedOfficerByAuthority = Object.fromEntries(
      activeAssignments.map((a) => [a.authorityType, a.officerUid]),
    );
    if (allRevoked) {
      tx.update(eventRef, {
        reviewStage: null,
        assignedOfficerUids: [],
        assignedOfficerByAuthority: {},
        updatedAt: now,
      });
    } else {
      tx.update(eventRef, {
        assignedOfficerUids: activeAssignments.map((a) => a.officerUid),
        assignedOfficerByAuthority,
        updatedAt: now,
      });
    }

    return { revoked, allRevoked };
  }).then((result) => {
    return {
      eventId,
      versionId,
      revoked: result.revoked,
      reviewStageReset: result.allRevoked,
    };
  });
});

export function validateUnassignmentSnapshot(
  event: EventRecord | undefined,
  eventId: string,
  versionId: string,
  assignments: Array<{ id: string; value: Assignment }>,
  authorityType?: AuthorityType,
): Assignment[] {
  if (!event || event.currentVersionId !== versionId || event.status !== 'UnderReview' || event.reviewStage !== 'authority') {
    throw new HttpsError('aborted', 'The review state changed while officers were being unassigned. Reload and retry.');
  }
  if (assignments.some(({ id, value }) => id !== `${versionId}_${value.authorityType}`
    || value.assignmentId !== id || value.eventId !== eventId || value.versionId !== versionId
    || event.assignedOfficerByAuthority?.[value.authorityType] !== value.officerUid)) {
    throw new HttpsError('failed-precondition', 'The current assignment records are invalid.');
  }
  const targeted = assignments
    .map(({ value }) => value)
    .filter((assignment) => !authorityType || assignment.authorityType === authorityType);
  if (targeted.length === 0) {
    throw new HttpsError('not-found', authorityType
      ? `No assignment found for authority ${authorityType}.`
      : 'No assignments found for the current version.');
  }
  if (targeted.some((assignment) => assignment.status === 'completed')) {
    throw new HttpsError('failed-precondition', 'An officer completed a proposal while the unassignment was in progress. Reload and review the submitted decision.');
  }
  return targeted;
}
