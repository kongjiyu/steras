import {
  Assignment,
  AuthorityDecision,
  AuthorityType,
  EventRecord,
  EventStatus,
  EventVersion,
  RiskAssessment,
} from '@shared/types';
import { persistedStatusLabel } from '@shared/applicationState';

export const ADMIN_STATUS_LABELS: Record<EventStatus, string> = {
  Draft: 'Draft',
  Pending: 'Pending',
  UnderReview: 'Under Review',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Cancelled: 'Cancelled',
  Withdrawn: 'Withdrawn',
  'Manual Review Required': 'Manual Review Required',
};

export function friendlyAdminStatus(status: EventStatus): string {
  return persistedStatusLabel(status);
}

export function friendlyRiskLevel(level?: string): string {
  if (!level) return 'Risk pending';
  return level;
}

export type AdminWorkflowStepState = 'complete' | 'active' | 'pending' | 'skipped' | 'rejected';

export interface AdminWorkflowStep {
  id: 'submitted' | 'assessment' | 'initial' | 'authority' | 'final';
  label: 'Submitted' | 'M2 Assessment' | 'Initial Review' | 'Authority Review' | 'Final Decision';
  state: AdminWorkflowStepState;
  detail: string;
}

export interface AdminWorkflowResult {
  steps: AdminWorkflowStep[];
  completedCount: number;
  terminal: boolean;
  terminalLabel?: string;
}

const TERMINAL_STATUSES = new Set<EventStatus>(['Approved', 'Rejected', 'Cancelled', 'Withdrawn']);

export function deriveAdminWorkflow(
  event: Pick<EventRecord, 'status' | 'submittedAt' | 'currentVersionId' | 'reviewStage' | 'initialReview' | 'requiredAuthorities'>,
  assessment: RiskAssessment | null | undefined,
  version: EventVersion | null | undefined,
  assignments: Assignment[],
  decisions: AuthorityDecision[] = [],
): AdminWorkflowResult {
  const currentVersionId = event.currentVersionId ?? version?.versionId;
  const currentAssignments = assignments.filter((assignment) => assignment.versionId === currentVersionId);
  const required = event.requiredAuthorities ?? [];
  const currentDecisions = new Map<AuthorityType, AuthorityDecision>();
  for (const decision of decisions) {
    if (decision.versionId === currentVersionId && decision.current) currentDecisions.set(decision.authorityType, decision);
  }
  for (const assignment of currentAssignments) {
    if (assignment.status === 'completed' && assignment.decision) {
      currentDecisions.set(assignment.authorityType, {
        decisionId: assignment.assignmentId,
        eventId: assignment.eventId,
        versionId: assignment.versionId,
        authorityType: assignment.authorityType,
        decision: assignment.decision,
        rationale: assignment.reason ?? '',
        suggestion: assignment.suggestion,
        reviewerId: assignment.officerUid,
        decidedAt: assignment.decidedAt ?? assignment.assignedAt,
        current: true,
      });
    }
  }

  const submitted = Boolean(event.submittedAt || version || currentVersionId);
  const assessmentReady = assessment?.status === 'provisional_ready'
    || assessment?.status === 'authority_review'
    || assessment?.status === 'official_ready';
  const assessmentInProgress = !assessment || assessment.status === 'manual_review_required';
  const initialReviewActive = event.status === 'Pending' && assessmentReady && !assessmentInProgress;
  const initialApproved = event.initialReview?.decision === 'Approved';
  const initialRejected = event.initialReview?.decision === 'Rejected'
    || (event.status === 'Rejected' && event.reviewStage === 'closed' && !initialApproved && currentDecisions.size === 0);
  const authorityStarted = event.reviewStage === 'authority' || event.reviewStage === 'second'
    || currentAssignments.length > 0 || currentDecisions.size > 0;
  const authorityComplete = required.length > 0
    && required.every((authority) => {
      const assignment = currentAssignments.find((candidate) => candidate.authorityType === authority);
      return Boolean((assignment && assignment.status === 'completed' && assignment.decision) || currentDecisions.has(authority));
    });
  const finalComplete = event.status === 'Approved' || event.status === 'Rejected';
  const terminal = TERMINAL_STATUSES.has(event.status);
  const earlyTerminal = event.status === 'Cancelled' || event.status === 'Withdrawn' || initialRejected;
  const finalReview = event.reviewStage === 'second' || authorityComplete;

  const steps: AdminWorkflowStep[] = [
    {
      id: 'submitted',
      label: 'Submitted',
      state: submitted ? 'complete' : 'active',
      detail: submitted ? 'Application received' : 'Awaiting submission',
    },
    {
      id: 'assessment',
      label: 'M2 Assessment',
      state: earlyTerminal ? 'skipped' : assessmentReady ? 'complete' : assessmentInProgress ? 'active' : 'pending',
      detail: earlyTerminal ? 'Not reached' : assessmentReady ? 'Assessment ready' : assessmentInProgress ? 'Assessment in progress' : 'Waiting for M2',
    },
    {
      id: 'initial',
      label: 'Initial Review',
      state: earlyTerminal && !initialRejected ? 'skipped' : initialRejected ? 'rejected' : initialApproved ? 'complete' : initialReviewActive ? 'active' : 'pending',
      detail: initialRejected ? 'Rejected at initial review' : initialApproved ? 'Released to authorities' : earlyTerminal ? 'Not reached' : 'Admin review pending',
    },
    {
      id: 'authority',
      label: 'Authority Review',
      state: earlyTerminal ? 'skipped' : authorityComplete ? (Array.from(currentDecisions.values()).some((decision) => decision.decision === 'Rejected') ? 'rejected' : 'complete') : authorityStarted ? 'active' : 'pending',
      detail: earlyTerminal ? 'Not reached' : authorityComplete ? 'Officer decisions recorded' : authorityStarted ? 'Officer review in progress' : 'Waiting for assignment',
    },
    {
      id: 'final',
      label: 'Final Decision',
      state: finalComplete ? (event.status === 'Rejected' ? 'rejected' : 'complete') : earlyTerminal ? 'skipped' : finalReview ? 'active' : terminal ? 'skipped' : 'pending',
      detail: finalComplete ? friendlyAdminStatus(event.status) : event.status === 'Cancelled' || event.status === 'Withdrawn' ? `${friendlyAdminStatus(event.status)} · workflow ended` : finalReview ? 'Admin confirmation pending' : 'Not yet reached',
    },
  ];
  return {
    steps,
    completedCount: steps.filter((step) => step.state === 'complete' || step.state === 'rejected').length,
    terminal,
    terminalLabel: terminal ? friendlyAdminStatus(event.status) : undefined,
  };
}

