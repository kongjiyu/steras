import { describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  ASSESSMENT_SCHEMA_VERSION,
  AssessmentRecord,
  HARD_RULE_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  ResourceRecommendation,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { assertOfficialAssessmentReady } from './authorityDecision';

describe('assertOfficialAssessmentReady', () => {
  it.each(['processing', 'manual_review_required', 'provisional_ready', 'authority_review', 'failed'] as const)(
    'blocks decisions while assessment status is %s',
    (status) => {
      expect(() => assertOfficialAssessmentReady(
        { currentAssessmentId: 'v1', currentResourceId: 'v1' },
        'v1',
        { status } as AssessmentRecord,
        undefined,
      )).toThrow(HttpsError);
    },
  );

  it('accepts only the current official assessment with matching resources', () => {
    expect(() => assertOfficialAssessmentReady(
      { currentAssessmentId: 'v1', currentResourceId: 'v1' },
      'v1',
      officialAssessment(),
      officialResources(),
    )).not.toThrow();
    expect(() => assertOfficialAssessmentReady(
      { currentAssessmentId: 'v1', currentResourceId: undefined },
      'v1',
      officialAssessment(),
      officialResources(),
    )).toThrow(HttpsError);
  });

  it('rejects incomplete official-looking records and provisional resources', () => {
    expect(() => assertOfficialAssessmentReady(
      { currentAssessmentId: 'v1', currentResourceId: 'v1' },
      'v1',
      { status: 'official_ready' } as AssessmentRecord,
      { ...officialResources(), assessmentStage: 'provisional' },
    )).toThrow(HttpsError);
  });

  it('rejects internally inconsistent official calculations', () => {
    const assessment = officialAssessment();
    if (assessment.status !== 'official_ready') throw new Error('Expected official fixture.');
    expect(() => assertOfficialAssessmentReady(
      { currentAssessmentId: 'v1', currentResourceId: 'v1' },
      'v1',
      { ...assessment, officialResult: { ...assessment.officialResult, overallScore: 99 } },
      officialResources(),
    )).toThrow(HttpsError);
  });
});

function officialAssessment(): AssessmentRecord {
  const categories = ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
    categoryId: category.id, categoryName: category.name,
    proposedLikelihood: 2, proposedSeverity: 2, validatedLikelihood: 2, validatedSeverity: 2,
    matrixScore: 4, normalizedScore: 16, riskLevel: 'Low', weight: category.weight,
    weightedContribution: 2, evidenceReferences: ['crowd'], rationale: 'Test', confidence: 'high',
    concerns: [], missingInformation: [], appliedHardRules: [], guidelineChecks: [...category.guidelineChecks],
  }));
  const result = {
    proposalId: 'proposal-1', validatedHazards: [], categories, overallScore: 16,
    weightedRiskLevel: 'Low', highestCategoryRiskLevel: 'Low', overallRiskLevel: 'Low',
    formulaVersion: PROVISIONAL_FORMULA_VERSION, categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    hardRuleVersion: HARD_RULE_VERSION, calculatedAt: 1,
  };
  return {
    status: 'official_ready',
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    assessmentId: 'v1',
    versionId: 'v1',
    aiProposal: { status: 'success', proposalId: 'proposal-1' },
    provisionalResult: result,
    officialResult: { ...result, finalizedAt: 2, finalizedBy: 'authority-1' },
  } as unknown as AssessmentRecord;
}

function officialResources(): ResourceRecommendation {
  return {
    resourceId: 'v1', versionId: 'v1', assessmentId: 'v1', assessmentStage: 'official',
    police: 1, medicalTeams: 1, ambulances: 1, toilets: 1, wasteBins: 1, security: 1, fireOfficers: 1,
    formulaVersion: 'test', guidelineVersion: 'test',
  } as ResourceRecommendation;
}
