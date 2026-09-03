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
 *     to the admin. The organiser is notified only after the admin records
 *     the final second-review outcome.
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
  OfficialRiskAssessment,
  REJECTION_REASON_CATEGORIES,
  RejectionReasonCategory,
  ResourceRecommendation,
  RiskAssessment,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { validateResourceRecommendation } from '../engines/resourceContract';
import { createNotification } from '../utils/notifications';

interface RecordOfficerProposalRequest {
  eventId?: string;
  decision?: DecisionValue;
  reason?: string;
  suggestion?: string;
  rejectionReasonCategory?: RejectionReasonCategory;
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
  const rejectionReasonCategory = request.data?.rejectionReasonCategory;

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
  if (decision === 'Rejected' && !REJECTION_REASON_CATEGORIES.includes(rejectionReasonCategory as RejectionReasonCategory)) {
    throw new HttpsError('invalid-argument', 'A valid rejectionReasonCategory is required when rejecting.');
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
  const assessmentId = event.currentAssessmentId;
  const resourceId = event.currentResourceId;
  if (!assessmentId || !resourceId || !safeDocumentId(assessmentId) || !safeDocumentId(resourceId)) {
    throw new HttpsError('failed-precondition', 'Risk assessment and resources must point to the current M2 generation.');
  }
  const [assessmentSnap, resourceSnap] = await Promise.all([
    eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(assessmentId).get(),
    eventRef.collection(COLLECTIONS.RESOURCES).doc(resourceId).get(),
  ]);
  if (!['Pending', 'UnderReview'].includes(event.status)) {
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
  if (assessment.status !== 'official_ready' || resource.stage !== 'official') {
    throw new HttpsError('failed-precondition', 'Officer decisions require the current official assessment and official resource revision.');
  }
  const manualOfficial = 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual';
  if (!manualOfficial) {
    const aiOfficial = assessment as OfficialRiskAssessment;
    const head = aiOfficial.authorityReviewState?.activeReviewHeads?.[profile.authorityType];
    const officialReviewIds = Array.isArray(aiOfficial.officialResult.reviewIds)
      ? aiOfficial.officialResult.reviewIds : [];
    if (!head?.reviewId || !officialReviewIds.includes(head.reviewId)) {
      throw new HttpsError('failed-precondition', 'Submit and finalize your eight-category score review before recording an application proposal.');
    }
  }
  if (assessment?.complianceStatus === 'blocked' && decision === 'Approved') {
    throw new HttpsError('failed-precondition', 'This application cannot be approved while compliance checks are blocked.');
  }
  const readiness = assessment.assessmentReadiness;
  const finalizedAdminManual = assessment.status === 'official_ready'
    && 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual';
  if (!finalizedAdminManual && (readiness === 'provisional' || readiness === 'insufficient_data') && reason.length < 80) {
    throw new HttpsError('invalid-argument', `When the assessment is ${readiness}, the proposal reason must be at least 80 characters.`);
  }

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
    const [currentEventSnap, allAssignmentsSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(eventRef.collection(COLLECTIONS.ASSIGNMENTS)),
    ]);
    const currentEvent = currentEventSnap.data() as EventRecord | undefined;
    if (!currentEventSnap.exists || currentEvent?.currentVersionId !== versionId
      || currentEvent.currentAssessmentId !== assessmentId || currentEvent.currentResourceId !== resourceId) {
      throw new HttpsError('aborted', 'The application generation changed before the proposal was recorded.');
    }
    const all = allAssignmentsSnap.docs
      .map((d) => d.data() as Assignment)
      .filter((candidate) => candidate.versionId === versionId);
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
      reviewStage: 'authority',
      ...(decision === 'Rejected' ? { rejectionReasonCategory } : {}),
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
    // Do not notify the organiser yet: this is an officer proposal, not a
    // final application outcome. `makeSecondReviewDecision` sends the one
    // authoritative result after the admin completes second review.
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
  return v === 'Approved' || v === 'Rejected';
}

function safeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

async function findFirstAdminUid(db: FirebaseFirestore.Firestore): Promise<string | null> {
  const snap = await db.collection(COLLECTIONS.USERS).where('role', '==', 'admin').limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}
