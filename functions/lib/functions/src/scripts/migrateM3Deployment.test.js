"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const migrateM3Deployment_1 = require("./migrateM3Deployment");
const firestore_1 = require("firebase-admin/firestore");
const baseManifest = () => ({
    migrationId: 'm3-legacy-linkos-2026-08',
    projectId: 'linkos-496505',
    eventIds: ['evt-legacy-one'],
    excludedEventIds: ['m3-uat-01-initial-ready'],
    allowedEventFields: { 'evt-legacy-one': ['reviewStage'] },
    allowProjectionChanges: false,
});
(0, vitest_1.describe)('M3 migration CLI safety', () => {
    (0, vitest_1.it)('defaults to a read-only dry-run and parses exact options', () => {
        (0, vitest_1.expect)((0, migrateM3Deployment_1.parseMigrationArgs)([])).toEqual({ action: 'dry-run' });
        (0, vitest_1.expect)((0, migrateM3Deployment_1.parseMigrationArgs)([
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
    (0, vitest_1.it)('requires a manifest for apply and verify', () => {
        (0, vitest_1.expect)(() => (0, migrateM3Deployment_1.parseMigrationArgs)(['--apply'])).toThrow(/requires --manifest/);
        (0, vitest_1.expect)(() => (0, migrateM3Deployment_1.parseMigrationArgs)(['--verify'])).toThrow(/requires --manifest/);
        (0, vitest_1.expect)((0, migrateM3Deployment_1.parseMigrationArgs)(['--rollback', 'snapshot.json'])).toEqual({ action: 'rollback', snapshotPath: 'snapshot.json' });
    });
    (0, vitest_1.it)('rejects UAT event IDs and unsupported fields in a migration manifest', () => {
        (0, vitest_1.expect)(() => (0, migrateM3Deployment_1.validateMigrationManifest)({ ...baseManifest(), eventIds: ['m3-uat-01-initial-ready'] }, 'linkos-496505')).toThrow(/UAT fixture/);
        (0, vitest_1.expect)(() => (0, migrateM3Deployment_1.validateMigrationManifest)({ ...baseManifest(), allowedEventFields: { 'evt-legacy-one': ['status'] } }, 'linkos-496505')).toThrow(/Unsupported migration field/);
        (0, vitest_1.expect)(() => (0, migrateM3Deployment_1.validateMigrationManifest)(baseManifest(), 'another-project')).toThrow(/credentials target/);
    });
});
(0, vitest_1.describe)('M3 migration semantic comparison', () => {
    (0, vitest_1.it)('treats assignment arrays as sets', () => {
        (0, vitest_1.expect)((0, migrateM3Deployment_1.canonicalStringSet)(['uid-b', 'uid-a', 'uid-a'])).toEqual(['uid-a', 'uid-b']);
        (0, vitest_1.expect)((0, migrateM3Deployment_1.sameStringSet)(['uid-b', 'uid-a'], ['uid-a', 'uid-b'])).toBe(true);
        (0, vitest_1.expect)((0, migrateM3Deployment_1.sameStringSet)(['uid-a'], ['uid-a', 'uid-b'])).toBe(false);
    });
    (0, vitest_1.it)('treats authority maps as key-sorted records', () => {
        (0, vitest_1.expect)((0, migrateM3Deployment_1.canonicalStringMap)({ KKM: 'uid-k', PDRM: 'uid-p' })).toEqual({ KKM: 'uid-k', PDRM: 'uid-p' });
        (0, vitest_1.expect)((0, migrateM3Deployment_1.sameStringMap)({ PDRM: 'uid-p', KKM: 'uid-k' }, { KKM: 'uid-k', PDRM: 'uid-p' })).toBe(true);
    });
});
(0, vitest_1.describe)('M3 migration snapshot values', () => {
    (0, vitest_1.it)('round-trips Firestore timestamps without changing their type', () => {
        const original = { createdAt: new firestore_1.Timestamp(123, 456), nested: [{ value: 'ok' }] };
        const restored = (0, migrateM3Deployment_1.decodeFirestoreValue)((0, migrateM3Deployment_1.encodeFirestoreValue)(original));
        (0, vitest_1.expect)(restored.createdAt).toBeInstanceOf(firestore_1.Timestamp);
        (0, vitest_1.expect)(restored.createdAt.seconds).toBe(123);
        (0, vitest_1.expect)(restored.createdAt.nanoseconds).toBe(456);
        (0, vitest_1.expect)(restored.nested).toEqual([{ value: 'ok' }]);
    });
    (0, vitest_1.it)('produces deterministic fingerprints for equivalent values', () => {
        (0, vitest_1.expect)((0, migrateM3Deployment_1.fingerprint)({ b: 2, a: 1 })).toBe((0, migrateM3Deployment_1.fingerprint)({ a: 1, b: 2 }));
    });
});
//# sourceMappingURL=migrateM3Deployment.test.js.map