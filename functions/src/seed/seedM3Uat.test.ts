import { afterEach, describe, expect, it } from 'vitest';
import { M3_UAT_DATASET_ID, M3_UAT_EVENT_IDS } from '@shared/m3UatFixtures';
import { assertSharedProjectAuthorization, parseM3UatAction } from './seedM3Uat';

const originalAllow = process.env.M3_UAT_ALLOW_SHARED_PROJECT;
const originalConfirm = process.env.M3_UAT_CONFIRM_DATASET;

afterEach(() => {
  if (originalAllow === undefined) delete process.env.M3_UAT_ALLOW_SHARED_PROJECT;
  else process.env.M3_UAT_ALLOW_SHARED_PROJECT = originalAllow;
  if (originalConfirm === undefined) delete process.env.M3_UAT_CONFIRM_DATASET;
  else process.env.M3_UAT_CONFIRM_DATASET = originalConfirm;
});

describe('seedM3Uat safety contract', () => {
  it('publishes exactly ten isolated event identifiers', () => {
    expect(M3_UAT_EVENT_IDS).toHaveLength(10);
    expect(new Set(M3_UAT_EVENT_IDS).size).toBe(10);
    expect(M3_UAT_EVENT_IDS.every((id) => id.startsWith('m3-uat-'))).toBe(true);
  });

  it('requires exactly one CLI action', () => {
    expect(parseM3UatAction(['--dry-run'])).toBe('dry-run');
    expect(() => parseM3UatAction([])).toThrow(/exactly one/i);
    expect(() => parseM3UatAction(['--apply', '--verify'])).toThrow(/exactly one/i);
  });

  it('refuses writes without shared-project opt-in', () => {
    delete process.env.M3_UAT_ALLOW_SHARED_PROJECT;
    expect(() => assertSharedProjectAuthorization('linkos-496505', 'apply')).toThrow(/ALLOW_SHARED_PROJECT/);
    expect(() => assertSharedProjectAuthorization('another-project', 'dry-run')).toThrow(/locked/);
  });

  it('requires the exact dataset confirmation before cleanup', () => {
    process.env.M3_UAT_ALLOW_SHARED_PROJECT = 'true';
    process.env.M3_UAT_CONFIRM_DATASET = 'wrong-dataset';
    expect(() => assertSharedProjectAuthorization('linkos-496505', 'cleanup')).toThrow(M3_UAT_DATASET_ID);
    process.env.M3_UAT_CONFIRM_DATASET = M3_UAT_DATASET_ID;
    expect(() => assertSharedProjectAuthorization('linkos-496505', 'cleanup')).not.toThrow();
  });
});

