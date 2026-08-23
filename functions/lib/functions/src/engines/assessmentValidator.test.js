"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const categorySchema_1 = require("../config/categorySchema");
const assessmentValidator_1 = require("./assessmentValidator");
const evidence = categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
    key: { crowd: 'crowd', venue_fire: 'venue', weather_environment: 'weather', public_health: 'public_health', food_water_sanitation: 'sanitation', medical_capacity: 'medical', security_cbrn: 'security', transport_accessibility: 'transport' }[category.id],
    description: category.name, sourceTimestamp: 1, source: 'test', status: 'available',
    quality: 'verified', confidenceScore: 100, eligibility: 'eligible', syntheticStatus: 'none',
}));
function proposal(overrides = {}) {
    return {
        status: 'success', proposalId: 'proposal-1', model: 'test', promptVersion: 'test', responseSchemaVersion: 'test', hazards: [], cacheStatus: 'miss', generatedAt: 1,
        categories: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
            categoryId: category.id, likelihood: 2, severity: 2, evidenceReferences: [evidence.find((item) => item.description === category.name).key], rationale: 'Test rationale', confidence: 'high', concerns: [], missingInformation: [], ...overrides,
        })),
    };
}
const baseline = {
    categoryAssignments: [], officialScore: 20, officialRiskLevel: 'Low', evidence, categorySchemaVersion: 'test', scoringLogicVersion: 'test', categorySchemaStatus: 'prototype', computedAt: 1,
    domainSummaries: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ domain: category.id, name: category.name, score: 4, matrixScore: 1, riskLevel: 'Low', dominantHazardId: `${category.id}.hazard`, confidenceScore: 80, confidenceLevel: 'high' })),
    hazards: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ hazardId: `${category.id}.hazard`, hazardName: 'Test', domain: category.id, inherentLikelihood: 4, inherentSeverity: 5, inherentMatrixScore: 20, controls: [], residualLikelihood: 4, residualSeverity: 5, residualMatrixScore: 20, riskLevel: 'High', evidenceKeys: [], missingData: [], guidelineChecks: [] })),
};
(0, vitest_1.describe)('validateAndCalculateProvisional', () => {
    (0, vitest_1.it)('applies hard-rule floors and records every uplift', () => {
        const result = (0, assessmentValidator_1.validateAndCalculateProvisional)(proposal(), baseline, 10);
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        (0, vitest_1.expect)(result.result.categories[0]).toMatchObject({ proposedLikelihood: 2, validatedLikelihood: 4, proposedSeverity: 2, validatedSeverity: 5, matrixScore: 20 });
        (0, vitest_1.expect)(result.warnings.filter((item) => item.code === 'hard_rule_adjustment')).toHaveLength(16);
    });
    (0, vitest_1.it)('uses weighted score but raises overall level to the highest category', () => {
        const mixedBaseline = structuredClone(baseline);
        mixedBaseline.hazards = mixedBaseline.hazards?.map((hazard, index) => index === 0 ? hazard : { ...hazard, residualLikelihood: 1, residualSeverity: 1, residualMatrixScore: 1, riskLevel: 'Low' });
        const result = (0, assessmentValidator_1.validateAndCalculateProvisional)(proposal({ likelihood: 1, severity: 1 }), mixedBaseline, 10);
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        (0, vitest_1.expect)(result.result.overallScore).toBeLessThan(40);
        (0, vitest_1.expect)(result.result.weightedRiskLevel).toBe('Low');
        (0, vitest_1.expect)(result.result.overallRiskLevel).toBe('High');
    });
    (0, vitest_1.it)('removes unsupported evidence and stops when a category has none left', () => {
        const result = (0, assessmentValidator_1.validateAndCalculateProvisional)(proposal({ evidenceReferences: ['history'] }), baseline, 10);
        (0, vitest_1.expect)(result.ok).toBe(false);
        (0, vitest_1.expect)(result.warnings.some((item) => item.code === 'unsupported_evidence_reference')).toBe(true);
        (0, vitest_1.expect)(result.warnings.some((item) => item.code === 'missing_evidence')).toBe(true);
    });
    (0, vitest_1.it)('excludes missing-quality and unavailable evidence even when the key exists', () => {
        for (const unavailable of [
            { status: 'available', quality: 'missing' },
            { status: 'unmatched', quality: 'declared' },
            { status: 'unavailable', quality: 'declared' },
            { status: 'missing', quality: 'declared' },
        ]) {
            const ineligibleBaseline = structuredClone(baseline);
            ineligibleBaseline.evidence = ineligibleBaseline.evidence.map((item) => (item.key === 'crowd' ? { ...item, ...unavailable, eligibility: 'ineligible' } : item));
            const result = (0, assessmentValidator_1.validateAndCalculateProvisional)(proposal(), ineligibleBaseline, 10);
            (0, vitest_1.expect)(result.ok).toBe(false);
            (0, vitest_1.expect)(result.warnings.some((item) => item.code === 'unsupported_evidence_reference' && item.evidenceReferences.includes('crowd'))).toBe(true);
        }
    });
    (0, vitest_1.it)('validates hazard references and keeps the original proposal immutable', () => {
        const proposalWithUnsupportedReferences = proposal();
        proposalWithUnsupportedReferences.hazards = [{
                hazardId: 'crowd-test', hazardName: 'Crowd test', categoryId: 'crowd',
                evidenceReferences: ['crowd', 'history'], rationale: 'Test hazard.',
            }];
        proposalWithUnsupportedReferences.categories[0].evidenceReferences = ['crowd', 'history'];
        const original = structuredClone(proposalWithUnsupportedReferences);
        const result = (0, assessmentValidator_1.validateAndCalculateProvisional)(proposalWithUnsupportedReferences, baseline, 10);
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        (0, vitest_1.expect)(result.result.categories[0].evidenceReferences).toEqual(['crowd']);
        (0, vitest_1.expect)(result.result.validatedHazards[0].evidenceReferences).toEqual(['crowd']);
        (0, vitest_1.expect)(result.warnings.some((item) => item.message.includes('hazard crowd-test') && item.evidenceReferences.includes('history'))).toBe(true);
        (0, vitest_1.expect)(proposalWithUnsupportedReferences).toEqual(original);
    });
    (0, vitest_1.it)('records low confidence and missing-information warnings deterministically', () => {
        const first = (0, assessmentValidator_1.validateAndCalculateProvisional)(proposal({ confidence: 'low', missingInformation: ['certificate'] }), baseline, 10);
        const second = (0, assessmentValidator_1.validateAndCalculateProvisional)(proposal({ confidence: 'low', missingInformation: ['certificate'] }), baseline, 10);
        (0, vitest_1.expect)(first).toEqual(second);
        (0, vitest_1.expect)(first.warnings.some((item) => item.code === 'low_confidence')).toBe(true);
        (0, vitest_1.expect)(first.warnings.some((item) => item.code === 'missing_evidence')).toBe(true);
    });
});
//# sourceMappingURL=assessmentValidator.test.js.map