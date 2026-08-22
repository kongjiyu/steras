"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const overrideResources_1 = require("./overrideResources");
const quantities = { police: 2, medicalTeams: 1, ambulances: 1, toilets: 10, wasteBins: 3, security: 5, fireOfficers: 1 };
(0, vitest_1.describe)('validateResourceOverrideRequest', () => {
    (0, vitest_1.it)('accepts complete bounded integer quantities', () => {
        (0, vitest_1.expect)((0, overrideResources_1.validateResourceOverrideRequest)({ eventId: ' event-1 ', quantities, rationale: '  Operational review.  ' }))
            .toEqual({ eventId: 'event-1', quantities, rationale: 'Operational review.' });
    });
    vitest_1.it.each([
        [{ eventId: '', quantities, rationale: 'Operational review.' }, 'eventId is required.'],
        [{ eventId: 'event-1', quantities: { ...quantities, police: -1 }, rationale: 'Operational review.' }, 'Every resource quantity must be a non-negative integer.'],
        [{ eventId: 'event-1', quantities: { ...quantities, extra: 1 }, rationale: 'Operational review.' }, 'Every resource quantity must be a non-negative integer.'],
        [{ eventId: 'event-1', quantities, rationale: 'short' }, 'Rationale must be between 10 and 1,000 characters.'],
    ])('rejects malformed resource overrides', (request, message) => {
        (0, vitest_1.expect)(() => (0, overrideResources_1.validateResourceOverrideRequest)(request)).toThrow(message);
    });
});
(0, vitest_1.describe)('PR2 resource override boundary', () => {
    (0, vitest_1.it)('rejects a valid override before any persistence work can start', async () => {
        await (0, vitest_1.expect)((0, overrideResources_1.overrideResourcesForUser)('authority-1', {
            eventId: 'event-1',
            quantities,
            rationale: 'Operational review.',
        })).rejects.toMatchObject({ code: 'failed-precondition' });
    });
    (0, vitest_1.it)('exposes a deterministic failed-precondition guard for every resource stage', () => {
        (0, vitest_1.expect)(overrideResources_1.throwResourceOverridesUnavailable).toThrow('Resource adjustments are unavailable until the append-only authority finalisation workflow is enabled.');
    });
});
//# sourceMappingURL=overrideResources.test.js.map