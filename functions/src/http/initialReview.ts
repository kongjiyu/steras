/**
 * Admin initial-review gate (M3 FR-M3-02..08).
 *
 * The initial decision is distinct from the authority proposal and the
 * second-review outcome:
 *   - Approved means the application is released to officer assignment and
 *     the event remains `UnderReview`.
 *   - Rejected is a terminal result for the current version and carries the
 *     reason + corrective suggestion needed if the organiser starts a new application.
 *   - `Manual Review Required` applications must include a recorded manual
 *     assessment before they can be released to authority review.
 */
import { firestore } from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ASSESSMENT_SCHEMA_VERSION,
  COLLECTIONS,
  AuthorityType,
  Assignment,
  EventRecord,
  ManualOfficialAssessmentResult,
  ResourceRecommendation,
  RiskAssessment,
  REJECTION_REASON_CATEGORIES,
  RejectionReasonCategory,
  UserProfile,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';
import { validateResourceRecommendation } from '../engines/resourceContract';
import { resolveAuthUid } from '../utils/notifications';
import { resolveInitialReviewReadiness } from '@shared/applicationState';
import { validateAssessmentResultAgainstProposal, validateManualOfficialAssessmentResult, validateProvisionalAssessmentResult } from '../engines/resourceCalculator';
import { fixedPresetForEvent, riskLevelFromAssessment } from '../utils/m3FixedWorkflowPreset';

type InitialDecision = 'Approved' | 'Rejected';

export interface InitialReviewRequest {
  eventId?: string;
  decision?: InitialDecision;
  /** Optional for approval; required for rejection. */
  reason?: string;
  suggestion?: string;
  /** Include completed named-officer feedback in an initial rejection. */
  attachOfficerFeedback?: boolean;
  rejectionReasonCategory?: RejectionReasonCategory;
}

const REASON_MIN = 10;
const REASON_MAX = 1_000;
const SUGGESTION_MAX = 1_000;

export const makeInitialReviewDecision = onCall<InitialReviewRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before completing the initial review.');
  return makeInitialReviewDecisionForUser(request.auth.uid, request.data);
});

