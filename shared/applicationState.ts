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
