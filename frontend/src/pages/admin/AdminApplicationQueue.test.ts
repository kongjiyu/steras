import { describe, expect, it } from 'vitest';
import { getAdminQueueAction } from './AdminApplicationQueue';

const event = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'event-1', status: 'Pending' as const, reviewStage: null, initialReview: undefined, assignedOfficerUids: [], ...overrides,
});

describe('admin queue actions', () => {
  it('routes initial/manual work to Review', () => {
    expect(getAdminQueueAction(event())).toMatchObject({ label: 'Review', to: '/admin/applications/event-1' });
    expect(getAdminQueueAction(event({ status: 'Pending', reviewStage: 'initial' }))).toMatchObject({ label: 'Review' });
    expect(getAdminQueueAction(event({ status: 'Manual Review Required', reviewStage: 'manual' }))).toMatchObject({ label: 'Review' });
  });

  it('routes assignment handoff to assignment and final review to details', () => {
    expect(getAdminQueueAction(event({ status: 'UnderReview', reviewStage: 'initial', initialReview: { decision: 'Approved' } }))).toMatchObject({ label: 'Assign officers', to: '/admin/applications/event-1/assign' });
    expect(getAdminQueueAction(event({ status: 'UnderReview', reviewStage: 'second', assignedOfficerUids: ['officer'] }))).toMatchObject({ label: 'View', to: '/admin/applications/event-1' });
  });

  it('uses read-only View for authority-in-progress and terminal cases', () => {
    expect(getAdminQueueAction(event({ status: 'UnderReview', reviewStage: 'authority', assignedOfficerUids: ['officer'] }))).toMatchObject({ label: 'View', variant: 'secondary' });
    expect(getAdminQueueAction(event({ status: 'Approved', reviewStage: 'closed' }))).toMatchObject({ label: 'View', variant: 'secondary' });
  });
});
