"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const withdrawEvent_1 = require("./withdrawEvent");
(0, vitest_1.describe)('validateWithdrawRequest', () => {
    (0, vitest_1.it)('normalizes an optional rationale', () => {
        (0, vitest_1.expect)((0, withdrawEvent_1.validateWithdrawRequest)({ eventId: ' event-1 ', rationale: '  Schedule cancelled.  ' }))
            .toEqual({ eventId: 'event-1', rationale: 'Schedule cancelled.' });
    });
    (0, vitest_1.it)('rejects missing identifiers and oversized rationales', () => {
        (0, vitest_1.expect)(() => (0, withdrawEvent_1.validateWithdrawRequest)({ eventId: ' ' })).toThrow('eventId is required.');
        (0, vitest_1.expect)(() => (0, withdrawEvent_1.validateWithdrawRequest)({ eventId: 'event-1', rationale: 'x'.repeat(501) }))
            .toThrow('Rationale must be at most 500 characters.');
    });
});
//# sourceMappingURL=withdrawEvent.test.js.map