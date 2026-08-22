"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const types_1 = require("../../../shared/types");
const categorySchema_1 = require("../config/categorySchema");
const manualFinalisation_1 = require("./manualFinalisation");
const resourceCalculator_1 = require("./resourceCalculator");
(0, vitest_1.describe)('Admin manual assessment contract and calculation', () => {
    (0, vitest_1.it)('requires 1-40 unique hazards and exactly eight unique categories', () => {
        const assessment = manualReview();
        (0, vitest_1.expect)((0, manualFinalisation_1.validateManualAssessmentInput)(input(), assessment.evidence)).toEqual([]);
        (0, vitest_1.expect)((0, manualFinalisation_1.validateManualAssessmentInput)({ ...input(), hazards: [] }, assessment.evidence)).toContain('hazard-count');
        (0, vitest_1.expect)((0, manualFinalisation_1.validateManualAssessmentInput)({ ...input(), hazards: Array.from({ length: 41 }, (_, index) => ({ ...input().hazards[0], hazardId: `h-${index}` })) }, assessment.evidence)).toContain('hazard-count');
        (0, vitest_1.expect)((0, manualFinalisation_1.validateManualAssessmentInput)({ ...input(), categories: input().categories.slice(0, 7) }, assessment.evidence)).toContain('category-count');
        (0, vitest_1.expect)((0, manualFinalisation_1.validateManualAssessmentInput)({ ...input(), categories: input().categories.map((category) => ({ ...category, categoryId: 'crowd' })) }, assessment.evidence)).toContain('category');
    });
    (0, vitest_1.it)('rejects invalid scores/evidence and requires missing-information when evidence is absent', () => {
        const assessment = manualReview();
        const badScore = input();
        badScore.categories[0].likelihood = 0;
        (0, vitest_1.expect)((0, manualFinalisation_1.validateManualAssessmentInput)(badScore, assessment.evidence)).toContain('score-crowd');
        const badEvidence = input();
        badEvidence.categories[0].evidenceReferences = ['weather'];
        (0, vitest_1.expect)((0, manualFinalisation_1.validateManualAssessmentInput)(badEvidence, assessment.evidence)).toContain('evidence-crowd');
        const missing = input();
        missing.categories[0].evidenceReferences = [];
        missing.categories[0].missingInformation = '';
        (0, vitest_1.expect)((0, manualFinalisation_1.validateManualAssessmentInput)(missing, assessment.evidence)).toContain('missing-information-crowd');
    });
    (0, vitest_1.it)('fails closed for malformed evidence-reference containers instead of throwing', () => {
        const assessment = manualReview();
        const malformed = input();
        malformed.categories[0] = { ...malformed.categories[0], evidenceReferences: null };
        (0, vitest_1.expect)(() => (0, manualFinalisation_1.validateManualAssessmentInput)(malformed, assessment.evidence)).not.toThrow();
        (0, vitest_1.expect)((0, manualFinalisation_1.validateManualAssessmentInput)(malformed, assessment.evidence)).toContain('evidence-crowd');
    });
    (0, vitest_1.it)('supports insufficient-data recovery without inventing hazard evidence', () => {
        const assessment = manualReview();
        assessment.assessmentReadiness = 'insufficient_data';
        assessment.aiProposal = null;
        assessment.evidence = [];
        const noEvidence = input();
        noEvidence.hazards[0].evidenceReferences = [];
        noEvidence.categories = noEvidence.categories.map((category) => ({
            ...category,
            evidenceReferences: [],
            missingInformation: 'No eligible evidence was available, so the Admin documented the uncertainty manually.',
        }));
        (0, vitest_1.expect)((0, manualFinalisation_1.validateManualAssessmentInput)(noEvidence, [])).toEqual([]);
        const manual = (0, manualFinalisation_1.buildManualAssessment)({ assessment, eventVersionInputHash: 'version-hash', submittedBy: 'admin-1', manualAssessmentId: 'manual-no-evidence', input: noEvidence, createdAt: 10 });
        (0, vitest_1.expect)(() => (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' })).not.toThrow();
    });
    (0, vitest_1.it)('builds deterministic proposal-free official provenance and resource input', () => {
        const assessment = manualReview();
        const manual = record(assessment);
        const first = (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
        const second = (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
        (0, vitest_1.expect)(first).toEqual(second);
        (0, vitest_1.expect)(first.sourceKind).toBe('admin_manual');
        (0, vitest_1.expect)(first).not.toHaveProperty('proposalId');
        (0, vitest_1.expect)(first.officialInputHash).toMatch(/^[a-f0-9]{64}$/);
        (0, vitest_1.expect)((0, resourceCalculator_1.validateManualOfficialAssessmentResult)(first)).toEqual([]);
        (0, vitest_1.expect)((0, resourceCalculator_1.computeResources)({ eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', eventDetails: details(), assessmentResult: first })).toMatchObject({ ok: true });
    });
    (0, vitest_1.it)('applies hard-rule floors without ever lowering Admin scores', () => {
        const assessment = manualReview();
        const manual = record(assessment);
        const result = (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
        result.categories.forEach((category) => {
            (0, vitest_1.expect)(category.validatedLikelihood).toBeGreaterThanOrEqual(category.manualLikelihood);
            (0, vitest_1.expect)(category.validatedSeverity).toBeGreaterThanOrEqual(category.manualSeverity);
        });
    });
    (0, vitest_1.it)('uses the single-category High safety uplift', () => {
        const assessment = manualReview();
        const high = input();
        high.categories[0] = { ...high.categories[0], likelihood: 5, severity: 5 };
        const manual = (0, manualFinalisation_1.buildManualAssessment)({ assessment, eventVersionInputHash: 'version-hash', submittedBy: 'admin-1', manualAssessmentId: 'manual-1', input: high, createdAt: 10 });
        const result = (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
        (0, vitest_1.expect)(result.weightedRiskLevel).toBe('Low');
        (0, vitest_1.expect)(result.highestCategoryRiskLevel).toBe('High');
        (0, vitest_1.expect)(result.overallRiskLevel).toBe('High');
    });
    (0, vitest_1.it)('changes the official hash when immutable manual provenance is tampered', () => {
        const assessment = manualReview();
        const manual = record(assessment);
        const original = (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
        const changed = (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({ assessment, manualAssessment: { ...manual, rationale: `${manual.rationale} Additional evidence interpretation.` }, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
        (0, vitest_1.expect)(changed.officialInputHash).not.toBe(original.officialInputHash);
        (0, vitest_1.expect)(() => (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'other-version-hash', finalizedAt: 20, finalizedBy: 'admin-1' }))
            .toThrow('manual-assessment-identity-mismatch');
    });
    (0, vitest_1.it)('rejects malformed failed-attempt provenance', () => {
        const assessment = manualReview();
        assessment.aiProposal = { status: 'timeout' };
        (0, vitest_1.expect)((0, manualFinalisation_1.isManualAssessmentSourceEligible)(assessment)).toBe(false);
        (0, vitest_1.expect)(() => (0, manualFinalisation_1.buildManualOfficialAssessmentResult)({ assessment, manualAssessment: record(manualReview()), eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' }))
            .toThrow('manual-assessment-identity-mismatch');
    });
});
function record(assessment) {
    return (0, manualFinalisation_1.buildManualAssessment)({ assessment, eventVersionInputHash: 'version-hash', submittedBy: 'admin-1', manualAssessmentId: 'manual-1', input: input(), createdAt: 10 });
}
function input() {
    const categories = categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
        categoryId: category.id, likelihood: 1, severity: 1, evidenceReferences: ['crowd'],
        rationale: `Admin reviewed the available evidence for ${category.name}.`, missingInformation: '',
    }));
    return {
        hazards: [{ hazardId: 'manual-hazard-1', hazardName: 'Crowd congestion', categoryId: 'crowd', evidenceReferences: ['crowd'], rationale: 'Attendance evidence indicates a credible congestion hazard.' }],
        categories, rationale: 'The complete application and all available contextual evidence were reviewed manually.', idempotencyKey: 'manual-key-0001',
    };
}
function manualReview() {
    return {
        assessmentId: 'a1', eventId: 'event-1', versionId: 'v1', schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
        status: 'manual_review_required', aiProposal: { status: 'timeout', model: 'MiniMax-M3', promptVersion: 'p1', responseSchemaVersion: 's1', retryable: true, errorSummary: 'Timed out', cacheStatus: 'not-applicable', generatedAt: 5 },
        contextSnapshot: {
            weather: { data: { forecast: 'Clear', temperature: 25, humidity: 50, windSpeed: 1, precipitationProbability: 0, severeAlert: false }, measurementStatus: 'available', source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 2, forecastFor: 1 },
            calendar: { localDate: '2026-08-21', dayOfWeek: 'Friday', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'test', sourceTimestamp: 1, coverageStatus: 'verified' },
            venue: { matched: true, submittedCapacity: 1000, registeredCapacity: 1000, fetchedAt: 1 },
            incidentHistory: { matched: true, incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, syntheticStatus: 'none', fetchedAt: 1 },
        },
        evidence: [{ key: 'crowd', description: 'Expected attendance and venue capacity', sourceTimestamp: 1, source: 'event-version', status: 'available', quality: 'verified', confidenceScore: 100, eligibility: 'eligible', syntheticStatus: 'none' }],
        contextEvidence: [{ evidenceId: 'document-evidence', evidenceKey: 'compliance', sourceKind: 'submitted_document', sourceLocator: 'event_documents/event-1/v1/evidence.pdf', retrievedAt: 1, sourceVersion: 'storage-generation:1', eligibility: 'eligible', synthetic: false, visibility: 'authority_only' }],
        sourceTimestamps: {}, contextStatuses: {}, assessmentReadiness: 'provisional', complianceStatus: 'review_required', complianceChecks: [], dataConfidenceScore: 50, dataConfidenceLevel: 'medium',
        inputHash: 'assessment-hash', createdAt: 5, warnings: [], authorityReviewRequired: true, manualReviewReason: 'AI timeout',
    };
}
function details() {
    return { name: 'Manual event', type: 'conference', venueName: 'Hall', venueAddress: 'KL', venueCapacity: 1000, expectedAttendance: 100, environment: 'indoor', coverage: 'covered', seating: 'seated', startDatetime: 10, endDatetime: 20, emergencyPlanSummary: 'Plan', organizerName: 'Org', organizerEmail: 'org@example.com', organizerPhone: '0123456789' };
}
void types_1.MANUAL_ASSESSMENT_SCHEMA_VERSION;
void types_1.MANUAL_OFFICIAL_FORMULA_VERSION;
void types_1.CATEGORY_SCHEMA_VERSION;
void types_1.HARD_RULE_VERSION;
//# sourceMappingURL=manualFinalisation.test.js.map