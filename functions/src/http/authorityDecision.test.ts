import { describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  ASSESSMENT_SCHEMA_VERSION,
  AssessmentRecord,
  AuthorityScoreReview,
  EventVersion,
  HARD_RULE_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  RESOURCE_KEYS,
  RESOURCE_CONFIG_VERSION,
  RESOURCE_FORMULA_VERSION,
  RESOURCE_SCHEMA_VERSION,
  RESOURCE_SOURCE_REGISTRY_VERSION,
  ResourceRecommendation,
  SCORE_REVIEW_SCHEMA_VERSION,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { computeResources } from '../engines/resourceCalculator';
import { aggregateDecisionStatus, assertOfficialAssessmentReady, validateDecisionRequest } from './authorityDecision';
import { buildAuthorityReviewState, buildOfficialAssessmentResult } from '../engines/authorityFinalisation';

describe('assertOfficialAssessmentReady', () => {
  it.each(['processing', 'manual_review_required', 'provisional_ready', 'authority_review', 'failed'] as const)(
    'blocks decisions while assessment status is %s',
    (status) => {
      expect(() => assertOfficialAssessmentReady(
        eventPointer('official-v1-hash'),
        'v1',
        { status } as AssessmentRecord,
        undefined,
        eventVersion(),
      )).toThrow(HttpsError);
    },
  );

  it('accepts only the current official assessment with matching resources', () => {
    expect(() => assertOfficialAssessmentReady(
      eventPointer(officialResources().resourceId),
      'v1',
      officialAssessment(),
      officialResources(),
      eventVersion(),
      [officialResources()],
      [scoreReview()],
    )).not.toThrow();
    expect(() => assertOfficialAssessmentReady(
      eventPointer(undefined),
      'v1',
      officialAssessment(),
      officialResources(),
      eventVersion(),
    )).toThrow(HttpsError);
  });

  it('accepts an official assessment ID that is distinct from the immutable version ID', () => {
    const assessmentId = 'assessment-v1-r2';
    const assessment = officialAssessment(assessmentId);
    const resources = officialResources(assessmentId);
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId, assessmentId),
      'v1',
      assessment,
      resources,
      eventVersion(),
      [resources],
      [scoreReview(assessmentId)],
    )).not.toThrow();
  });

  it('rejects incomplete official-looking records and provisional resources', () => {
    expect(() => assertOfficialAssessmentReady(
      eventPointer(officialResources().resourceId),
      'v1',
      { status: 'official_ready' } as AssessmentRecord,
      { ...officialResources(), stage: 'provisional' } as unknown as ResourceRecommendation,
      eventVersion(),
    )).toThrow(HttpsError);
  });

  it('rejects internally inconsistent official calculations', () => {
    const assessment = officialAssessment();
    if (assessment.status !== 'official_ready') throw new Error('Expected official fixture.');
    expect(() => assertOfficialAssessmentReady(
      eventPointer(officialResources().resourceId),
      'v1',
      { ...assessment, officialResult: { ...assessment.officialResult, overallScore: 99 } },
      officialResources(),
      eventVersion(),
    )).toThrow(HttpsError);
  });

  it('rejects resources with mismatched finalization metadata or incomplete provenance', () => {
    const mismatched = officialResources();
    if (mismatched.stage !== 'official') throw new Error('Expected official resource fixture.');
    const aiReference = mismatched.assessmentReference as Extract<ResourceRecommendation['assessmentReference'], { stage: 'official'; proposalId: string }>;
    expect(() => assertOfficialAssessmentReady(
      eventPointer(mismatched.resourceId), 'v1', officialAssessment(),
      { ...mismatched, assessmentReference: { ...aiReference, proposalId: 'other-proposal' } },
      eventVersion(),
    )).toThrow(HttpsError);
    expect(() => assertOfficialAssessmentReady(
      eventPointer(mismatched.resourceId), 'v1', officialAssessment(),
      { ...mismatched, items: { ...mismatched.items, police: { ...mismatched.items.police, appliedRules: [] } } },
      eventVersion(),
    )).toThrow(HttpsError);
  });

  it('keeps blocked compliance reviewable while rejecting resources not bound to the event or deterministic hash', () => {
    const assessment = officialAssessment();
    const resources = officialResources();
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId), 'v1', { ...assessment, complianceStatus: 'blocked' } as AssessmentRecord,
      resources, eventVersion(), [resources], [scoreReview()],
    )).not.toThrow();
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId), 'v1', assessment,
      { ...resources, eventId: 'other-event' }, eventVersion(),
    )).toThrow(HttpsError);
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId), 'v1', assessment,
      { ...resources, resourceInputHash: 'b'.repeat(64) }, eventVersion(),
    )).toThrow(HttpsError);
  });

  it('rejects deterministic item tampering even when the signed input hash is unchanged', () => {
    const resources = officialResources();
    const tampered = {
      ...resources,
      items: {
        ...resources.items,
        police: { ...resources.items.police, baseline: resources.items.police.baseline + 1 },
      },
    } as ResourceRecommendation;
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId), 'v1', officialAssessment(), tampered, eventVersion(), [tampered],
    )).toThrow(HttpsError);
  });

  it('rejects cross-event versions, assessments, and corrupt retained provisional results', () => {
    const resources = officialResources();
    const assessment = officialAssessment();
    if (assessment.status !== 'official_ready') throw new Error('Expected official assessment.');
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId), 'v1', { ...assessment, eventId: 'other-event' }, resources, eventVersion(), [resources],
    )).toThrow(HttpsError);
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId), 'v1', assessment, resources,
      { ...eventVersion(), eventId: 'other-event' }, [resources],
    )).toThrow(HttpsError);
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId), 'v1', {
        ...assessment,
        provisionalResult: { ...assessment.provisionalResult, overallScore: 99 },
      }, resources, eventVersion(), [resources],
    )).toThrow(HttpsError);
    const mismatchedProposal = structuredClone(assessment);
    if (mismatchedProposal.status !== 'official_ready') throw new Error('Expected official assessment.');
    mismatchedProposal.aiProposal.categories[0].likelihood = 1;
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId), 'v1', mismatchedProposal, resources, eventVersion(), [resources],
    )).toThrow(HttpsError);
  });

  it('requires the current official resource to be the unique revision-chain tip', () => {
    const resources = officialResources();
    const newer = {
      ...resources,
      resourceId: `official-v1-${'e'.repeat(64)}`,
      resourceInputHash: 'e'.repeat(64),
      revision: 2,
      supersedesResourceId: resources.resourceId,
    } as ResourceRecommendation;
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId), 'v1', officialAssessment(), resources, eventVersion(), [resources, newer],
    )).toThrow(HttpsError);
  });

  it('rejects official scores that are not exactly reproducible from stored review provenance', () => {
    const assessment = officialAssessment();
    const resources = officialResources();
    if (assessment.status !== 'official_ready') throw new Error('Expected official assessment.');
    const tampered = structuredClone(assessment);
    tampered.officialResult.categories[0].authorityLikelihood = 4;
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId), 'v1', tampered, resources, eventVersion(), [resources], [scoreReview()],
    )).toThrow(HttpsError);
    const alteredReview = { ...scoreReview(), rationale: 'A different rationale changes the signed review input.' };
    expect(() => assertOfficialAssessmentReady(
      eventPointer(resources.resourceId), 'v1', assessment, resources, eventVersion(), [resources], [alteredReview],
    )).toThrow(HttpsError);
  });
});

