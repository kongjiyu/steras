import { describe, expect, it } from 'vitest';
import { authorityAssessmentPresentation } from './authorityReviewPresentation';

describe('authorityAssessmentPresentation', () => {
  it('surfaces manual review instead of calling it processing', () => {
    const result = authorityAssessmentPresentation(null, 'manual_review_required', 'UnderReview', false);
    expect(result.title).toBe('Manual assessment required');
    expect(result.emptyMessage).toContain('Admin');
  });

  it('does not call a terminal record processing when its assessment is missing', () => {
    const result = authorityAssessmentPresentation(null, null, 'Approved', false);
    expect(result.title).toBe('Assessment record unavailable');
    expect(result.subtitle).toContain('no longer processing');
  });
});
