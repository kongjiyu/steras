import { describe, expect, it } from 'vitest';
import { AdminManualOfficialRiskAssessment, EventRecord, MANUAL_OFFICIAL_FORMULA_VERSION, ResourceRecommendation, RiskAssessment, RiskLevel, hirarcRiskLevelFor, riskLevelFor } from '@shared/types';
import {
  assessmentFreshness,
  filterResourcePortfolio,
  filterRiskPortfolio,
  isCurrentAssessmentRecord,
  isCurrentResourceRecommendation,
  isCurrentRiskAssessment,
  M2PortfolioRecord,
  resourcePortfolioSummary,
  riskPortfolioSummary,
} from './m2PortfolioData';
import { isCurrentAuthorityDecision, isCurrentEventRecord, isCurrentEventVersion, isSafeManualAssessmentId } from '../../components/m2/m2Contract';
import { mockAssessments } from '../../mock_data/assessments';
import { mockResourceRecommendations } from '../../mock_data/resources';

const makeEvent = (eventId: string, name: string, updatedAt: number): EventRecord => ({
  eventId,
  organizerId: 'organizer-1',
  status: 'Pending',
  currentVersionId: 'v1',
  currentVersionNumber: 1,
  draftDocumentPaths: [],
  requiredAuthorities: ['PDRM'],
  createdAt: updatedAt,
  updatedAt,
  eventDetails: {
    name,
    type: 'conference',
    venueName: 'PICC',
    venueAddress: 'Putrajaya',
    venueCapacity: 2000,
    expectedAttendance: 1000,
    environment: 'indoor',
    coverage: 'covered',
    seating: 'seated',
    startDatetime: Date.UTC(2026, 7, 20),
    endDatetime: Date.UTC(2026, 7, 20, 8),
    emergencyPlanSummary: 'On-site response team.',
    organizerName: 'Tourism Org',
    organizerEmail: 'organizer@example.com',
    organizerPhone: '0123456789',
  },
});
const makeAssessment = (risk: RiskLevel, aiStatus: 'success' | 'unavailable' = 'success'): RiskAssessment => {
  const calculated = mockAssessments.find((item) => item.status === 'provisional_ready')!;
  if (aiStatus === 'unavailable') {
    const manual = mockAssessments.find((item) => item.status === 'manual_review_required')!;
    return structuredClone(manual);
  }
  if (!('provisionalResult' in calculated)) throw new Error('Calculated fixture is missing.');
  const rating = risk === 'High' ? 4 : risk === 'Medium' ? 3 : 2;
  const matrixScore = rating * rating;
  const normalizedScore = matrixScore * 4;
  const categoryRiskLevel = hirarcRiskLevelFor(matrixScore);
  return {
    ...structuredClone(calculated),
    provisionalResult: {
      ...structuredClone(calculated.provisionalResult),
      categories: calculated.provisionalResult.categories.map((category) => ({
        ...structuredClone(category),
        proposedLikelihood: rating,
        proposedSeverity: rating,
        validatedLikelihood: rating,
        validatedSeverity: rating,
        matrixScore,
        normalizedScore,
        riskLevel: categoryRiskLevel,
        weightedContribution: normalizedScore * category.weight,
      })),
      overallScore: normalizedScore,
      weightedRiskLevel: riskLevelFor(normalizedScore),
      highestCategoryRiskLevel: categoryRiskLevel,
      overallRiskLevel: categoryRiskLevel,
    },
  };
};

const makeResources = (confidenceLevel: 'prototype' | 'authority_validated'): ResourceRecommendation => ({
  ...structuredClone(mockResourceRecommendations[0]),
  confidenceLevel,
  items: {
    ...structuredClone(mockResourceRecommendations[0].items),
    police: { ...structuredClone(mockResourceRecommendations[0].items.police), baseline: 10, planningRange: { min: 10, max: 13 } },
  },
});

