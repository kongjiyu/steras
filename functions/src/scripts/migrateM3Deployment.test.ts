import { describe, expect, it } from 'vitest';
import {
  canonicalStringMap,
  canonicalStringSet,
  decodeFirestoreValue,
  encodeFirestoreValue,
  fingerprint,
  parseMigrationArgs,
  sameStringMap,
  sameStringSet,
  validateMigrationManifest,
  type MigrationManifest,
} from './migrateM3Deployment';
import { Timestamp } from 'firebase-admin/firestore';

const baseManifest = (): MigrationManifest => ({
  migrationId: 'm3-legacy-linkos-2026-08',
  projectId: 'linkos-496505',
  eventIds: ['evt-legacy-one'],
  excludedEventIds: ['steras-test-johor-01'],
  allowedEventFields: { 'evt-legacy-one': ['reviewStage'] },
  allowProjectionChanges: false,
});

describe('M3 migration CLI safety', () => {
  it('defaults to a read-only dry-run and parses exact options', () => {
    expect(parseMigrationArgs([])).toEqual({ action: 'dry-run' });
    expect(parseMigrationArgs([
      '--dry-run',
      '--manifest',
      'manifest.json',
      '--event=evt-legacy-one',
      '--report',
      'report.json',
    ])).toEqual({
      action: 'dry-run',
      manifestPath: 'manifest.json',
      eventId: 'evt-legacy-one',
      reportPath: 'report.json',
    });
  });

  it('requires a manifest for apply and verify', () => {
    expect(() => parseMigrationArgs(['--apply'])).toThrow(/requires --manifest/);
    expect(() => parseMigrationArgs(['--verify'])).toThrow(/requires --manifest/);
    expect(parseMigrationArgs(['--rollback', 'snapshot.json'])).toEqual({ action: 'rollback', snapshotPath: 'snapshot.json' });
  });

  it('rejects STERAS test event IDs and unsupported fields in a migration manifest', () => {
    expect(() => validateMigrationManifest({ ...baseManifest(), eventIds: ['steras-test-johor-01'] }, 'linkos-496505')).toThrow(/fixture IDs/);
    expect(() => validateMigrationManifest({ ...baseManifest(), allowedEventFields: { 'evt-legacy-one': ['status'] } }, 'linkos-496505')).toThrow(/Unsupported migration field/);
    expect(() => validateMigrationManifest(baseManifest(), 'another-project')).toThrow(/credentials target/);
  });
});

describe('M3 migration semantic comparison', () => {
  it('treats assignment arrays as sets', () => {
    expect(canonicalStringSet(['uid-b', 'uid-a', 'uid-a'])).toEqual(['uid-a', 'uid-b']);
    expect(sameStringSet(['uid-b', 'uid-a'], ['uid-a', 'uid-b'])).toBe(true);
    expect(sameStringSet(['uid-a'], ['uid-a', 'uid-b'])).toBe(false);
  });

  it('treats authority maps as key-sorted records', () => {
    expect(canonicalStringMap({ KKM: 'uid-k', PDRM: 'uid-p' })).toEqual({ KKM: 'uid-k', PDRM: 'uid-p' });
    expect(sameStringMap({ PDRM: 'uid-p', KKM: 'uid-k' }, { KKM: 'uid-k', PDRM: 'uid-p' })).toBe(true);
  });
});

describe('M3 migration snapshot values', () => {
  it('round-trips Firestore timestamps without changing their type', () => {
    const original = { createdAt: new Timestamp(123, 456), nested: [{ value: 'ok' }] };
    const restored = decodeFirestoreValue(encodeFirestoreValue(original)) as typeof original;
    expect(restored.createdAt).toBeInstanceOf(Timestamp);
    expect((restored.createdAt as Timestamp).seconds).toBe(123);
    expect((restored.createdAt as Timestamp).nanoseconds).toBe(456);
    expect(restored.nested).toEqual([{ value: 'ok' }]);
  });

  it('produces deterministic fingerprints for equivalent values', () => {
    expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 }));
  });
});

