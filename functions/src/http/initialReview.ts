/**
 * Admin initial-review gate (M3 FR-M3-02..08).
 *
 * The initial decision is distinct from the authority proposal and the
 * second-review outcome:
 *   - Approved means the application is released to officer assignment and
 *     the event remains `UnderReview`.
 *   - Rejected is a terminal result for the current version and carries the
 *     reason + corrective suggestion needed by the organiser for resubmission.
 *   - `Manual Review Required` applications must include a recorded manual
 *     assessment before they can be released to authority review.
 */
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  AuthorityType,
  Assignment,
  EventRecord,
  ResourceRecommendation,
  RiskAssessment,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { validateResourceRecommendation } from '../engines/resourceContract';
import { createNotification, resolveAuthUid } from '../utils/notifications';

type InitialDecision = 'Approved' | 'Rejected';

interface InitialReviewRequest {
  eventId?: string;
  decision?: InitialDecision;
  reason?: string;
  suggestion?: string;
  /** Include completed named-officer feedback in an initial rejection. */
  attachOfficerFeedback?: boolean;
}

const REASON_MIN = 10;
const REASON_MAX = 1_000;
const SUGGESTION_MAX = 1_000;

export const makeInitialReviewDecision = onCall<InitialReviewRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before completing the initial review.');
  return makeInitialReviewDecisionForUser(request.auth.uid, request.data);
});

