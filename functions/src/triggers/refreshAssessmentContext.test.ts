import { describe, expect, it } from 'vitest';
import { AssessmentRecord, EventRecord } from '@shared/types';
import { refreshGenerationFor, shouldRefreshAssessmentContext } from './refreshAssessmentContext';

const now = Date.UTC(2026, 7, 21, 0, 0, 0);
const event = {
  eventId: 'event-1', organizerId: 'organizer-1', status: 'Pending', currentVersionNumber: 1,
  currentVersionId: 'v1', currentAssessmentId: 'assessment-old', draftDocumentPaths: ['event_documents/event-1/v1/a.pdf'],
  requiredAuthorities: ['PDRM'], createdAt: now, updatedAt: now,
  eventDetails: { name: 'Event', type: 'festival', venueName: 'Venue', venueAddress: 'KL', venueCapacity: 100,
    expectedAttendance: 50, environment: 'outdoor', coverage: 'uncovered', seating: 'standing',
    startDatetime: now + 3 * 24 * 60 * 60 * 1_000, endDatetime: now + 4 * 24 * 60 * 60 * 1_000,
    emergencyPlanSummary: 'Plan', organizerName: 'Org', organizerEmail: 'org@example.com', organizerPhone: '+60' },
} satisfies EventRecord;

const assessment = {
  assessmentId: 'assessment-old', eventId: 'event-1', versionId: 'v1', status: 'manual_review_required',
  schemaVersion: '2026-08-21-prd-v5-hardening-v1', inputHash: 'a'.repeat(64), createdAt: now,
  contextSnapshot: {
    weather: { data: null, measurementStatus: 'unavailable', unavailableReason: 'outside_forecast_horizon', source: 'fallback', freshness: 'not_assessable_yet', fetchedAt: now, expiresAt: now, forecastFor: event.eventDetails.startDatetime },
    calendar: { localDate: '2026-08-24', dayOfWeek: 'Monday', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'test', sourceTimestamp: now, coverageStatus: 'verified' },
    venue: { matched: true, venueId: 'venue-1', submittedCapacity: 100, registeredCapacity: 100, fetchedAt: now },
    incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, syntheticStatus: 'none', fetchedAt: now },
  },
  evidence: [], contextEvidence: [{ evidenceId: 'document-evidence', evidenceKey: 'compliance', sourceKind: 'submitted_document', sourceLocator: 'event_documents/event-1/v1/a.pdf', retrievedAt: now, sourceVersion: 'storage-generation:1', eligibility: 'eligible', synthetic: false, visibility: 'authority_only' }], sourceTimestamps: {}, contextStatuses: {}, assessmentReadiness: 'provisional',
  complianceStatus: 'pass', complianceChecks: [], dataConfidenceScore: 50, dataConfidenceLevel: 'medium',
  aiProposal: { status: 'unavailable', model: 'MiniMax', promptVersion: 'v', responseSchemaVersion: 'v', retryable: true, errorSummary: 'Unavailable', cacheStatus: 'not-applicable', generatedAt: now },
  warnings: [], authorityReviewRequired: true, manualReviewReason: 'AI unavailable',
} as AssessmentRecord;

describe('scheduled assessment context refresh', () => {
  it('uses deterministic six-hour generation buckets', () => {
    expect(refreshGenerationFor(now)).toBe(refreshGenerationFor(now + 1));
    expect(refreshGenerationFor(now)).not.toBe(refreshGenerationFor(now + 6 * 60 * 60 * 1_000));
  });

  it('refreshes unavailable context inside the horizon, but freezes reviewed/manual/official generations', () => {
    expect(shouldRefreshAssessmentContext(event, assessment, now)).toBe(true);
    expect(shouldRefreshAssessmentContext(event, { ...assessment, activeManualAssessmentId: 'manual-1' } as AssessmentRecord, now)).toBe(false);
    expect(shouldRefreshAssessmentContext(event, {
      ...assessment, status: 'authority_review',
      authorityReviewState: { requiredAuthorities: ['PDRM'], activeReviewHeads: { PDRM: { reviewId: 'review-1', createdAt: now } }, conflicts: [], updatedAt: now },
    } as AssessmentRecord, now)).toBe(false);
  });
});
