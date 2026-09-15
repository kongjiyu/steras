import { describe, expect, it } from 'vitest';
import { shouldReopenDecisionAfterScoreRevision } from './authorityScoreReview';

describe('authority score revision decision handling', () => {
  it('reopens a completed assignment that already has a decision', () => {
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'completed', decision: 'Approved' })).toBe(true);
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'completed', decision: 'Rejected' })).toBe(true);
  });

  it('leaves undecided work in its existing assignment state', () => {
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'pending' })).toBe(false);
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'in_progress' })).toBe(false);
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'completed' })).toBe(false);
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'revoked', decision: 'Approved' })).toBe(false);
  });
});
