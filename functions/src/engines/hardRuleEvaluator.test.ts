import { describe, expect, it } from 'vitest';
import { DeterministicCategoryResult } from '@shared/types';
import { evaluateCategoryHardRules } from './hardRuleEvaluator';

describe('evaluateCategoryHardRules', () => {
  it('creates versioned category constraints from the dominant deterministic hazard', () => {
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
    } satisfies DeterministicCategoryResult;

    const crowd = evaluateCategoryHardRules(baseline).find((rule) => rule.categoryId === 'crowd');
    expect(crowd).toMatchObject({
      likelihoodFloor: 4,
      severityFloor: 4,
      sourceHazardId: 'crowd.capacity',
      guidelineReferences: ['crowd.rule'],
    });
    expect(crowd?.ruleId).toContain('2026-08-18-hirarc-floor-v1');
  });
});
