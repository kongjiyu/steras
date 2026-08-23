"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const m3UatFixtures_1 = require("../../../shared/m3UatFixtures");
const seedM3Uat_1 = require("./seedM3Uat");
const originalAllow = process.env.M3_UAT_ALLOW_SHARED_PROJECT;
const originalConfirm = process.env.M3_UAT_CONFIRM_DATASET;
(0, vitest_1.afterEach)(() => {
    if (originalAllow === undefined)
        delete process.env.M3_UAT_ALLOW_SHARED_PROJECT;
    else
        process.env.M3_UAT_ALLOW_SHARED_PROJECT = originalAllow;
    if (originalConfirm === undefined)
        delete process.env.M3_UAT_CONFIRM_DATASET;
    else
        process.env.M3_UAT_CONFIRM_DATASET = originalConfirm;
});
(0, vitest_1.describe)('seedM3Uat safety contract', () => {
    (0, vitest_1.it)('publishes exactly ten isolated event identifiers', () => {
        (0, vitest_1.expect)(m3UatFixtures_1.M3_UAT_EVENT_IDS).toHaveLength(10);
        (0, vitest_1.expect)(new Set(m3UatFixtures_1.M3_UAT_EVENT_IDS).size).toBe(10);
        (0, vitest_1.expect)(m3UatFixtures_1.M3_UAT_EVENT_IDS.every((id) => id.startsWith('m3-uat-'))).toBe(true);
    });
    (0, vitest_1.it)('requires exactly one CLI action', () => {
        (0, vitest_1.expect)((0, seedM3Uat_1.parseM3UatAction)(['--dry-run'])).toBe('dry-run');
        (0, vitest_1.expect)(() => (0, seedM3Uat_1.parseM3UatAction)([])).toThrow(/exactly one/i);
        (0, vitest_1.expect)(() => (0, seedM3Uat_1.parseM3UatAction)(['--apply', '--verify'])).toThrow(/exactly one/i);
    });
    (0, vitest_1.it)('refuses writes without shared-project opt-in', () => {
        delete process.env.M3_UAT_ALLOW_SHARED_PROJECT;
        (0, vitest_1.expect)(() => (0, seedM3Uat_1.assertSharedProjectAuthorization)('linkos-496505', 'apply')).toThrow(/ALLOW_SHARED_PROJECT/);
        (0, vitest_1.expect)(() => (0, seedM3Uat_1.assertSharedProjectAuthorization)('another-project', 'dry-run')).toThrow(/locked/);
    });
    (0, vitest_1.it)('requires the exact dataset confirmation before cleanup', () => {
        process.env.M3_UAT_ALLOW_SHARED_PROJECT = 'true';
        process.env.M3_UAT_CONFIRM_DATASET = 'wrong-dataset';
        (0, vitest_1.expect)(() => (0, seedM3Uat_1.assertSharedProjectAuthorization)('linkos-496505', 'cleanup')).toThrow(m3UatFixtures_1.M3_UAT_DATASET_ID);
        process.env.M3_UAT_CONFIRM_DATASET = m3UatFixtures_1.M3_UAT_DATASET_ID;
        (0, vitest_1.expect)(() => (0, seedM3Uat_1.assertSharedProjectAuthorization)('linkos-496505', 'cleanup')).not.toThrow();
    });
});
//# sourceMappingURL=seedM3Uat.test.js.map