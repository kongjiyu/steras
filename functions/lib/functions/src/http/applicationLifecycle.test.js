"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const applicationLifecycle_1 = require("./applicationLifecycle");
function event(status, overrides = {}) {
    return {
        eventId: 'event-1', organizerId: 'organizer-1', status,
        currentVersionId: 'v1', currentVersionNumber: 1, editableVersionId: null,
        eventDetails: {}, draftDocumentPaths: [], requiredAuthorities: [],
        createdAt: 1, updatedAt: 1, ...overrides,
    };
}
(0, vitest_1.describe)('M1 application lifecycle guards', () => {
    (0, vitest_1.it)('allows Pending edit/cancel only before any Admin or officer review state exists', () => {
        (0, vitest_1.expect)((0, applicationLifecycle_1.isBeforeAdminReview)(event('Pending', { reviewStage: 'initial' }))).toBe(true);
        (0, vitest_1.expect)((0, applicationLifecycle_1.isBeforeAdminReview)(event('Pending', { initialReview: { decision: 'Approved', reason: 'ok', reviewerUid: 'admin', reviewedAt: 2 } }))).toBe(false);
        (0, vitest_1.expect)((0, applicationLifecycle_1.isBeforeAdminReview)(event('Pending', { assignedOfficerUids: ['officer'] }))).toBe(false);
        (0, vitest_1.expect)((0, applicationLifecycle_1.isBeforeAdminReview)(event('Pending', { assignedOfficerByAuthority: { PDRM: 'officer' } }))).toBe(false);
        (0, vitest_1.expect)((0, applicationLifecycle_1.isBeforeAdminReview)(event('UnderReview'))).toBe(false);
    });
    (0, vitest_1.it)('creates traceable sources for Pending edits and rejected revisions only', () => {
        (0, vitest_1.expect)((0, applicationLifecycle_1.lifecycleRevisionSource)(event('Pending'), 10)).toEqual({ kind: 'pending_edit', sourceVersionId: 'v1', startedAt: 10 });
        (0, vitest_1.expect)((0, applicationLifecycle_1.lifecycleRevisionSource)(event('Rejected', {
            initialReview: { decision: 'Rejected', reason: 'Missing route plan.', suggestion: 'Attach a signed plan.', reviewerUid: 'admin', reviewedAt: 5 },
        }), 10)).toEqual({
            kind: 'rejected_revision', sourceVersionId: 'v1', startedAt: 10,
            rejectionReason: 'Missing route plan.', rejectionSuggestion: 'Attach a signed plan.',
        });
        (0, vitest_1.expect)((0, applicationLifecycle_1.lifecycleRevisionSource)(event('Approved'), 10)).toBeUndefined();
        (0, vitest_1.expect)((0, applicationLifecycle_1.lifecycleRevisionSource)(event('Rejected', { initialReview: undefined }), 10)).toBeUndefined();
        (0, vitest_1.expect)((0, applicationLifecycle_1.hasCanonicalCurrentVersion)(event('Pending', { currentVersionId: 'v2', currentVersionNumber: 1 }))).toBe(false);
        (0, vitest_1.expect)((0, applicationLifecycle_1.hasValidActiveRevision)(event('Draft', {
            editableVersionId: 'v2', activeRevision: { kind: 'pending_edit', sourceVersionId: 'v1', startedAt: 10 },
        }))).toBe(true);
        (0, vitest_1.expect)((0, applicationLifecycle_1.hasValidActiveRevision)(event('Draft', {
            editableVersionId: 'v2', activeRevision: { kind: 'pending_edit', sourceVersionId: 'v404', startedAt: 10 },
        }))).toBe(false);
        (0, vitest_1.expect)((0, applicationLifecycle_1.isMatchingSubmittedVersion)('event-1', event('Pending'), { eventId: 'event-1', versionId: 'v1', versionNumber: 1 })).toBe(true);
        (0, vitest_1.expect)((0, applicationLifecycle_1.isMatchingSubmittedVersion)('event-1', event('Pending'), { eventId: 'other', versionId: 'v1', versionNumber: 1 })).toBe(false);
    });
    (0, vitest_1.it)('rejects malformed IDs and request smuggling fields', () => {
        (0, vitest_1.expect)((0, applicationLifecycle_1.validateEventId)({ eventId: ' event-1 ' })).toBe('event-1');
        (0, vitest_1.expect)(() => (0, applicationLifecycle_1.validateEventId)({ eventId: '../event' })).toThrow('A valid eventId is required.');
        (0, vitest_1.expect)(() => (0, applicationLifecycle_1.validateEventId)({ eventId: 'event-1', status: 'Draft' })).toThrow('unsupported fields');
    });
});
//# sourceMappingURL=applicationLifecycle.test.js.map