const makeManualOfficial = (): AdminManualOfficialRiskAssessment => {
  const manual = makeAssessment('Low', 'unavailable');
  const calculated = makeAssessment('Low');
  if (manual.status !== 'manual_review_required' || !('provisionalResult' in calculated)) throw new Error('Fixtures are incomplete.');
  const categories = calculated.provisionalResult.categories.map((category) => ({
    categoryId: category.categoryId as import('@shared/types').HazardDomain, categoryName: category.categoryName,
    manualLikelihood: category.proposedLikelihood, manualSeverity: category.proposedSeverity,
    validatedLikelihood: category.validatedLikelihood, validatedSeverity: category.validatedSeverity,
    matrixScore: category.matrixScore, normalizedScore: category.normalizedScore, riskLevel: category.riskLevel,
    weight: category.weight, weightedContribution: category.weightedContribution,
    evidenceReferences: category.evidenceReferences, rationale: category.rationale, missingInformation: '',
    appliedHardRules: category.appliedHardRules, guidelineChecks: category.guidelineChecks,
  }));
  return {
    ...manual, status: 'official_ready', sourceKind: 'admin_manual', authorityReviewRequired: false,
    aiProposal: manual.aiProposal?.status === 'success' ? null : manual.aiProposal,
    activeManualAssessmentId: 'manual-v1',
    officialResult: {
      sourceKind: 'admin_manual', manualAssessmentId: 'manual-v1',
      manualHazards: [{ hazardId: 'h1', hazardName: 'Manual hazard', categoryId: 'crowd', evidenceReferences: ['crowd'], rationale: 'Admin identified the hazard from evidence.' }],
      categories, overallScore: calculated.provisionalResult.overallScore,
      weightedRiskLevel: calculated.provisionalResult.weightedRiskLevel,
      highestCategoryRiskLevel: calculated.provisionalResult.highestCategoryRiskLevel,
      overallRiskLevel: calculated.provisionalResult.overallRiskLevel,
      formulaVersion: MANUAL_OFFICIAL_FORMULA_VERSION,
      categorySchemaVersion: calculated.provisionalResult.categorySchemaVersion,
      hardRuleVersion: calculated.provisionalResult.hardRuleVersion,
      officialInputHash: 'a'.repeat(64), calculatedAt: 2, finalizedAt: 2, finalizedBy: 'admin-1',
    },
  };
};

