import type { Assignment, RiskAssessment } from '@shared/types';

export function canEditAuthorityScores(input: {
  assignment: Assignment | undefined;
  reviewOpen: boolean;
  assessment: RiskAssessment | null;
  editing: boolean;
}): boolean {
  const { assignment, reviewOpen, assessment, editing } = input;
  return Boolean(!editing
    && reviewOpen
    && (assignment?.status === 'pending' || assignment?.status === 'in_progress')
    && assessment
    && (assessment.status === 'provisional_ready' || assessment.status === 'authority_review')
    && assessment.aiProposal?.status === 'success');
}
