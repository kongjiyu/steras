"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const initialReview_1 = require("./initialReview");
(0, vitest_1.describe)('validateManualAssessment', () => {
    (0, vitest_1.it)('accepts a score whose risk band matches the manual risk level', () => {
        (0, vitest_1.expect)((0, initialReview_1.validateManualAssessment)({
            score: 72,
            riskLevel: 'High',
            inputs: { attendanceReviewed: true, notes: 'Admin review' },
            rationale: 'Manual review considered the submitted evidence and venue conditions.',
        })).toMatchObject({ score: 72, riskLevel: 'High' });
    });
    (0, vitest_1.it)('rejects an inconsistent risk band and empty inputs', () => {
        (0, vitest_1.expect)(() => (0, initialReview_1.validateManualAssessment)({
            score: 72,
            riskLevel: 'Medium',
            inputs: { attendanceReviewed: true },
            rationale: 'Manual review considered the submitted evidence and venue conditions.',
        })).toThrow(/must match the score band/i);
        (0, vitest_1.expect)(() => (0, initialReview_1.validateManualAssessment)({
            score: 42,
            riskLevel: 'Medium',
            inputs: {},
            rationale: 'Manual review considered the submitted evidence and venue conditions.',
        })).toThrow(/inputs/i);
    });
});
//# sourceMappingURL=initialReview.test.js.map