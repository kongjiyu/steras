import { describe, expect, it } from 'vitest';
import { organizerAssessmentAvailability } from './organizerApplication';

describe('organizerAssessmentAvailability', () => {
  it('does not describe terminal applications with missing summaries as processing', () => {
    const state = organizerAssessmentAvailability('Approved', true, true, null, false);
    expect(state.label).toBe('Record unavailable');
    expect(state.emptyMessage).toContain('no longer processing');
  });

  it('keeps an active submitted application in the processing state', () => {
    const state = organizerAssessmentAvailability('Pending', true, false, null, false);
    expect(state.label).toBe('Processing');
    expect(state.emptyMessage).toContain('processing');
  });

  it('prioritizes an earlier incompatible summary over a generic processing state', () => {
    const state = organizerAssessmentAvailability('UnderReview', true, true, null, true);
    expect(state.label).toBe('Recalculation required');
  });

  it('keeps manual-review applications actionable when the safe summary is unavailable', () => {
    const state = organizerAssessmentAvailability('Manual Review Required', true, true, null, false);
    expect(state.label).toBe('Manual assessment required');
    expect(state.emptyMessage).toContain('Admin');
  });
});
