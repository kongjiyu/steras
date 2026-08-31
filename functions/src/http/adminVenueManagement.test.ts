import { describe, expect, it } from 'vitest';
import { Venue } from '@shared/types';
import { validateVenueCommand, validateVenueMutation, verificationErrors } from './adminVenueManagement';

const valid = {
  name: 'Central Convention Hall', address: '1 Jalan Central, Kuala Lumpur', state: 'Kuala Lumpur', jurisdiction: 'DBKL',
  capacity: 2_000, location: { lat: 3.139, lng: 101.687 }, verifiedSafeCapacity: 1_800,
  fireCertificateStatus: 'valid' as const, fireCertificateExpiresAt: Date.UTC(2030, 0, 1), nearestHospitalTravelMinutes: 12,
  emergencyAccessVerified: true, idempotencyKey: 'venue_request_1',
};

describe('M1 venue registry guards', () => {
  it('accepts create and fenced update inputs', () => {
    expect(validateVenueMutation(valid)).toMatchObject({ name: valid.name, capacity: 2_000 });
    expect(validateVenueMutation({ ...valid, venueId: 'venue-1', expectedRevision: 3 })).toMatchObject({ venueId: 'venue-1', expectedRevision: 3 });
    expect(validateVenueCommand({ venueId: 'venue-1', expectedRevision: 0, idempotencyKey: 'verify_1234' })).toEqual({ venueId: 'venue-1', expectedRevision: 0, idempotencyKey: 'verify_1234' });
  });

  it.each([
    [{ ...valid, capacity: Number.NaN }, 'capacity must be'],
    [{ ...valid, capacity: Number.POSITIVE_INFINITY }, 'capacity must be'],
    [{ ...valid, capacity: 1.5 }, 'safe integer'],
    [{ ...valid, verifiedSafeCapacity: 2_001 }, 'verifiedSafeCapacity'],
    [{ ...valid, location: { lat: 91, lng: 1 } }, 'location.lat'],
    [{ ...valid, location: { lat: 1, lng: 2, altitude: 3 } }, 'location must contain only'],
    [{ ...valid, fireCertificateStatus: 'not_required', fireCertificateExpiresAt: 1 }, 'cannot have an expiry'],
    [{ ...valid, active: true }, 'Unsupported fields'],
    [{ ...valid, venueId: '../venue', expectedRevision: 0 }, 'venueId is invalid'],
    [{ ...valid, expectedRevision: 0 }, 'only valid when updating'],
  ])('rejects malformed venue payload %#', (payload, message) => {
    expect(() => validateVenueMutation(payload)).toThrow(message);
  });

  it('requires complete current safety facts before verification', () => {
    const venue: Venue = { venueId: 'venue-1', active: true, verificationStatus: 'unverified', revision: 1, ...valid };
    expect(verificationErrors(venue, Date.UTC(2029, 0, 1))).toEqual([]);
    expect(verificationErrors({ ...venue, verifiedSafeCapacity: undefined, fireCertificateStatus: 'unknown', nearestHospitalTravelMinutes: undefined, emergencyAccessVerified: undefined })).toEqual([
      'Verified safe capacity is required and cannot exceed capacity.', 'Fire certificate status must be resolved.',
      'Hospital travel time is required.', 'Emergency access verification must be recorded.',
    ]);
    expect(verificationErrors({ ...venue, fireCertificateExpiresAt: Date.UTC(2028, 0, 1) }, Date.UTC(2029, 0, 1))).toContain('A valid fire certificate requires a future expiry date.');
  });
});
