"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const initialReview_1 = require("./initialReview");
const applicationState_1 = require("../../../shared/applicationState");
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
(0, vitest_1.describe)('validateInitialReviewRequest', () => {
    (0, vitest_1.it)('allows an approval without a reason', () => {
        (0, vitest_1.expect)((0, initialReview_1.validateInitialReviewRequest)({ eventId: 'event-1', decision: 'Approved' })).toMatchObject({
            eventId: 'event-1', decision: 'Approved', reason: '', suggestion: '',
        });
    });
    (0, vitest_1.it)('requires a reason and constructive suggestion for rejection', () => {
        (0, vitest_1.expect)(() => (0, initialReview_1.validateInitialReviewRequest)({ eventId: 'event-1', decision: 'Rejected' })).toThrow(/reason must be/i);
        (0, vitest_1.expect)(() => (0, initialReview_1.validateInitialReviewRequest)({ eventId: 'event-1', decision: 'Rejected', reason: 'Sufficient rejection reason.' })).toThrow(/suggestion/i);
    });
});
(0, vitest_1.describe)('shared initial-review readiness', () => {
    const generation = {
        eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', resourceId: 'r1',
        assessment: { eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', status: 'provisional_ready', assessmentReadiness: 'provisional', authorityReviewRequired: true, complianceStatus: 'pass' },
        resource: { resourceId: 'r1', eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', stage: 'provisional' },
    };
    (0, vitest_1.it)('accepts a valid provisional generation and rejects an authority-finalized AI record', () => {
        (0, vitest_1.expect)((0, applicationState_1.resolveInitialReviewReadiness)(generation).ready).toBe(true);
        (0, vitest_1.expect)((0, applicationState_1.resolveInitialReviewReadiness)({ ...generation, assessment: { ...generation.assessment, status: 'official_ready' } }).reason).toBe('official_ai_not_allowed');
    });
});
//# sourceMappingURL=initialReview.test.js.map