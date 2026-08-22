"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const types_1 = require("../../../shared/types");
const categorySchema_1 = require("../config/categorySchema");
const resourceRecommendationConfig_1 = require("../config/resourceRecommendationConfig");
const resourceCalculator_1 = require("./resourceCalculator");
const resourceContract_1 = require("./resourceContract");
const details = {
    name: 'Indoor Conference',
    type: 'conference',
    venueName: 'Convention Centre',
    venueAddress: 'Kuala Lumpur',
    venueCapacity: 1_000,
    expectedAttendance: 251,
    environment: 'indoor',
    coverage: 'covered',
    seating: 'seated',
    startDatetime: 1,
    endDatetime: 2,
    emergencyPlanSummary: 'Plan',
    organizerName: 'Organizer',
    organizerEmail: 'organizer@example.com',
    organizerPhone: '+60000000000',
};
(0, vitest_1.describe)('computeResources', () => {
    (0, vitest_1.it)('returns exactly seven canonical items with deterministic prototype formulas', () => {
        const result = (0, resourceCalculator_1.computeResources)(calculationInput());
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        (0, vitest_1.expect)(Object.keys(result.items)).toEqual(types_1.RESOURCE_KEYS);
        (0, vitest_1.expect)(result.items.police.baseline).toBe(2);
        (0, vitest_1.expect)(result.items.toilets.baseline).toBe(10);
        (0, vitest_1.expect)(result.items.fireOfficers.baseline).toBe(2);
        (0, vitest_1.expect)(result.items.police.planningRange).toEqual({ min: 2, max: 3 });
        (0, vitest_1.expect)(result.items.security.baseline).toBe(3);
    });
    (0, vitest_1.it)('applies overall and category-specific uplifts using validated provisional risk', () => {
        const result = (0, resourceCalculator_1.computeResources)(calculationInput(assessmentResult('High', {
            crowd: 'High', weather_environment: 'High', venue_fire: 'High',
        })));
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        (0, vitest_1.expect)(result.items.police.baseline).toBe(17);
        (0, vitest_1.expect)(result.items.security.baseline).toBe(8);
        (0, vitest_1.expect)(result.items.medicalTeams.baseline).toBe(3);
        (0, vitest_1.expect)(result.items.ambulances.baseline).toBe(2);
        (0, vitest_1.expect)(result.items.fireOfficers.baseline).toBe(4);
    });
    (0, vitest_1.it)('retains complete, honest provenance for every numeric output', () => {
        const result = (0, resourceCalculator_1.computeResources)(calculationInput());
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        for (const resource of types_1.RESOURCE_KEYS) {
            const item = result.items[resource];
            (0, vitest_1.expect)(item.status).toBe('ready');
            (0, vitest_1.expect)(item.authoritySource.status).toBe('not_supplied');
            (0, vitest_1.expect)(item.authorityReviewRequired).toBe(true);
            (0, vitest_1.expect)(item.sourceSnapshots).toEqual([vitest_1.expect.objectContaining({
                    sourceId: resourceRecommendationConfig_1.INTERNAL_RESOURCE_SOURCE_ID,
                    kind: 'internal_prototype',
                    verificationStatus: 'prototype_unverified',
                })]);
            (0, vitest_1.expect)(item.appliedRules.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(item.appliedRules).toContainEqual(vitest_1.expect.objectContaining({ ruleId: `resource.${resource}.planning-range` }));
            (0, vitest_1.expect)(item.appliedRules.every((rule) => rule.sourceIds.includes(resourceRecommendationConfig_1.INTERNAL_RESOURCE_SOURCE_ID))).toBe(true);
            (0, vitest_1.expect)(item.assumptions.every((assumption) => assumption.sourceIds.includes(resourceRecommendationConfig_1.INTERNAL_RESOURCE_SOURCE_ID))).toBe(true);
            (0, vitest_1.expect)(item.inputReferences.length).toBeGreaterThan(0);
        }
    });
    (0, vitest_1.it)('does not coerce absent, non-finite, fractional, non-positive or unsafe attendance to zero', () => {
        const hostileValues = [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, Number.MAX_VALUE];
        for (const expectedAttendance of hostileValues) {
            const input = calculationInput();
            input.eventDetails = { ...input.eventDetails, expectedAttendance: expectedAttendance };
            const result = (0, resourceCalculator_1.computeResources)(input);
            (0, vitest_1.expect)(result.ok, String(expectedAttendance)).toBe(false);
            if (result.ok)
                continue;
            (0, vitest_1.expect)(['missing_input', 'invalid_input']).toContain(result.code);
        }
    });
    (0, vitest_1.it)('keeps every quantity and planning range safe at maximum accepted attendance', () => {
        const input = calculationInput();
        input.eventDetails = { ...input.eventDetails, expectedAttendance: Number.MAX_SAFE_INTEGER };
        const result = (0, resourceCalculator_1.computeResources)(input);
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        for (const item of Object.values(result.items)) {
            (0, vitest_1.expect)(Number.isSafeInteger(item.baseline)).toBe(true);
            (0, vitest_1.expect)(Number.isSafeInteger(item.planningRange.min)).toBe(true);
            (0, vitest_1.expect)(Number.isSafeInteger(item.planningRange.max)).toBe(true);
            (0, vitest_1.expect)(item.planningRange.min).toBe(item.baseline);
            (0, vitest_1.expect)(item.planningRange.max).toBeGreaterThanOrEqual(item.planningRange.min);
        }
    });
    (0, vitest_1.it)('fails closed for missing and duplicate assessment categories', () => {
        const missing = calculationInput();
        missing.assessmentResult.categories = missing.assessmentResult.categories.filter((item) => item.categoryId !== 'crowd');
        (0, vitest_1.expect)((0, resourceCalculator_1.computeResources)(missing)).toMatchObject({ ok: false, code: 'invalid_input' });
        const duplicate = calculationInput();
        duplicate.assessmentResult.categories.push({ ...duplicate.assessmentResult.categories[0] });
        (0, vitest_1.expect)((0, resourceCalculator_1.computeResources)(duplicate)).toMatchObject({ ok: false, code: 'invalid_input' });
    });
    (0, vitest_1.it)('rejects stale schemas and internally inconsistent provisional results', () => {
        const stale = calculationInput();
        stale.assessmentResult = { ...stale.assessmentResult, formulaVersion: 'legacy-formula' };
        (0, vitest_1.expect)((0, resourceCalculator_1.computeResources)(stale)).toMatchObject({ ok: false, code: 'invalid_input' });
        const corrupt = calculationInput();
        corrupt.assessmentResult.categories[0] = { ...corrupt.assessmentResult.categories[0], normalizedScore: 99 };
        (0, vitest_1.expect)((0, resourceCalculator_1.computeResources)(corrupt)).toMatchObject({ ok: false, code: 'invalid_input' });
    });
    (0, vitest_1.it)('fails closed when numeric provenance is unavailable or a range becomes unsafe', () => {
        (0, vitest_1.expect)((0, resourceCalculator_1.computeResources)(calculationInput(), {
            ...resourceRecommendationConfig_1.ACTIVE_RESOURCE_CONFIG,
            numericSourceId: 'missing.source',
        })).toMatchObject({ ok: false, code: 'incomplete_provenance' });
        (0, vitest_1.expect)((0, resourceCalculator_1.computeResources)(calculationInput(), {
            ...resourceRecommendationConfig_1.ACTIVE_RESOURCE_CONFIG,
            planningRangeMultiplier: Number.MAX_VALUE,
        })).toMatchObject({ ok: false, code: 'unsafe_calculation' });
    });
    (0, vitest_1.it)('is deterministic and changes the input hash when a bound version changes', () => {
        const input = calculationInput();
        const original = structuredClone(input);
        const first = (0, resourceCalculator_1.computeResources)(input);
        const second = (0, resourceCalculator_1.computeResources)(input);
        (0, vitest_1.expect)(first).toEqual(second);
        (0, vitest_1.expect)(input).toEqual(original);
        (0, vitest_1.expect)(first.ok).toBe(true);
        if (!first.ok)
            return;
        const changed = (0, resourceCalculator_1.computeResources)({ ...input, versionId: 'version-2' });
        (0, vitest_1.expect)(changed.ok).toBe(true);
        if (!changed.ok)
            return;
        (0, vitest_1.expect)(changed.resourceInputHash).not.toBe(first.resourceInputHash);
        const reconfigured = (0, resourceCalculator_1.computeResources)(input, { ...resourceRecommendationConfig_1.ACTIVE_RESOURCE_CONFIG, configVersion: 'next-config' });
        (0, vitest_1.expect)(reconfigured.ok).toBe(true);
        if (!reconfigured.ok)
            return;
        (0, vitest_1.expect)(reconfigured.resourceInputHash).not.toBe(first.resourceInputHash);
        const silentlyChangedConfig = (0, resourceCalculator_1.computeResources)(input, {
            ...resourceRecommendationConfig_1.ACTIVE_RESOURCE_CONFIG,
            baselines: {
                ...resourceRecommendationConfig_1.ACTIVE_RESOURCE_CONFIG.baselines,
                police: { ...resourceRecommendationConfig_1.ACTIVE_RESOURCE_CONFIG.baselines.police, divisor: 249 },
            },
        });
        (0, vitest_1.expect)(silentlyChangedConfig.ok).toBe(true);
        if (!silentlyChangedConfig.ok)
            return;
        (0, vitest_1.expect)(silentlyChangedConfig.resourceInputHash).not.toBe(first.resourceInputHash);
    });
    (0, vitest_1.it)('produces items that satisfy the strict backend resource contract', () => {
        const calculation = (0, resourceCalculator_1.computeResources)(calculationInput());
        (0, vitest_1.expect)(calculation.ok).toBe(true);
        if (!calculation.ok)
            return;
        const recommendation = {
            resourceId: `provisional-version-1-${calculation.resourceInputHash}`,
            eventId: 'event-1', versionId: 'version-1', assessmentId: 'assessment-1', schemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
            stage: 'provisional', revision: 1, supersedesResourceId: null,
            assessmentReference: { stage: 'provisional', assessmentId: 'assessment-1', proposalId: 'proposal-1' },
            resourceInputHash: calculation.resourceInputHash, formulaVersion: calculation.formulaVersion,
            configVersion: calculation.configVersion, sourceRegistryVersion: calculation.sourceRegistryVersion,
            items: calculation.items, confidenceLevel: 'prototype', authorityReviewRequired: true, computedAt: 1,
            validationScope: 'provisional_risk_input',
        };
        (0, vitest_1.expect)((0, resourceContract_1.validateResourceRecommendation)(recommendation)).toEqual({ ok: true, errors: [] });
        (0, vitest_1.expect)((0, resourceContract_1.validateResourceRecommendation)({ ...recommendation, police: 1 }).ok).toBe(false);
        (0, vitest_1.expect)((0, resourceContract_1.validateResourceRecommendation)({
            ...recommendation,
            items: { ...recommendation.items, police: { ...recommendation.items.police, appliedRules: [] } },
        }).ok).toBe(false);
        (0, vitest_1.expect)((0, resourceContract_1.validateResourceRecommendation)({ ...recommendation, resourceId: 'provisional-version-1-alias' }).errors)
            .toContain('resource-identity');
        (0, vitest_1.expect)((0, resourceContract_1.validateResourceRecommendation)({
            ...recommendation,
            items: {
                ...recommendation.items,
                police: {
                    ...recommendation.items.police,
                    reviewingAuthority: 'UNKNOWN',
                    inputReferences: [
                        ...recommendation.items.police.inputReferences,
                        recommendation.items.police.inputReferences[0],
                    ],
                },
            },
        }).ok).toBe(false);
        const prototypeSource = recommendation.items.police.sourceSnapshots[0];
        (0, vitest_1.expect)((0, resourceContract_1.validateResourceRecommendation)({
            ...recommendation,
            items: {
                ...recommendation.items,
                police: {
                    ...recommendation.items.police,
                    authoritySource: { status: 'supplied', source: prototypeSource },
                },
            },
        }).errors).toContain('item-police-authority-source');
        const authoritySource = {
            sourceId: 'pdrm.staffing.v1', title: 'Verified staffing review', issuer: 'PDRM', kind: 'official_guidance',
            locator: 'pdrm://staffing/v1', version: 'v1', retrievedAt: 2, verificationStatus: 'verified',
        };
        const unlinkedAuthoritySource = {
            ...recommendation,
            items: {
                ...recommendation.items,
                police: {
                    ...recommendation.items.police,
                    authoritySource: { status: 'supplied', source: authoritySource },
                },
            },
        };
        (0, vitest_1.expect)((0, resourceContract_1.validateResourceRecommendation)(unlinkedAuthoritySource).errors)
            .toContain('item-police-authority-source-unlinked');
        (0, vitest_1.expect)((0, resourceContract_1.validateResourceRecommendation)({
            ...unlinkedAuthoritySource,
            items: {
                ...unlinkedAuthoritySource.items,
                police: {
                    ...unlinkedAuthoritySource.items.police,
                    sourceSnapshots: [...unlinkedAuthoritySource.items.police.sourceSnapshots, authoritySource],
                    assumptions: [...unlinkedAuthoritySource.items.police.assumptions, {
                            assumptionId: 'police.authority-validation', statement: 'PDRM validated the planning basis.', sourceIds: [authoritySource.sourceId],
                        }],
                },
            },
        }).ok).toBe(true);
    });
    (0, vitest_1.it)('rejects incomplete assessment provenance and unexplained hard-rule uplifts', () => {
        const missingEvidence = assessmentResult('Low');
        missingEvidence.categories[0].evidenceReferences = [];
        (0, vitest_1.expect)((0, resourceCalculator_1.computeResources)(calculationInput(missingEvidence))).toMatchObject({ ok: false, code: 'invalid_input' });
        const unexplainedUplift = assessmentResult('Low');
        unexplainedUplift.categories[0] = {
            ...unexplainedUplift.categories[0],
            proposedLikelihood: 1,
            validatedLikelihood: 2,
            matrixScore: 2,
            normalizedScore: 8,
            weightedContribution: 1,
        };
        unexplainedUplift.overallScore = 4.5;
        (0, vitest_1.expect)((0, resourceCalculator_1.computeResources)(calculationInput(unexplainedUplift))).toMatchObject({ ok: false, code: 'invalid_input' });
        (0, vitest_1.expect)(() => (0, resourceCalculator_1.validateProvisionalAssessmentResult)({
            ...assessmentResult('Low'),
            categories: [null],
            validatedHazards: [null],
        })).not.toThrow();
        const duplicateHazards = assessmentResult('Low');
        duplicateHazards.validatedHazards = [
            { hazardId: ' Crowd.Entry ', hazardName: 'Crowd entry', categoryId: 'crowd', evidenceReferences: ['crowd'], rationale: 'Observed crowd entry pressure.' },
            { hazardId: 'crowd.entry', hazardName: 'Crowd entry duplicate', categoryId: 'crowd', evidenceReferences: ['crowd'], rationale: 'Duplicate normalized identifier.' },
        ];
        (0, vitest_1.expect)((0, resourceCalculator_1.computeResources)(calculationInput(duplicateHazards))).toMatchObject({ ok: false, code: 'invalid_input' });
    });
});
function calculationInput(result = assessmentResult('Low')) {
    return {
        eventId: 'event-1',
        versionId: 'version-1',
        assessmentId: 'assessment-1',
        eventDetails: structuredClone(details),
        assessmentResult: result,
    };
}
function assessmentResult(overallRiskLevel, categoryLevels = {}) {
    const categories = categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => categoryResult(category.id, categoryLevels[category.id] ?? 'Low', category.weight));
    const overallScore = Math.round(categories.reduce((sum, category) => sum + category.normalizedScore * category.weight, 0) * 100) / 100;
    const weightedRiskLevel = (0, types_1.riskLevelFor)(overallScore);
    const highestCategoryRiskLevel = categories.reduce((highest, category) => riskOrder(category.riskLevel) > riskOrder(highest) ? category.riskLevel : highest, 'Low');
    const calculatedOverall = riskOrder(weightedRiskLevel) > riskOrder(highestCategoryRiskLevel)
        ? weightedRiskLevel
        : highestCategoryRiskLevel;
    if (calculatedOverall !== overallRiskLevel)
        throw new Error(`Fixture requested ${overallRiskLevel} but calculates ${calculatedOverall}.`);
    return {
        proposalId: 'proposal-1',
        validatedHazards: [],
        categories,
        overallScore,
        weightedRiskLevel,
        highestCategoryRiskLevel,
        overallRiskLevel: calculatedOverall,
        formulaVersion: types_1.PROVISIONAL_FORMULA_VERSION,
        categorySchemaVersion: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.version,
        hardRuleVersion: types_1.HARD_RULE_VERSION,
        calculatedAt: 1,
    };
}
function categoryResult(categoryId, riskLevel, weight) {
    const definition = categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.find((category) => category.id === categoryId);
    if (!definition)
        throw new Error(`Unknown fixture category ${categoryId}.`);
    const [validatedLikelihood, validatedSeverity] = riskLevel === 'High'
        ? [3, 5]
        : riskLevel === 'Medium' ? [2, 3] : [1, 1];
    const matrixScore = validatedLikelihood * validatedSeverity;
    const normalizedScore = matrixScore * 4;
    return {
        categoryId,
        categoryName: definition.name,
        proposedLikelihood: validatedLikelihood,
        proposedSeverity: validatedSeverity,
        validatedLikelihood,
        validatedSeverity,
        matrixScore,
        normalizedScore,
        riskLevel: (0, types_1.hirarcRiskLevelFor)(matrixScore),
        weight,
        weightedContribution: Math.round(normalizedScore * weight * 100) / 100,
        evidenceReferences: ['crowd'],
        rationale: 'test',
        confidence: 'high',
        concerns: [],
        missingInformation: [],
        appliedHardRules: [],
        guidelineChecks: [...definition.guidelineChecks],
    };
}
function riskOrder(level) {
    return { Low: 0, Medium: 1, High: 2 }[level];
}
//# sourceMappingURL=resourceCalculator.test.js.map