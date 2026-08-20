import { describe, expect, it } from 'vitest';
import {
  EventDetails,
  HARD_RULE_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  ProvisionalAssessmentResult,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  ResourceRecommendation,
  RiskLevel,
  ScoreRating,
  ValidatedCategoryResult,
  hirarcRiskLevelFor,
  riskLevelFor,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { ACTIVE_RESOURCE_CONFIG, INTERNAL_RESOURCE_SOURCE_ID } from '../config/resourceRecommendationConfig';
import { computeResources, ResourceCalculationInput, validateProvisionalAssessmentResult } from './resourceCalculator';
import { validateResourceRecommendation } from './resourceContract';

const details: EventDetails = {
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

describe('computeResources', () => {
  it('returns exactly seven canonical items with deterministic prototype formulas', () => {
    const result = computeResources(calculationInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.items)).toEqual(RESOURCE_KEYS);
    expect(result.items.police.baseline).toBe(2);
    expect(result.items.toilets.baseline).toBe(10);
    expect(result.items.fireOfficers.baseline).toBe(2);
    expect(result.items.police.planningRange).toEqual({ min: 2, max: 3 });
    expect(result.items.security.baseline).toBe(3);
  });

  it('applies overall and category-specific uplifts using validated provisional risk', () => {
    const result = computeResources(calculationInput(assessmentResult('High', {
      crowd: 'High', weather_environment: 'High', venue_fire: 'High',
    })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.items.police.baseline).toBe(17);
    expect(result.items.security.baseline).toBe(8);
    expect(result.items.medicalTeams.baseline).toBe(3);
    expect(result.items.ambulances.baseline).toBe(2);
    expect(result.items.fireOfficers.baseline).toBe(4);
  });

  it('retains complete, honest provenance for every numeric output', () => {
    const result = computeResources(calculationInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const resource of RESOURCE_KEYS) {
      const item = result.items[resource];
      expect(item.status).toBe('ready');
      expect(item.authoritySource.status).toBe('not_supplied');
      expect(item.authorityReviewRequired).toBe(true);
      expect(item.sourceSnapshots).toEqual([expect.objectContaining({
        sourceId: INTERNAL_RESOURCE_SOURCE_ID,
        kind: 'internal_prototype',
        verificationStatus: 'prototype_unverified',
      })]);
      expect(item.appliedRules.length).toBeGreaterThan(0);
      expect(item.appliedRules).toContainEqual(expect.objectContaining({ ruleId: `resource.${resource}.planning-range` }));
      expect(item.appliedRules.every((rule) => rule.sourceIds.includes(INTERNAL_RESOURCE_SOURCE_ID))).toBe(true);
      expect(item.assumptions.every((assumption) => assumption.sourceIds.includes(INTERNAL_RESOURCE_SOURCE_ID))).toBe(true);
      expect(item.inputReferences.length).toBeGreaterThan(0);
    }
  });

  it('does not coerce absent, non-finite, fractional, non-positive or unsafe attendance to zero', () => {
    const hostileValues = [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, Number.MAX_VALUE];
    for (const expectedAttendance of hostileValues) {
      const input = calculationInput();
      input.eventDetails = { ...input.eventDetails, expectedAttendance: expectedAttendance as number };
      const result = computeResources(input);
      expect(result.ok, String(expectedAttendance)).toBe(false);
      if (result.ok) continue;
      expect(['missing_input', 'invalid_input']).toContain(result.code);
    }
  });

  it('keeps every quantity and planning range safe at maximum accepted attendance', () => {
    const input = calculationInput();
    input.eventDetails = { ...input.eventDetails, expectedAttendance: Number.MAX_SAFE_INTEGER };
    const result = computeResources(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const item of Object.values(result.items)) {
      expect(Number.isSafeInteger(item.baseline)).toBe(true);
      expect(Number.isSafeInteger(item.planningRange.min)).toBe(true);
      expect(Number.isSafeInteger(item.planningRange.max)).toBe(true);
      expect(item.planningRange.min).toBe(item.baseline);
      expect(item.planningRange.max).toBeGreaterThanOrEqual(item.planningRange.min);
    }
  });

  it('fails closed for missing and duplicate assessment categories', () => {
    const missing = calculationInput();
    missing.assessmentResult.categories = missing.assessmentResult.categories.filter((item) => item.categoryId !== 'crowd');
    expect(computeResources(missing)).toMatchObject({ ok: false, code: 'invalid_input' });

    const duplicate = calculationInput();
    duplicate.assessmentResult.categories.push({ ...duplicate.assessmentResult.categories[0] });
    expect(computeResources(duplicate)).toMatchObject({ ok: false, code: 'invalid_input' });
  });

  it('rejects stale schemas and internally inconsistent provisional results', () => {
    const stale = calculationInput();
    stale.assessmentResult = { ...stale.assessmentResult, formulaVersion: 'legacy-formula' };
    expect(computeResources(stale)).toMatchObject({ ok: false, code: 'invalid_input' });

    const corrupt = calculationInput();
    corrupt.assessmentResult.categories[0] = { ...corrupt.assessmentResult.categories[0], normalizedScore: 99 };
    expect(computeResources(corrupt)).toMatchObject({ ok: false, code: 'invalid_input' });
  });

  it('fails closed when numeric provenance is unavailable or a range becomes unsafe', () => {
    expect(computeResources(calculationInput(), {
      ...ACTIVE_RESOURCE_CONFIG,
      numericSourceId: 'missing.source',
    })).toMatchObject({ ok: false, code: 'incomplete_provenance' });

    expect(computeResources(calculationInput(), {
      ...ACTIVE_RESOURCE_CONFIG,
      planningRangeMultiplier: Number.MAX_VALUE,
    })).toMatchObject({ ok: false, code: 'unsafe_calculation' });
  });

  it('is deterministic and changes the input hash when a bound version changes', () => {
    const input = calculationInput();
    const original = structuredClone(input);
    const first = computeResources(input);
    const second = computeResources(input);
    expect(first).toEqual(second);
    expect(input).toEqual(original);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const changed = computeResources({ ...input, versionId: 'version-2' });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.resourceInputHash).not.toBe(first.resourceInputHash);

    const reconfigured = computeResources(input, { ...ACTIVE_RESOURCE_CONFIG, configVersion: 'next-config' });
    expect(reconfigured.ok).toBe(true);
    if (!reconfigured.ok) return;
    expect(reconfigured.resourceInputHash).not.toBe(first.resourceInputHash);

    const silentlyChangedConfig = computeResources(input, {
      ...ACTIVE_RESOURCE_CONFIG,
      baselines: {
        ...ACTIVE_RESOURCE_CONFIG.baselines,
        police: { ...ACTIVE_RESOURCE_CONFIG.baselines.police, divisor: 249 },
      },
    });
    expect(silentlyChangedConfig.ok).toBe(true);
    if (!silentlyChangedConfig.ok) return;
    expect(silentlyChangedConfig.resourceInputHash).not.toBe(first.resourceInputHash);
  });

  it('produces items that satisfy the strict backend resource contract', () => {
    const calculation = computeResources(calculationInput());
    expect(calculation.ok).toBe(true);
    if (!calculation.ok) return;
    const recommendation: ResourceRecommendation = {
      resourceId: `provisional-version-1-${calculation.resourceInputHash}`,
      eventId: 'event-1', versionId: 'version-1', assessmentId: 'assessment-1', schemaVersion: RESOURCE_SCHEMA_VERSION,
      stage: 'provisional', revision: 1, supersedesResourceId: null,
      assessmentReference: { stage: 'provisional', assessmentId: 'assessment-1', proposalId: 'proposal-1' },
      resourceInputHash: calculation.resourceInputHash, formulaVersion: calculation.formulaVersion,
      configVersion: calculation.configVersion, sourceRegistryVersion: calculation.sourceRegistryVersion,
      items: calculation.items, confidenceLevel: 'prototype', authorityReviewRequired: true, computedAt: 1,
    };
    expect(validateResourceRecommendation(recommendation)).toEqual({ ok: true, errors: [] });
    expect(validateResourceRecommendation({ ...recommendation, police: 1 }).ok).toBe(false);
    expect(validateResourceRecommendation({
      ...recommendation,
      items: { ...recommendation.items, police: { ...recommendation.items.police, appliedRules: [] } },
    }).ok).toBe(false);
    expect(validateResourceRecommendation({ ...recommendation, resourceId: 'provisional-version-1-alias' }).errors)
      .toContain('resource-identity');
    expect(validateResourceRecommendation({
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
    expect(validateResourceRecommendation({
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
      sourceId: 'pdrm.staffing.v1', title: 'Verified staffing review', issuer: 'PDRM', kind: 'official_guidance' as const,
      locator: 'pdrm://staffing/v1', version: 'v1', retrievedAt: 2, verificationStatus: 'verified' as const,
    };
    const unlinkedAuthoritySource = {
      ...recommendation,
      items: {
        ...recommendation.items,
        police: {
          ...recommendation.items.police,
          authoritySource: { status: 'supplied' as const, source: authoritySource },
        },
      },
    };
    expect(validateResourceRecommendation(unlinkedAuthoritySource).errors)
      .toContain('item-police-authority-source-unlinked');
    expect(validateResourceRecommendation({
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

  it('rejects incomplete assessment provenance and unexplained hard-rule uplifts', () => {
    const missingEvidence = assessmentResult('Low');
    missingEvidence.categories[0].evidenceReferences = [];
    expect(computeResources(calculationInput(missingEvidence))).toMatchObject({ ok: false, code: 'invalid_input' });

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
    expect(computeResources(calculationInput(unexplainedUplift))).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(() => validateProvisionalAssessmentResult({
      ...assessmentResult('Low'),
      categories: [null] as unknown as ProvisionalAssessmentResult['categories'],
      validatedHazards: [null] as unknown as ProvisionalAssessmentResult['validatedHazards'],
    })).not.toThrow();
  });
});

function calculationInput(result = assessmentResult('Low')): ResourceCalculationInput {
  return {
    eventId: 'event-1',
    versionId: 'version-1',
    assessmentId: 'assessment-1',
    eventDetails: structuredClone(details),
    assessmentResult: result,
  };
}
function assessmentResult(
  overallRiskLevel: RiskLevel,
  categoryLevels: Partial<Record<'crowd' | 'venue_fire' | 'weather_environment', RiskLevel>> = {},
): ProvisionalAssessmentResult {
  const categories = ACTIVE_CATEGORY_SCHEMA.categories.map((category) => categoryResult(
    category.id,
    categoryLevels[category.id as keyof typeof categoryLevels] ?? 'Low',
    category.weight,
  ));
  const overallScore = Math.round(categories.reduce((sum, category) => sum + category.normalizedScore * category.weight, 0) * 100) / 100;
  const weightedRiskLevel = riskLevelFor(overallScore);
  const highestCategoryRiskLevel = categories.reduce<RiskLevel>(
    (highest, category) => riskOrder(category.riskLevel) > riskOrder(highest) ? category.riskLevel : highest,
    'Low',
  );
  const calculatedOverall = riskOrder(weightedRiskLevel) > riskOrder(highestCategoryRiskLevel)
    ? weightedRiskLevel
    : highestCategoryRiskLevel;
  if (calculatedOverall !== overallRiskLevel) throw new Error(`Fixture requested ${overallRiskLevel} but calculates ${calculatedOverall}.`);
  return {
    proposalId: 'proposal-1',
    validatedHazards: [],
    categories,
    overallScore,
    weightedRiskLevel,
    highestCategoryRiskLevel,
    overallRiskLevel: calculatedOverall,
    formulaVersion: PROVISIONAL_FORMULA_VERSION,
    categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    hardRuleVersion: HARD_RULE_VERSION,
    calculatedAt: 1,
  };
}

function categoryResult(categoryId: string, riskLevel: RiskLevel, weight: number): ValidatedCategoryResult {
  const definition = ACTIVE_CATEGORY_SCHEMA.categories.find((category) => category.id === categoryId);
  if (!definition) throw new Error(`Unknown fixture category ${categoryId}.`);
  const [validatedLikelihood, validatedSeverity]: [ScoreRating, ScoreRating] = riskLevel === 'High'
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
    riskLevel: hirarcRiskLevelFor(matrixScore),
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

function riskOrder(level: RiskLevel): number {
  return { Low: 0, Medium: 1, High: 2 }[level];
}
