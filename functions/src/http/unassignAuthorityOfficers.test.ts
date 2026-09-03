import { describe, expect, it } from 'vitest';
import type { Assignment, EventRecord } from '@shared/types';
import { validateUnassignmentSnapshot } from './unassignAuthorityOfficers';

const event = {
  currentVersionId: 'version-1', status: 'UnderReview', reviewStage: 'authority',
  assignedOfficerByAuthority: { PDRM: 'PDRM-officer', BOMBA: 'BOMBA-officer' },
} as EventRecord;

function assignment(authorityType: Assignment['authorityType'], status: Assignment['status']): { id: string; value: Assignment } {
  const id = `version-1_${authorityType}`;
  return { id, value: { assignmentId: id, eventId: 'event-1234', versionId: 'version-1', authorityType, officerUid: `${authorityType}-officer`, status } as Assignment };
}

describe('officer unassignment transaction snapshot', () => {
  it('rejects an officer proposal that completed after the initial read', () => {
    expect(() => validateUnassignmentSnapshot(event, 'event-1234', 'version-1', [
      assignment('PDRM', 'completed'), assignment('BOMBA', 'pending'),
    ], 'PDRM')).toThrow(/completed a proposal/);
  });

  it('rejects withdrawal and generation changes', () => {
    expect(() => validateUnassignmentSnapshot({ ...event, status: 'Withdrawn' }, 'event-1234', 'version-1', [assignment('PDRM', 'pending')])).toThrow();
    expect(() => validateUnassignmentSnapshot({ ...event, currentVersionId: 'version-2' }, 'event-1234', 'version-1', [assignment('PDRM', 'pending')])).toThrow();
  });

  it('rejects forged assignment identities and returns only the requested authority', () => {
    const forged = assignment('PDRM', 'pending');
    forged.value.assignmentId = 'version-1_BOMBA';
    expect(() => validateUnassignmentSnapshot(event, 'event-1234', 'version-1', [forged])).toThrow(/invalid/);
    const wrongOfficer = assignment('PDRM', 'pending');
    wrongOfficer.value.officerUid = 'someone-else';
    expect(() => validateUnassignmentSnapshot(event, 'event-1234', 'version-1', [wrongOfficer])).toThrow(/invalid/);
    expect(validateUnassignmentSnapshot(event, 'event-1234', 'version-1', [
      assignment('PDRM', 'pending'), assignment('BOMBA', 'in_progress'),
    ], 'BOMBA')).toHaveLength(1);
  });
});
