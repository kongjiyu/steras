import { describe, expect, it } from 'vitest';
import { DeterministicCategoryResult, EventDetails, RiskLevel } from '@shared/types';
import { computeResources } from './resourceCalculator';

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
  it('uses deterministic ceiling formulas and records prototype rationale', () => {
    const result = computeResources(details, officialResult('Low'));
    expect(result.quantities.police).toBe(2);
    expect(result.quantities.toilets).toBe(10);
    expect(result.quantities.fireOfficers).toBe(2);
    expect(result.rationales.toilets.guidelineReferences).toContain('internal.resource-baseline.v3');
    expect(result.rationales.police.baselineQuantity).toBe(result.quantities.police);
    expect(result.items.find((item) => item.resource === 'police')?.planningRange).toEqual({ min: 2, max: 3 });
    expect(result.items.every((item) => item.authorityReviewRequired)).toBe(true);
  });

  it('applies official and category-specific risk modifiers deterministically', () => {
    const result = computeResources(details, officialResult('High', {
      crowd: 'High',
      weather_environment: 'High',
      venue_fire: 'High',
    }));
    expect(result.quantities.police).toBe(17);
    expect(result.quantities.medicalTeams).toBe(3);
    expect(result.quantities.ambulances).toBe(2);
    expect(result.quantities.fireOfficers).toBe(4);
  });

  it('never returns negative or non-finite quantities for malformed attendance', () => {
    for (const attendance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = computeResources({ ...details, expectedAttendance: attendance }, officialResult('Low'));
      expect(Object.values(result.quantities).every((value) => Number.isInteger(value) && value >= 0)).toBe(true);
    }
  });

  it('UC-M2-11 never emits unsafe or infinite quantities and planning ranges for hostile finite attendance', () => {
    const result = computeResources({ ...details, expectedAttendance: Number.MAX_VALUE }, officialResult('High'));
    expect(Object.values(result.quantities).every(Number.isSafeInteger)).toBe(true);
    expect(result.items.every((item) => Number.isSafeInteger(item.baseline)
      && Number.isSafeInteger(item.planningRange.min)
      && Number.isSafeInteger(item.planningRange.max)
      && item.planningRange.min <= item.planningRange.max)).toBe(true);
  });
});

function officialResult(
  officialRiskLevel: RiskLevel,
  categoryLevels: Partial<Record<'crowd' | 'venue_fire' | 'weather_environment', RiskLevel>> = {},
): DeterministicCategoryResult {
  return {
    categoryAssignments: (['crowd', 'venue_fire', 'weather_environment'] as const).map((categoryId) => ({
      categoryId,
      categoryName: categoryId,
      score: 20,
      riskLevel: categoryLevels[categoryId] ?? 'Low',
      weight: 0.2,
      weightedContribution: 4,
      rationale: 'test',
      evidenceKeys: categoryId === 'crowd' ? ['crowd'] : categoryId === 'venue_fire' ? ['venue'] : ['weather'],
      guidelineChecks: [],
    })),
    officialScore: officialRiskLevel === 'High' ? 75 : officialRiskLevel === 'Medium' ? 50 : 20,
    officialRiskLevel,
    evidence: [],
    categorySchemaVersion: 'test',
    scoringLogicVersion: 'test',
    categorySchemaStatus: 'prototype',
    computedAt: 1,
  };
}
