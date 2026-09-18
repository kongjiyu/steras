import type {
  ApplicationDecision,
  Assignment,
  AuthorityDecision,
  AssessmentReadiness,
  AssessmentStatus,
  AuthorityType,
  ComplianceStatus,
  EventRecord,
  EventStatus,
} from './types';

/**
 * Human-facing workflow labels. These are deliberately separate from the
 * persisted EventStatus union: a single persisted status (notably
 * `UnderReview`) covers several distinct M3 hand-offs.
 */
export type ApplicationDisplayState =
  | 'Draft'
  | 'Pending'
  | 'Initial Review'
  | 'Manual Review Required'
  | 'Authority Selection'
  | 'Under Review'
  | 'Final Review'
  | 'Approved'
  | 'Documentation Required'
  | 'Rejected'
  | 'Cancelled'
  | 'Withdrawn';

export const APPLICATION_DISPLAY_STATE_LABELS: Record<ApplicationDisplayState, string> = {
  Draft: 'Draft',
  Pending: 'Pending',
  'Initial Review': 'Initial Review',
  'Manual Review Required': 'Manual Review Required',
  'Authority Selection': 'Authority Selection',
  'Under Review': 'Under Review',
  'Final Review': 'Final Review',
  Approved: 'Approved',
  'Documentation Required': 'Documentation Required',
  Rejected: 'Rejected',
  Cancelled: 'Cancelled',
  Withdrawn: 'Withdrawn',
};

/** Minimal, serialisable input accepted by the pure state resolver. */
export interface ApplicationDisplaySnapshot {
  status: EventStatus;
  reviewStage?: EventRecord['reviewStage'];
  submittedAt?: number;
  currentVersionId?: string;
  currentAssessmentId?: string;
  currentResourceId?: string;
  controlListGenerated?: boolean;
  initialReview?: EventRecord['initialReview'];
  requiredAuthorities?: readonly AuthorityType[];
  assignedOfficerUids?: readonly string[];
  assessmentStatus?: AssessmentStatus;
  assessmentReadiness?: AssessmentReadiness;
  assignments?: readonly Pick<Assignment, 'versionId' | 'authorityType' | 'status' | 'decision'>[];
  decisions?: readonly Pick<AuthorityDecision, 'versionId' | 'authorityType' | 'current' | 'decision'>[];
}

/**
 * The single readiness contract used by both the Admin page and the initial
 * review callable.  It intentionally accepts a small serialisable projection
 * rather than Firestore types so stale/mismatched generations can be checked
 * in every client without duplicating the workflow rules.
 */
export interface InitialReviewReadinessInput {
  eventId: string;
  versionId?: string;
  assessmentId?: string;
  resourceId?: string;
  assessment?: {
    status?: AssessmentStatus;
    assessmentReadiness?: AssessmentReadiness;
    authorityReviewRequired?: boolean;
    sourceKind?: string;
    eventId?: string;
    versionId?: string;
    assessmentId?: string;
    complianceStatus?: ComplianceStatus;
  } | null;
  resource?: {
    resourceId?: string;
    eventId?: string;
    versionId?: string;
    assessmentId?: string;
    stage?: 'provisional' | 'official';
  } | null;
}

export type InitialReviewReadinessReason =
  | 'missing_assessment'
  | 'assessment_not_ready'
  | 'assessment_identity_mismatch'
  | 'compliance_blocked'
  | 'resource_missing'
  | 'resource_identity_mismatch'
  | 'resource_stage_mismatch'
  | 'manual_not_finalized'
  | 'official_ai_not_allowed';

export interface InitialReviewReadiness {
  ready: boolean;
  reason?: InitialReviewReadinessReason;
  message: string;
}

