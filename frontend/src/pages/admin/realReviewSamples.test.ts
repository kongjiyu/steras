import { describe, expect, it } from 'vitest';
import { REAL_REVIEW_SAMPLE_DATASET_ID, REAL_REVIEW_SAMPLE_EVENT_IDS, REAL_REVIEW_SAMPLES } from '@shared/realReviewSamples';

describe('real review sample definitions', () => {
  it('keeps exactly three clearly marked workflow samples with public event facts', () => {
    expect(REAL_REVIEW_SAMPLE_EVENT_IDS).toHaveLength(3);
    expect(REAL_REVIEW_SAMPLE_DATASET_ID).toContain('real-review-samples');
    expect(REAL_REVIEW_SAMPLES['steras-sample-klscm-2026'].name).toBe('Kuala Lumpur Standard Chartered Marathon 2026');
    expect(REAL_REVIEW_SAMPLES['steras-sample-malaysian-motogp-2026'].name).toBe('PETRONAS Grand Prix of Malaysia 2026');
    expect(REAL_REVIEW_SAMPLES['steras-sample-ironman-malaysia-2026'].name).toBe('2026 IRONMAN Malaysia');
    for (const sample of Object.values(REAL_REVIEW_SAMPLES)) {
      expect(sample.sourceUrls.length).toBeGreaterThan(0);
      expect(sample.syntheticCapacityNote).toMatch(/estimate|synthetic/i);
      expect(sample.requiredAuthorities).toEqual(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);
    }
  });
});
