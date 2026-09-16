import { describe, expect, it } from 'vitest';
import { resolveApplicationDisplayState } from '@shared/applicationState';

const base = {
  status: 'Pending' as const,
  currentVersionId: 'v1',
  currentAssessmentId: 'assessment-v1',
  currentResourceId: 'resource-v1',
  requiredAuthorities: ['PDRM', 'BOMBA'] as const,
};

describe('shared application display state', () => {
  it('distinguishes initial review, authority selection, authority review, and final review', () => {
    expect(resolveApplicationDisplayState({ ...base, assessmentStatus: 'provisional_ready' })).toBe('Initial Review');
    expect(resolveApplicationDisplayState({ ...base, status: 'UnderReview', reviewStage: 'initial', initialReview: { decision: 'Approved', reason: 'Ready', reviewerUid: 'admin', reviewedAt: 1 } })).toBe('Authority Selection');
    expect(resolveApplicationDisplayState({ ...base, status: 'UnderReview', reviewStage: 'authority', initialReview: { decision: 'Approved', reason: 'Ready', reviewerUid: 'admin', reviewedAt: 1 }, assignments: [{ versionId: 'v1', authorityType: 'PDRM', status: 'pending' }] })).toBe('Under Review');
    expect(resolveApplicationDisplayState({ ...base, status: 'UnderReview', reviewStage: 'second', initialReview: { decision: 'Approved', reason: 'Ready', reviewerUid: 'admin', reviewedAt: 1 } })).toBe('Final Review');
  });

  it('keeps manual and terminal states explicit, including documentation required', () => {
    expect(resolveApplicationDisplayState({ ...base, status: 'Manual Review Required', reviewStage: 'manual' })).toBe('Manual Review Required');
    expect(resolveApplicationDisplayState({ ...base, status: 'Approved', controlListGenerated: false })).toBe('Approved');
    expect(resolveApplicationDisplayState({ ...base, status: 'Approved', controlListGenerated: true })).toBe('Documentation Required');
    expect(resolveApplicationDisplayState({ ...base, status: 'Cancelled' })).toBe('Cancelled');
    expect(resolveApplicationDisplayState({ ...base, status: 'Withdrawn' })).toBe('Withdrawn');
    expect(resolveApplicationDisplayState({ ...base, status: 'Rejected' })).toBe('Rejected');
  });
});
