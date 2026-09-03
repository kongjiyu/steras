import { describe, expect, it } from 'vitest';
import type { Assignment, EventRecord } from '@shared/types';
import { assertActiveScoreReviewAssignment, assertReviewableEvent } from './authorityScoreReview';

const event = {
  eventId: 'event-1', status: 'UnderReview', reviewStage: 'authority', currentVersionId: 'v1',
  currentAssessmentId: 'assessment-1', requiredAuthorities: ['PDRM'],
  assignedOfficerUids: ['officer-1'], assignedOfficerByAuthority: { PDRM: 'officer-1' },
} as EventRecord;

const assignment = {
  assignmentId: 'v1_PDRM', eventId: 'event-1', versionId: 'v1', authorityType: 'PDRM',
  officerUid: 'officer-1', status: 'pending', assignedBy: 'admin-1', assignedAt: 1,
} as Assignment;

describe('authority score-review assignment gate', () => {
  it('allows the named active officer only after Admin initial approval and assignment', () => {
    expect(assertReviewableEvent(event, 'PDRM', 'officer-1')).toEqual({ versionId: 'v1', assessmentId: 'assessment-1' });
    expect(() => assertActiveScoreReviewAssignment(assignment, 'v1_PDRM', 'event-1', 'v1', 'PDRM', 'officer-1')).not.toThrow();
  });

  it.each([
    [{ ...event, status: 'Pending', reviewStage: undefined }, 'pre-assignment pending event'],
    [{ ...event, reviewStage: 'initial' }, 'initial review without assignment release'],
    [{ ...event, assignedOfficerByAuthority: { PDRM: 'other' } }, 'different named officer'],
  ])('rejects %s (%s)', (candidate, label) => {
    expect(label).toBeTruthy();
    expect(() => assertReviewableEvent(candidate as EventRecord, 'PDRM', 'officer-1')).toThrow();
  });

  it.each(['revoked', 'completed'] as const)('rejects a %s assignment at transaction time', (status) => {
    expect(() => assertActiveScoreReviewAssignment({ ...assignment, status }, 'v1_PDRM', 'event-1', 'v1', 'PDRM', 'officer-1')).toThrow(/missing, revoked, completed, or stale/i);
  });
});
