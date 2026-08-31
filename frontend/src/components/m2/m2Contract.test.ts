import { describe, expect, it } from 'vitest';
import { isCurrentEventVersion } from './m2Contract';

const version = {
  versionId: 'v2', eventId: 'event-1', versionNumber: 2,
  eventDetails: {
    name: 'Event', type: 'cultural', venueName: 'Venue', venueAddress: 'Address', venueCapacity: 100,
    expectedAttendance: 50, environment: 'outdoor', coverage: 'uncovered', seating: 'mixed',
    startDatetime: 2, endDatetime: 3, emergencyPlanSummary: 'Plan', organizerName: 'Organizer',
    organizerEmail: 'organizer@example.com', organizerPhone: '0123', riskProfile: {},
  },
  documentPaths: [], submittedBy: 'organizer-1', submittedAt: 1, inputHash: 'a'.repeat(64),
};

describe('M1 version provenance runtime guard', () => {
  it('accepts valid rejected-revision provenance', () => {
    expect(isCurrentEventVersion({
      ...version,
      revisionSource: {
        kind: 'rejected_revision', sourceVersionId: 'v1', startedAt: 1,
        rejectionReason: 'Missing signed plan.', rejectionSuggestion: 'Attach the signed plan.',
      },
    }, 'event-1', 'v2')).toBe(true);
  });

  it('rejects malformed or incomplete revision provenance', () => {
    expect(isCurrentEventVersion({ ...version, revisionSource: { kind: 'rejected_revision', sourceVersionId: '../v1', startedAt: 1 } })).toBe(false);
    expect(isCurrentEventVersion({ ...version, revisionSource: { kind: 'pending_edit', sourceVersionId: 'v1', startedAt: 1, rejectionReason: 'forged' } })).toBe(false);
    expect(isCurrentEventVersion({ ...version, revisionSource: { kind: 'unknown', sourceVersionId: 'v1', startedAt: 1 } })).toBe(false);
  });
});