export async function makeInitialReviewDecisionForUser(uid: string, data: InitialReviewRequest, now = Date.now()) {
  const eventId = (data.eventId ?? '').trim();
  const decision = data.decision;
  const reason = (data.reason ?? '').trim();
  const suggestion = (data.suggestion ?? '').trim();
  const attachOfficerFeedback = data.attachOfficerFeedback === true;
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (decision !== 'Approved' && decision !== 'Rejected') {
    throw new HttpsError('invalid-argument', 'decision must be Approved or Rejected.');
  }
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    throw new HttpsError('invalid-argument', `reason must be ${REASON_MIN}-${REASON_MAX} characters.`);
  }
  if (suggestion.length > SUGGESTION_MAX) {
    throw new HttpsError('invalid-argument', `suggestion must be at most ${SUGGESTION_MAX} characters.`);
  }
  if (decision === 'Rejected' && suggestion.length === 0) {
    throw new HttpsError('invalid-argument', 'A suggestion is required when rejecting.');
  }
  if (Object.prototype.hasOwnProperty.call(data, 'manualAssessment')) {
    throw new HttpsError(
      'failed-precondition',
      'Manual Review Required applications must be completed in the Admin manual assessment queue before initial review.',
    );
  }

  const db = firestore();
  const userSnap = await db.collection(COLLECTIONS.USERS).doc(uid).get();
  const profile = userSnap.data() as UserProfile | undefined;
  if (!profile || profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can complete an initial review.');
  }

  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError('not-found', `Event ${eventId} not found.`);
  const event = { eventId, ...eventSnap.data() } as EventRecord;
  const versionId = event.currentVersionId;
  const assessmentId = event.currentAssessmentId;
  const resourceId = event.currentResourceId;
  if (!versionId || !assessmentId) throw new HttpsError('failed-precondition', 'The application has no current assessment generation.');
  if (!safeDocumentId(versionId) || !safeDocumentId(assessmentId)
    || (resourceId !== undefined && !safeDocumentId(resourceId))) {
    throw new HttpsError('failed-precondition', 'The application current-generation pointers are invalid.');
  }
  if (!['Pending', 'UnderReview', 'Manual Review Required', 'AmendmentRequested'].includes(event.status)) {
    throw new HttpsError('failed-precondition', 'This application is not available for initial review.');
  }
  if (event.reviewStage === 'authority' || event.reviewStage === 'second') {
    throw new HttpsError('failed-precondition', 'Initial review is already complete for this application version.');
  }
  if ((event.assignedOfficerUids?.length ?? 0) > 0) {
    throw new HttpsError('failed-precondition', 'Officers are already assigned; use the authority or second-review workflow.');
  }

  const assessmentRef = eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(assessmentId);
  const resourceRef = resourceId ? eventRef.collection(COLLECTIONS.RESOURCES).doc(resourceId) : undefined;
  const [assessmentSnap, resourceSnap] = await Promise.all([
    assessmentRef.get(),
    resourceRef ? resourceRef.get() : Promise.resolve(undefined),
  ]);
  const assessment = assessmentSnap.data() as RiskAssessment | undefined;
  const resource = resourceSnap?.data() as ResourceRecommendation | undefined;
  const manualOfficial = isManualOfficialAssessment(assessment, eventId, versionId, assessmentId);

  // Feedback is read before the decision transaction so the admin can
  // explicitly attach the completed officer rationale to an initial reject.
  // Assignments are never deleted, so this also works when a previous review
  // was revoked or the application is being re-opened for correction.
  let officerFeedback: NonNullable<NonNullable<EventRecord['initialReview']>['officerFeedback']> | undefined;
  if (decision === 'Rejected' && attachOfficerFeedback) {
    const assignmentSnapshot = await eventRef.collection(COLLECTIONS.ASSIGNMENTS).get();
    officerFeedback = assignmentSnapshot.docs
      .map((snapshot) => snapshot.data() as Assignment)
      .filter((assignment) => assignment.versionId === versionId && assignment.decision && assignment.reason)
      .map((assignment) => ({
        authorityType: assignment.authorityType as AuthorityType,
        officerUid: assignment.officerUid,
        decision: assignment.decision!,
        reason: assignment.reason!,
        ...(assignment.suggestion ? { suggestion: assignment.suggestion } : {}),
        ...(assignment.decidedAt ? { decidedAt: assignment.decidedAt } : {}),
      }));
  }

  if (decision === 'Approved' && (!(isReadyAssessment(assessment, eventId, versionId, assessmentId) || manualOfficial)
    || !resourceSnap?.exists || !resource || !resourceId
    || !validateResourceRecommendation(resource).ok
    || resource.resourceId !== resourceId
    || resource.eventId !== eventId
    || resource.versionId !== versionId
    || resource.assessmentId !== assessmentId)) {
    if (event.status === 'Manual Review Required' || assessment?.status === 'manual_review_required') {
      throw new HttpsError('failed-precondition', 'Complete the Admin manual assessment queue before initial approval.');
    }
    throw new HttpsError('failed-precondition', 'Smart Risk Assessment and Safety Resource Recommendation must be ready before initial approval.');
  }

  const nextStatus: EventRecord['status'] = decision === 'Approved' ? 'UnderReview' : 'Rejected';
  const initialReview = {
    decision,
    reason,
    ...(suggestion ? { suggestion } : {}),
    reviewerUid: uid,
    reviewedAt: now,
    manualAssessmentRecorded: manualOfficial,
    ...(officerFeedback && officerFeedback.length > 0 ? { officerFeedback } : {}),
  };

  const result = await db.runTransaction(async (tx) => {
    const currentEventSnap = await tx.get(eventRef);
    const currentEvent = { eventId, ...currentEventSnap.data() } as EventRecord;
    if (!currentEventSnap.exists
      || currentEvent.currentVersionId !== versionId
      || currentEvent.currentAssessmentId !== assessmentId
      || currentEvent.currentResourceId !== resourceId
      || currentEvent.reviewStage === 'authority'
      || currentEvent.reviewStage === 'second'
      || (currentEvent.assignedOfficerUids?.length ?? 0) > 0) {
      throw new HttpsError('failed-precondition', 'Initial review was completed by another admin.');
    }

    const eventUpdate: Record<string, unknown> = {
      status: nextStatus,
      reviewStage: decision === 'Approved' ? 'initial' : 'closed',
      initialReview,
      updatedAt: now,
    };
    if (decision === 'Rejected') {
      eventUpdate.reviewStage = 'closed';
      eventUpdate.editableVersionId = `v${event.currentVersionNumber + 1}`;
      eventUpdate.draftDocumentPaths = [];
    }
    tx.update(eventRef, eventUpdate);

    const auditId = `initial_review_${versionId}_${now}`;
    tx.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), {
      id: auditId,
      eventId,
      versionId,
      action: 'decision_made',
      actorId: uid,
      actorRole: 'admin',
      timestamp: now,
      previousStatus: event.status,
      newStatus: nextStatus,
      notes: reason,
      metadata: {
        reviewStage: 'initial',
        decision,
        suggestion: suggestion || null,
        attachedOfficerFeedback: officerFeedback?.length ?? 0,
        manualAssessmentRecorded: manualOfficial,
      },
    });
    return { eventId, versionId, status: nextStatus, organizerId: event.organizerId };
  });

  if (decision === 'Rejected' && result.organizerId) {
    try {
      const recipientUid = await resolveAuthUid(result.organizerId);
      if (recipientUid) {
        await createNotification({
          recipientUid,
          eventId,
          versionId,
          type: 'application_rejected',
          title: 'Application rejected at initial review',
          message: `${reason}${suggestion ? `. ${suggestion}` : ''}`,
          sourceActionId: `initial_review_${versionId}`,
          reason,
          suggestion,
        });
      }
    } catch (error) {
      console.warn('[makeInitialReviewDecision] organiser notification failed (non-fatal):', error);
    }
  }
  return { eventId, versionId, assessmentId, status: result.status, decision, manualAssessmentRecorded: manualOfficial };
}

function isReadyAssessment(value: unknown, eventId?: string, versionId?: string, assessmentId?: string): value is RiskAssessment {
  if (!value || typeof value !== 'object') return false;
  const assessment = value as Record<string, unknown>;
  // The current M2 contract uses `official_ready` (the older M3 fixture used
  // `ready`). Accept only a current, non-manual assessment here so initial
  // review cannot release an incomplete or legacy record.
  return assessment.status === 'official_ready'
    && assessment.assessmentReadiness === 'complete'
    && Array.isArray(assessment.evidence)
    && (!eventId || assessment.eventId === eventId)
    && (!versionId || assessment.versionId === versionId)
    && (!assessmentId || assessment.assessmentId === assessmentId);
}

function isManualOfficialAssessment(value: unknown, eventId: string, versionId: string, assessmentId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const assessment = value as Record<string, unknown>;
  return assessment.status === 'official_ready'
    && assessment.sourceKind === 'admin_manual'
    && assessment.authorityReviewRequired === false
    && assessment.eventId === eventId
    && assessment.versionId === versionId
    && assessment.assessmentId === assessmentId
    && typeof assessment.activeManualAssessmentId === 'string'
    && assessment.activeManualAssessmentId.length > 0;
}

function safeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
