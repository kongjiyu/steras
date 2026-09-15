import { describe, expect, it } from 'vitest';
import type { Assignment, EventRecord } from '@shared/types';
import { assertActiveScoreReviewAssignment, assertReviewableEvent, shouldReopenDecisionAfterScoreRevision } from './authorityScoreReview';

describe('authority score revision decision handling', () => {
  it('reopens a completed assignment that already has a decision', () => {
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'completed', decision: 'Approved' })).toBe(true);
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'completed', decision: 'Rejected' })).toBe(true);
  });

  it('leaves undecided work in its existing assignment state', () => {
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'pending' })).toBe(false);
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'in_progress' })).toBe(false);
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'completed' })).toBe(false);
    expect(shouldReopenDecisionAfterScoreRevision({ status: 'revoked', decision: 'Approved' })).toBe(false);
  });
});

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

  it('allows a completed assignment for an in-stage score revision', () => {
    expect(() => assertActiveScoreReviewAssignment({ ...assignment, status: 'completed' }, 'v1_PDRM', 'event-1', 'v1', 'PDRM', 'officer-1')).not.toThrow();
  });

  it('rejects a revoked assignment at transaction time', () => {
    expect(() => assertActiveScoreReviewAssignment({ ...assignment, status: 'revoked' }, 'v1_PDRM', 'event-1', 'v1', 'PDRM', 'officer-1')).toThrow(/missing, revoked, completed, or stale/i);
  });
});
