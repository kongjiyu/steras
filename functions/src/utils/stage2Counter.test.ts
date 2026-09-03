import { describe, expect, it } from 'vitest';
import type { Stage2Doc } from '@shared/types';
import { counterMatchesStage2 } from './stage2Counter';

const stage2 = { uploadedAt: 200 } as Stage2Doc;

describe('Stage 2 per-upload counters', () => {
  it('matches only the exact immutable upload timestamp', () => {
    expect(counterMatchesStage2({ stage2UploadedAt: 200 }, stage2)).toBe(true);
    expect(counterMatchesStage2({ stage2UploadedAt: 199 }, stage2)).toBe(false);
    expect(counterMatchesStage2({}, stage2)).toBe(false);
  });
});
