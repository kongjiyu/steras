import { describe, expect, it } from 'vitest';
import { activeScoreResolutionId } from './authorityReviewPresentation';

describe('activeScoreResolutionId', () => {
  it('keeps a persisted resolution visible while official finalisation is pending retry', () => {
    expect(activeScoreResolutionId({
      status: 'authority_review',
      authorityReviewState: { activeResolutionId: 'resolution-1' },
    } as never)).toBe('resolution-1');
  });

  it('uses official provenance after finalisation', () => {
    expect(activeScoreResolutionId({
      status: 'official_ready',
      officialResult: { resolutionId: 'resolution-2' },
    } as never)).toBe('resolution-2');
  });
});
