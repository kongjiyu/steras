"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const adminVenueManagement_1 = require("./adminVenueManagement");
const valid = {
    name: 'Central Convention Hall', address: '1 Jalan Central, Kuala Lumpur', state: 'Kuala Lumpur', jurisdiction: 'DBKL',
    capacity: 2_000, location: { lat: 3.139, lng: 101.687 }, verifiedSafeCapacity: 1_800,
    fireCertificateStatus: 'valid', fireCertificateExpiresAt: Date.UTC(2030, 0, 1), nearestHospitalTravelMinutes: 12,
    emergencyAccessVerified: true, idempotencyKey: 'venue_request_1',
};
(0, vitest_1.describe)('M1 venue registry guards', () => {
    (0, vitest_1.it)('accepts create and fenced update inputs', () => {
        (0, vitest_1.expect)((0, adminVenueManagement_1.validateVenueMutation)(valid)).toMatchObject({ name: valid.name, capacity: 2_000 });
        (0, vitest_1.expect)((0, adminVenueManagement_1.validateVenueMutation)({ ...valid, venueId: 'venue-1', expectedRevision: 3 })).toMatchObject({ venueId: 'venue-1', expectedRevision: 3 });
        (0, vitest_1.expect)((0, adminVenueManagement_1.validateVenueCommand)({ venueId: 'venue-1', expectedRevision: 0, idempotencyKey: 'verify_1234' })).toEqual({ venueId: 'venue-1', expectedRevision: 0, idempotencyKey: 'verify_1234' });
    });
    vitest_1.it.each([
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
        (0, vitest_1.expect)(() => (0, adminVenueManagement_1.validateVenueMutation)(payload)).toThrow(message);
    });
    (0, vitest_1.it)('requires complete current safety facts before verification', () => {
        const venue = { venueId: 'venue-1', active: true, verificationStatus: 'unverified', revision: 1, ...valid };
        (0, vitest_1.expect)((0, adminVenueManagement_1.verificationErrors)(venue, Date.UTC(2029, 0, 1))).toEqual([]);
        (0, vitest_1.expect)((0, adminVenueManagement_1.verificationErrors)({ ...venue, verifiedSafeCapacity: undefined, fireCertificateStatus: 'unknown', nearestHospitalTravelMinutes: undefined, emergencyAccessVerified: undefined })).toEqual([
            'Verified safe capacity is required and cannot exceed capacity.', 'Fire certificate status must be resolved.',
            'Hospital travel time is required.', 'Emergency access verification must be recorded.',
        ]);
        (0, vitest_1.expect)((0, adminVenueManagement_1.verificationErrors)({ ...venue, fireCertificateExpiresAt: Date.UTC(2028, 0, 1) }, Date.UTC(2029, 0, 1))).toContain('A valid fire certificate requires a future expiry date.');
    });
});
//# sourceMappingURL=adminVenueManagement.test.js.map