import { describe, expect, it } from 'vitest';
import { allRequiredAssignmentsCompleted, assertCurrentOfficerAssignment } from './recordOfficerProposal';

const assignment = {
  assignmentId: 'v1_PDRM',
  eventId: 'event-1',
  versionId: 'v1',
  authorityType: 'PDRM',
  officerUid: 'officer-1',
  assignedBy: 'admin-1',
  assignedAt: 1,
  status: 'pending',
} as const;

describe('recordOfficerProposal transactional assignment fence', () => {
  it('accepts only the current canonical pending or in-progress assignment', () => {
    expect(() => assertCurrentOfficerAssignment(assignment, 'v1_PDRM', 'event-1', 'v1', 'PDRM', 'officer-1')).not.toThrow();
    expect(() => assertCurrentOfficerAssignment({ ...assignment, status: 'in_progress' }, 'v1_PDRM', 'event-1', 'v1', 'PDRM', 'officer-1')).not.toThrow();
  });

  it.each([
    [{ ...assignment, status: 'revoked' }, 'revoked concurrently'],
    [{ ...assignment, status: 'completed' }, 'completed concurrently'],
    [{ ...assignment, officerUid: 'replacement-officer' }, 'reassigned concurrently'],
    [{ ...assignment, authorityType: 'BOMBA' }, 'authority changed'],
    [{ ...assignment, versionId: 'v2' }, 'version changed'],
    [{ ...assignment, assignmentId: 'forged' }, 'non-canonical payload identity'],
    [undefined, 'assignment deleted'],
  ])('rejects %s (%s)', (candidate, label) => {
    expect(label).toBeTruthy();
    expect(() => assertCurrentOfficerAssignment(candidate, 'v1_PDRM', 'event-1', 'v1', 'PDRM', 'officer-1')).toThrow(/assignment changed/i);
  });

  it('does not treat revoked or stale officer assignments as completed', () => {
    const completed = { ...assignment, status: 'completed' as const };
    expect(allRequiredAssignmentsCompleted([completed], ['PDRM'], { PDRM: 'officer-1' }, 'v1')).toBe(true);
    expect(allRequiredAssignmentsCompleted([{ ...completed, status: 'revoked' }], ['PDRM'], { PDRM: 'officer-1' }, 'v1')).toBe(false);
    expect(allRequiredAssignmentsCompleted([completed], ['PDRM'], { PDRM: 'replacement-officer' }, 'v1')).toBe(false);
    expect(allRequiredAssignmentsCompleted([completed], ['PDRM', 'BOMBA'], { PDRM: 'officer-1' }, 'v1')).toBe(false);
  });
});
