"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const manualRecompute_1 = require("./manualRecompute");
const retryableDependencies = {
    loadProfile: async () => ({ role: 'authority', authorityType: 'PDRM' }),
    loadEvent: async () => ({ requiredAuthorities: ['PDRM'], currentVersionId: 'v1', currentAssessmentId: 'assessment-1' }),
    loadAssessment: async () => ({ status: 'manual_review_required', eventId: 'event-1', versionId: 'v1', assessmentId: 'assessment-1' }),
};
(0, vitest_1.describe)('validateRecomputeEventId', () => {
    (0, vitest_1.it)('trims a valid event id', () => {
        (0, vitest_1.expect)((0, manualRecompute_1.validateRecomputeEventId)(' event-1 ')).toBe('event-1');
    });
    (0, vitest_1.it)('rejects missing and oversized event ids', () => {
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRecomputeEventId)(undefined)).toThrow('eventId required.');
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRecomputeEventId)('x'.repeat(201))).toThrow('eventId must be at most 200 characters.');
    });
});
(0, vitest_1.describe)('validateRecomputeProfile', () => {
    (0, vitest_1.it)('accepts a provisioned authority and rejects every other profile', () => {
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRecomputeProfile)({ role: 'authority', authorityType: 'PDRM' })).not.toThrow();
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRecomputeProfile)({ role: 'organizer' })).toThrow('Only provisioned authority accounts can retry assessments.');
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRecomputeProfile)({ role: 'authority' })).toThrow('Only provisioned authority accounts can retry assessments.');
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRecomputeProfile)(undefined)).toThrow('Only provisioned authority accounts can retry assessments.');
    });
});
(0, vitest_1.describe)('manual recompute authorization', () => {
    (0, vitest_1.it)('requires the caller authority type to be assigned to the event', () => {
        (0, vitest_1.expect)((0, manualRecompute_1.validateAuthorityAssignment)({ requiredAuthorities: ['PDRM'], currentVersionId: 'v1', currentAssessmentId: 'a1' }, 'PDRM')).toBe('a1');
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateAuthorityAssignment)({ requiredAuthorities: ['PDRM'], currentVersionId: 'failed-v1' }, 'PDRM'))
            .toThrow('This application has no assessment that can be retried.');
        (0, vitest_1.expect)((0, manualRecompute_1.validateAuthorityAssignment)({ requiredAuthorities: ['PDRM'], currentVersionId: 'v2', currentAssessmentId: 'assessment-v2' }, 'PDRM')).toBe('assessment-v2');
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateAuthorityAssignment)({ requiredAuthorities: ['BOMBA'], currentAssessmentId: 'a1' }, 'PDRM'))
            .toThrow('Your authority is not assigned to this application.');
    });
    (0, vitest_1.it)('only permits forced retry from manual-review or failed state', () => {
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRetryableAssessment)({ status: 'manual_review_required' })).not.toThrow();
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRetryableAssessment)({ status: 'failed' })).not.toThrow();
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRetryableAssessment)({ status: 'manual_review_required', activeManualAssessmentId: 'manual-1' }))
            .toThrow('An Admin manual assessment is already locked');
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRetryableAssessment)({ status: 'manual_review_required', activeManualAssessmentId: null }))
            .toThrow('manual assessment lock is invalid');
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRetryableAssessment)({ status: 'manual_review_required', activeManualAssessmentId: 42 }))
            .toThrow('manual assessment lock is invalid');
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRetryableAssessment)({ status: 'manual_review_required', activeManualAssessmentId: 'manual/child' }))
            .toThrow('manual assessment lock is invalid');
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRetryableAssessment)({ status: 'provisional_ready' }))
            .toThrow('Only manual-review or failed assessments can be retried.');
    });
    (0, vitest_1.it)('rejects an assessment from a different event generation', () => {
        (0, vitest_1.expect)(() => (0, manualRecompute_1.validateRetryableAssessment)({
            status: 'manual_review_required', eventId: 'event-1', versionId: 'v1', assessmentId: 'old-assessment',
        }, { eventId: 'event-1', versionId: 'v2', assessmentId: 'current-assessment' })).toThrow('assessment generation changed');
    });
});
(0, vitest_1.describe)('manualRecomputeForUser', () => {
    (0, vitest_1.it)('returns the pipeline result for a provisioned authority', async () => {
        const result = await (0, manualRecompute_1.manualRecomputeForUser)('authority-1', ' event-1 ', {
            ...retryableDependencies,
            recompute: async (eventId) => ({ status: 'processed', eventId, versionId: 'v1' }),
        });
        (0, vitest_1.expect)(result).toMatchObject({ success: true, status: 'processed', eventId: 'event-1' });
    });
    (0, vitest_1.it)('rejects an unprovisioned caller before running the pipeline', async () => {
        let calls = 0;
        await (0, vitest_1.expect)((0, manualRecompute_1.manualRecomputeForUser)('organizer-1', 'event-1', {
            loadProfile: async () => ({ role: 'organizer' }),
            loadEvent: async () => { throw new Error('must not load event'); },
            loadAssessment: async () => { throw new Error('must not load assessment'); },
            recompute: async (eventId) => { calls += 1; return { status: 'processed', eventId }; },
        })).rejects.toMatchObject({ code: 'permission-denied' });
        (0, vitest_1.expect)(calls).toBe(0);
    });
    (0, vitest_1.it)('converts pipeline failures to a stable internal error', async () => {
        await (0, vitest_1.expect)((0, manualRecompute_1.manualRecomputeForUser)('authority-1', 'event-1', {
            ...retryableDependencies,
            recompute: async () => { throw new Error('private upstream detail'); },
        })).rejects.toMatchObject({ code: 'internal', message: 'Recompute failed.' });
    });
    (0, vitest_1.it)('does not run the pipeline for an unassigned authority or a ready assessment', async () => {
        let calls = 0;
        const recompute = async (eventId) => { calls += 1; return { status: 'processed', eventId }; };
        await (0, vitest_1.expect)((0, manualRecompute_1.manualRecomputeForUser)('authority-1', 'event-1', {
            ...retryableDependencies,
            loadEvent: async () => ({ requiredAuthorities: ['BOMBA'], currentAssessmentId: 'assessment-1' }),
            recompute,
        })).rejects.toMatchObject({ code: 'permission-denied' });
        await (0, vitest_1.expect)((0, manualRecompute_1.manualRecomputeForUser)('authority-1', 'event-1', {
            ...retryableDependencies,
            loadAssessment: async () => ({ status: 'provisional_ready', eventId: 'event-1', versionId: 'v1', assessmentId: 'assessment-1' }),
            recompute,
        })).rejects.toMatchObject({ code: 'failed-precondition' });
        (0, vitest_1.expect)(calls).toBe(0);
    });
    (0, vitest_1.it)('fails closed while the resource cutover lock exists', async () => {
        let calls = 0;
        await (0, vitest_1.expect)((0, manualRecompute_1.manualRecomputeForUser)('authority-1', 'event-1', {
            ...retryableDependencies,
            loadCutoverLock: async () => true,
            recompute: async (eventId) => { calls += 1; return { status: 'processed', eventId }; },
        })).rejects.toMatchObject({ code: 'unavailable' });
        (0, vitest_1.expect)(calls).toBe(0);
    });
});
//# sourceMappingURL=manualRecompute.test.js.map