"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const hardRuleEvaluator_1 = require("./hardRuleEvaluator");
(0, vitest_1.describe)('evaluateCategoryHardRules', () => {
    (0, vitest_1.it)('creates versioned category constraints from the dominant deterministic hazard', () => {
        const baseline = {
            categoryAssignments: [],
            officialScore: 80,
            officialRiskLevel: 'High',
            evidence: [],
            categorySchemaVersion: 'test',
            scoringLogicVersion: 'test',
            categorySchemaStatus: 'prototype',
            domainSummaries: [{
                    domain: 'crowd', name: 'Crowd', score: 80, matrixScore: 20, riskLevel: 'High',
                    dominantHazardId: 'crowd.capacity', confidenceScore: 100, confidenceLevel: 'high',
                }],
            hazards: [{
                    hazardId: 'crowd.capacity', hazardName: 'Capacity pressure', domain: 'crowd',
                    inherentLikelihood: 5, inherentSeverity: 4, inherentMatrixScore: 20,
                    controls: [], residualLikelihood: 4, residualSeverity: 4, residualMatrixScore: 16,
                    riskLevel: 'High', evidenceKeys: ['crowd'], missingData: [], guidelineChecks: ['crowd.rule'],
                }],
            computedAt: 1,
        };
        const crowd = (0, hardRuleEvaluator_1.evaluateCategoryHardRules)(baseline).find((rule) => rule.categoryId === 'crowd');
        (0, vitest_1.expect)(crowd).toMatchObject({
            likelihoodFloor: 4,
            severityFloor: 4,
            sourceHazardId: 'crowd.capacity',
            guidelineReferences: ['crowd.rule'],
        });
        (0, vitest_1.expect)(crowd?.ruleId).toContain('2026-08-18-hirarc-floor-v1');
    });
});
//# sourceMappingURL=hardRuleEvaluator.test.js.map