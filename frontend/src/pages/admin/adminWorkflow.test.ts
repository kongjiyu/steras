import { describe, expect, it } from 'vitest';
import type { EventRecord } from '@shared/types';
import { adminWorkflowState } from './adminWorkflow';

const NOW = Date.parse('2026-09-08T00:00:00Z');
function event(patch: Partial<EventRecord> = {}): EventRecord {
  return {
    eventId: 'event-1', organizerId: 'organizer-1', status: 'Pending', currentVersionNumber: 1,
    draftDocumentPaths: [], requiredAuthorities: ['PDRM'], createdAt: NOW - 4 * 86_400_000,
    updatedAt: NOW - 4 * 86_400_000,
    eventDetails: { name: 'Demo', type: 'festival', venueName: 'Venue', venueAddress: 'Address', venueCapacity: 1000, expectedAttendance: 500, environment: 'outdoor', coverage: 'uncovered', seating: 'mixed', startDatetime: NOW + 5 * 86_400_000, endDatetime: NOW + 6 * 86_400_000, emergencyPlanSummary: 'Plan', organizerName: 'Organiser', organizerEmail: 'demo@example.com', organizerPhone: '1' },
    ...patch,
  };
}

describe('admin workflow presentation', () => {
  it('places a clean pending application in the initial decision queue', () => {
    expect(adminWorkflowState(event(), NOW)).toMatchObject({ stage: 'Initial decision', needsAction: true, priority: 'High', actionLabel: 'Review' });
  });
  it('shows assignment only after initial approval', () => {
    expect(adminWorkflowState(event({ status: 'UnderReview', reviewStage: 'initial', initialReview: { decision: 'Approved', reason: '', reviewerUid: 'admin', reviewedAt: NOW } }), NOW)).toMatchObject({ stage: 'Assign officers', actionLabel: 'Assign' });
  });
  it('keeps officer completion in final admin decision without changing event status', () => {
    expect(adminWorkflowState(event({ status: 'UnderReview', reviewStage: 'second', assignedOfficerUids: ['officer'] }), NOW)).toMatchObject({ stage: 'Final decision', needsAction: true, actionLabel: 'Decide' });
  });
  it('shows the post-approval documentation phase after controls publish', () => {
    expect(adminWorkflowState(event({ status: 'Approved', reviewStage: null, controlListGenerated: true }), NOW)).toMatchObject({ stage: 'Awaiting organiser documentation', needsAction: false });
  });
});