describe('officer decision boundary', () => {
  it('requires material confirmation for approval and suggestions for adverse recommendations', () => {
    expect(() => validateDecisionRequest({ eventId: 'event-1', decision: 'Approved', rationale: 'Reviewed all required materials.' })).toThrow(HttpsError);
    expect(validateDecisionRequest({ eventId: 'event-1', decision: 'Approved', rationale: 'Reviewed all required materials.', materialsReviewed: true })).toMatchObject({ materialsReviewed: true });
    expect(() => validateDecisionRequest({ eventId: 'event-1', decision: 'Rejected', rationale: 'Evidence is not sufficient.' })).toThrow(HttpsError);
    expect(validateDecisionRequest({ eventId: 'event-1', decision: 'Rejected', rationale: 'Evidence is not sufficient.', suggestion: 'Provide verified evidence and submit the application again.' })).toMatchObject({ decision: 'Rejected' });
  });

  it('rejects event IDs that could escape the event document path', () => {
    expect(() => validateDecisionRequest({ eventId: 'events/nested', decision: 'Rejected', rationale: 'Evidence is not sufficient.', suggestion: 'Provide verified evidence and submit the application again.' })).toThrow(HttpsError);
  });

  it('never turns officer recommendations into a final application status', () => {
    expect(aggregateDecisionStatus(['PDRM', 'BOMBA'], new Map([['PDRM', 'Approved'], ['BOMBA', 'Approved']]))).toBe('UnderReview');
    expect(aggregateDecisionStatus(['PDRM'], new Map([['PDRM', 'Rejected']]))).toBe('UnderReview');
  });
});

