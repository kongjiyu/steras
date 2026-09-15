import { describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Assignment, AuthorityType } from '@shared/types';
import { validateReplacementAssignments, validateSubmittedVenue } from './assignAuthorityOfficers';

const details = {
  venueId: 'venue-1', venueName: 'Verified Hall', venueAddress: 'Kuala Lumpur, Malaysia', venueCapacity: 1000,
} as never;

function snapshot(data: Record<string, unknown> | undefined) {
  return {
    exists: Boolean(data),
    data: () => data,
  } as never;
}

describe('validateSubmittedVenue', () => {
  it('requires an active verified registry venue with matching submitted details', () => {
    expect(() => validateSubmittedVenue(snapshot(undefined), details, 'venue-1')).toThrow(HttpsError);
    expect(() => validateSubmittedVenue(snapshot({
      venueId: 'venue-1', active: true, verificationStatus: 'unverified', state: 'Kuala Lumpur',
      name: 'Verified Hall', address: 'Kuala Lumpur, Malaysia', capacity: 1000,
    }), details, 'venue-1')).toThrow(/stale or invalid/i);
    expect(validateSubmittedVenue(snapshot({
      venueId: 'venue-1', active: true, verificationStatus: 'verified', state: 'Kuala Lumpur',
      name: 'Verified Hall', address: 'Kuala Lumpur, Malaysia', capacity: 1000,
    }), details, 'venue-1')).toBe('Kuala Lumpur');
  });

  it('uses the ALL sentinel only for custom venues without a registry id', () => {
    expect(validateSubmittedVenue(snapshot(undefined), {
      venueId: undefined, venueName: 'Custom venue', venueAddress: 'Malaysia', venueCapacity: 100,
    } as never, '')).toBe('ALL');
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
