import { describe, expect, it } from 'vitest';
import type { Assignment, AuthorityType, EventVersion, Venue } from '@shared/types';
import { resolveSubmittedVenueState, validateReplacementAssignments } from './assignAuthorityOfficers';

function version(venueState?: string, venueId?: string): EventVersion {
  return { eventId: 'event-1', versionId: 'v1', versionNumber: 1, submittedBy: 'organizer-1', submittedAt: 1,
    documentPaths: [], inputHash: 'hash', eventDetails: { venueState, venueId } as EventVersion['eventDetails'] };
}

describe('officer assignment venue-state binding', () => {
  it('uses the immutable submitted state for a custom venue', () => {
    expect(resolveSubmittedVenueState(version('Selangor'))).toBe('Selangor');
  });

  it('requires registry state to match the immutable submitted state', () => {
    const venue = { venueId: 'venue-1', active: true, state: 'Kuala Lumpur' } as Venue;
    expect(resolveSubmittedVenueState(version('Kuala Lumpur', 'venue-1'), venue)).toBe('Kuala Lumpur');
    expect(() => resolveSubmittedVenueState(version('Selangor', 'venue-1'), venue)).toThrow(/stale or invalid/i);
    expect(() => resolveSubmittedVenueState(version('Kuala Lumpur', 'venue-1'), { ...venue, active: false })).toThrow(/stale or invalid/i);
  });
});

describe('replacement assignment guard', () => {
  const revoked = { versionId: 'v1', authorityType: 'PDRM', status: 'revoked' } as Assignment;
  it('accepts only a revoked assignment for the same version and authority', () => {
    expect(() => validateReplacementAssignments('v1', ['PDRM'], new Map<AuthorityType, Assignment | undefined>([['PDRM', revoked]]))).not.toThrow();
  });
  it('rejects active, missing, or cross-version assignments', () => {
    expect(() => validateReplacementAssignments('v1', ['PDRM'], new Map())).toThrow(/revoked assignment/i);
    expect(() => validateReplacementAssignments('v1', ['PDRM'], new Map([['PDRM', { ...revoked, status: 'pending' }]]))).toThrow(/revoked assignment/i);
    expect(() => validateReplacementAssignments('v1', ['PDRM'], new Map([['PDRM', { ...revoked, versionId: 'v2' }]]))).toThrow(/revoked assignment/i);
  });
});
