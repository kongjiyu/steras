import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_SCHEMA_VERSION,
  AISuccessfulProposal,
  AuthorityScoreReview,
  AuthorityScoreResolution,
  EventRecord,
  ProvisionalRiskAssessment,
  SCORE_REVIEW_SCHEMA_VERSION,
  SCORE_RESOLUTION_SCHEMA_VERSION,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { computeCategoryBasedAssessment } from './ruleBased';
import { validateAndCalculateProvisional } from './assessmentValidator';
import {
  buildAuthorityReviewState,
  buildOfficialAssessmentResult,
  detectScoreConflicts,
  validateResolutionInput,
  validateScoreReviewInput,
} from './authorityFinalisation';

describe('authority score review contract', () => {
  it('requires exactly eight confirmed or reasoned overridden categories', () => {
    const proposal = fixture().aiProposal;
    const valid = proposal.categories.map((category) => ({
      categoryId: category.categoryId, likelihood: category.likelihood, severity: category.severity, decision: 'confirmed' as const,
    }));
    expect(validateScoreReviewInput({ categories: valid, rationale: 'Reviewed all supplied evidence.', idempotencyKey: 'review_key_01' }, proposal)).toEqual([]);
    expect(validateScoreReviewInput({ categories: valid.slice(1), rationale: 'Reviewed all supplied evidence.', idempotencyKey: 'review_key_02' }, proposal)).toContain('category-count');
    expect(validateScoreReviewInput({ categories: [{ ...valid[0], likelihood: 5 }, ...valid.slice(1)], rationale: 'Reviewed all supplied evidence.', idempotencyKey: 'review_key_03' }, proposal)).toContain(`confirmation-${valid[0].categoryId}`);
    expect(validateScoreReviewInput({ categories: [{ ...valid[0], decision: 'overridden', likelihood: 5, reason: 'short' }, ...valid.slice(1)], rationale: 'Reviewed all supplied evidence.', idempotencyKey: 'review_key_04' }, proposal)).toContain(`override-reason-${valid[0].categoryId}`);
  });

  it('detects score disagreement only after every required authority submitted', () => {
    const assessment = fixture();
    const pdrm = review(assessment, 'PDRM', 1);
    const bomba = review(assessment, 'BOMBA', 1);
    expect(detectScoreConflicts(['PDRM', 'BOMBA'], [pdrm])).toEqual([]);
    expect(detectScoreConflicts(['PDRM', 'BOMBA'], [pdrm, bomba])).toEqual([]);
    bomba.categories[0] = { ...bomba.categories[0], decision: 'overridden', likelihood: 5, reason: 'Verified crowd conditions require a higher score.' };
    expect(detectScoreConflicts(['PDRM', 'BOMBA'], [pdrm, bomba]).map((conflict) => conflict.categoryId)).toEqual([ACTIVE_CATEGORY_SCHEMA.categories[0].id]);
  });

  it('binds admin resolution to the exact review heads and every conflict', () => {
    const assessment = fixture();
    const pdrm = review(assessment, 'PDRM', 1);
    const bomba = review(assessment, 'BOMBA', 1);
    bomba.categories[0] = { ...bomba.categories[0], decision: 'overridden', likelihood: 5, reason: 'Verified crowd conditions require a higher score.' };
    const state = buildAuthorityReviewState(['PDRM', 'BOMBA'], [pdrm, bomba], 3);
    const input = {
      reviewHeadIds: { PDRM: pdrm.reviewId, BOMBA: bomba.reviewId },
      categories: [{ categoryId: state.conflicts[0].categoryId, likelihood: 4 as const, severity: 3 as const, reason: 'The submitted evidence supports the reconciled score.' }],
      rationale: 'Both authority submissions were considered and reconciled.',
    };
    expect(validateResolutionInput(input, state)).toEqual([]);
    expect(validateResolutionInput({ ...input, reviewHeadIds: { ...input.reviewHeadIds, BOMBA: 'stale' } }, state)).toContain('stale-review-heads');
    expect(validateResolutionInput({ ...input, categories: [] }, state)).toContain('resolution-category-count');
    expect(validateResolutionInput({ ...input, reviewHeadIds: null } as never, state)).toContain('review-heads');
    const resolution: AuthorityScoreResolution = {
      resolutionId: 'resolution-1',
      schemaVersion: SCORE_RESOLUTION_SCHEMA_VERSION,
      eventId: assessment.eventId,
      versionId: assessment.versionId,
      assessmentId: assessment.assessmentId,
      ...input,
      resolvedBy: 'admin-1',
      createdAt: 4,
    };
    expect(() => buildOfficialAssessmentResult({
      assessment,
      eventDetails: event().eventDetails,
      requiredAuthorities: ['PDRM', 'BOMBA'],
      reviews: [pdrm, bomba],
      resolution: { ...resolution, eventId: 'wrong-event' },
      finalizedAt: 5,
      finalizedBy: 'admin-1',
    })).toThrow('invalid-score-resolution-identity');
  });

  it('deterministically recalculates official scores and reapplies hard-rule floors', () => {
    const assessment = fixture();
    const authorityReview = review(assessment, 'PDRM', 1);
    const first = buildOfficialAssessmentResult({ assessment, eventDetails: event().eventDetails, requiredAuthorities: ['PDRM'], reviews: [authorityReview], finalizedAt: 10, finalizedBy: 'system' });
    const second = buildOfficialAssessmentResult({ assessment, eventDetails: event().eventDetails, requiredAuthorities: ['PDRM'], reviews: [authorityReview], finalizedAt: 10, finalizedBy: 'system' });
    const proposalChanged = {
      ...assessment,
      aiProposal: { ...assessment.aiProposal, model: 'different-model' },
    };
    const changed = buildOfficialAssessmentResult({ assessment: proposalChanged, eventDetails: event().eventDetails, requiredAuthorities: ['PDRM'], reviews: [authorityReview], finalizedAt: 10, finalizedBy: 'system' });
    expect(first).toEqual(second);
    expect(first.officialInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(changed.officialInputHash).not.toBe(first.officialInputHash);
    expect(first.reviewIds).toEqual([authorityReview.reviewId]);
    expect(first.categories).toHaveLength(8);
    expect(first.categories.every((category) => category.validatedLikelihood >= category.authorityLikelihood
      && category.validatedSeverity >= category.authoritySeverity)).toBe(true);
  });
});

function fixture(): ProvisionalRiskAssessment {
  const currentEvent = event();
  const context = {
    weather: { data: { forecast: 'Clear', temperature: 25, humidity: 50, windSpeed: 1, precipitationProbability: 0, severeAlert: false }, source: 'openweather' as const, freshness: 'fresh' as const, fetchedAt: 1, expiresAt: 100, forecastFor: 10 },
    calendar: { localDate: '2026-08-21', dayOfWeek: 'Friday', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'test', sourceTimestamp: 1 },
    venue: { matched: true, venueId: 'venue-1', submittedCapacity: 2_000, registeredCapacity: 2_000, verifiedSafeCapacity: 2_000, capacityDifference: 0, fireCertificateStatus: 'valid' as const, emergencyAccessVerified: true, fetchedAt: 1 },
    incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, fetchedAt: 1 },
  };
  const baseline = computeCategoryBasedAssessment(currentEvent, context, 1);
  const proposal: AISuccessfulProposal = {
    status: 'success', proposalId: 'proposal-1', model: 'test-model', promptVersion: 'test-prompt', responseSchemaVersion: 'test-response', cacheStatus: 'miss', generatedAt: 1,
    hazards: [],
    categories: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ categoryId: category.id, likelihood: 1, severity: 1, evidenceReferences: ['crowd'], rationale: 'Evidence was assessed for this category.', confidence: 'high', concerns: [], missingInformation: [] })),
  };
  const validation = validateAndCalculateProvisional(proposal, baseline, 2);
  if (!validation.ok) throw new Error(validation.reason);
  return {
    status: 'provisional_ready', assessmentId: 'v1', eventId: 'event-1', versionId: 'v1', schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    contextSnapshot: context, evidence: baseline.evidence, sourceTimestamps: {}, contextStatuses: {}, assessmentReadiness: baseline.assessmentReadiness!,
    complianceStatus: baseline.complianceStatus!, complianceChecks: baseline.complianceChecks!, dataConfidenceScore: baseline.dataConfidenceScore!,
    dataConfidenceLevel: baseline.dataConfidenceLevel!, inputHash: 'assessment-input-1', createdAt: 1, aiProposal: proposal,
    warnings: validation.warnings, authorityReviewRequired: true, provisionalResult: validation.result,
  };
}

