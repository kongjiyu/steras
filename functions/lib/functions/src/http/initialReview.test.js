"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const initialReview_1 = require("./initialReview");
(0, vitest_1.describe)('makeInitialReviewDecisionForUser', () => {
    (0, vitest_1.it)('keeps inline legacy manual assessments out of the initial-review command', async () => {
        await (0, vitest_1.expect)((0, initialReview_1.makeInitialReviewDecisionForUser)('admin-1', {
            eventId: 'event-1',
            decision: 'Approved',
            reason: 'The submitted evidence and operational plan are ready for review.',
            manualAssessment: {},
        })).rejects.toMatchObject({ code: 'failed-precondition' });
    });
});
//# sourceMappingURL=initialReview.test.js.map