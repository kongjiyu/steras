import { describe, expect, it } from 'vitest';
import { makeInitialReviewDecisionForUser, validateInitialReviewRequest } from './initialReview';
import { resolveInitialReviewReadiness } from '@shared/applicationState';

describe('makeInitialReviewDecisionForUser', () => {
  it('keeps inline legacy manual assessments out of the initial-review command', async () => {
    await expect(makeInitialReviewDecisionForUser('admin-1', {
      eventId: 'event-1',
      decision: 'Approved',
      reason: 'The submitted evidence and operational plan are ready for review.',
      manualAssessment: {} as never,
    } as never)).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('validateInitialReviewRequest', () => {
  it('allows an approval without a reason', () => {
    expect(validateInitialReviewRequest({ eventId: 'event-1', decision: 'Approved' })).toMatchObject({
      eventId: 'event-1', decision: 'Approved', reason: '', suggestion: '',
    });
  });

  it('requires a reason and constructive suggestion for rejection', () => {
    expect(() => validateInitialReviewRequest({ eventId: 'event-1', decision: 'Rejected' })).toThrow(/reason must be/i);
    expect(() => validateInitialReviewRequest({ eventId: 'event-1', decision: 'Rejected', reason: 'Sufficient rejection reason.' })).toThrow(/suggestion/i);
  });
});

describe('shared initial-review readiness', () => {
  const generation = {
    eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', resourceId: 'r1',
    assessment: { eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', status: 'provisional_ready' as const, assessmentReadiness: 'provisional' as const, authorityReviewRequired: true, complianceStatus: 'pass' as const },
    resource: { resourceId: 'r1', eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', stage: 'provisional' as const },
  };

  it('accepts a valid provisional generation and rejects an authority-finalized AI record', () => {
    expect(resolveInitialReviewReadiness(generation).ready).toBe(true);
    expect(resolveInitialReviewReadiness({ ...generation, assessment: { ...generation.assessment, status: 'official_ready' } }).reason).toBe('official_ai_not_allowed');
  });
});