export interface OfficerDecisionReadinessInput {
  eventId: string;
  versionId?: string;
  assessmentId?: string;
  resourceId?: string;
  authorityType: AuthorityType;
  eventStatus?: EventStatus;
  reviewStage?: EventRecord['reviewStage'];
  assignment?: {
    assignmentId?: string;
    eventId?: string;
    versionId?: string;
    authorityType?: AuthorityType;
    officerUid?: string;
    status?: Assignment['status'];
  } | null;
  officerUid?: string;
  assessment?: {
    status?: AssessmentStatus;
    sourceKind?: string;
    eventId?: string;
    versionId?: string;
    assessmentId?: string;
    authorityReviewRequired?: boolean;
    complianceStatus?: ComplianceStatus;
    authorityReviewState?: {
      activeReviewHeads?: Partial<Record<AuthorityType, { reviewId?: string }>>;
    };
    officialResult?: object | null;
  } | null;
  resource?: {
    resourceId?: string;
    eventId?: string;
    versionId?: string;
    assessmentId?: string;
    stage?: 'provisional' | 'official';
  } | null;
  requiredAuthorities?: readonly AuthorityType[];
}

export type OfficerDecisionReadinessReason =
  | 'review_closed'
  | 'not_assigned'
  | 'assignment_mismatch'
  | 'assessment_missing'
  | 'assessment_identity_mismatch'
  | 'resource_missing'
  | 'resource_identity_mismatch'
  | 'manual_not_finalized'
  | 'own_score_review_required'
  | 'other_score_reviews_pending'
  | 'score_review_record_missing'
  | 'officialisation_pending'
  | 'compliance_blocked';

export interface OfficerDecisionReadiness {
  ready: boolean;
  reason?: OfficerDecisionReadinessReason;
  message: string;
}

/** Resolve the exact blocker for an officer application decision. This is a
 * pure, serialisable rule shared by the Authority UI and callable fences. */
export function resolveOfficerDecisionReadiness(input: OfficerDecisionReadinessInput): OfficerDecisionReadiness {
  if (input.eventStatus !== 'UnderReview' || input.reviewStage !== 'authority') {
    return { ready: false, reason: 'review_closed', message: 'Officer decisions are available only during Authority Review.' };
  }
  const assignment = input.assignment;
  if (!assignment || assignment.status === 'revoked') {
    return { ready: false, reason: 'not_assigned', message: 'You are not assigned to this authority review.' };
  }
  if ((assignment.assignmentId !== undefined && assignment.assignmentId !== `${input.versionId}_${input.authorityType}`)
    || assignment.eventId !== input.eventId || assignment.versionId !== input.versionId
    || assignment.authorityType !== input.authorityType
    || (input.officerUid !== undefined && assignment.officerUid !== input.officerUid)) {
    return { ready: false, reason: 'assignment_mismatch', message: 'Your current officer assignment does not match this application version.' };
  }
  const assessment = input.assessment;
  if (!assessment) return { ready: false, reason: 'assessment_missing', message: 'The official M2 assessment is not available yet.' };
  if (assessment.eventId !== input.eventId || assessment.versionId !== input.versionId || assessment.assessmentId !== input.assessmentId) {
    return { ready: false, reason: 'assessment_identity_mismatch', message: 'The M2 assessment does not match the current application version.' };
  }
  if (assessment.complianceStatus === 'blocked') {
    return { ready: false, reason: 'compliance_blocked', message: 'Approval is blocked while compliance checks remain blocked.' };
  }
  const isManual = assessment.sourceKind === 'admin_manual';
  const heads = assessment.authorityReviewState?.activeReviewHeads ?? {};
  const required = input.requiredAuthorities ?? [];
  const ownReviewId = heads[input.authorityType]?.reviewId;
  const allRequiredHeadsPresent = required.length === 0
    ? Boolean(ownReviewId)
    : required.every((authority) => Boolean(heads[authority]?.reviewId));

  // An assessment marked official must carry a coherent set of score-review
  // heads and the review ids used to finalise it. If that provenance is
  // missing, do not send an officer back into an editor that cannot repair an
  // already-finalised record; show the integrity blocker instead.
  if (!isManual && assessment.status === 'official_ready') {
    const officialReviewIds = isRecord(assessment.officialResult) && Array.isArray(assessment.officialResult.reviewIds)
      ? assessment.officialResult.reviewIds.filter((value): value is string => typeof value === 'string') : [];
    const officialIdsMatch = allRequiredHeadsPresent
      && officialReviewIds.length > 0
      && required.every((authority) => {
        const reviewId = heads[authority]?.reviewId;
        return Boolean(reviewId && officialReviewIds.includes(reviewId));
      });
    if (!ownReviewId || !allRequiredHeadsPresent || !officialIdsMatch) {
      return {
        ready: false,
        reason: 'score_review_record_missing',
        message: 'The current score-review record is missing or inconsistent. Reload the application or ask an Admin to repair the review record.',
      };
    }
  }

  const resource = input.resource;
  if (!resource) return { ready: false, reason: 'resource_missing', message: 'The matching official resource recommendation is not available yet.' };
  if (resource.resourceId !== input.resourceId || resource.eventId !== input.eventId
    || resource.versionId !== input.versionId || resource.assessmentId !== input.assessmentId) {
    return { ready: false, reason: 'resource_identity_mismatch', message: 'The resource recommendation does not match the current application version.' };
  }
  if (!isManual && (assessment.status === 'provisional_ready' || assessment.status === 'authority_review')) {
    if (resource.stage !== 'provisional') {
      return { ready: false, reason: 'resource_identity_mismatch', message: 'The provisional resource recommendation does not match the current M2 assessment.' };
    }
    // Unchanged AI scores are implicitly confirmed by the officer's decision.
    // A separate score-review action is only needed when the officer wants to
    // override a category. Other authorities may still be collecting their
    // reviews; finalisation is deferred until every assignment is decided.
    return { ready: true, message: 'The current provisional assessment is ready. Reviewing AI scores is optional unless you want to change them.' };
  }
  if (resource.stage !== 'official' || assessment.status !== 'official_ready') {
    return { ready: false, reason: 'manual_not_finalized', message: 'Wait for M2 official assessment finalisation before recording a decision.' };
  }
  if (isManual) {
    return { ready: true, message: 'The Admin manual assessment and official resources are ready.' };
  }
  const officialReviewIds = isRecord(assessment.officialResult) && Array.isArray(assessment.officialResult.reviewIds)
    ? assessment.officialResult.reviewIds.filter((value): value is string => typeof value === 'string') : [];
  if (!officialReviewIds.includes(ownReviewId!)) {
    return { ready: false, reason: 'officialisation_pending', message: 'All score reviews are present, but M2 officialisation is still pending.' };
  }
  return { ready: true, message: 'The official assessment and resources are ready.' };
}

