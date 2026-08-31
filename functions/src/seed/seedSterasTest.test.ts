import { afterEach, describe, expect, it } from 'vitest';
import { STERAS_TEST_DATASET_ID, STERAS_TEST_EVENT_IDS } from '@shared/sterasTestFixtures';
import { assertSharedProjectAuthorization, parseSterasTestAction } from './seedSterasTest';

const originalAllow = process.env.STERAS_TEST_ALLOW_SHARED_PROJECT;
const originalConfirm = process.env.STERAS_TEST_CONFIRM_DATASET;

afterEach(() => {
  if (originalAllow === undefined) delete process.env.STERAS_TEST_ALLOW_SHARED_PROJECT;
  else process.env.STERAS_TEST_ALLOW_SHARED_PROJECT = originalAllow;
  if (originalConfirm === undefined) delete process.env.STERAS_TEST_CONFIRM_DATASET;
  else process.env.STERAS_TEST_CONFIRM_DATASET = originalConfirm;
});

describe('seedSterasTest safety contract', () => {
  it('publishes exactly two event identifiers for each of the sixteen jurisdictions', () => {
    expect(STERAS_TEST_EVENT_IDS).toHaveLength(32);
    expect(new Set(STERAS_TEST_EVENT_IDS).size).toBe(32);
    expect(STERAS_TEST_EVENT_IDS.every((id) => id.startsWith('steras-test-'))).toBe(true);
  });

  it('requires exactly one CLI action', () => {
    expect(parseSterasTestAction(['--dry-run'])).toBe('dry-run');
    expect(() => parseSterasTestAction([])).toThrow(/exactly one/i);
    expect(() => parseSterasTestAction(['--apply', '--verify'])).toThrow(/exactly one/i);
  });

  it('refuses writes without shared-project opt-in', () => {
    delete process.env.STERAS_TEST_ALLOW_SHARED_PROJECT;
    expect(() => assertSharedProjectAuthorization('linkos-496505', 'apply')).toThrow(/ALLOW_SHARED_PROJECT/);
    expect(() => assertSharedProjectAuthorization('another-project', 'dry-run')).toThrow(/locked/);
  });

  it('requires the exact dataset confirmation before cleanup', () => {
    process.env.STERAS_TEST_ALLOW_SHARED_PROJECT = 'true';
    process.env.STERAS_TEST_CONFIRM_DATASET = 'wrong-dataset';
    expect(() => assertSharedProjectAuthorization('linkos-496505', 'cleanup')).toThrow(STERAS_TEST_DATASET_ID);
    process.env.STERAS_TEST_CONFIRM_DATASET = STERAS_TEST_DATASET_ID;
    expect(() => assertSharedProjectAuthorization('linkos-496505', 'cleanup')).not.toThrow();
  });
});


