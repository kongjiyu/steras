# M3 legacy migration result

Date: 2026-08-24  
Product: STERAS  
Firebase project: `linkos-496505`  
Initial mode: read-only (`--dry-run`); no broad migration apply

## Manifest result

The exact manifest at `functions/m3-legacy-migration-manifest.json` scanned
seven legacy fixture IDs and returned:

| Metric | Result |
|---|---:|
| Events scanned | 7 |
| Events with planned changes | 1 |
| Assignment denormalisations | 1 |
| Review stages initialised | 0 |
| Public projections created/repaired | 0 |
| Stale public projections deleted | 0 |
| Anomalies | 0 |
| Manual-review requirements | 0 |
| Planned Firestore operations | 2 |

The current dry-run planned one event update:

- `evt-004-kl-marathon`: `assignedOfficerUids` and
  `assignedOfficerByAuthority` from active version `v2` assignments.
- The other six legacy IDs are semantic no-ops. The decision-contract migration
  for `evt-004-kl-marathon` is a separate exact-ID tool.

No broad event status, decision, control document, public projection, Storage
object, Auth identity, or notification migration is planned.

## Full inventory result

A separate inventory now contains 32 STERAS test events and eight historical
`evt-*` records. The 32 exact STERAS IDs are excluded from the migration
manifest, so broad `--apply` remains disabled.

## Safety check

An attempted apply without the production confirmation variables was rejected
before any Firestore read/write transaction:

```text
Refusing to apply the shared linkos-496505 project without M3_MIGRATION_ALLOW_PRODUCTION=true.
```

At the time of this guard test, no migration apply or rollback had been executed.

## Decision-contract result

The separate decision-contract dry-run, snapshot, idempotent apply, and verify
completed for the exact `evt-004-kl-marathon` record. Its snapshot contains one
event tree only; no broad migration was applied.

## Post-apply deployed validation

The deployed STERAS suites were run against the manifest-managed test dataset:

- `m3-smoke`: passed after one transient network timeout was recovered by the configured retry.
- `m3-full`: 32/32 passed.
- `m3-workstream1`: 7/7 passed.

The old ten-record test dataset, eight dedicated accounts, one managed venue,
and exact old projections/reports were removed after ownership-marker and
reference checks. No Storage files existed. The suite is intentionally allowed
to mutate only its own `steras-module3-test-v2` records.

