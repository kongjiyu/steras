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

  it('serializes only bound M2 V3 official results and canonical resource items', () => {
    const input = JSON.parse(buildAllowedControlListInput({
      event,
      requiredAuthorities: ['PDRM'],
      assessment: {
        status: 'official_ready', assessmentReadiness: 'complete', complianceStatus: 'pass',
        officialResult: { overallScore: 72, overallRiskLevel: 'High', categories: [{ categoryId: 'crowd', validatedLikelihood: 4, validatedSeverity: 5, riskLevel: 'High', matrixScore: 20 }] },
        aiProposal: { hazards: [{ hazardId: 'h1', hazardName: 'Crowding', categoryId: 'crowd', rationale: 'private reasoning' }] },
      },
      resource: { stage: 'official', confidenceLevel: 'medium', validationScope: 'official_risk_input_only', items: { police: { baseline: 12, planningRange: { minimum: 10, maximum: 14 }, assumptions: ['private'] } } },
    }));
    expect(input.assessment).toMatchObject({ overallScore: 72, overallRiskLevel: 'High', categories: [{ categoryId: 'crowd', likelihood: 4, severity: 5 }] });
    expect(input.resources.items.police).toEqual({ baseline: 12, planningRange: { minimum: 10, maximum: 14 } });
    expect(JSON.stringify(input)).not.toContain('private reasoning');
    expect(JSON.stringify(input)).not.toContain('private');
  });

  it('does not reinterpret legacy flat scores or quantities as official M2 input', () => {
    const input = JSON.parse(buildAllowedControlListInput({ event, requiredAuthorities: ['PDRM'], assessment: { status: 'ready', officialScore: 99 }, resource: { police: 99 } }));
    expect(input.assessment).toBeNull();
    expect(input.resources).toBeNull();
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