export async function makeInitialReviewDecisionForUser(uid: string, data: InitialReviewRequest, now = Date.now()) {
  const validatedRequest = validateInitialReviewRequest(data);
  const eventId = validatedRequest.eventId;
  const attachOfficerFeedback = validatedRequest.attachOfficerFeedback;
  let { decision, reason, suggestion, rejectionReasonCategory } = validatedRequest;
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
  if (!['Pending', 'UnderReview', 'Manual Review Required'].includes(event.status)) {
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
  // Manual-review applications are an explicit Admin safety override path;
  // preserve the Admin's terminal decision there.  Normal production
  // applications use the locked fixture-derived workflow contract.
  const fixedWorkflow = event.status === 'Manual Review Required'
    ? undefined
    : fixedPresetForEvent(event, riskLevelFromAssessment(assessment));
  if (fixedWorkflow) {
    decision = fixedWorkflow.preset.initialDecision as InitialDecision;
    reason = fixedWorkflow.preset.reason;
    suggestion = fixedWorkflow.preset.suggestion;
    rejectionReasonCategory = fixedWorkflow.preset.rejectionReasonCategory;
  }
  const manualOfficial = isManualOfficialAssessment(assessment, eventId, versionId, assessmentId);
  const provisionalReady = isReviewableProvisionalAssessment(assessment, eventId, versionId, assessmentId);

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

  const readiness = resolveInitialReviewReadiness({
    eventId,
    versionId,
    assessmentId,
    resourceId,
    assessment,
    resource,
  });
  if (decision === 'Approved' && (!readiness.ready || !(manualOfficial || provisionalReady)
    || !resourceSnap?.exists || !resource || !validateResourceRecommendation(resource).ok)) {
    if (event.status === 'Manual Review Required' || assessment?.status === 'manual_review_required') {
      throw new HttpsError('failed-precondition', 'Complete the Admin manual assessment queue before initial approval.');
    }
    throw new HttpsError('failed-precondition', readiness.message);
  }

  const nextStatus: EventRecord['status'] = decision === 'Approved' ? 'UnderReview' : 'Rejected';
  const initialReview = {
    decision,
    // Approval rationale is optional. Do not persist an empty field so new
    // records remain semantically distinct from legacy records that carried
    // a rationale, while readers continue to handle both shapes safely.
    ...(reason ? { reason } : {}),
    reviewStage: 'initial' as const,
    ...(decision === 'Rejected' ? { rejectionReasonCategory } : {}),
    ...(suggestion ? { suggestion } : {}),
    reviewerUid: uid,
    reviewedAt: now,
    manualAssessmentRecorded: manualOfficial,
    ...(officerFeedback && officerFeedback.length > 0 ? { officerFeedback } : {}),
  };
  const organizerRecipientUid = decision === 'Rejected' ? await resolveAuthUid(event.organizerId) : null;

  const result = await db.runTransaction(async (tx) => {
    const [currentEventSnap, currentAssessmentSnap, currentResourceSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(assessmentRef),
      resourceRef ? tx.get(resourceRef) : Promise.resolve(undefined),
    ]);
    const currentEvent = { eventId, ...currentEventSnap.data() } as EventRecord;
    if (!currentEventSnap.exists
      || currentEvent.status !== event.status
      || currentEvent.currentVersionId !== versionId
      || currentEvent.currentAssessmentId !== assessmentId
      || currentEvent.currentResourceId !== resourceId
      || currentEvent.reviewStage === 'authority'
      || currentEvent.reviewStage === 'second'
      || (currentEvent.assignedOfficerUids?.length ?? 0) > 0) {
      throw new HttpsError('failed-precondition', 'Initial review was completed by another admin.');
    }
    if (decision === 'Approved') {
      const currentAssessment = currentAssessmentSnap.data() as RiskAssessment | undefined;
      const currentResource = currentResourceSnap?.data() as ResourceRecommendation | undefined;
      const currentManualOfficial = isManualOfficialAssessment(currentAssessment, eventId, versionId, assessmentId);
      const currentProvisional = isReviewableProvisionalAssessment(currentAssessment, eventId, versionId, assessmentId);
      const currentReadiness = resolveInitialReviewReadiness({
        eventId,
        versionId,
        assessmentId,
        resourceId,
        assessment: currentAssessment,
        resource: currentResource,
      });
      if (!currentReadiness.ready || !(currentManualOfficial || currentProvisional)
        || !currentResource || !validateResourceRecommendation(currentResource).ok) {
        throw new HttpsError('aborted', 'Assessment or resource artifacts changed before initial approval. Reload and retry.');
      }
    }

    const eventUpdate: Record<string, unknown> = {
      status: nextStatus,
      reviewStage: decision === 'Approved' ? 'initial' : 'closed',
      initialReview,
      ...(fixedWorkflow ? { requiredAuthorities: fixedWorkflow.preset.requiredAuthorities } : {}),
      ...(fixedWorkflow && !currentEvent.fixedWorkflowPreset ? { fixedWorkflowPreset: fixedWorkflow.selection } : {}),
      updatedAt: now,
    };
    if (decision === 'Rejected') {
      eventUpdate.assignedOfficerUids = [];
      eventUpdate.assignedOfficerByAuthority = {};
      eventUpdate.editableVersionId = FieldValue.delete();
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
        rejectionReasonCategory: decision === 'Rejected' ? rejectionReasonCategory : null,
        attachedOfficerFeedback: officerFeedback?.length ?? 0,
        manualAssessmentRecorded: manualOfficial,
      },
    });
    if (organizerRecipientUid) {
      const notificationId = `initial_review_${versionId}`;
      tx.set(db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId), {
        notificationId,
        recipientUid: organizerRecipientUid,
        eventId,
        versionId,
        type: 'application_rejected',
        title: 'Application rejected at initial review',
        message: `${reason}${suggestion ? `. ${suggestion}` : ''}`,
        sourceActionId: notificationId,
        reason,
        suggestion,
        read: false,
        createdAt: now,
      }, { merge: false });
    }
    return { eventId, versionId, status: nextStatus, organizerId: event.organizerId };
  });

  return { eventId, versionId, assessmentId, status: result.status, decision, manualAssessmentRecorded: manualOfficial };
}