function review(assessment: ProvisionalRiskAssessment, authorityType: 'PDRM' | 'BOMBA', score: 1 | 2 | 3 | 4 | 5): AuthorityScoreReview {
  return {
    reviewId: `review-${authorityType}`, schemaVersion: SCORE_REVIEW_SCHEMA_VERSION, eventId: assessment.eventId, versionId: assessment.versionId,
    assessmentId: assessment.assessmentId, proposalId: assessment.aiProposal.proposalId, provisionalCalculatedAt: assessment.provisionalResult.calculatedAt,
    assessmentInputHash: assessment.inputHash, categorySchemaVersion: assessment.provisionalResult.categorySchemaVersion, authorityType, reviewerId: `user-${authorityType}`,
    categories: assessment.aiProposal.categories.map((category) => score === category.likelihood
      ? { categoryId: category.categoryId, likelihood: category.likelihood, severity: category.severity, decision: 'confirmed' as const }
      : { categoryId: category.categoryId, likelihood: score, severity: score, decision: 'overridden' as const, reason: 'Verified evidence supports this authority override.' }),
    rationale: 'Reviewed the complete application, evidence and assessment.', idempotencyKey: `review_key_${authorityType}`, createdAt: 3,
  };
}

function event(): EventRecord {
  return {
    eventId: 'event-1', organizerId: 'organizer-1', status: 'Pending', currentVersionId: 'v1', currentVersionNumber: 1,
    draftDocumentPaths: [], requiredAuthorities: ['PDRM'], createdAt: 1, updatedAt: 1,
    eventDetails: { name: 'Test event', type: 'conference', venueName: 'Venue', venueAddress: 'Kuala Lumpur', venueCapacity: 2_000, expectedAttendance: 500, environment: 'indoor', coverage: 'covered', seating: 'seated', startDatetime: 10, endDatetime: 20, emergencyPlanSummary: 'Emergency plan.', organizerName: 'Organizer', organizerEmail: 'organizer@example.com', organizerPhone: '+60000000000' },
  };
}
