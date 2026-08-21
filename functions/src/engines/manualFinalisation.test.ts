import { describe, expect, it } from 'vitest';
import {
  AdminManualCategoryInput,
  ASSESSMENT_SCHEMA_VERSION,
  CATEGORY_SCHEMA_VERSION,
  HARD_RULE_VERSION,
  MANUAL_ASSESSMENT_SCHEMA_VERSION,
  MANUAL_OFFICIAL_FORMULA_VERSION,
  ManualReviewRiskAssessment,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import {
  buildManualAssessment,
  buildManualOfficialAssessmentResult,
  isManualAssessmentSourceEligible,
  validateManualAssessmentInput,
} from './manualFinalisation';
import { computeResources, validateManualOfficialAssessmentResult } from './resourceCalculator';

describe('Admin manual assessment contract and calculation', () => {
  it('requires 1-40 unique hazards and exactly eight unique categories', () => {
    const assessment = manualReview();
    expect(validateManualAssessmentInput(input(), assessment.evidence)).toEqual([]);
    expect(validateManualAssessmentInput({ ...input(), hazards: [] }, assessment.evidence)).toContain('hazard-count');
    expect(validateManualAssessmentInput({ ...input(), hazards: Array.from({ length: 41 }, (_, index) => ({ ...input().hazards[0], hazardId: `h-${index}` })) }, assessment.evidence)).toContain('hazard-count');
    expect(validateManualAssessmentInput({ ...input(), categories: input().categories.slice(0, 7) }, assessment.evidence)).toContain('category-count');
    expect(validateManualAssessmentInput({ ...input(), categories: input().categories.map((category) => ({ ...category, categoryId: 'crowd' })) }, assessment.evidence)).toContain('category');
  });

  it('rejects invalid scores/evidence and requires missing-information when evidence is absent', () => {
    const assessment = manualReview();
    const badScore = input();
    badScore.categories[0].likelihood = 0 as never;
    expect(validateManualAssessmentInput(badScore, assessment.evidence)).toContain('score-crowd');
    const badEvidence = input();
    badEvidence.categories[0].evidenceReferences = ['weather'];
    expect(validateManualAssessmentInput(badEvidence, assessment.evidence)).toContain('evidence-crowd');
    const missing = input();
    missing.categories[0].evidenceReferences = [];
    missing.categories[0].missingInformation = '';
    expect(validateManualAssessmentInput(missing, assessment.evidence)).toContain('missing-information-crowd');
  });

  it('fails closed for malformed evidence-reference containers instead of throwing', () => {
    const assessment = manualReview();
    const malformed = input();
    malformed.categories[0] = { ...malformed.categories[0], evidenceReferences: null as never };
    expect(() => validateManualAssessmentInput(malformed, assessment.evidence)).not.toThrow();
    expect(validateManualAssessmentInput(malformed, assessment.evidence)).toContain('evidence-crowd');
  });

  it('supports insufficient-data recovery without inventing hazard evidence', () => {
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
    expect(validateManualAssessmentInput(noEvidence, [])).toEqual([]);
    const manual = buildManualAssessment({ assessment, eventVersionInputHash: 'version-hash', submittedBy: 'admin-1', manualAssessmentId: 'manual-no-evidence', input: noEvidence, createdAt: 10 });
    expect(() => buildManualOfficialAssessmentResult({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' })).not.toThrow();
  });

  it('builds deterministic proposal-free official provenance and resource input', () => {
    const assessment = manualReview();
    const manual = record(assessment);
    const first = buildManualOfficialAssessmentResult({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
    const second = buildManualOfficialAssessmentResult({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
    expect(first).toEqual(second);
    expect(first.sourceKind).toBe('admin_manual');
    expect(first).not.toHaveProperty('proposalId');
    expect(first.officialInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(validateManualOfficialAssessmentResult(first)).toEqual([]);
    expect(computeResources({ eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', eventDetails: details(), assessmentResult: first })).toMatchObject({ ok: true });
  });

  it('applies hard-rule floors without ever lowering Admin scores', () => {
    const assessment = manualReview();
    const manual = record(assessment);
    const result = buildManualOfficialAssessmentResult({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
    result.categories.forEach((category) => {
      expect(category.validatedLikelihood).toBeGreaterThanOrEqual(category.manualLikelihood);
      expect(category.validatedSeverity).toBeGreaterThanOrEqual(category.manualSeverity);
    });
  });

  it('uses the single-category High safety uplift', () => {
    const assessment = manualReview();
    const high = input();
    high.categories[0] = { ...high.categories[0], likelihood: 5, severity: 5 };
    const manual = buildManualAssessment({ assessment, eventVersionInputHash: 'version-hash', submittedBy: 'admin-1', manualAssessmentId: 'manual-1', input: high, createdAt: 10 });
    const result = buildManualOfficialAssessmentResult({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
    expect(result.weightedRiskLevel).toBe('Low');
    expect(result.highestCategoryRiskLevel).toBe('High');
    expect(result.overallRiskLevel).toBe('High');
  });

  it('changes the official hash when immutable manual provenance is tampered', () => {
    const assessment = manualReview();
    const manual = record(assessment);
    const original = buildManualOfficialAssessmentResult({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
    const changed = buildManualOfficialAssessmentResult({ assessment, manualAssessment: { ...manual, rationale: `${manual.rationale} Additional evidence interpretation.` }, eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' });
    expect(changed.officialInputHash).not.toBe(original.officialInputHash);
    expect(() => buildManualOfficialAssessmentResult({ assessment, manualAssessment: manual, eventDetails: details(), eventVersionInputHash: 'other-version-hash', finalizedAt: 20, finalizedBy: 'admin-1' }))
      .toThrow('manual-assessment-identity-mismatch');
  });

  it('rejects malformed failed-attempt provenance', () => {
    const assessment = manualReview();
    assessment.aiProposal = { status: 'timeout' } as never;
    expect(isManualAssessmentSourceEligible(assessment)).toBe(false);
    expect(() => buildManualOfficialAssessmentResult({ assessment, manualAssessment: record(manualReview()), eventDetails: details(), eventVersionInputHash: 'version-hash', finalizedAt: 20, finalizedBy: 'admin-1' }))
      .toThrow('manual-assessment-identity-mismatch');
  });
});

function record(assessment: ManualReviewRiskAssessment) {
  return buildManualAssessment({ assessment, eventVersionInputHash: 'version-hash', submittedBy: 'admin-1', manualAssessmentId: 'manual-1', input: input(), createdAt: 10 });
}

function input() {
  const categories: AdminManualCategoryInput[] = ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
    categoryId: category.id, likelihood: 1, severity: 1, evidenceReferences: ['crowd'],
    rationale: `Admin reviewed the available evidence for ${category.name}.`, missingInformation: '',
  }));
  return {
    hazards: [{ hazardId: 'manual-hazard-1', hazardName: 'Crowd congestion', categoryId: 'crowd' as const, evidenceReferences: ['crowd' as const], rationale: 'Attendance evidence indicates a credible congestion hazard.' }],
    categories, rationale: 'The complete application and all available contextual evidence were reviewed manually.', idempotencyKey: 'manual-key-0001',
  };
}

function manualReview(): ManualReviewRiskAssessment {
  return {
    assessmentId: 'a1', eventId: 'event-1', versionId: 'v1', schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    status: 'manual_review_required', aiProposal: { status: 'timeout', model: 'MiniMax-M3', promptVersion: 'p1', responseSchemaVersion: 's1', retryable: true, errorSummary: 'Timed out', cacheStatus: 'not-applicable', generatedAt: 5 },
    contextSnapshot: {
      weather: { data: { forecast: 'Clear', temperature: 25, humidity: 50, windSpeed: 1, precipitationProbability: 0, severeAlert: false }, source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 2, forecastFor: 1 },
      calendar: { localDate: '2026-08-21', dayOfWeek: 'Friday', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'test', sourceTimestamp: 1 },
      venue: { matched: true, submittedCapacity: 1000, registeredCapacity: 1000, fetchedAt: 1 },
      incidentHistory: { matched: true, incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, fetchedAt: 1 },
    },
    evidence: [{ key: 'crowd', description: 'Expected attendance and venue capacity', sourceTimestamp: 1, source: 'event-version', status: 'available', quality: 'verified' }],
    sourceTimestamps: {}, contextStatuses: {}, assessmentReadiness: 'provisional', complianceStatus: 'review_required', complianceChecks: [], dataConfidenceScore: 50, dataConfidenceLevel: 'medium',
    inputHash: 'assessment-hash', createdAt: 5, warnings: [], authorityReviewRequired: true, manualReviewReason: 'AI timeout',
  };
}

function details() {
  return { name: 'Manual event', type: 'conference' as const, venueName: 'Hall', venueAddress: 'KL', venueCapacity: 1000, expectedAttendance: 100, environment: 'indoor' as const, coverage: 'covered' as const, seating: 'seated' as const, startDatetime: 10, endDatetime: 20, emergencyPlanSummary: 'Plan', organizerName: 'Org', organizerEmail: 'org@example.com', organizerPhone: '0123456789' };
}

void MANUAL_ASSESSMENT_SCHEMA_VERSION;
void MANUAL_OFFICIAL_FORMULA_VERSION;
void CATEGORY_SCHEMA_VERSION;
void HARD_RULE_VERSION;
