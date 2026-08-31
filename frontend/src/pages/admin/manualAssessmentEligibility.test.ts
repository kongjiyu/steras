import { describe, expect, it } from 'vitest';
import type { ManualReviewRiskAssessment } from '@shared/types';
import { isAdminManualEligible } from './manualAssessmentEligibility';

const base = {
  aiProposal: null,
  assessmentReadiness: 'insufficient_data',
  contextEvidence: [{
    evidenceId: 'evidence-1',
    evidenceKey: 'compliance',
    sourceKind: 'submitted_document',
    sourceLocator: 'event_documents/event-1/v1/evidence.pdf',
    retrievedAt: 1,
    sourceVersion: 'storage-generation:1',
    eligibility: 'eligible',
    synthetic: true,
    visibility: 'authority_only',
  }],
} as Pick<ManualReviewRiskAssessment, 'aiProposal' | 'assessmentReadiness' | 'contextEvidence'>;

describe('Admin manual assessment eligibility', () => {
  it('accepts an insufficient-data assessment with eligible versioned Storage evidence', () => {
    expect(isAdminManualEligible(base)).toBe(true);
  });

  it('hides malformed fixtures that the callable would reject', () => {
    expect(isAdminManualEligible({
      ...base,
      contextEvidence: [{ ...base.contextEvidence[0], sourceVersion: 'steras-test-v1' }],
    })).toBe(false);
  });

  it('requires at least one eligible submitted document', () => {
    expect(isAdminManualEligible({ ...base, contextEvidence: [] })).toBe(false);
  });
});
