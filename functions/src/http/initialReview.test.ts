import { describe, expect, it } from 'vitest';
import { ASSESSMENT_SCHEMA_VERSION, AISuccessfulProposal, EventRecord, ProvisionalRiskAssessment } from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { computeCategoryBasedAssessment } from '../engines/ruleBased';
import { validateAndCalculateProvisional } from '../engines/assessmentValidator';
import { isReviewableProvisionalAssessment, makeInitialReviewDecisionForUser } from './initialReview';

describe('makeInitialReviewDecisionForUser', () => {
  it('keeps inline legacy manual assessments out of the initial-review command', async () => {
    await expect(makeInitialReviewDecisionForUser('admin-1', {
      eventId: 'event-1',
      decision: 'Approved',
      reason: 'The submitted evidence and operational plan are ready for review.',
      manualAssessment: {} as never,
    } as never)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('accepts a complete current provisional assessment for the Admin-initial-review handoff', () => {
    const assessment = provisionalAssessment();
    expect(isReviewableProvisionalAssessment(assessment, 'event-1', 'v1', 'assessment-1')).toBe(true);
    expect(isReviewableProvisionalAssessment({ ...assessment, status: 'authority_review' }, 'event-1', 'v1', 'assessment-1')).toBe(false);
    expect(isReviewableProvisionalAssessment({ ...assessment, assessmentId: 'stale' }, 'event-1', 'v1', 'assessment-1')).toBe(false);
  });
});

function provisionalAssessment(): ProvisionalRiskAssessment {
  const event = {
    eventId: 'event-1', eventDetails: {
      name: 'Event', type: 'conference', venueName: 'Venue', venueAddress: 'Kuala Lumpur', venueCapacity: 2_000,
      expectedAttendance: 500, environment: 'indoor', coverage: 'covered', seating: 'seated', startDatetime: 10,
      endDatetime: 20, emergencyPlanSummary: 'Plan', organizerName: 'Organizer', organizerEmail: 'o@example.com', organizerPhone: '1',
    },
  } as EventRecord;
  const context = {
    weather: { data: { forecast: 'Clear', temperature: 25, humidity: 50, windSpeed: 1, precipitationProbability: 0, severeAlert: false }, measurementStatus: 'available' as const, source: 'openweather' as const, freshness: 'fresh' as const, fetchedAt: 1, expiresAt: 100, forecastFor: 10 },
    calendar: { localDate: '2026-08-21', dayOfWeek: 'Friday', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'test', sourceTimestamp: 1, coverageStatus: 'verified' as const },
    venue: { matched: true, venueId: 'venue-1', submittedCapacity: 2_000, registeredCapacity: 2_000, verifiedSafeCapacity: 2_000, capacityDifference: 0, fireCertificateStatus: 'valid' as const, emergencyAccessVerified: true, fetchedAt: 1 },
    incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, syntheticStatus: 'none' as const, fetchedAt: 1 },
  };
  const baseline = computeCategoryBasedAssessment(event, context, 1);
  const proposal: AISuccessfulProposal = {
    status: 'success', proposalId: 'proposal-1', model: 'test', promptVersion: 'test', responseSchemaVersion: 'test', cacheStatus: 'miss', generatedAt: 1, hazards: [],
    categories: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ categoryId: category.id, likelihood: 1, severity: 1, evidenceReferences: ['crowd'], rationale: 'Evidence reviewed.', confidence: 'high', concerns: [], missingInformation: [] })),
  };
  const validation = validateAndCalculateProvisional(proposal, baseline, 2);
  if (!validation.ok) throw new Error(validation.reason);
  return {
    status: 'provisional_ready', schemaVersion: ASSESSMENT_SCHEMA_VERSION, assessmentId: 'assessment-1', eventId: 'event-1', versionId: 'v1',
    contextSnapshot: context, evidence: baseline.evidence, contextEvidence: [{ evidenceId: 'document-1', evidenceKey: 'compliance', sourceKind: 'submitted_document', sourceLocator: 'events/event-1/versions/v1/documents/evidence.pdf', retrievedAt: 1, sourceVersion: '1', eligibility: 'eligible', synthetic: false, visibility: 'authority_only' }], sourceTimestamps: {}, contextStatuses: {}, assessmentReadiness: baseline.assessmentReadiness!,
    complianceStatus: baseline.complianceStatus!, complianceChecks: baseline.complianceChecks!, dataConfidenceScore: baseline.dataConfidenceScore!, dataConfidenceLevel: baseline.dataConfidenceLevel!,
    inputHash: 'hash', createdAt: 1, aiProposal: proposal, warnings: validation.warnings, authorityReviewRequired: true, provisionalResult: validation.result,
  };
}