describe('M2 portfolio data', () => {
  it('accepts the category contract and rejects legacy baseline records', () => {
    expect(isCurrentRiskAssessment(makeAssessment('High'))).toBe(true);
    expect(isCurrentRiskAssessment({ status: 'ready', finalScore: 82, finalRiskLevel: 'High' })).toBe(false);
    expect(isCurrentRiskAssessment({ ...makeAssessment('High'), status: 'official_ready' })).toBe(false);
    const malformed = makeAssessment('High');
    if (malformed.status !== 'provisional_ready') throw new Error('Expected provisional fixture.');
    expect(() => isCurrentRiskAssessment({
      ...malformed,
      provisionalResult: { ...malformed.provisionalResult, categories: [null] },
    })).not.toThrow();
    expect(isCurrentRiskAssessment({
      ...malformed,
      provisionalResult: { ...malformed.provisionalResult, categories: [null] },
    })).toBe(false);
    const malformedRule = structuredClone(malformed);
    if (malformedRule.status !== 'provisional_ready') throw new Error('Expected provisional fixture.');
    malformedRule.provisionalResult.categories[0].appliedHardRules = [null as never];
    expect(() => isCurrentRiskAssessment(malformedRule)).not.toThrow();
    expect(isCurrentRiskAssessment(malformedRule)).toBe(false);
    const malformedProposal = structuredClone(malformed);
    if (malformedProposal.status !== 'provisional_ready') throw new Error('Expected provisional fixture.');
    malformedProposal.aiProposal.categories[0] = { ...malformedProposal.aiProposal.categories[0], rationale: null as never };
    expect(() => isCurrentRiskAssessment(malformedProposal)).not.toThrow();
    expect(isCurrentRiskAssessment(malformedProposal)).toBe(false);
    expect(isCurrentRiskAssessment({
      ...malformed,
      aiProposal: { ...malformed.aiProposal, proposalId: '' },
      provisionalResult: { ...malformed.provisionalResult, proposalId: '' },
    })).toBe(false);
    const unsupportedEvidence = structuredClone(malformed);
    if (unsupportedEvidence.status !== 'provisional_ready') throw new Error('Expected provisional fixture.');
    unsupportedEvidence.provisionalResult.categories[0].evidenceReferences = ['not-in-assessment' as never];
    expect(isCurrentRiskAssessment(unsupportedEvidence)).toBe(false);
    const job = {
      assessmentId: 'v1', eventId: 'event-1', versionId: 'v1', status: 'processing', inputHash: 'hash',
      claimId: 'claim', claimedAt: 1, leaseExpiresAt: 2, createdAt: 1,
    } as const;
    expect(isCurrentAssessmentRecord(job)).toBe(true);
    expect(isCurrentAssessmentRecord({ ...job, status: 'failed', error: 'test' })).toBe(true);
    expect(isCurrentAssessmentRecord({ status: 'processing' })).toBe(false);
    expect(isCurrentResourceRecommendation(makeResources('prototype'))).toBe(true);
    const legacyResource = { ...makeResources('prototype') } as Partial<ResourceRecommendation>;
    delete legacyResource.schemaVersion;
    expect(isCurrentResourceRecommendation(legacyResource)).toBe(false);
    expect(isCurrentResourceRecommendation({ police: 10, security: 20 })).toBe(false);
    expect(isCurrentResourceRecommendation({ ...makeResources('prototype'), police: 10 })).toBe(false);
    const missingItem = structuredClone(makeResources('prototype')) as unknown as Record<string, unknown>;
    delete (missingItem.items as Record<string, unknown>).police;
    expect(isCurrentResourceRecommendation(missingItem)).toBe(false);
    const invalidRange = structuredClone(makeResources('prototype'));
    invalidRange.items.police.planningRange = { min: 11, max: 10 };
    expect(isCurrentResourceRecommendation(invalidRange)).toBe(false);
    const dishonestSource = structuredClone(makeResources('prototype'));
    dishonestSource.items.police.sourceSnapshots[0].kind = 'law';
    expect(isCurrentResourceRecommendation(dishonestSource)).toBe(false);
    const aliasedIdentity = structuredClone(makeResources('prototype'));
    aliasedIdentity.resourceId = 'provisional-v1-alias';
    expect(isCurrentResourceRecommendation(aliasedIdentity)).toBe(false);
    const duplicateInput = structuredClone(makeResources('prototype'));
    duplicateInput.items.police.inputReferences.push(duplicateInput.items.police.inputReferences[0]);
    expect(isCurrentResourceRecommendation(duplicateInput)).toBe(false);
    const invalidAuthority = structuredClone(makeResources('prototype')) as unknown as { items: { police: { reviewingAuthority: string } } };
    invalidAuthority.items.police.reviewingAuthority = 'UNKNOWN';
    expect(isCurrentResourceRecommendation(invalidAuthority)).toBe(false);
    const falseAuthoritySource = structuredClone(makeResources('prototype'));
    falseAuthoritySource.items.police.authoritySource = {
      status: 'supplied',
      source: falseAuthoritySource.items.police.sourceSnapshots[0],
    };
    expect(isCurrentResourceRecommendation(falseAuthoritySource)).toBe(false);
  });

  it('fails closed for malformed event documents before authority views dereference them', () => {
    const event = makeEvent('event-1', 'Safe event', 1);
    expect(isCurrentEventRecord(event, 'event-1')).toBe(true);
    expect(isCurrentEventRecord({ ...event, status: 'Draft', requiredAuthorities: [], currentVersionId: undefined, currentVersionNumber: 0 }, 'event-1')).toBe(true);
    expect(isCurrentEventRecord({ ...event, eventDetails: null }, 'event-1')).toBe(false);
    expect(isCurrentEventRecord({ ...event, requiredAuthorities: [null] }, 'event-1')).toBe(false);
    expect(isCurrentEventRecord({ ...event, currentVersionNumber: Number.NaN }, 'event-1')).toBe(false);
    expect(isCurrentEventRecord({ ...event, eventId: 'other' }, 'event-1')).toBe(false);
    expect(isSafeManualAssessmentId('manual-v1')).toBe(true);
    expect(isSafeManualAssessmentId('manual/child')).toBe(false);
    const version = {
      versionId: 'v1', eventId: 'event-1', versionNumber: 1, eventDetails: event.eventDetails,
      documentPaths: [], submittedBy: 'organizer-1', submittedAt: 1, inputHash: 'a'.repeat(64),
    };
    expect(isCurrentEventVersion(version, 'event-1', 'v1')).toBe(true);
    expect(isCurrentEventVersion({ ...version, inputHash: 'not-a-hash' }, 'event-1', 'v1')).toBe(false);
    const decision = {
      decisionId: 'v1_PDRM', eventId: 'event-1', versionId: 'v1', authorityType: 'PDRM',
      decision: 'Rejected', rationale: 'A sufficiently detailed decision rationale.', suggestion: 'Provide the missing safety evidence.',
      reviewerId: 'pdrm-1', decidedAt: 1, current: true,
    } as const;
    expect(isCurrentAuthorityDecision(decision, 'event-1', 'v1_PDRM')).toBe(true);
    expect(isCurrentAuthorityDecision({ ...decision, decidedAt: Number.NaN }, 'event-1', 'v1_PDRM')).toBe(false);
  });

  it('accepts strict manual official assessment/resource provenance and rejects ambiguous AI references', () => {
    const assessment = makeManualOfficial();
    expect(isCurrentRiskAssessment(assessment)).toBe(true);
    expect(isCurrentRiskAssessment({ ...assessment, officialResult: { ...assessment.officialResult, overallScore: 99 } })).toBe(false);
    const base = makeResources('authority_validated');
    const hash = base.resourceInputHash;
    const resource = {
      ...base, stage: 'official', resourceId: `official-${base.versionId}-${hash}`,
      assessmentReference: { stage: 'official', assessmentId: base.assessmentId, sourceKind: 'admin_manual', manualAssessmentId: 'manual-v1', finalizedAt: 2, finalizedBy: 'admin-1' },
      items: Object.fromEntries(Object.entries(base.items).map(([key, item]) => [key, { ...item, confidence: 'authority_validated', authorityReviewRequired: false }])),
      confidenceLevel: 'authority_validated', authorityReviewRequired: false,
      validationScope: 'official_risk_input_only',
    } as unknown as ResourceRecommendation;
    expect(isCurrentResourceRecommendation(resource)).toBe(true);
    expect(isCurrentResourceRecommendation({ ...resource, assessmentReference: { ...resource.assessmentReference, proposalId: 'fake-proposal' } })).toBe(false);
  });

  it('filters by current assessment risk and orders higher risk first', () => {
    const records: M2PortfolioRecord[] = [
      { event: makeEvent('low', 'Low Forum', 3), assessment: makeAssessment('Low') },
      { event: makeEvent('high', 'High Festival', 1), assessment: makeAssessment('High') },
      { event: makeEvent('pending', 'Pending Fair', 2), assessmentStatus: 'processing' },
    ];
    expect(filterRiskPortfolio(records, 'all', '').map(({ event }) => event.eventId)).toEqual(['high', 'low', 'pending']);
    expect(filterRiskPortfolio(records, 'High', 'festival')).toHaveLength(1);
  });

  it('summarizes advisory failures, freshness, and resource quantities', () => {
    const records: M2PortfolioRecord[] = [
      { event: makeEvent('one', 'One', 1), assessment: makeAssessment('Medium', 'unavailable'), resources: makeResources('prototype') },
      { event: makeEvent('two', 'Two', 2), assessmentStatus: 'processing' },
    ];
    expect(riskPortfolioSummary(records)).toMatchObject({ Medium: 0, Unassessed: 2, advisoryUnavailable: 2 });
    expect(assessmentFreshness(records[0].assessment)).toBe('fallback');
    expect(resourcePortfolioSummary(records)).toMatchObject({ recommended: 1, missing: 1, authorityValidated: 0 });
    expect(resourcePortfolioSummary(records).totals.police).toBe(10);
    expect(filterResourcePortfolio(records, 'missing', '')[0].event.eventId).toBe('two');
  });
});
