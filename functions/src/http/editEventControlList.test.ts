import { describe, expect, it } from 'vitest';
import type { Assignment, ProposedControlItem } from '@shared/types';
import { buildControlListSnapshot, resolveDefaultStage1Reviewer } from './editEventControlList';

describe('buildControlListSnapshot', () => {
  it('omits stage2Label when the proposal has no stage 2 requirement', () => {
    const items: ProposedControlItem[] = [{
      controlName: 'Tourism endorsement',
      authority: 'MOTAC',
      stageRequirement: 'stage1_only',
      stage1Requirements: [{ docType: 'other', label: 'Endorsement letter', required: true }],
      stage2Requirement: null,
    }];

    const [snapshot] = buildControlListSnapshot('event-1', items, 1);

    expect(snapshot).toEqual(expect.objectContaining({
      controlId: 'event-1-ctrl-motac-v1',
      stage1RequirementsCount: 1,
    }));
    expect(snapshot).not.toHaveProperty('stage2Label');
  });
});

describe('resolveDefaultStage1Reviewer', () => {
  const assignment = (overrides: Partial<Assignment> = {}): Assignment => ({
    assignmentId: 'v1_PDRM',
    eventId: 'event-1',
    versionId: 'v1',
    authorityType: 'PDRM',
    officerUid: 'pdrm-1',
    assignedBy: 'admin-1',
    assignedAt: 10,
    status: 'pending',
    ...overrides,
  });

  it('uses the current authority assignment when the control list is created later', () => {
    expect(resolveDefaultStage1Reviewer([assignment()], 'event-1', 'v1', 'PDRM')).toBe('pdrm-1');
  });

  it('ignores revoked, stale, and unrelated assignments', () => {
    expect(resolveDefaultStage1Reviewer([
      assignment({ status: 'revoked', officerUid: 'revoked-1' }),
      assignment({ versionId: 'v0', officerUid: 'old-1' }),
      assignment({ authorityType: 'BOMBA', officerUid: 'bomba-1' }),
    ], 'event-1', 'v1', 'PDRM')).toBeUndefined();
  });

  it('chooses the most recently assigned active replacement', () => {
    expect(resolveDefaultStage1Reviewer([
      assignment({ officerUid: 'old-1', assignedAt: 10 }),
      assignment({ officerUid: 'new-1', assignedAt: 20 }),
    ], 'event-1', 'v1', 'PDRM')).toBe('new-1');
  });
});
