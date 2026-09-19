import { describe, expect, it } from 'vitest';
import type { EventRecord } from '@shared/types';
import { FIXED_WORKFLOW_PRESET_VERSION, fixedPresetForEvent, selectFixedWorkflowPreset } from './m3FixedWorkflowPreset';

const event = (type: 'sports' | 'festival' | 'concert' = 'sports', fixedWorkflowPreset?: EventRecord['fixedWorkflowPreset']) => ({
  eventDetails: { type },
  fixedWorkflowPreset,
});

describe('fixed Module 3 workflow presets', () => {
  it('prefers an Approved template for an exact type and risk match', () => {
    const preset = selectFixedWorkflowPreset('sports', 'Low');
    expect(preset.id).toBe('wellness-run');
    expect(preset.templateStatus).toBe('Approved');
  });

  it('falls back deterministically when no exact template exists', () => {
    const preset = selectFixedWorkflowPreset('concert', 'Low');
    expect(preset.id).toBe('merdeka-music');
    expect(preset.finalDecision).toBe('Rejected');
  });

  it('locks a previously selected template instead of rematching it', () => {
    const selected = {
      version: FIXED_WORKFLOW_PRESET_VERSION,
      presetId: 'heritage-night',
      templateStatus: 'Approved' as const,
      matchedEventType: 'cultural' as const,
      matchedRiskLevel: 'Medium' as const,
      selectedAt: 123,
    };
    const result = fixedPresetForEvent(event('festival', selected), 'High');
    expect(result.selection).toEqual(selected);
    expect(result.preset.id).toBe('heritage-night');
  });
});
