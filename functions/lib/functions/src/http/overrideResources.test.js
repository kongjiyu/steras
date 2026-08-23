"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const overrideResources_1 = require("./overrideResources");
const quantities = { police: 2, medicalTeams: 1, ambulances: 1, toilets: 10, wasteBins: 3, security: 5, fireOfficers: 1 };
(0, vitest_1.describe)('validateResourceOverrideRequest', () => {
    (0, vitest_1.it)('accepts complete bounded integer quantities', () => {
        (0, vitest_1.expect)((0, overrideResources_1.validateResourceOverrideRequest)({ eventId: ' event-1 ', quantities, rationale: '  Operational review.  ', idempotencyKey: 'override-key-1' }))
            .toEqual({ eventId: 'event-1', quantities, rationale: 'Operational review.', idempotencyKey: 'override-key-1' });
    });
    vitest_1.it.each([
        [{ eventId: '', quantities, rationale: 'Operational review.' }, 'eventId is required.'],
        [{ eventId: 'event-1', quantities: { ...quantities, police: -1 }, rationale: 'Operational review.', idempotencyKey: 'override-key-1' }, 'Every resource quantity must be a non-negative integer.'],
        [{ eventId: 'event-1', quantities: { ...quantities, extra: 1 }, rationale: 'Operational review.', idempotencyKey: 'override-key-1' }, 'Every resource quantity must be a non-negative integer.'],
        [{ eventId: 'event-1', quantities, rationale: 'short', idempotencyKey: 'override-key-1' }, 'Rationale must be between 10 and 1,000 characters.'],
        [{ eventId: 'event-1', quantities, rationale: 'Operational review.' }, 'idempotencyKey must be 8-128 characters.'],
    ])('rejects malformed resource overrides', (request, message) => {
        (0, vitest_1.expect)(() => (0, overrideResources_1.validateResourceOverrideRequest)(request)).toThrow(message);
    });
});
//# sourceMappingURL=overrideResources.test.js.map