/** Resolve whether the current M2 generation may enter Admin initial review. */
export function resolveInitialReviewReadiness(input: InitialReviewReadinessInput): InitialReviewReadiness {
  const assessment = input.assessment;
  if (!assessment) return { ready: false, reason: 'missing_assessment', message: 'The current M2 assessment is not available yet.' };
  if (assessment.eventId !== input.eventId || assessment.versionId !== input.versionId || assessment.assessmentId !== input.assessmentId) {
    return { ready: false, reason: 'assessment_identity_mismatch', message: 'The current M2 assessment generation does not match this application version.' };
  }
  if (assessment.complianceStatus === 'blocked') {
    return { ready: false, reason: 'compliance_blocked', message: 'Compliance checks block initial approval until the issue is resolved.' };
  }

  const manualOfficial = assessment.status === 'official_ready' && assessment.sourceKind === 'admin_manual';
  if (assessment.status === 'official_ready' && !manualOfficial) {
    return { ready: false, reason: 'official_ai_not_allowed', message: 'Authority-finalized AI assessments cannot be released from initial review.' };
  }
  if (manualOfficial) {
    // A manual-official result may intentionally retain the originating
    // `insufficient_data` readiness (the Admin supplied the missing inputs).
    // The callable performs the deeper locked-manual/result validation; this
    // shared resolver only needs to recognise the resulting official source
    // and its matching official resource.
    if (assessment.authorityReviewRequired !== false) {
      return { ready: false, reason: 'manual_not_finalized', message: 'Complete the Admin manual assessment before initial approval.' };
    }
    if (!input.resource) return { ready: false, reason: 'resource_missing', message: 'The matching official resource recommendation is missing.' };
    if (input.resource.stage !== 'official') return { ready: false, reason: 'resource_stage_mismatch', message: 'The manual-official assessment requires an official resource recommendation.' };
  } else {
    const aiReady = assessment.status === 'provisional_ready'
      && (assessment.assessmentReadiness === 'complete' || assessment.assessmentReadiness === 'provisional')
      && assessment.authorityReviewRequired === true;
    if (!aiReady) return { ready: false, reason: 'assessment_not_ready', message: 'The current M2 assessment is not ready for Admin initial review.' };
    if (!input.resource) return { ready: false, reason: 'resource_missing', message: 'The matching provisional resource recommendation is missing.' };
    if (input.resource.stage !== 'provisional') return { ready: false, reason: 'resource_stage_mismatch', message: 'Initial approval requires a provisional resource recommendation.' };
  }

  if (!input.resourceId || input.resource.resourceId !== input.resourceId
    || input.resource.eventId !== input.eventId
    || input.resource.versionId !== input.versionId
    || input.resource.assessmentId !== input.assessmentId) {
    return { ready: false, reason: 'resource_identity_mismatch', message: 'The resource recommendation does not match the current application generation.' };
  }
  return { ready: true, message: manualOfficial ? 'Manual assessment and official resources are ready.' : 'M2 assessment and provisional resources are ready.' };
}

