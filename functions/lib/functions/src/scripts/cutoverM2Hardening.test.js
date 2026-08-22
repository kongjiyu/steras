"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_path_1 = __importDefault(require("node:path"));
const cutoverM2Hardening_1 = require("./cutoverM2Hardening");
const onEventCreated_1 = require("../triggers/onEventCreated");
(0, vitest_1.describe)('M2 hardening cutover safety boundary', () => {
    (0, vitest_1.it)('is dry-run by default and canonicalizes backup paths', () => {
        const options = (0, cutoverM2Hardening_1.parseHardeningCutoverArguments)(['--project', 'linkos-496505', '--backup-dir', './backups']);
        (0, vitest_1.expect)(options.mode).toBe('plan');
        (0, vitest_1.expect)(node_path_1.default.isAbsolute(options.backupDirectory)).toBe(true);
        (0, vitest_1.expect)(() => (0, cutoverM2Hardening_1.validateHardeningCutoverOptions)(options)).not.toThrow();
    });
    (0, vitest_1.it)('requires exact project confirmation and trusted restore checksum', () => {
        (0, vitest_1.expect)(() => (0, cutoverM2Hardening_1.validateHardeningCutoverOptions)((0, cutoverM2Hardening_1.parseHardeningCutoverArguments)(['--project=x', '--mode=apply', '--confirm=x']))).toThrow(/project/);
        (0, vitest_1.expect)(() => (0, cutoverM2Hardening_1.validateHardeningCutoverOptions)((0, cutoverM2Hardening_1.parseHardeningCutoverArguments)(['--project=linkos-496505', '--mode=restore', '--confirm=linkos-496505', '--backup=/tmp/a.json']))).toThrow(/checksum/);
    });
    (0, vitest_1.it)('rejects paths outside the allowlisted immutable M2 scope', () => {
        const backup = { manifestVersion: 1, projectId: 'linkos-496505', sessionId: 's1', createdAt: 1, events: [], documents: [{ path: 'users/admin', data: { __sterasBackupType: 'map', value: {} } }] };
        (0, vitest_1.expect)((0, cutoverM2Hardening_1.validateHardeningBackup)(backup)).toContain('document-path');
        (0, vitest_1.expect)((0, cutoverM2Hardening_1.backupChecksum)('same')).toBe((0, cutoverM2Hardening_1.backupChecksum)('same'));
        (0, vitest_1.expect)((0, cutoverM2Hardening_1.backupChecksum)('same')).not.toBe((0, cutoverM2Hardening_1.backupChecksum)('changed'));
    });
    (0, vitest_1.it)('binds new assessment identity to schema processing inputs and the cutover generation', () => {
        const firstHash = (0, onEventCreated_1.assessmentInputHashForVersion)('a'.repeat(64), 'hardening-cutover-session-a');
        const replayHash = (0, onEventCreated_1.assessmentInputHashForVersion)('a'.repeat(64), 'hardening-cutover-session-a');
        const nextHash = (0, onEventCreated_1.assessmentInputHashForVersion)('a'.repeat(64), 'hardening-cutover-session-b');
        (0, vitest_1.expect)(firstHash).toBe(replayHash);
        (0, vitest_1.expect)(firstHash).not.toBe(nextHash);
        (0, vitest_1.expect)((0, onEventCreated_1.assessmentDocumentId)('v1', firstHash)).toMatch(/^v1-assessment-[a-f0-9]{24}$/);
    });
    (0, vitest_1.it)('rejects a malformed version fingerprint in a recovery manifest', () => {
        const backup = {
            manifestVersion: 1, projectId: 'linkos-496505', sessionId: 's1', createdAt: 1, documents: [],
            events: [{ eventId: 'event-1', path: 'events/event-1', currentVersionId: 'v1', versionInputHash: 'not-a-hash' }],
        };
        (0, vitest_1.expect)((0, cutoverM2Hardening_1.validateHardeningBackup)(backup)).toContain('version-input-hash');
    });
});
//# sourceMappingURL=cutoverM2Hardening.test.js.map