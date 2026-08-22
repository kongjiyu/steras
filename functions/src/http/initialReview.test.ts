import { describe, expect, it } from 'vitest';
import { validateManualAssessment } from './initialReview';

describe('validateManualAssessment', () => {
  it('accepts a score whose risk band matches the manual risk level', () => {
    expect(validateManualAssessment({
      score: 72,
      riskLevel: 'High',
      inputs: { attendanceReviewed: true, notes: 'Admin review' },
      rationale: 'Manual review considered the submitted evidence and venue conditions.',
    })).toMatchObject({ score: 72, riskLevel: 'High' });
  });

  it('rejects an inconsistent risk band and empty inputs', () => {
    expect(() => validateManualAssessment({
      score: 72,
      riskLevel: 'Medium',
      inputs: { attendanceReviewed: true },
      rationale: 'Manual review considered the submitted evidence and venue conditions.',
    })).toThrow(/must match the score band/i);
    expect(() => validateManualAssessment({
      score: 42,
      riskLevel: 'Medium',
      inputs: {},
      rationale: 'Manual review considered the submitted evidence and venue conditions.',
    })).toThrow(/inputs/i);
  });
});
