import { ManualReviewRiskAssessment } from '@shared/types';

type ManualEligibilityFields = Pick<ManualReviewRiskAssessment, 'aiProposal' | 'assessmentReadiness' | 'contextEvidence'>;

export function isAdminManualEligible(assessment: ManualEligibilityFields): boolean {
  if (!hasValidEligibleStorageEvidence(assessment.contextEvidence)) return false;
  if (assessment.aiProposal === null) return assessment.assessmentReadiness === 'insufficient_data';
  const attempt = assessment.aiProposal;
  if (!attempt || typeof attempt !== 'object') return false;
  if (attempt.status === 'success' || !['unavailable', 'timeout', 'invalid'].includes(String(attempt.status))) return false;
  return typeof attempt.model === 'string' && Boolean(attempt.model.trim())
    && typeof attempt.promptVersion === 'string' && Boolean(attempt.promptVersion.trim())
    && typeof attempt.responseSchemaVersion === 'string' && Boolean(attempt.responseSchemaVersion.trim())
    && typeof attempt.retryable === 'boolean'
    && typeof attempt.errorSummary === 'string' && Boolean(attempt.errorSummary.trim())
    && attempt.cacheStatus === 'not-applicable'
    && Number.isFinite(attempt.generatedAt);
}

function hasValidEligibleStorageEvidence(evidence: ManualReviewRiskAssessment['contextEvidence']): boolean {
  let found = false;
  for (const item of evidence) {
    if (item.sourceKind !== 'submitted_document' || item.eligibility !== 'eligible') continue;
    found = true;
    if (!/^storage-generation:\d+$/.test(item.sourceVersion)) return false;
  }
  return found;
}
