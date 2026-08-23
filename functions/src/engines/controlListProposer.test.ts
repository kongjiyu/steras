import { describe, expect, it } from 'vitest';
import type { EventRecord, ProposedControlItem } from '@shared/types';
import {
  buildAllowedControlListInput,
  parseControlListProposal,
  proposeControlListWithMiniMax,
} from './controlListProposer';

const fallback: ProposedControlItem[] = [{
  controlName: 'PDRM compliance',
  authority: 'PDRM',
  stageRequirement: 'stage1_and_stage2',
  stage1Requirements: [{ docType: 'application', label: 'Acknowledgement', required: true }],
  stage2Requirement: { kind: 'image', label: 'PDRM venue photo' },
}];

const event = {
  eventId: 'evt-1',
  organizerId: 'private-organizer-uid',
  eventDetails: {
    name: 'Private event name',
    organizerEmail: 'private@example.com',
    type: 'cultural',
    venueName: 'Venue',
    venueAddress: 'Address',
    venueLocation: { lat: 3.1, lng: 101.7 },
    venueCapacity: 1000,
    expectedAttendance: 500,
    environment: 'outdoor',
    coverage: 'uncovered',
    seating: 'mixed',
    startDatetime: 1,
    endDatetime: 3_601,
    emergencyPlanSummary: 'Plan',
    organizerName: 'Private organizer',
    organizerPhone: 'private-phone',
  },
} as unknown as EventRecord;

describe('control-list MiniMax contract', () => {
  it('keeps the proposal input free of organizer identity fields', () => {
    const input = buildAllowedControlListInput({ event, requiredAuthorities: ['PDRM'] });
    expect(input).not.toContain('private@example.com');
    expect(input).not.toContain('private-organizer-uid');
    expect(input).not.toContain('Private organizer');
    expect(input).toContain('PDRM');
  });

  it('validates a complete one-control-per-authority response', () => {
    const items = parseControlListProposal(JSON.stringify({ controls: [{
      controlName: 'PDRM compliance',
      authority: 'PDRM',
      stageRequirement: 'stage1_and_stage2',
      stage1Requirements: [{ docType: 'application', label: 'Acknowledgement', required: true }],
      stage2Requirement: { kind: 'image', label: 'PDRM venue photo' },
    }] }), ['PDRM']);
    expect(items).toEqual(fallback);
  });

  it('rejects unknown authorities and duplicate authorities', () => {
    const item = { controlName: 'x', authority: 'KKM', stageRequirement: 'stage1_only', stage1Requirements: [], stage2Requirement: null };
    expect(() => parseControlListProposal(JSON.stringify({ controls: [item] }), ['PDRM'])).toThrow(/unrequired authority/i);
    expect(() => parseControlListProposal(JSON.stringify({ controls: [
      { ...item, authority: 'PDRM' },
      { ...item, authority: 'PDRM' },
    ] }), ['PDRM', 'BOMBA'])).toThrow(/duplicate authority/i);
  });

  it('returns an explicit deterministic fallback when MiniMax is unavailable', async () => {
    const result = await proposeControlListWithMiniMax('', { event, requiredAuthorities: ['PDRM'] }, fallback, { now: 10 });
    expect(result).toMatchObject({ source: 'deterministic_fallback', generatedAt: 10, items: fallback });
  });

  it('uses and validates a mocked MiniMax response', async () => {
    const result = await proposeControlListWithMiniMax('secret', { event, requiredAuthorities: ['PDRM'] }, fallback, {
      now: 20,
      request: async () => JSON.stringify({ controls: [{
        controlName: 'AI PDRM compliance',
        authority: 'PDRM',
        stageRequirement: 'stage1_and_stage2',
        stage1Requirements: [{ docType: 'license', label: 'Licence', required: true }],
        stage2Requirement: { kind: 'image', label: 'On-site photo' },
      }] }),
    });
    expect(result).toMatchObject({ source: 'minimax', generatedAt: 20 });
    expect(result.items[0].controlName).toBe('AI PDRM compliance');
  });
});
