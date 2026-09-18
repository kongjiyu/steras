export type ControlListIntegrity = 'draft' | 'confirmed' | 'legacy-confirmed' | 'unreadable' | 'inconsistent';

export interface ControlListIntegrityInput {
  hasPublishedFlag: boolean;
  snapshotMatchesControls: boolean;
  proposalMatchesControls: boolean;
  proposalLoadState: 'loading' | 'missing' | 'loaded' | 'error';
  hasPublishedArtifacts: boolean;
  controlsUnreadable?: boolean;
}
export function resolveControlListIntegrity(input: ControlListIntegrityInput): ControlListIntegrity {
  if (input.hasPublishedFlag && input.snapshotMatchesControls && input.proposalMatchesControls && input.proposalLoadState === 'loaded') return 'confirmed';
  if (input.hasPublishedFlag && input.snapshotMatchesControls && input.proposalLoadState === 'missing') return 'legacy-confirmed';
  if (input.hasPublishedArtifacts && (input.proposalLoadState === 'error' || input.controlsUnreadable)) return 'unreadable';
  if (input.hasPublishedArtifacts && !input.proposalMatchesControls) return 'inconsistent';
  return 'draft';
}
