import { describe, expect, it } from 'vitest';
import { EventRecord, ResourceRecommendation, RiskAssessment, RiskLevel } from '@shared/types';
import {
  assessmentFreshness,
  filterResourcePortfolio,
  filterRiskPortfolio,
  isCurrentResourceRecommendation,
  isCurrentRiskAssessment,
  M2PortfolioRecord,
  resourcePortfolioSummary,
  riskPortfolioSummary,
} from './m2PortfolioData';

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
const makeAssessment = (risk: RiskLevel, score: number, aiStatus: 'success' | 'unavailable' = 'success'): RiskAssessment => ({
  assessmentId: 'v1', eventId: 'event-1', versionId: 'v1', status: 'ready',
  officialScore: score, officialRiskLevel: risk,
  categorySchemaVersion: 'schema-v1', scoringLogicVersion: 'logic-v1', categorySchemaStatus: 'prototype', computedAt: 10,
  categoryAssignments: [{
    categoryId: 'crowd', categoryName: 'Crowd pressure', score, riskLevel: risk, weight: 1,
    weightedContribution: score, rationale: 'Attendance and venue capacity.', evidenceKeys: ['crowd'], guidelineChecks: ['prototype.crowd'],
  }],
  evidence: [{ key: 'crowd', description: 'Attendance input', sourceTimestamp: 1, source: 'submission', status: 'matched' }],
  aiAdvisory: {
    model: 'MiniMax-M3', promptVersion: 'prompt-v1', responseSchemaVersion: 'ai-v1', status: aiStatus, label: 'advisory',
    overallBand: risk, overallExplanation: 'Advisory explanation.', categories: [], keyConcerns: [], resourceConsiderations: [],
    citedEvidenceKeys: ['crowd'], cacheStatus: 'miss', generatedAt: 10,
  },
  contextSnapshot: {
    weather: {
      data: { forecast: 'Clear', temperature: 30, humidity: 70, windSpeed: 2, precipitationProbability: 10, severeAlert: false },
      source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 2, forecastFor: 3,
    },
    calendar: { localDate: '2026-08-20', dayOfWeek: 'Thursday', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'calendar-v1', sourceTimestamp: 1 },
    venue: { matched: false, submittedCapacity: 2000, fetchedAt: 1 },
    incidentHistory: { matched: false, incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, fetchedAt: 1 },
  },
  sourceTimestamps: { event: 1 }, contextStatuses: { weather: 'fresh' }, inputHash: 'hash', createdAt: 10,
});

const makeResources = (confidenceLevel: 'prototype' | 'authorityValidated'): ResourceRecommendation => ({
  resourceId: 'v1', eventId: 'event-1', versionId: 'v1', assessmentId: 'v1',
  police: 10, security: 20, medicalTeams: 2, ambulances: 1, fireOfficers: 3, toilets: 8, wasteBins: 12,
  formulaVersion: 'formula-v1', guidelineVersion: 'guideline-v1', guidelineStatus: 'prototype', confidenceLevel,
  rationales: Object.fromEntries((['police', 'security', 'medicalTeams', 'ambulances', 'fireOfficers', 'toilets', 'wasteBins'] as const)
    .map((resource) => [resource, { resource, baselineQuantity: 1, factors: ['attendance'], guidelineReferences: ['prototype'] }])) as ResourceRecommendation['rationales'],
  aiConsiderations: [], computedAt: 10,
});

describe('M2 portfolio data', () => {
  it('accepts the category contract and rejects legacy baseline records', () => {
    expect(isCurrentRiskAssessment(makeAssessment('High', 82))).toBe(true);
    expect(isCurrentRiskAssessment({ status: 'ready', finalScore: 82, finalRiskLevel: 'High' })).toBe(false);
    expect(isCurrentResourceRecommendation(makeResources('prototype'))).toBe(true);
    expect(isCurrentResourceRecommendation({ police: 10, security: 20 })).toBe(false);
  });

  it('filters by official risk and orders higher risk first', () => {
    const records: M2PortfolioRecord[] = [
      { event: makeEvent('low', 'Low Forum', 3), assessment: makeAssessment('Low', 20) },
      { event: makeEvent('high', 'High Festival', 1), assessment: makeAssessment('High', 80) },
      { event: makeEvent('pending', 'Pending Fair', 2), assessmentStatus: 'processing' },
    ];
    expect(filterRiskPortfolio(records, 'all', '').map(({ event }) => event.eventId)).toEqual(['high', 'low', 'pending']);
    expect(filterRiskPortfolio(records, 'High', 'festival')).toHaveLength(1);
  });

  it('summarizes advisory failures, freshness, and resource quantities', () => {
    const records: M2PortfolioRecord[] = [
      { event: makeEvent('one', 'One', 1), assessment: makeAssessment('Medium', 55, 'unavailable'), resources: makeResources('prototype') },
      { event: makeEvent('two', 'Two', 2), assessmentStatus: 'processing' },
    ];
    expect(riskPortfolioSummary(records)).toMatchObject({ Medium: 1, Unassessed: 1, advisoryUnavailable: 2 });
    expect(assessmentFreshness(records[0].assessment)).toBe('fresh');
    expect(resourcePortfolioSummary(records)).toMatchObject({ recommended: 1, missing: 1, authorityValidated: 0 });
    expect(resourcePortfolioSummary(records).totals.police).toBe(10);
    expect(filterResourcePortfolio(records, 'missing', '')[0].event.eventId).toBe('two');
  });
});
