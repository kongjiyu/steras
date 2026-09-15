import { describe, expect, it } from 'vitest';
import { userFacingSystemText } from './userFacingText';

describe('userFacingSystemText', () => {
  it('replaces internal module codes in historical system copy', () => {
    expect(userFacingSystemText('M4 investigation sent to Module 3.'))
      .toBe('Incident response investigation sent to Authority approval.');
  });

  it('leaves ordinary system copy unchanged', () => {
    expect(userFacingSystemText('Application submitted for review.'))
      .toBe('Application submitted for review.');
  });
});
