"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const onM4ReportOutcome_1 = require("./onM4ReportOutcome");
(0, vitest_1.describe)('onM4ReportOutcome contract', () => {
    (0, vitest_1.it)('accepts only the two terminal M4 outcomes', () => {
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isM4TerminalOutcome)('confirmed_true')).toBe(true);
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isM4TerminalOutcome)('dismissed_fake')).toBe(true);
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isM4TerminalOutcome)('under_review')).toBe(false);
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isM4TerminalOutcome)(undefined)).toBe(false);
    });
});
//# sourceMappingURL=onM4ReportOutcome.test.js.map