function officialAssessment(assessmentId = 'v1'): import('@shared/types').OfficialRiskAssessment {
  const categories = ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
    categoryId: category.id, categoryName: category.name,
    proposedLikelihood: 5, proposedSeverity: 5, validatedLikelihood: 5, validatedSeverity: 5,
    matrixScore: 25, normalizedScore: 100, riskLevel: 'High', weight: category.weight,
    weightedContribution: 12.5, evidenceReferences: ['crowd'], rationale: 'Test', confidence: 'high',
    concerns: [], missingInformation: [], appliedHardRules: [], guidelineChecks: [...category.guidelineChecks],
  }));
  const result = {
    proposalId: 'proposal-1', validatedHazards: [], categories, overallScore: 100,
    weightedRiskLevel: 'High', highestCategoryRiskLevel: 'High', overallRiskLevel: 'High',
    formulaVersion: PROVISIONAL_FORMULA_VERSION, categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    hardRuleVersion: HARD_RULE_VERSION, calculatedAt: 1,
  };
  const provisional = {
    status: 'authority_review',
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    assessmentId,
    eventId: 'event-1',
    versionId: 'v1',
    complianceStatus: 'pass',
    contextSnapshot: benignContextSnapshot(),
    createdAt: 1,
    aiProposal: {
      status: 'success', proposalId: 'proposal-1', model: 'test-model', promptVersion: 'test-prompt',
      responseSchemaVersion: 'test-schema', cacheStatus: 'miss', generatedAt: 1, hazards: [],
      categories: categories.map((category) => ({
        categoryId: category.categoryId, likelihood: category.proposedLikelihood, severity: category.proposedSeverity,
        evidenceReferences: category.evidenceReferences, rationale: category.rationale, confidence: category.confidence,
        concerns: category.concerns, missingInformation: category.missingInformation,
      })),
    },
    evidence: [{ key: 'crowd', description: 'Test attendance evidence', sourceTimestamp: 1, source: 'test', status: 'available', quality: 'verified' }],
    provisionalResult: result,
    inputHash: 'assessment-input-1',
    warnings: [],
    sourceTimestamps: {},
    contextStatuses: {},
    assessmentReadiness: 'complete',
    complianceChecks: [],
    dataConfidenceScore: 100,
    dataConfidenceLevel: 'high',
    authorityReviewRequired: true,
  } as const;
  const review = scoreReview(assessmentId);
  const authorityReviewState = buildAuthorityReviewState(['PDRM'], [review], 2);
  return {
    ...provisional,
    status: 'official_ready',
    authorityReviewRequired: false,
    authorityReviewState,
    officialResult: buildOfficialAssessmentResult({
      assessment: provisional as never,
      eventDetails: eventVersion().eventDetails,
      requiredAuthorities: ['PDRM'],
      reviews: [review],
      finalizedAt: 2,
      finalizedBy: 'system',
    }),
  } as unknown as import('@shared/types').OfficialRiskAssessment;
}

