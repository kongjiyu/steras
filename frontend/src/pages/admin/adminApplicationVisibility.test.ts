import { describe, expect, it } from 'vitest';
import { adminStatusFromQuery, isAdminVisibleEvent } from './adminApplicationVisibility';

describe('admin application visibility', () => {
  it('keeps organizer drafts outside every Admin application view', () => {
    expect(isAdminVisibleEvent({ status: 'Draft' })).toBe(false);
    expect(adminStatusFromQuery('Draft')).toBe('all');
  });

  it('allows submitted and terminal application states', () => {
    for (const status of ['Pending', 'UnderReview', 'Manual Review Required', 'Approved', 'Rejected', 'Withdrawn'] as const) {
      expect(isAdminVisibleEvent({ status })).toBe(true);
      expect(adminStatusFromQuery(status)).toBe(status);
    }
  });
});
