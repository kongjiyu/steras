import { describe, expect, it } from 'vitest';
import { resolveControlListIntegrity } from './controlListIntegrity';

const base = {
  hasPublishedFlag: true,
  snapshotMatchesControls: true,
  proposalMatchesControls: false,
  proposalLoadState: 'missing' as const,
  hasPublishedArtifacts: true,
};

describe('resolveControlListIntegrity', () => {
  it('opens a matching legacy confirmed list read-only when the proposal is genuinely absent', () => {
    expect(resolveControlListIntegrity(base)).toBe('legacy-confirmed');
  });

  it('locks a proposal read failure instead of treating it as legacy data', () => {
    expect(resolveControlListIntegrity({ ...base, proposalLoadState: 'error' })).toBe('unreadable');
  });

  it('locks a published record when the controls subscription itself fails', () => {
    expect(resolveControlListIntegrity({ ...base, hasPublishedArtifacts: false, controlsUnreadable: true })).toBe('unreadable');
  });

  it('accepts a complete current confirmed record', () => {
    expect(resolveControlListIntegrity({ ...base, proposalMatchesControls: true, proposalLoadState: 'loaded' })).toBe('confirmed');
  });
});
