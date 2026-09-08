import { describe, expect, it } from 'vitest';
import type { ProposedControlItem } from '@shared/types';
import { buildControlListSnapshot } from './editEventControlList';

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
