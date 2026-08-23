"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const categorySchema_1 = require("../config/categorySchema");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const authorityDecision_1 = require("./authorityDecision");
const authorityFinalisation_1 = require("../engines/authorityFinalisation");
(0, vitest_1.describe)('assertOfficialAssessmentReady', () => {
    vitest_1.it.each(['processing', 'manual_review_required', 'provisional_ready', 'authority_review', 'failed'])('blocks decisions while assessment status is %s', (status) => {
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer('official-v1-hash'), 'v1', { status }, undefined, eventVersion())).toThrow(https_1.HttpsError);
    });
    (0, vitest_1.it)('accepts only the current official assessment with matching resources', () => {
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(officialResources().resourceId), 'v1', officialAssessment(), officialResources(), eventVersion(), [officialResources()], [scoreReview()])).not.toThrow();
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(undefined), 'v1', officialAssessment(), officialResources(), eventVersion())).toThrow(https_1.HttpsError);
    });
    (0, vitest_1.it)('accepts an official assessment ID that is distinct from the immutable version ID', () => {
        const assessmentId = 'assessment-v1-r2';
        const assessment = officialAssessment(assessmentId);
        const resources = officialResources(assessmentId);
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId, assessmentId), 'v1', assessment, resources, eventVersion(), [resources], [scoreReview(assessmentId)])).not.toThrow();
    });
    (0, vitest_1.it)('rejects incomplete official-looking records and provisional resources', () => {
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(officialResources().resourceId), 'v1', { status: 'official_ready' }, { ...officialResources(), stage: 'provisional' }, eventVersion())).toThrow(https_1.HttpsError);
    });
    (0, vitest_1.it)('rejects internally inconsistent official calculations', () => {
        const assessment = officialAssessment();
        if (assessment.status !== 'official_ready')
            throw new Error('Expected official fixture.');
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(officialResources().resourceId), 'v1', { ...assessment, officialResult: { ...assessment.officialResult, overallScore: 99 } }, officialResources(), eventVersion())).toThrow(https_1.HttpsError);
    });
    (0, vitest_1.it)('rejects resources with mismatched finalization metadata or incomplete provenance', () => {
        const mismatched = officialResources();
        if (mismatched.stage !== 'official')
            throw new Error('Expected official resource fixture.');
        const aiReference = mismatched.assessmentReference;
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(mismatched.resourceId), 'v1', officialAssessment(), { ...mismatched, assessmentReference: { ...aiReference, proposalId: 'other-proposal' } }, eventVersion())).toThrow(https_1.HttpsError);
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(mismatched.resourceId), 'v1', officialAssessment(), { ...mismatched, items: { ...mismatched.items, police: { ...mismatched.items.police, appliedRules: [] } } }, eventVersion())).toThrow(https_1.HttpsError);
    });
    (0, vitest_1.it)('keeps blocked compliance reviewable while rejecting resources not bound to the event or deterministic hash', () => {
        const assessment = officialAssessment();
        const resources = officialResources();
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId), 'v1', { ...assessment, complianceStatus: 'blocked' }, resources, eventVersion(), [resources], [scoreReview()])).not.toThrow();
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId), 'v1', assessment, { ...resources, eventId: 'other-event' }, eventVersion())).toThrow(https_1.HttpsError);
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId), 'v1', assessment, { ...resources, resourceInputHash: 'b'.repeat(64) }, eventVersion())).toThrow(https_1.HttpsError);
    });
    (0, vitest_1.it)('rejects deterministic item tampering even when the signed input hash is unchanged', () => {
        const resources = officialResources();
        const tampered = {
            ...resources,
            items: {
                ...resources.items,
                police: { ...resources.items.police, baseline: resources.items.police.baseline + 1 },
            },
        };
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId), 'v1', officialAssessment(), tampered, eventVersion(), [tampered])).toThrow(https_1.HttpsError);
    });
    (0, vitest_1.it)('rejects cross-event versions, assessments, and corrupt retained provisional results', () => {
        const resources = officialResources();
        const assessment = officialAssessment();
        if (assessment.status !== 'official_ready')
            throw new Error('Expected official assessment.');
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId), 'v1', { ...assessment, eventId: 'other-event' }, resources, eventVersion(), [resources])).toThrow(https_1.HttpsError);
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId), 'v1', assessment, resources, { ...eventVersion(), eventId: 'other-event' }, [resources])).toThrow(https_1.HttpsError);
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId), 'v1', {
            ...assessment,
            provisionalResult: { ...assessment.provisionalResult, overallScore: 99 },
        }, resources, eventVersion(), [resources])).toThrow(https_1.HttpsError);
        const mismatchedProposal = structuredClone(assessment);
        if (mismatchedProposal.status !== 'official_ready')
            throw new Error('Expected official assessment.');
        mismatchedProposal.aiProposal.categories[0].likelihood = 1;
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId), 'v1', mismatchedProposal, resources, eventVersion(), [resources])).toThrow(https_1.HttpsError);
    });
    (0, vitest_1.it)('requires the current official resource to be the unique revision-chain tip', () => {
        const resources = officialResources();
        const newer = {
            ...resources,
            resourceId: `official-v1-${'e'.repeat(64)}`,
            resourceInputHash: 'e'.repeat(64),
            revision: 2,
            supersedesResourceId: resources.resourceId,
        };
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId), 'v1', officialAssessment(), resources, eventVersion(), [resources, newer])).toThrow(https_1.HttpsError);
    });
    (0, vitest_1.it)('rejects official scores that are not exactly reproducible from stored review provenance', () => {
        const assessment = officialAssessment();
        const resources = officialResources();
        if (assessment.status !== 'official_ready')
            throw new Error('Expected official assessment.');
        const tampered = structuredClone(assessment);
        tampered.officialResult.categories[0].authorityLikelihood = 4;
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId), 'v1', tampered, resources, eventVersion(), [resources], [scoreReview()])).toThrow(https_1.HttpsError);
        const alteredReview = { ...scoreReview(), rationale: 'A different rationale changes the signed review input.' };
        (0, vitest_1.expect)(() => (0, authorityDecision_1.assertOfficialAssessmentReady)(eventPointer(resources.resourceId), 'v1', assessment, resources, eventVersion(), [resources], [alteredReview])).toThrow(https_1.HttpsError);
    });
});
(0, vitest_1.describe)('officer decision boundary', () => {
    (0, vitest_1.it)('requires material confirmation for approval and suggestions for adverse recommendations', () => {
        (0, vitest_1.expect)(() => (0, authorityDecision_1.validateDecisionRequest)({ eventId: 'event-1', decision: 'Approved', rationale: 'Reviewed all required materials.' })).toThrow(https_1.HttpsError);
        (0, vitest_1.expect)((0, authorityDecision_1.validateDecisionRequest)({ eventId: 'event-1', decision: 'Approved', rationale: 'Reviewed all required materials.', materialsReviewed: true })).toMatchObject({ materialsReviewed: true });
        (0, vitest_1.expect)(() => (0, authorityDecision_1.validateDecisionRequest)({ eventId: 'event-1', decision: 'Rejected', rationale: 'Evidence is not sufficient.' })).toThrow(https_1.HttpsError);
        (0, vitest_1.expect)((0, authorityDecision_1.validateDecisionRequest)({ eventId: 'event-1', decision: 'Rejected', rationale: 'Evidence is not sufficient.', suggestion: 'Provide verified evidence and submit the application again.' })).toMatchObject({ decision: 'Rejected' });
    });
    (0, vitest_1.it)('rejects event IDs that could escape the event document path', () => {
        (0, vitest_1.expect)(() => (0, authorityDecision_1.validateDecisionRequest)({ eventId: 'events/nested', decision: 'Rejected', rationale: 'Evidence is not sufficient.', suggestion: 'Provide verified evidence and submit the application again.' })).toThrow(https_1.HttpsError);
    });
    (0, vitest_1.it)('never turns officer recommendations into a final application status', () => {
        (0, vitest_1.expect)((0, authorityDecision_1.aggregateDecisionStatus)(['PDRM', 'BOMBA'], new Map([['PDRM', 'Approved'], ['BOMBA', 'Approved']]))).toBe('UnderReview');
        (0, vitest_1.expect)((0, authorityDecision_1.aggregateDecisionStatus)(['PDRM'], new Map([['PDRM', 'Rejected']]))).toBe('UnderReview');
    });
});
function officialAssessment(assessmentId = 'v1') {
    const categories = categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
        categoryId: category.id, categoryName: category.name,
        proposedLikelihood: 5, proposedSeverity: 5, validatedLikelihood: 5, validatedSeverity: 5,
        matrixScore: 25, normalizedScore: 100, riskLevel: 'High', weight: category.weight,
        weightedContribution: 12.5, evidenceReferences: ['crowd'], rationale: 'Test', confidence: 'high',
        concerns: [], missingInformation: [], appliedHardRules: [], guidelineChecks: [...category.guidelineChecks],
    }));
    const result = {
        proposalId: 'proposal-1', validatedHazards: [], categories, overallScore: 100,
        weightedRiskLevel: 'High', highestCategoryRiskLevel: 'High', overallRiskLevel: 'High',
        formulaVersion: types_1.PROVISIONAL_FORMULA_VERSION, categorySchemaVersion: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.version,
        hardRuleVersion: types_1.HARD_RULE_VERSION, calculatedAt: 1,
    };
    const provisional = {
        status: 'authority_review',
        schemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
        assessmentId,
        eventId: 'event-1',
        versionId: 'v1',
        complianceStatus: 'pass',
        contextSnapshot: benignContextSnapshot(),
        createdAt: 1,
        aiProposal: {
            status: 'success', proposalId: 'proposal-1', model: 'test-model', promptVersion: 'test-prompt',
            responseSchemaVersion: 'test-schema', cacheStatus: 'miss', generatedAt: 1, hazards: [],
            categories: categories.map((category) => ({
                categoryId: category.categoryId, likelihood: category.proposedLikelihood, severity: category.proposedSeverity,
                evidenceReferences: category.evidenceReferences, rationale: category.rationale, confidence: category.confidence,
                concerns: category.concerns, missingInformation: category.missingInformation,
            })),
        },
        evidence: [{ key: 'crowd', description: 'Test attendance evidence', sourceTimestamp: 1, source: 'test', status: 'available', quality: 'verified' }],
        provisionalResult: result,
        inputHash: 'assessment-input-1',
        warnings: [],
        sourceTimestamps: {},
        contextStatuses: {},
        assessmentReadiness: 'complete',
        complianceChecks: [],
        dataConfidenceScore: 100,
        dataConfidenceLevel: 'high',
        authorityReviewRequired: true,
    };
    const review = scoreReview(assessmentId);
    const authorityReviewState = (0, authorityFinalisation_1.buildAuthorityReviewState)(['PDRM'], [review], 2);
    return {
        ...provisional,
        status: 'official_ready',
        authorityReviewRequired: false,
        authorityReviewState,
        officialResult: (0, authorityFinalisation_1.buildOfficialAssessmentResult)({
            assessment: provisional,
            eventDetails: eventVersion().eventDetails,
            requiredAuthorities: ['PDRM'],
            reviews: [review],
            finalizedAt: 2,
            finalizedBy: 'system',
        }),
    };
}
function scoreReview(assessmentId = 'v1') {
    return {
        reviewId: 'review-pdrm-1', schemaVersion: types_1.SCORE_REVIEW_SCHEMA_VERSION, eventId: 'event-1', versionId: 'v1', assessmentId,
        proposalId: 'proposal-1', provisionalCalculatedAt: 1, assessmentInputHash: 'assessment-input-1',
        categorySchemaVersion: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.version, authorityType: 'PDRM', reviewerId: 'authority-1',
        categories: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ categoryId: category.id, likelihood: 5, severity: 5, decision: 'confirmed' })),
        rationale: 'All category evidence and advisory materials were reviewed.', idempotencyKey: 'review-key-0001', createdAt: 2,
    };
}
function benignContextSnapshot() {
    return {
        weather: {
            data: { forecast: 'Clear', temperature: 25, humidity: 50, windSpeed: 1, precipitationProbability: 0, severeAlert: false },
            measurementStatus: 'available',
            source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 2, forecastFor: 1,
        },
        calendar: {
            localDate: '2026-08-19', dayOfWeek: 'Wednesday', isWeekend: false, isHolidayOrAdjacent: false,
            holidayDistanceDays: 10, sourceVersion: 'test', sourceTimestamp: 1,
        },
        venue: { matched: true, venueId: 'venue-1', submittedCapacity: 1_000, registeredCapacity: 1_000, capacityDifference: 0, fetchedAt: 1 },
        incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, syntheticStatus: 'none', fetchedAt: 1 },
    };
}
function officialResources(assessmentId = 'v1') {
    const assessment = officialAssessment(assessmentId);
    if (assessment.status !== 'official_ready')
        throw new Error('Expected official assessment.');
    const calculation = (0, resourceCalculator_1.computeResources)({
        eventId: 'event-1', versionId: 'v1', assessmentId,
        eventDetails: eventVersion().eventDetails, assessmentResult: assessment.officialResult,
    });
    if (!calculation.ok)
        throw new Error(calculation.message);
    const items = Object.fromEntries(types_1.RESOURCE_KEYS.map((resource) => [resource, {
            ...calculation.items[resource], confidence: 'authority_validated', authorityReviewRequired: false,
        }]));
    return {
        resourceId: `official-v1-${calculation.resourceInputHash}`, eventId: 'event-1', versionId: 'v1', assessmentId,
        schemaVersion: types_1.RESOURCE_SCHEMA_VERSION, stage: 'official', revision: 1, supersedesResourceId: null,
        assessmentReference: { stage: 'official', assessmentId, proposalId: 'proposal-1', finalizedAt: 2, finalizedBy: 'system' },
        resourceInputHash: calculation.resourceInputHash, formulaVersion: types_1.RESOURCE_FORMULA_VERSION, configVersion: types_1.RESOURCE_CONFIG_VERSION, sourceRegistryVersion: types_1.RESOURCE_SOURCE_REGISTRY_VERSION,
        items, confidenceLevel: 'authority_validated', authorityReviewRequired: false, validationScope: 'official_risk_input_only', computedAt: 2,
    };
}
function eventPointer(currentResourceId, currentAssessmentId = 'v1') {
    return { eventId: 'event-1', currentAssessmentId, currentResourceId, requiredAuthorities: ['PDRM'] };
}
function eventVersion() {
    return {
        versionId: 'v1', eventId: 'event-1', versionNumber: 1, documentPaths: [], submittedBy: 'organizer-1', submittedAt: 1, inputHash: 'hash',
        eventDetails: {
            name: 'Test event', type: 'conference', venueName: 'Venue', venueAddress: 'Kuala Lumpur',
            venueLocation: { lat: 3.1, lng: 101.6 }, venueCapacity: 1_000, expectedAttendance: 100,
            environment: 'indoor', coverage: 'covered', seating: 'seated', startDatetime: 1, endDatetime: 2,
            emergencyPlanSummary: 'Plan', organizerName: 'Organizer', organizerEmail: 'organizer@example.com', organizerPhone: '+60000000000',
        },
    };
}
//# sourceMappingURL=authorityDecision.test.js.map