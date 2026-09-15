import { describe, expect, it } from 'vitest';
import { parsePresentationArgs } from './seedPresentationPortfolio';

describe('presentation portfolio seed safety', () => {
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
  });

  it('requires exact confirmation for every write operation', () => {
    expect(() => parsePresentationArgs(['--apply', '--project', 'linkos-496505'])).toThrow('--confirm must be linkos-496505');
    expect(() => parsePresentationArgs(['--cleanup', '--project', 'linkos-496505', '--confirm', 'wrong'])).toThrow('--confirm must be linkos-496505');
    expect(parsePresentationArgs(['--apply', '--project', 'linkos-496505', '--confirm', 'linkos-496505'])).toEqual({ action: 'apply', projectId: 'linkos-496505' });
  });
});
