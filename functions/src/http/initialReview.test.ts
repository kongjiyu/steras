import { describe, expect, it } from 'vitest';
import { makeInitialReviewDecisionForUser } from './initialReview';

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
