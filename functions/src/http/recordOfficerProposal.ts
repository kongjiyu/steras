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
  *     `status` is `pending` or `in_progress`; a completed assignment may
  *     be amended while the event remains in Authority Review.
 *   - Writes `decision`, `reason`, `suggestion`, `decidedAt`, sets
 *     `status: 'completed'` on the assignment.
 *   - Does NOT change `events.status`. (The old `makeAuthorityDecision`
 *     still does; this function is the new path.)
 *   - When all assignments are completed, sets
 *     `events/{eventId}.reviewStage = 'second'` and emits a notification
 *     to the admin. The organiser is notified only after the admin records
 *     the final second-review outcome.
 *   - Reason and suggestion are split per FR-M3-05.
 *
 * FR-M3-15 (officer reject with reason + suggestion) and FR-M3-16
 * (officer approve) are realised here.
 */
import { firestore } from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Assignment,
  AssessmentReadiness,
  COLLECTIONS,
  DecisionValue,
  EventRecord,
  ResourceRecommendation,
  RiskAssessment,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { validateResourceRecommendation } from '../engines/resourceContract';
import { createNotification } from '../utils/notifications';

export interface RecordOfficerProposalRequest {
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
  const { eventId, decision, reason, suggestion, confirmedReview } = validateOfficerProposalRequest(request.data);

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
  const assessmentId = event.currentAssessmentId;
  const resourceId = event.currentResourceId;
  if (!assessmentId || !resourceId || !safeDocumentId(assessmentId) || !safeDocumentId(resourceId)) {
    throw new HttpsError('failed-precondition', 'Risk assessment and resources must point to the current M2 generation.');
  }
  const [assessmentSnap, resourceSnap] = await Promise.all([
    eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(assessmentId).get(),
    eventRef.collection(COLLECTIONS.RESOURCES).doc(resourceId).get(),
  ]);
  if (!['Pending', 'UnderReview'].includes(event.status) || event.reviewStage !== 'authority') {
    throw new HttpsError('failed-precondition', 'This application version is no longer open for officer review.');
  }
  if (event.initialReview?.decision !== 'Approved') {
    throw new HttpsError('failed-precondition', 'The admin initial review has not released this application for officer review.');
  }
  const resource = resourceSnap.data() as ResourceRecommendation | undefined;
  const assessment = assessmentSnap.data() as RiskAssessment | undefined;
  if (!assessmentSnap.exists || !resourceSnap.exists || !assessment
    || assessment.assessmentId !== assessmentId
    || assessment.eventId !== eventId
    || assessment.versionId !== versionId
    || !resource
    || !validateResourceRecommendation(resource).ok
    || resource.resourceId !== resourceId
    || resource.eventId !== eventId
    || resource.versionId !== versionId
    || resource.assessmentId !== assessmentId) {
    throw new HttpsError('failed-precondition', 'Risk assessment and resources must be ready before recording a proposal.');
  }
  if (assessment?.complianceStatus === 'blocked' && decision === 'Approved') {
    throw new HttpsError('failed-precondition', 'This application cannot be approved while compliance checks are blocked.');
  }
  const readiness = assessment.assessmentReadiness;
  const finalizedAdminManual = assessment.status === 'official_ready'
    && 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual';
  validateOfficerRejectionRationale(decision, readiness, finalizedAdminManual, reason);

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
  if (assignment.status === 'revoked') {
    throw new HttpsError('failed-precondition', 'This assignment was revoked.');
  }