function scoreReview(assessmentId = 'v1'): AuthorityScoreReview {
  return {
    reviewId: 'review-pdrm-1', schemaVersion: SCORE_REVIEW_SCHEMA_VERSION, eventId: 'event-1', versionId: 'v1', assessmentId,
    proposalId: 'proposal-1', provisionalCalculatedAt: 1, assessmentInputHash: 'assessment-input-1',
    categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version, authorityType: 'PDRM', reviewerId: 'authority-1',
    categories: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ categoryId: category.id, likelihood: 5, severity: 5, decision: 'confirmed' as const })),
    rationale: 'All category evidence and advisory materials were reviewed.', idempotencyKey: 'review-key-0001', createdAt: 2,
  };
}

function benignContextSnapshot() {
  return {
    weather: {
      data: { forecast: 'Clear', temperature: 25, humidity: 50, windSpeed: 1, precipitationProbability: 0, severeAlert: false },
      source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 2, forecastFor: 1,
    },
    calendar: {
      localDate: '2026-08-19', dayOfWeek: 'Wednesday', isWeekend: false, isHolidayOrAdjacent: false,
      holidayDistanceDays: 10, sourceVersion: 'test', sourceTimestamp: 1,
    },
    venue: { matched: true, venueId: 'venue-1', submittedCapacity: 1_000, registeredCapacity: 1_000, capacityDifference: 0, fetchedAt: 1 },
    incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, fetchedAt: 1 },
  };
}

function officialResources(assessmentId = 'v1'): ResourceRecommendation {
  const assessment = officialAssessment(assessmentId);
  if (assessment.status !== 'official_ready') throw new Error('Expected official assessment.');
  const calculation = computeResources({
    eventId: 'event-1', versionId: 'v1', assessmentId,
    eventDetails: eventVersion().eventDetails, assessmentResult: assessment.officialResult,
  });
  if (!calculation.ok) throw new Error(calculation.message);
  const items = Object.fromEntries(RESOURCE_KEYS.map((resource) => [resource, {
    ...calculation.items[resource], confidence: 'authority_validated' as const, authorityReviewRequired: false,
  }])) as ResourceRecommendation['items'];
  return {
    resourceId: `official-v1-${calculation.resourceInputHash}`, eventId: 'event-1', versionId: 'v1', assessmentId,
    schemaVersion: RESOURCE_SCHEMA_VERSION, stage: 'official', revision: 1, supersedesResourceId: null,
    assessmentReference: { stage: 'official', assessmentId, proposalId: 'proposal-1', finalizedAt: 2, finalizedBy: 'system' },
    resourceInputHash: calculation.resourceInputHash, formulaVersion: RESOURCE_FORMULA_VERSION, configVersion: RESOURCE_CONFIG_VERSION, sourceRegistryVersion: RESOURCE_SOURCE_REGISTRY_VERSION,
    items, confidenceLevel: 'authority_validated', authorityReviewRequired: false, computedAt: 2,
  } as unknown as ResourceRecommendation;
}

function eventPointer(currentResourceId: string | undefined, currentAssessmentId = 'v1'): Pick<import('@shared/types').EventRecord, 'eventId' | 'currentAssessmentId' | 'currentResourceId' | 'requiredAuthorities'> {
  return { eventId: 'event-1', currentAssessmentId, currentResourceId, requiredAuthorities: ['PDRM'] };
}

function eventVersion(): EventVersion {
  return {
    versionId: 'v1', eventId: 'event-1', versionNumber: 1, documentPaths: [], submittedBy: 'organizer-1', submittedAt: 1, inputHash: 'hash',
    eventDetails: {
      name: 'Test event', type: 'conference', venueName: 'Venue', venueAddress: 'Kuala Lumpur',
      venueLocation: { lat: 3.1, lng: 101.6 }, venueCapacity: 1_000, expectedAttendance: 100,
      environment: 'indoor', coverage: 'covered', seating: 'seated', startDatetime: 1, endDatetime: 2,
      emergencyPlanSummary: 'Plan', organizerName: 'Organizer', organizerEmail: 'organizer@example.com', organizerPhone: '+60000000000',
    },
  };
}
