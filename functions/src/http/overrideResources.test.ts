import { describe, expect, it } from 'vitest';
import { validateResourceOverrideRequest } from './overrideResources';

const quantities = { police: 2, medicalTeams: 1, ambulances: 1, toilets: 10, wasteBins: 3, security: 5, fireOfficers: 1 };

describe('validateResourceOverrideRequest', () => {
  it('accepts complete bounded integer quantities', () => {
    expect(validateResourceOverrideRequest({ eventId: ' event-1 ', quantities, rationale: '  Operational review.  ', idempotencyKey: 'override-key-1', overrideReasonCategory: 'venue_constraint' }))
      .toEqual({ eventId: 'event-1', quantities, rationale: 'Operational review.', idempotencyKey: 'override-key-1', overrideReasonCategory: 'venue_constraint' });
  });

  it.each([
    [{ eventId: '', quantities, rationale: 'Operational review.' }, 'eventId is required.'],
    [{ eventId: 'event-1', quantities: { ...quantities, police: -1 }, rationale: 'Operational review.', idempotencyKey: 'override-key-1' }, 'Every resource quantity must be a non-negative integer.'],
    [{ eventId: 'event-1', quantities: { ...quantities, extra: 1 }, rationale: 'Operational review.', idempotencyKey: 'override-key-1' }, 'Every resource quantity must be a non-negative integer.'],
    [{ eventId: 'event-1', quantities, rationale: 'short', idempotencyKey: 'override-key-1' }, 'Rationale must be between 10 and 1,000 characters.'],
    [{ eventId: 'event-1', quantities, rationale: 'Operational review.' }, 'idempotencyKey must be 8-128 characters.'],
    [{ eventId: 'event-1', quantities, rationale: 'Operational review.', idempotencyKey: 'override-key-1', overrideReasonCategory: 'invented' }, 'valid overrideReasonCategory'],
  ])('rejects malformed resource overrides', (request, message) => {
    expect(() => validateResourceOverrideRequest(request)).toThrow(message);
  });
});
