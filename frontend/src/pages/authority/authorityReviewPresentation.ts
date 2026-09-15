import { AssessmentRecord, EventRecord, RiskAssessment } from '@shared/types';

export function activeScoreResolutionId(assessment: RiskAssessment | null | undefined): string | undefined {
  if (assessment?.status === 'official_ready' && !('sourceKind' in assessment && assessment.sourceKind === 'admin_manual')) {
    return (assessment as import('@shared/types').OfficialRiskAssessment).officialResult.resolutionId;
  }
  if (assessment?.status === 'authority_review') return assessment.authorityReviewState?.activeResolutionId;
  return undefined;
}

export function authorityAssessmentPresentation(
  assessment: RiskAssessment | null,
  assessmentStatus: AssessmentRecord['status'] | null,
  eventStatus: EventRecord['status'],
  earlierVersion: boolean,
): { title: string; subtitle: string; emptyMessage: string } {
  if (assessment?.status === 'official_ready') {
    const manual = 'sourceKind' in assessment && assessment.sourceKind === 'admin_manual';
    return manual
      ? { title: 'Official manual assessment', subtitle: 'Admin-authored recovery assessment · no AI score proposal', emptyMessage: '' }
      : { title: 'Official AI-assisted assessment', subtitle: 'Finalized human-reviewed risk inputs with retained AI provenance', emptyMessage: '' };
  }
  if (assessment) return { title: 'Provisional category assessment', subtitle: 'Validated AI proposal · authority confirmation required', emptyMessage: '' };
  if (earlierVersion) return {
    title: 'Assessment recalculation required', subtitle: 'This application uses an earlier calculation version', emptyMessage: 'Recalculate the assessment before recording a decision.',
  };
  if (assessmentStatus === 'manual_review_required') return {
    title: 'Manual assessment required', subtitle: 'No calculated risk result is available', emptyMessage: 'An Admin must retry the AI assessment or complete a manual assessment before authority review can continue.',
  };
  if (assessmentStatus === 'failed') return {
    title: 'Assessment unavailable', subtitle: 'The assessment failed and requires recovery', emptyMessage: 'Assessment failed and requires an Admin retry.',
  };
  if (assessmentStatus === 'processing') return {
    title: 'Assessment processing', subtitle: 'Context and evidence are still being evaluated', emptyMessage: 'Assessment is still processing. Refresh later to view the result.',
  };
  if (['Approved', 'Rejected', 'Withdrawn', 'Cancelled'].includes(eventStatus)) return {
    title: 'Assessment record unavailable', subtitle: 'This application is no longer processing', emptyMessage: 'The saved assessment could not be found for this application version. An Admin must verify the record before further action.',
  };
  return { title: 'Assessment pending', subtitle: 'Waiting for an assessment record', emptyMessage: 'No assessment is available yet.' };
}
