import { describe, expect, it } from 'vitest';
import { isManagedRealReviewFixture } from './makeSecondReviewDecision';

describe('managed review fixture publication guard', () => {
  it('recognises only the owned Module 3 fixture marker', () => {
    expect(isManagedRealReviewFixture({ sterasFixture: {
      datasetId: 'steras-module3-real-review-samples-v1',
      managedBy: 'seed:steras:real-review-samples',
    } } as never)).toBe(true);
    expect(isManagedRealReviewFixture({ sterasFixture: {
      datasetId: 'other-dataset', managedBy: 'seed:steras:real-review-samples',
    } } as never)).toBe(false);
  });
});