  const now = Date.now();
  return db.runTransaction(async (tx) => {
    // Reads first (Firestore requires all reads before all writes).
    const currentDecisionRef = eventRef.collection(COLLECTIONS.DECISIONS).doc(assignmentId);
    const [currentEventSnap, allAssignmentsSnap, currentDecisionSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(eventRef.collection(COLLECTIONS.ASSIGNMENTS)),
      tx.get(currentDecisionRef),
    ]);
    const currentEvent = currentEventSnap.data() as EventRecord | undefined;
    if (!currentEventSnap.exists || currentEvent?.currentVersionId !== versionId
      || currentEvent.currentAssessmentId !== assessmentId || currentEvent.currentResourceId !== resourceId) {
      throw new HttpsError('aborted', 'The application generation changed before the proposal was recorded.');
    }
    if (currentEvent.reviewStage !== 'authority' || !['Pending', 'UnderReview'].includes(currentEvent.status)) {
      throw new HttpsError('failed-precondition', 'This application has advanced to Final Review; amendments are closed.');
    }
    const all = allAssignmentsSnap.docs
      .map((d) => ({ ...(d.data() as Assignment), assignmentId: d.id }))
      .filter((candidate) => candidate.versionId === versionId);
    const currentAssignment = all.find((candidate) => candidate.assignmentId === assignmentId);
    if (!currentAssignment || currentAssignment.officerUid !== request.auth!.uid
      || currentAssignment.authorityType !== profile.authorityType
      || currentAssignment.status === 'revoked') {
      throw new HttpsError('permission-denied', 'This assignment is no longer yours to review.');
    }
    const isAmendment = currentAssignment.status === 'completed';
    const previousReason = currentAssignment.reason ?? '';
    const previousSuggestion = currentAssignment.suggestion ?? '';
    const previousDecisionRecord = currentDecisionSnap.data() as {
      decision?: DecisionValue;
      rationale?: string;
      suggestion?: string;
      reviewerId?: string;
      decidedAt?: number;
      current?: boolean;
    } | undefined;
    if (isAmendment && currentAssignment.decision === decision
      && previousReason === reason && previousSuggestion === suggestion) {
      return { assignmentId, decision, allCompleted: false, amended: false, idempotent: true };
    }
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
      ...(reason ? { reason } : { reason: FieldValue.delete() }),
      ...(suggestion ? { suggestion } : { suggestion: FieldValue.delete() }),
      decidedAt: now,
      ...(decision === 'Approved' ? { confirmedReview: true } : { confirmedReview: FieldValue.delete() }),
    });

    // Older clients wrote a current decision document in addition to the
    // assignment. Keep that legacy projection in sync when amending, while
    // leaving the new assignment-first schema unchanged for fresh proposals.
    if (isAmendment && currentDecisionSnap.exists && previousDecisionRecord?.current === true) {
      tx.set(currentDecisionRef, {
        ...previousDecisionRecord,
        decisionId: assignmentId,
        eventId,
        versionId,
        authorityType: currentAssignment.authorityType,
        decision,
        rationale: reason,
        ...(suggestion ? { suggestion } : { suggestion: FieldValue.delete() }),
        ...(decision === 'Approved' ? { materialsReviewed: true } : { materialsReviewed: FieldValue.delete() }),
        reviewerId: request.auth!.uid,
        decidedAt: now,
        current: true,
      }, { merge: true });
    }

    if (allCompleted && !isAmendment) {
      tx.update(eventRef, {
        reviewStage: 'second',
        updatedAt: now,
      });
    }

    if (isAmendment && currentAssignment.decision && currentAssignment.decidedAt) {
      const archivedDecision = previousDecisionRecord?.decision ?? currentAssignment.decision;
      const archivedReason = previousDecisionRecord?.rationale ?? previousReason;
      const archivedSuggestion = previousDecisionRecord?.suggestion ?? previousSuggestion;
      const archivedReviewer = previousDecisionRecord?.reviewerId ?? currentAssignment.officerUid;
      const archivedAt = previousDecisionRecord?.decidedAt ?? currentAssignment.decidedAt;
      const historyId = `${assignmentId}_amended_${now}_${historySuffix({
        decision: archivedDecision,
        reason: archivedReason,
        suggestion: archivedSuggestion,
      })}`;
      const historyReference = eventRef.collection(COLLECTIONS.DECISION_HISTORY).doc(historyId);
      tx.create(historyReference, {
        decisionId: historyId,
        eventId,
        versionId,
        authorityType: currentAssignment.authorityType,
        decision: archivedDecision,
        rationale: archivedReason,
        ...(archivedSuggestion ? { suggestion: archivedSuggestion } : {}),
        reviewerId: archivedReviewer,
        decidedAt: archivedAt,
        current: false,
        amendedAt: now,
        amendedBy: request.auth!.uid,
      });
      const auditReference = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${historyId}_audit`);
      tx.create(auditReference, {
        id: auditReference.id,
        eventId,
        versionId,
        action: 'decision_amended',
        actorId: request.auth!.uid,
        actorRole: 'authority',
        timestamp: now,
        notes: reason || 'Approval rationale omitted after reviewed-material confirmation.',
        metadata: {
          authorityType: currentAssignment.authorityType,
          previousDecision: archivedDecision,
          previousReason: archivedReason,
          previousSuggestion: archivedSuggestion || null,
          decision,
          reason: reason || null,
          suggestion: suggestion || null,
          confirmedReview,
        },
      });
    }

    return { assignmentId, decision, allCompleted, amended: isAmendment, idempotent: false };
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
    // Do not notify the organiser yet: this is an officer proposal, not a
    // final application outcome. `makeSecondReviewDecision` sends the one
    // authoritative result after the admin completes second review.
    return {
      eventId,
      versionId,
      assignmentId: result.assignmentId,
      decision: result.decision,
      allCompleted: result.allCompleted,
      amended: result.amended,
      ...(result.idempotent ? { idempotent: true } : {}),
    };
  });
});

function historySuffix(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url').slice(0, 16);
}

/** Apply the longer rationale rule only to adverse officer proposals while
 * the assessment is provisional or lacks sufficient data. */
export function validateOfficerRejectionRationale(
  decision: DecisionValue,
  readiness: AssessmentReadiness | undefined,
  finalizedAdminManual: boolean,
  reason: string,
): void {
  if (decision === 'Rejected' && !finalizedAdminManual
    && (readiness === 'provisional' || readiness === 'insufficient_data') && reason.trim().length < 80) {
    throw new HttpsError('invalid-argument', `When the assessment is ${readiness}, the proposal reason must be at least 80 characters.`);
  }
}

function isDecision(v: unknown): v is DecisionValue {
  return v === 'Approved' || v === 'Rejected';
}

/** Validate and normalise the officer-facing proposal contract. */
export function validateOfficerProposalRequest(request: unknown): {
  eventId: string;
  decision: DecisionValue;
  reason: string;
  suggestion: string;
  confirmedReview: boolean;
} {
  const value = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {};
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
  const decision = value.decision;
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const suggestion = typeof value.suggestion === 'string' ? value.suggestion.trim() : '';
  const confirmedReview = value.confirmedReview === true;
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!isDecision(decision)) throw new HttpsError('invalid-argument', 'A valid decision is required.');
  // Approval rationale is optional after the officer confirms that all
  // required review materials were considered. Rejections still need a
  // meaningful reason.
  if (decision === 'Rejected' && (reason.length < REASON_MIN || reason.length > REASON_MAX)) {
    throw new HttpsError('invalid-argument', `reason must be ${REASON_MIN}-${REASON_MAX} characters when rejecting.`);
  }
  if (decision === 'Approved' && reason.length > REASON_MAX) {
    throw new HttpsError('invalid-argument', `reason must be at most ${REASON_MAX} characters.`);
  }
  if (suggestion.length > SUGGESTION_MAX) {
    throw new HttpsError('invalid-argument', `suggestion must be at most ${SUGGESTION_MAX} characters.`);
  }
  if (decision === 'Rejected' && (suggestion.length < REASON_MIN || suggestion.length > SUGGESTION_MAX)) {
    throw new HttpsError('invalid-argument', `suggestion must be ${REASON_MIN}-${SUGGESTION_MAX} characters when rejecting.`);
  }
  if (decision === 'Approved' && !confirmedReview) {
    throw new HttpsError(
      'failed-precondition',
      'You must confirm that you have reviewed the assessment, advisory, evidence, and resource recommendation before approving.',
    );
  }
  return { eventId, decision, reason, suggestion, confirmedReview };
}

function safeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

async function findFirstAdminUid(db: FirebaseFirestore.Firestore): Promise<string | null> {
  const snap = await db.collection(COLLECTIONS.USERS).where('role', '==', 'admin').limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}
