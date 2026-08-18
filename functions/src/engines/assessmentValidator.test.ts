import { describe, expect, it } from 'vitest';
import { AISuccessfulProposal, DeterministicCategoryResult, HazardDomain, ScoreEvidence } from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { validateAndCalculateProvisional } from './assessmentValidator';

const evidence = ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
  key: ({ crowd: 'crowd', venue_fire: 'venue', weather_environment: 'weather', public_health: 'public_health', food_water_sanitation: 'sanitation', medical_capacity: 'medical', security_cbrn: 'security', transport_accessibility: 'transport' } as const)[category.id],
  description: category.name, sourceTimestamp: 1, source: 'test', status: 'available',
})) satisfies ScoreEvidence[];

function proposal(overrides: Partial<AISuccessfulProposal['categories'][number]> = {}): AISuccessfulProposal {
  return {
    status: 'success', proposalId: 'proposal-1', model: 'test', promptVersion: 'test', responseSchemaVersion: 'test', hazards: [], cacheStatus: 'miss', generatedAt: 1,
    categories: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
      categoryId: category.id, likelihood: 2, severity: 2, evidenceReferences: [evidence.find((item) => item.description === category.name)!.key], rationale: 'Test rationale', confidence: 'high', concerns: [], missingInformation: [], ...overrides,
    })),
  };
}

const baseline: DeterministicCategoryResult = {
  categoryAssignments: [], officialScore: 20, officialRiskLevel: 'Low', evidence, categorySchemaVersion: 'test', scoringLogicVersion: 'test', categorySchemaStatus: 'prototype', computedAt: 1,
  domainSummaries: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ domain: category.id, name: category.name, score: 4, matrixScore: 1, riskLevel: 'Low', dominantHazardId: `${category.id}.hazard`, confidenceScore: 80, confidenceLevel: 'high' })),
  hazards: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ hazardId: `${category.id}.hazard`, hazardName: 'Test', domain: category.id as HazardDomain, inherentLikelihood: 4, inherentSeverity: 5, inherentMatrixScore: 20, controls: [], residualLikelihood: 4, residualSeverity: 5, residualMatrixScore: 20, riskLevel: 'High', evidenceKeys: [], missingData: [], guidelineChecks: [] })),
};

describe('validateAndCalculateProvisional', () => {
  it('applies hard-rule floors and records every uplift', () => {
    const result = validateAndCalculateProvisional(proposal(), baseline, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.categories[0]).toMatchObject({ proposedLikelihood: 2, validatedLikelihood: 4, proposedSeverity: 2, validatedSeverity: 5, matrixScore: 20 });
    expect(result.warnings.filter((item) => item.code === 'hard_rule_adjustment')).toHaveLength(16);
  });

  it('uses weighted score but raises overall level to the highest category', () => {
    const mixedBaseline = structuredClone(baseline);
    mixedBaseline.hazards = mixedBaseline.hazards?.map((hazard, index) => index === 0 ? hazard : { ...hazard, residualLikelihood: 1, residualSeverity: 1, residualMatrixScore: 1, riskLevel: 'Low' });
    const result = validateAndCalculateProvisional(proposal({ likelihood: 1, severity: 1 }), mixedBaseline, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.overallScore).toBeLessThan(40);
    expect(result.result.weightedRiskLevel).toBe('Low');
    expect(result.result.overallRiskLevel).toBe('High');
  });

  it('removes unsupported evidence and stops when a category has none left', () => {
    const result = validateAndCalculateProvisional(proposal({ evidenceReferences: ['history'] }), baseline, 10);
    expect(result.ok).toBe(false);
    expect(result.warnings.some((item) => item.code === 'unsupported_evidence_reference')).toBe(true);
    expect(result.warnings.some((item) => item.code === 'missing_evidence')).toBe(true);
  });

  it('excludes missing-quality and unavailable evidence even when the key exists', () => {
    for (const unavailable of [
      { status: 'available', quality: 'missing' as const },
      { status: 'unmatched', quality: 'declared' as const },
      { status: 'unavailable', quality: 'declared' as const },
      { status: 'missing', quality: 'declared' as const },
    ]) {
      const ineligibleBaseline = structuredClone(baseline);
      ineligibleBaseline.evidence = ineligibleBaseline.evidence.map((item) => (
        item.key === 'crowd' ? { ...item, ...unavailable } : item
      ));
      const result = validateAndCalculateProvisional(proposal(), ineligibleBaseline, 10);
      expect(result.ok).toBe(false);
      expect(result.warnings.some((item) => item.code === 'unsupported_evidence_reference' && item.evidenceReferences.includes('crowd'))).toBe(true);
    }
  });

  it('validates hazard references and keeps the original proposal immutable', () => {
    const proposalWithUnsupportedReferences = proposal();
    proposalWithUnsupportedReferences.hazards = [{
      hazardId: 'crowd-test', hazardName: 'Crowd test', categoryId: 'crowd',
      evidenceReferences: ['crowd', 'history'], rationale: 'Test hazard.',
    }];
    proposalWithUnsupportedReferences.categories[0].evidenceReferences = ['crowd', 'history'];
    const original = structuredClone(proposalWithUnsupportedReferences);
    const result = validateAndCalculateProvisional(proposalWithUnsupportedReferences, baseline, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.categories[0].evidenceReferences).toEqual(['crowd']);
    expect(result.result.validatedHazards[0].evidenceReferences).toEqual(['crowd']);
    expect(result.warnings.some((item) => item.message.includes('hazard crowd-test') && item.evidenceReferences.includes('history'))).toBe(true);
    expect(proposalWithUnsupportedReferences).toEqual(original);
  });

  it('records low confidence and missing-information warnings deterministically', () => {
    const first = validateAndCalculateProvisional(proposal({ confidence: 'low', missingInformation: ['certificate'] }), baseline, 10);
    const second = validateAndCalculateProvisional(proposal({ confidence: 'low', missingInformation: ['certificate'] }), baseline, 10);
    expect(first).toEqual(second);
    expect(first.warnings.some((item) => item.code === 'low_confidence')).toBe(true);
    expect(first.warnings.some((item) => item.code === 'missing_evidence')).toBe(true);
  });
});
