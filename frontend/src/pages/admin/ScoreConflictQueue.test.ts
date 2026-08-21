import { describe, expect, it } from 'vitest';
import { ProvisionalRiskAssessment, SCORE_REVIEW_SCHEMA_VERSION } from '@shared/types';
import { isAuthorityScoreReview } from './ScoreConflictQueue';
import { mockAssessments } from '../../mock_data/assessments';

describe('isAuthorityScoreReview', () => {
  it('rejects a malformed overridden category without throwing', () => {
    const assessment = mockAssessments.find((item): item is ProvisionalRiskAssessment => item.status === 'provisional_ready')!;
    const categories = assessment.aiProposal.categories.map((category) => ({
      categoryId: category.categoryId,
      likelihood: category.likelihood,
      severity: category.severity,
      decision: 'confirmed' as const,
    }));
    const malformed = {
      schemaVersion: SCORE_REVIEW_SCHEMA_VERSION,
      reviewId: 'review-1',
      rationale: 'The complete evidence package was reviewed.',
      categories: [{ ...categories[0], decision: 'overridden', reason: null }, ...categories.slice(1)],
    };
    expect(() => isAuthorityScoreReview(malformed)).not.toThrow();
    expect(isAuthorityScoreReview(malformed)).toBe(false);
    expect(() => isAuthorityScoreReview({ ...malformed, categories: [null, ...categories.slice(1)] })).not.toThrow();
    expect(isAuthorityScoreReview({ ...malformed, categories: [null, ...categories.slice(1)] })).toBe(false);
  });
});
