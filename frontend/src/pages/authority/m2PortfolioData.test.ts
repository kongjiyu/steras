import { describe, expect, it } from 'vitest';
import { EventRecord, ResourceRecommendation, RiskAssessment, RiskLevel, hirarcRiskLevelFor, riskLevelFor } from '@shared/types';
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
import { mockAssessments } from '../../mock_data/assessments';

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

const makeResources = (confidenceLevel: 'prototype' | 'authorityValidated'): ResourceRecommendation => ({
  resourceId: 'v1', eventId: 'event-1', versionId: 'v1', assessmentId: 'v1',
  police: 10, security: 20, medicalTeams: 2, ambulances: 1, fireOfficers: 3, toilets: 8, wasteBins: 12,
  formulaVersion: 'formula-v1', guidelineVersion: 'guideline-v1', guidelineStatus: 'prototype', confidenceLevel,
  assessmentStage: confidenceLevel === 'authorityValidated' ? 'official' : 'provisional',
  rationales: Object.fromEntries((['police', 'security', 'medicalTeams', 'ambulances', 'fireOfficers', 'toilets', 'wasteBins'] as const)
    .map((resource) => [resource, { resource, baselineQuantity: 1, factors: ['attendance'], guidelineReferences: ['prototype'] }])) as ResourceRecommendation['rationales'],
  aiConsiderations: [], computedAt: 10,
});

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
    expect(isCurrentRiskAssessment({
      ...malformed,
      aiProposal: { ...malformed.aiProposal, proposalId: '' },
      provisionalResult: { ...malformed.provisionalResult, proposalId: '' },
    })).toBe(false);
    const job = {
      assessmentId: 'v1', eventId: 'event-1', versionId: 'v1', status: 'processing', inputHash: 'hash',
      claimId: 'claim', claimedAt: 1, leaseExpiresAt: 2, createdAt: 1,
    } as const;
    expect(isCurrentAssessmentRecord(job)).toBe(true);
    expect(isCurrentAssessmentRecord({ ...job, status: 'failed', error: 'test' })).toBe(true);
    expect(isCurrentAssessmentRecord({ status: 'processing' })).toBe(false);
    expect(isCurrentResourceRecommendation(makeResources('prototype'))).toBe(true);
    const legacyResource = { ...makeResources('prototype') } as Partial<ResourceRecommendation>;
    delete legacyResource.assessmentStage;
    expect(isCurrentResourceRecommendation(legacyResource)).toBe(false);
    expect(isCurrentResourceRecommendation({ police: 10, security: 20 })).toBe(false);
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