const TERMINAL_STATES = new Set<ApplicationDisplayState>(['Rejected', 'Cancelled', 'Withdrawn']);

/**
 * Resolve the current user-facing workflow state without mutating or
 * interpreting persisted data as a new schema. Current-version assignments
 * and decisions are considered before legacy decision documents.
 */
export function resolveApplicationDisplayState(input: ApplicationDisplaySnapshot): ApplicationDisplayState {
  const { status } = input;
  if (status === 'Draft') return 'Draft';
  if (status === 'Cancelled') return 'Cancelled';
  if (status === 'Withdrawn') return 'Withdrawn';
  if (status === 'Rejected') return 'Rejected';
  if (status === 'Approved') return input.controlListGenerated === true ? 'Documentation Required' : 'Approved';

  const versionId = input.currentVersionId;
  const required = [...(input.requiredAuthorities ?? [])];
  const assignments = (input.assignments ?? []).filter((assignment) => !versionId || assignment.versionId === versionId);
  const decisions = (input.decisions ?? []).filter((decision) => (!versionId || decision.versionId === versionId) && decision.current);
  const completedAuthorities = new Set<AuthorityType>();
  for (const assignment of assignments) {
    if (assignment.status === 'completed' && assignment.decision) completedAuthorities.add(assignment.authorityType);
  }
  for (const decision of decisions) completedAuthorities.add(decision.authorityType);
  const allAuthoritiesDecided = required.length > 0 && required.every((authority) => completedAuthorities.has(authority));

  // A server-side second-review marker is authoritative. The assignment
  // fallback covers legacy records where that marker was not written.
  if (input.reviewStage === 'second' || allAuthoritiesDecided) return 'Final Review';
  if (input.reviewStage === 'authority' || assignments.some((assignment) => assignment.status !== 'revoked')) return 'Under Review';

  if (input.initialReview?.decision === 'Approved'
    || (status === 'UnderReview' && input.reviewStage === 'initial')) {
    return 'Authority Selection';
  }

  if (status === 'Manual Review Required' || input.reviewStage === 'manual' || input.assessmentStatus === 'manual_review_required') {
    return 'Manual Review Required';
  }

  const assessmentReady = input.assessmentStatus === 'provisional_ready'
    || input.assessmentStatus === 'authority_review'
    || input.assessmentStatus === 'official_ready'
    || Boolean(input.currentAssessmentId && input.currentResourceId);
  if (assessmentReady) return 'Initial Review';
  return 'Pending';
}

export function applicationDisplayStateLabel(state: ApplicationDisplayState): string {
  return APPLICATION_DISPLAY_STATE_LABELS[state];
}

export function persistedStatusLabel(status: EventStatus): string {
  return status === 'UnderReview' ? 'Under Review' : status;
}

export function isTerminalApplicationDisplayState(state: ApplicationDisplayState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isApplicationDecision(value: unknown): value is ApplicationDecision {
  return value === 'Approved' || value === 'Rejected';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
