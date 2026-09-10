"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const types_1 = require("../../../shared/types");
const categorySchema_1 = require("../config/categorySchema");
const ruleBased_1 = require("../engines/ruleBased");
const assessmentValidator_1 = require("../engines/assessmentValidator");
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
    (0, vitest_1.it)('accepts a complete current provisional assessment for the Admin-initial-review handoff', () => {
        const assessment = provisionalAssessment();
        (0, vitest_1.expect)((0, initialReview_1.isReviewableProvisionalAssessment)(assessment, 'event-1', 'v1', 'assessment-1')).toBe(true);
        (0, vitest_1.expect)((0, initialReview_1.isReviewableProvisionalAssessment)({ ...assessment, status: 'authority_review' }, 'event-1', 'v1', 'assessment-1')).toBe(false);
        (0, vitest_1.expect)((0, initialReview_1.isReviewableProvisionalAssessment)({ ...assessment, assessmentId: 'stale' }, 'event-1', 'v1', 'assessment-1')).toBe(false);
    });
});
function provisionalAssessment() {
    const event = {
        eventId: 'event-1', eventDetails: {
            name: 'Event', type: 'conference', venueName: 'Venue', venueAddress: 'Kuala Lumpur', venueCapacity: 2_000,
            expectedAttendance: 500, environment: 'indoor', coverage: 'covered', seating: 'seated', startDatetime: 10,
            endDatetime: 20, emergencyPlanSummary: 'Plan', organizerName: 'Organizer', organizerEmail: 'o@example.com', organizerPhone: '1',
        },
    };
    const context = {
        weather: { data: { forecast: 'Clear', temperature: 25, humidity: 50, windSpeed: 1, precipitationProbability: 0, severeAlert: false }, measurementStatus: 'available', source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 100, forecastFor: 10 },
        calendar: { localDate: '2026-08-21', dayOfWeek: 'Friday', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'test', sourceTimestamp: 1, coverageStatus: 'verified' },
        venue: { matched: true, venueId: 'venue-1', submittedCapacity: 2_000, registeredCapacity: 2_000, verifiedSafeCapacity: 2_000, capacityDifference: 0, fireCertificateStatus: 'valid', emergencyAccessVerified: true, fetchedAt: 1 },
        incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, syntheticStatus: 'none', fetchedAt: 1 },
    };
    const baseline = (0, ruleBased_1.computeCategoryBasedAssessment)(event, context, 1);
    const proposal = {
        status: 'success', proposalId: 'proposal-1', model: 'test', promptVersion: 'test', responseSchemaVersion: 'test', cacheStatus: 'miss', generatedAt: 1, hazards: [],
        categories: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ categoryId: category.id, likelihood: 1, severity: 1, evidenceReferences: ['crowd'], rationale: 'Evidence reviewed.', confidence: 'high', concerns: [], missingInformation: [] })),
    };
    const validation = (0, assessmentValidator_1.validateAndCalculateProvisional)(proposal, baseline, 2);
    if (!validation.ok)
        throw new Error(validation.reason);
    return {
        status: 'provisional_ready', schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION, assessmentId: 'assessment-1', eventId: 'event-1', versionId: 'v1',
        contextSnapshot: context, evidence: baseline.evidence, contextEvidence: [{ evidenceId: 'document-1', evidenceKey: 'compliance', sourceKind: 'submitted_document', sourceLocator: 'events/event-1/versions/v1/documents/evidence.pdf', retrievedAt: 1, sourceVersion: '1', eligibility: 'eligible', synthetic: false, visibility: 'authority_only' }], sourceTimestamps: {}, contextStatuses: {}, assessmentReadiness: baseline.assessmentReadiness,
        complianceStatus: baseline.complianceStatus, complianceChecks: baseline.complianceChecks, dataConfidenceScore: baseline.dataConfidenceScore, dataConfidenceLevel: baseline.dataConfidenceLevel,
        inputHash: 'hash', createdAt: 1, aiProposal: proposal, warnings: validation.warnings, authorityReviewRequired: true, provisionalResult: validation.result,
    };
}
//# sourceMappingURL=initialReview.test.js.map