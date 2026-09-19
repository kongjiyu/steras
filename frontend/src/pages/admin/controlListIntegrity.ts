import type { EventControl, EventRecord } from '@shared/types';

export type ControlListIntegrity = 'draft' | 'confirmed' | 'legacy-confirmed' | 'unreadable' | 'inconsistent';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const requirement = (value: unknown): boolean => record(value)
  && typeof value.docType === 'string'
  && typeof value.label === 'string'
  && typeof value.required === 'boolean';

export function isValidCurrentControl(value: unknown): value is EventControl {
  return record(value)
    && typeof value.controlId === 'string'
    && typeof value.eventId === 'string'
    && typeof value.versionId === 'string'
    && typeof value.controlName === 'string'
    && typeof value.authority === 'string'
    && (value.stageRequirement === 'stage1_only' || value.stageRequirement === 'stage1_and_stage2')
    && Number.isSafeInteger(value.controlItemVersion)
    && Array.isArray(value.stage1Requirements)
    && value.stage1Requirements.every(requirement)
    && (value.stage2Requirement === null || (record(value.stage2Requirement)
      && value.stage2Requirement.kind === 'image'
      && typeof value.stage2Requirement.label === 'string'));
}

export function isValidControlSnapshot(value: unknown): value is NonNullable<EventRecord['controlListSnapshot']> {
  return Array.isArray(value) && value.every((item) => record(item)
    && typeof item.controlId === 'string'
    && typeof item.controlName === 'string'
    && typeof item.authority === 'string'
    && (item.stageRequirement === 'stage1_only' || item.stageRequirement === 'stage1_and_stage2')
    && Number.isSafeInteger(item.controlItemVersion));
}

export interface ControlListIntegrityInput {
  hasPublishedFlag: boolean;
  snapshotMatchesControls: boolean;
  proposalMatchesControls: boolean;
  proposalLoadState: 'loading' | 'missing' | 'loaded' | 'error';
  hasPublishedArtifacts: boolean;
  controlsUnreadable?: boolean;
  malformedPublishedRecord?: boolean;
}
export function resolveControlListIntegrity(input: ControlListIntegrityInput): ControlListIntegrity {
  if (input.malformedPublishedRecord) return 'inconsistent';
  if (input.proposalLoadState === 'error' || input.controlsUnreadable) return 'unreadable';
  if (input.hasPublishedFlag && input.snapshotMatchesControls && input.proposalMatchesControls && input.proposalLoadState === 'loaded') return 'confirmed';
  if (input.snapshotMatchesControls && input.proposalLoadState === 'missing' && (input.hasPublishedFlag || input.hasPublishedArtifacts)) return 'legacy-confirmed';
  if (input.hasPublishedArtifacts && !input.proposalMatchesControls) return 'inconsistent';
  return 'draft';
}
