import { describe, expect, it } from 'vitest';
import { hasPublicEvidence, parsePresentationArgs, shouldPublishPresentationEvent } from './seedPresentationPortfolio';

describe('presentation portfolio seed safety', () => {
  it('keeps managed post-final workflow applications out of the public projection', () => {
    expect(shouldPublishPresentationEvent('Approved', 'controls')).toBe(false);
    expect(shouldPublishPresentationEvent('Approved', 'stage1_submitted')).toBe(false);
    expect(shouldPublishPresentationEvent('Approved', 'stage2_submitted')).toBe(false);
    expect(shouldPublishPresentationEvent('Approved')).toBe(true);
    expect(shouldPublishPresentationEvent('Pending')).toBe(false);
  });
  it('detects orphaned public images even when the projection parent was deleted', () => {
    expect(hasPublicEvidence(false, 4, 0)).toBe(true);
    expect(hasPublicEvidence(false, 0, 1)).toBe(true);
    expect(hasPublicEvidence(false, 0, 0)).toBe(false);
  });
  it('requires exactly one explicit action', () => {
    expect(() => parsePresentationArgs(['--project', 'linkos-496505'])).toThrow('Choose exactly one action');
    expect(() => parsePresentationArgs(['--dry-run', '--verify', '--project', 'linkos-496505'])).toThrow('Choose exactly one action');
  });

  it('is locked to the production project named by the repository', () => {
    expect(() => parsePresentationArgs(['--dry-run', '--project', 'another-project'])).toThrow('--project must be linkos-496505');
  });

  it('allows read-only operations without destructive confirmation', () => {
    expect(parsePresentationArgs(['--dry-run', '--project', 'linkos-496505'])).toEqual({ action: 'dry-run', projectId: 'linkos-496505' });
    expect(parsePresentationArgs(['--verify', '--project', 'linkos-496505'])).toEqual({ action: 'verify', projectId: 'linkos-496505' });
    expect(parsePresentationArgs(['--verify', '--project', 'linkos-496505', '--only', 'presentation-putrajaya-community-run'])).toEqual({
      action: 'verify', projectId: 'linkos-496505', only: 'presentation-putrajaya-community-run',
    });
    expect(() => parsePresentationArgs(['--verify', '--project', 'linkos-496505', '--only', 'not-managed'])).toThrow('--only must identify');
    expect(parsePresentationArgs(['--verify', '--project', 'linkos-496505', '--only', 'presentation-craft-market'])).toEqual({
      action: 'verify', projectId: 'linkos-496505', only: 'presentation-craft-market',
    });
  });

  it('requires exact confirmation for every write operation', () => {
    expect(() => parsePresentationArgs(['--apply', '--project', 'linkos-496505'])).toThrow('--confirm must be linkos-496505');
    expect(() => parsePresentationArgs(['--cleanup', '--project', 'linkos-496505', '--confirm', 'wrong'])).toThrow('--confirm must be linkos-496505');
    expect(parsePresentationArgs(['--apply', '--project', 'linkos-496505', '--confirm', 'linkos-496505'])).toEqual({ action: 'apply', projectId: 'linkos-496505' });
  });
});
