"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const types_1 = require("../../../shared/types");
const categorySchema_1 = require("../config/categorySchema");
const ruleBased_1 = require("./ruleBased");
const assessmentValidator_1 = require("./assessmentValidator");
const authorityFinalisation_1 = require("./authorityFinalisation");
(0, vitest_1.describe)('authority score review contract', () => {
    (0, vitest_1.it)('requires exactly eight confirmed or reasoned overridden categories', () => {
        const proposal = fixture().aiProposal;
        const valid = proposal.categories.map((category) => ({
            categoryId: category.categoryId, likelihood: category.likelihood, severity: category.severity, decision: 'confirmed',
        }));
        (0, vitest_1.expect)((0, authorityFinalisation_1.validateScoreReviewInput)({ categories: valid, rationale: 'Reviewed all supplied evidence.', idempotencyKey: 'review_key_01' }, proposal)).toEqual([]);
        (0, vitest_1.expect)((0, authorityFinalisation_1.validateScoreReviewInput)({ categories: valid.slice(1), rationale: 'Reviewed all supplied evidence.', idempotencyKey: 'review_key_02' }, proposal)).toContain('category-count');
        (0, vitest_1.expect)((0, authorityFinalisation_1.validateScoreReviewInput)({ categories: [{ ...valid[0], likelihood: 5 }, ...valid.slice(1)], rationale: 'Reviewed all supplied evidence.', idempotencyKey: 'review_key_03' }, proposal)).toContain(`confirmation-${valid[0].categoryId}`);
        (0, vitest_1.expect)((0, authorityFinalisation_1.validateScoreReviewInput)({ categories: [{ ...valid[0], decision: 'overridden', likelihood: 5, reason: 'short' }, ...valid.slice(1)], rationale: 'Reviewed all supplied evidence.', idempotencyKey: 'review_key_04' }, proposal)).toContain(`override-reason-${valid[0].categoryId}`);
    });
    (0, vitest_1.it)('detects score disagreement only after every required authority submitted', () => {
        const assessment = fixture();
        const pdrm = review(assessment, 'PDRM', 1);
        const bomba = review(assessment, 'BOMBA', 1);
        (0, vitest_1.expect)((0, authorityFinalisation_1.detectScoreConflicts)(['PDRM', 'BOMBA'], [pdrm])).toEqual([]);
        (0, vitest_1.expect)((0, authorityFinalisation_1.detectScoreConflicts)(['PDRM', 'BOMBA'], [pdrm, bomba])).toEqual([]);
        bomba.categories[0] = { ...bomba.categories[0], decision: 'overridden', likelihood: 5, reason: 'Verified crowd conditions require a higher score.' };
        (0, vitest_1.expect)((0, authorityFinalisation_1.detectScoreConflicts)(['PDRM', 'BOMBA'], [pdrm, bomba]).map((conflict) => conflict.categoryId)).toEqual([categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories[0].id]);
    });
    (0, vitest_1.it)('binds admin resolution to the exact review heads and every conflict', () => {
        const assessment = fixture();
        const pdrm = review(assessment, 'PDRM', 1);
        const bomba = review(assessment, 'BOMBA', 1);
        bomba.categories[0] = { ...bomba.categories[0], decision: 'overridden', likelihood: 5, reason: 'Verified crowd conditions require a higher score.' };
        const state = (0, authorityFinalisation_1.buildAuthorityReviewState)(['PDRM', 'BOMBA'], [pdrm, bomba], 3);
        const input = {
            reviewHeadIds: { PDRM: pdrm.reviewId, BOMBA: bomba.reviewId },
            categories: [{ categoryId: state.conflicts[0].categoryId, likelihood: 4, severity: 3, reason: 'The submitted evidence supports the reconciled score.' }],
            rationale: 'Both authority submissions were considered and reconciled.',
        };
        (0, vitest_1.expect)((0, authorityFinalisation_1.validateResolutionInput)(input, state)).toEqual([]);
        (0, vitest_1.expect)((0, authorityFinalisation_1.validateResolutionInput)({ ...input, reviewHeadIds: { ...input.reviewHeadIds, BOMBA: 'stale' } }, state)).toContain('stale-review-heads');
        (0, vitest_1.expect)((0, authorityFinalisation_1.validateResolutionInput)({ ...input, categories: [] }, state)).toContain('resolution-category-count');
        (0, vitest_1.expect)((0, authorityFinalisation_1.validateResolutionInput)({ ...input, reviewHeadIds: null }, state)).toContain('review-heads');
        const resolution = {
            resolutionId: 'resolution-1',
            schemaVersion: types_1.SCORE_RESOLUTION_SCHEMA_VERSION,
            eventId: assessment.eventId,
            versionId: assessment.versionId,
            assessmentId: assessment.assessmentId,
            ...input,
            resolvedBy: 'admin-1',
            createdAt: 4,
        };
        (0, vitest_1.expect)(() => (0, authorityFinalisation_1.buildOfficialAssessmentResult)({
            assessment,
            eventDetails: event().eventDetails,
            requiredAuthorities: ['PDRM', 'BOMBA'],
            reviews: [pdrm, bomba],
            resolution: { ...resolution, eventId: 'wrong-event' },
            finalizedAt: 5,
            finalizedBy: 'admin-1',
        })).toThrow('invalid-score-resolution-identity');
    });
    (0, vitest_1.it)('deterministically recalculates official scores and reapplies hard-rule floors', () => {
        const assessment = fixture();
        const authorityReview = review(assessment, 'PDRM', 1);
        const first = (0, authorityFinalisation_1.buildOfficialAssessmentResult)({ assessment, eventDetails: event().eventDetails, requiredAuthorities: ['PDRM'], reviews: [authorityReview], finalizedAt: 10, finalizedBy: 'system' });
        const second = (0, authorityFinalisation_1.buildOfficialAssessmentResult)({ assessment, eventDetails: event().eventDetails, requiredAuthorities: ['PDRM'], reviews: [authorityReview], finalizedAt: 10, finalizedBy: 'system' });
        const proposalChanged = {
            ...assessment,
            aiProposal: { ...assessment.aiProposal, model: 'different-model' },
        };
        const changed = (0, authorityFinalisation_1.buildOfficialAssessmentResult)({ assessment: proposalChanged, eventDetails: event().eventDetails, requiredAuthorities: ['PDRM'], reviews: [authorityReview], finalizedAt: 10, finalizedBy: 'system' });
        (0, vitest_1.expect)(first).toEqual(second);
        (0, vitest_1.expect)(first.officialInputHash).toMatch(/^[a-f0-9]{64}$/);
        (0, vitest_1.expect)(changed.officialInputHash).not.toBe(first.officialInputHash);
        (0, vitest_1.expect)(first.reviewIds).toEqual([authorityReview.reviewId]);
        (0, vitest_1.expect)(first.categories).toHaveLength(8);
        (0, vitest_1.expect)(first.categories.every((category) => category.validatedLikelihood >= category.authorityLikelihood
            && category.validatedSeverity >= category.authoritySeverity)).toBe(true);
    });
});
function fixture() {
    const currentEvent = event();
    const context = {
        weather: { data: { forecast: 'Clear', temperature: 25, humidity: 50, windSpeed: 1, precipitationProbability: 0, severeAlert: false }, measurementStatus: 'available', source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 100, forecastFor: 10 },
        calendar: { localDate: '2026-08-21', dayOfWeek: 'Friday', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'test', sourceTimestamp: 1, coverageStatus: 'verified' },
        venue: { matched: true, venueId: 'venue-1', submittedCapacity: 2_000, registeredCapacity: 2_000, verifiedSafeCapacity: 2_000, capacityDifference: 0, fireCertificateStatus: 'valid', emergencyAccessVerified: true, fetchedAt: 1 },
        incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, syntheticStatus: 'none', fetchedAt: 1 },
    };
    const baseline = (0, ruleBased_1.computeCategoryBasedAssessment)(currentEvent, context, 1);
    const proposal = {
        status: 'success', proposalId: 'proposal-1', model: 'test-model', promptVersion: 'test-prompt', responseSchemaVersion: 'test-response', cacheStatus: 'miss', generatedAt: 1,
        hazards: [],
        categories: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ categoryId: category.id, likelihood: 1, severity: 1, evidenceReferences: ['crowd'], rationale: 'Evidence was assessed for this category.', confidence: 'high', concerns: [], missingInformation: [] })),
    };
    const validation = (0, assessmentValidator_1.validateAndCalculateProvisional)(proposal, baseline, 2);
    if (!validation.ok)
        throw new Error(validation.reason);
    return {
        status: 'provisional_ready', assessmentId: 'v1', eventId: 'event-1', versionId: 'v1', schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
        contextSnapshot: context, evidence: baseline.evidence, contextEvidence: [{ evidenceId: 'document-evidence', evidenceKey: 'compliance', sourceKind: 'submitted_document', sourceLocator: 'event_documents/event-1/v1/evidence.pdf', retrievedAt: 1, sourceVersion: 'storage-generation:1', eligibility: 'eligible', synthetic: false, visibility: 'authority_only' }], sourceTimestamps: {}, contextStatuses: {}, assessmentReadiness: baseline.assessmentReadiness,
        complianceStatus: baseline.complianceStatus, complianceChecks: baseline.complianceChecks, dataConfidenceScore: baseline.dataConfidenceScore,
        dataConfidenceLevel: baseline.dataConfidenceLevel, inputHash: 'assessment-input-1', createdAt: 1, aiProposal: proposal,
        warnings: validation.warnings, authorityReviewRequired: true, provisionalResult: validation.result,
    };
}
function review(assessment, authorityType, score) {
    return {
        reviewId: `review-${authorityType}`, schemaVersion: types_1.SCORE_REVIEW_SCHEMA_VERSION, eventId: assessment.eventId, versionId: assessment.versionId,
        assessmentId: assessment.assessmentId, proposalId: assessment.aiProposal.proposalId, provisionalCalculatedAt: assessment.provisionalResult.calculatedAt,
        assessmentInputHash: assessment.inputHash, categorySchemaVersion: assessment.provisionalResult.categorySchemaVersion, authorityType, reviewerId: `user-${authorityType}`,
        categories: assessment.aiProposal.categories.map((category) => score === category.likelihood
            ? { categoryId: category.categoryId, likelihood: category.likelihood, severity: category.severity, decision: 'confirmed' }
            : { categoryId: category.categoryId, likelihood: score, severity: score, decision: 'overridden', reason: 'Verified evidence supports this authority override.' }),
        rationale: 'Reviewed the complete application, evidence and assessment.', idempotencyKey: `review_key_${authorityType}`, createdAt: 3,
    };
}
function event() {
    return {
        eventId: 'event-1', organizerId: 'organizer-1', status: 'Pending', currentVersionId: 'v1', currentVersionNumber: 1,
        draftDocumentPaths: [], requiredAuthorities: ['PDRM'], createdAt: 1, updatedAt: 1,
        eventDetails: { name: 'Test event', type: 'conference', venueName: 'Venue', venueAddress: 'Kuala Lumpur', venueCapacity: 2_000, expectedAttendance: 500, environment: 'indoor', coverage: 'covered', seating: 'seated', startDatetime: 10, endDatetime: 20, emergencyPlanSummary: 'Emergency plan.', organizerName: 'Organizer', organizerEmail: 'organizer@example.com', organizerPhone: '+60000000000' },
    };
}
//# sourceMappingURL=authorityFinalisation.test.js.map