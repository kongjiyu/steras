import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  backupChecksum,
  HARDENING_CUTOVER_BUCKET,
  parseHardeningCutoverArguments,
  validateHardeningBackup,
  validateHardeningCutoverOptions,
} from './cutoverM2Hardening';
import { assessmentDocumentId, assessmentInputHashForVersion } from '../triggers/onEventCreated';

describe('M2 hardening cutover safety boundary', () => {
  it('is dry-run by default and canonicalizes backup paths', () => {
    const options = parseHardeningCutoverArguments(['--project', 'linkos-496505', '--backup-dir', './backups']);
    expect(options.mode).toBe('plan');
    expect(path.isAbsolute(options.backupDirectory)).toBe(true);
    expect(() => validateHardeningCutoverOptions(options)).not.toThrow();
    expect(HARDENING_CUTOVER_BUCKET).toBe('linkos-496505.firebasestorage.app');
  });

  it('requires exact project confirmation and trusted restore checksum', () => {
    expect(() => validateHardeningCutoverOptions(parseHardeningCutoverArguments(['--project=x', '--mode=apply', '--confirm=x']))).toThrow(/project/);
    expect(() => validateHardeningCutoverOptions(parseHardeningCutoverArguments(['--project=linkos-496505', '--mode=restore', '--confirm=linkos-496505', '--backup=/tmp/a.json']))).toThrow(/checksum/);
  });

  it('rejects paths outside the allowlisted immutable M2 scope', () => {
    const backup = { manifestVersion: 1, projectId: 'linkos-496505', sessionId: 's1', createdAt: 1, events: [], documents: [{ path: 'users/admin', data: { __sterasBackupType: 'map', value: {} } }] };
    expect(validateHardeningBackup(backup)).toContain('document-path');
    expect(backupChecksum('same')).toBe(backupChecksum('same'));
    expect(backupChecksum('same')).not.toBe(backupChecksum('changed'));
  });

  it('binds new assessment identity to schema processing inputs and the cutover generation', () => {
    const firstHash = assessmentInputHashForVersion('a'.repeat(64), 'hardening-cutover-session-a');
    const replayHash = assessmentInputHashForVersion('a'.repeat(64), 'hardening-cutover-session-a');
    const nextHash = assessmentInputHashForVersion('a'.repeat(64), 'hardening-cutover-session-b');
    expect(firstHash).toBe(replayHash);
    expect(firstHash).not.toBe(nextHash);
    expect(assessmentDocumentId('v1', firstHash)).toMatch(/^v1-assessment-[a-f0-9]{24}$/);
  });

  it('rejects a malformed version fingerprint in a recovery manifest', () => {
    const backup = {
      manifestVersion: 1, projectId: 'linkos-496505', sessionId: 's1', createdAt: 1, documents: [],
      events: [{ eventId: 'event-1', path: 'events/event-1', currentVersionId: 'v1', versionInputHash: 'not-a-hash' }],
    };
    expect(validateHardeningBackup(backup)).toContain('version-input-hash');
  });
});