export interface AdminAuthorityProgressRow {
  authority: AuthorityType;
  scoreStatus: 'reviewed' | 'pending' | 'manual_official' | 'record_missing';
  decisionStatus: 'approved' | 'rejected' | 'pending';
  assignmentStatus: 'not_assigned' | 'assigned' | 'completed';
}

export function deriveAuthorityProgress(
  event: Pick<EventRecord, 'currentVersionId' | 'requiredAuthorities'>,
  assessment: RiskAssessment | null | undefined,
  assignments: Assignment[],
  decisions: AuthorityDecision[] = [],
): AdminAuthorityProgressRow[] {
  const currentVersionId = event.currentVersionId;
  const heads = assessment && 'authorityReviewState' in assessment ? assessment.authorityReviewState?.activeReviewHeads ?? {} : {};
  const currentAssignments = assignments.filter((assignment) => assignment.versionId === currentVersionId);
  return (event.requiredAuthorities ?? []).map((authority) => {
    const assignment = currentAssignments.find((candidate) => candidate.authorityType === authority);
    const decision = assignment?.status === 'completed' && assignment.decision
      ? assignment.decision
      : decisions.find((candidate) => candidate.versionId === currentVersionId && candidate.current && candidate.authorityType === authority)?.decision;
    const assignmentStatus = !assignment || assignment.status === 'revoked'
      ? 'not_assigned' as const
      : assignment.status === 'completed' ? 'completed' as const : 'assigned' as const;
    const hasCurrentAssignment = assignmentStatus !== 'not_assigned';
    return {
      authority,
      // A score head without a matching current-version assignment is not an
      // officer review. This prevents pre-assignment fixtures from appearing
      // reviewed merely because M2 generated synthetic heads.
      scoreStatus: assessment?.status === 'official_ready' && 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual'
        ? 'manual_official'
        : hasCurrentAssignment && Boolean(heads[authority]?.reviewId)
          ? 'reviewed'
          : hasCurrentAssignment && assignments.some((candidate) => candidate.versionId === currentVersionId && candidate.authorityType === authority && candidate.status === 'completed')
            ? 'record_missing'
            : 'pending',
      decisionStatus: decision === 'Approved' ? 'approved' : decision === 'Rejected' ? 'rejected' : 'pending',
      assignmentStatus,
    };
  });
}

export function friendlyDecisionStatus(status: AdminAuthorityProgressRow['decisionStatus']): string {
  return status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Decision pending';
}