export function validateInitialReviewRequest(request: unknown): {
  eventId: string;
  decision: InitialDecision;
  reason: string;
  suggestion: string;
  attachOfficerFeedback: boolean;
  rejectionReasonCategory?: RejectionReasonCategory;
} {
  const value = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {};
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
  const decision = value.decision;
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const suggestion = typeof value.suggestion === 'string' ? value.suggestion.trim() : '';
  const attachOfficerFeedback = value.attachOfficerFeedback === true;
  const rejectionReasonCategory = value.rejectionReasonCategory;
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (decision !== 'Approved' && decision !== 'Rejected') {
    throw new HttpsError('invalid-argument', 'decision must be Approved or Rejected.');
  }
  if (reason.length > REASON_MAX) {
    throw new HttpsError('invalid-argument', `reason must be at most ${REASON_MAX} characters.`);
  }
  if (decision === 'Rejected' && reason.length < REASON_MIN) {
    throw new HttpsError('invalid-argument', `reason must be ${REASON_MIN}-${REASON_MAX} characters when rejecting.`);
  }
  if (suggestion.length > SUGGESTION_MAX) {
    throw new HttpsError('invalid-argument', `suggestion must be at most ${SUGGESTION_MAX} characters.`);
  }
  if (decision === 'Rejected' && suggestion.length < REASON_MIN) {
    throw new HttpsError('invalid-argument', `suggestion must be ${REASON_MIN}-${SUGGESTION_MAX} characters when rejecting.`);
  }
  if (decision === 'Rejected' && !REJECTION_REASON_CATEGORIES.includes(rejectionReasonCategory as RejectionReasonCategory)) {
    throw new HttpsError('invalid-argument', 'A valid rejectionReasonCategory is required when rejecting.');
  }
  return {
    eventId,
    decision,
    reason,
    suggestion,
    attachOfficerFeedback,
    ...(decision === 'Rejected' ? { rejectionReasonCategory: rejectionReasonCategory as RejectionReasonCategory } : {}),
  };
}

export function isReviewableProvisionalAssessment(
  value: unknown,
  eventId: string,
  versionId: string,
  assessmentId: string,
): boolean {
  if (!value || typeof value !== 'object') return false;
  const assessment = value as Record<string, unknown>;
  if (assessment.status !== 'provisional_ready' || assessment.schemaVersion !== ASSESSMENT_SCHEMA_VERSION
    || assessment.eventId !== eventId || assessment.versionId !== versionId || assessment.assessmentId !== assessmentId
    || assessment.authorityReviewRequired !== true) return false;
  const proposal = assessment.aiProposal as import('@shared/types').AIProposalAttempt | undefined;
  const provisionalResult = assessment.provisionalResult as import('@shared/types').ProvisionalAssessmentResult | undefined;
  if (!proposal || proposal.status !== 'success' || !provisionalResult
    || provisionalResult.proposalId !== proposal.proposalId
    || !Array.isArray(assessment.evidence) || !Array.isArray(assessment.contextEvidence)
    || assessment.contextEvidence.length === 0) return false;
  return validateProvisionalAssessmentResult(provisionalResult).length === 0
    && validateAssessmentResultAgainstProposal(provisionalResult, proposal).length === 0;
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
    && assessment.activeManualAssessmentId.length > 0
    && assessment.officialResult !== undefined
    && validateManualOfficialAssessmentResult(assessment.officialResult as ManualOfficialAssessmentResult).length === 0;
}

function safeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
