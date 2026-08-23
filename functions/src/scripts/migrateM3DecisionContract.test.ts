import { describe, expect, it } from 'vitest';
import {
  DECISION_MIGRATION_CONFIRMATION,
  DECISION_MIGRATION_EVENT_IDS,
  assertDecisionMigrationAuthorization,
  assertDecisionMigrationSnapshot,
  parseDecisionMigrationArgs,
} from './migrateM3DecisionContract';

describe('Module 3 decision-contract migration safety', () => {
  it('defaults to both exact legacy IDs in read-only mode', () => {
    expect(parseDecisionMigrationArgs([])).toEqual({ action: 'dry-run' });
    expect(DECISION_MIGRATION_EVENT_IDS).toEqual([
      'evt-004-kl-marathon',
      'm3-uat-08-amendment',
    ]);
  });

  it('supports an explicit snapshot action without widening the ID allowlist', () => {
    expect(parseDecisionMigrationArgs(['--snapshot', '--report', 'artifacts/m3-snapshot.json'])).toEqual({
      action: 'snapshot',
      reportPath: 'artifacts/m3-snapshot.json',
    });
    expect(() => parseDecisionMigrationArgs(['--snapshot', '--event', 'evt-005-shah-alam-beach-carnival'])).toThrow(/exact migration IDs/);
    expect(parseDecisionMigrationArgs(['--apply', '--snapshot-file', 'artifacts/m3-snapshot.json'])).toEqual({
      action: 'apply',
      snapshotPath: 'artifacts/m3-snapshot.json',
    });
  });

  it('rejects a missing snapshot before any migration write can start', () => {
    expect(() => assertDecisionMigrationSnapshot('artifacts/does-not-exist.json')).toThrow(/Unable to read migration snapshot/);
  });

  it('rejects IDs outside the explicit allowlist', () => {
    expect(() => parseDecisionMigrationArgs(['--event', 'evt-005-shah-alam-beach-carnival'])).toThrow(/exact migration IDs/);
  });

  it('requires explicit shared-project authorization for apply', () => {
    expect(() => assertDecisionMigrationAuthorization('dry-run', {
      M3_DECISION_MIGRATION_PROJECT_ID: 'linkos-496505',
    })).not.toThrow();
    expect(() => assertDecisionMigrationAuthorization('apply', {
      M3_DECISION_MIGRATION_PROJECT_ID: 'linkos-496505',
    })).toThrow(/ALLOW_SHARED_PROJECT/);
    expect(() => assertDecisionMigrationAuthorization('apply', {
      M3_DECISION_MIGRATION_PROJECT_ID: 'linkos-496505',
      M3_DECISION_MIGRATION_ALLOW_SHARED_PROJECT: 'true',
      M3_DECISION_MIGRATION_CONFIRM: DECISION_MIGRATION_CONFIRMATION,
    })).not.toThrow();
  });
});
