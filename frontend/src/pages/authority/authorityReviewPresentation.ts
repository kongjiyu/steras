import { RiskAssessment } from '@shared/types';

export function activeScoreResolutionId(assessment: RiskAssessment | null | undefined): string | undefined {
  if (assessment?.status === 'official_ready' && !('sourceKind' in assessment && assessment.sourceKind === 'admin_manual')) {
    return (assessment as import('@shared/types').OfficialRiskAssessment).officialResult.resolutionId;
  }
  if (assessment?.status === 'authority_review') return assessment.authorityReviewState?.activeResolutionId;
  return undefined;
}
