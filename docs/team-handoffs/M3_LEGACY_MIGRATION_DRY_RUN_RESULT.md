# M3 legacy migration result

Date: 2026-08-23  
Project: `linkos-496505`  
Initial mode: read-only (`--dry-run`); followed by the approved, manifest-only apply

## Manifest result

The exact manifest at `functions/m3-legacy-migration-manifest.json` scanned
seven legacy fixture IDs and returned:

| Metric | Result |
|---|---:|
| Events scanned | 7 |
| Events with planned changes | 2 |
| Assignment denormalisations | 1 |
| Review stages initialised | 1 |
| Public projections created/repaired | 0 |
| Stale public projections deleted | 0 |
| Anomalies | 0 |
| Manual-review requirements | 0 |
| Planned Firestore operations | 4 |

The two planned event updates are:

- `evt-004-kl-marathon`: `assignedOfficerUids` and
  `assignedOfficerByAuthority` from active version `v2` assignments.
- `evt-control-verification`: `reviewStage: initial` only.

The other five legacy IDs are semantic no-ops. Every operation is paired with
one migration audit log. No event status, decision, assignment document,
control document, public projection, Storage object, Auth identity, or
notification is planned to change.

## Full inventory result

A separate unscoped read-only scan found 20 events and 11 total candidate
operations, including five public projection operations, involving the current
`m3-uat-*` fixtures. This confirms that broad
`--apply` remains unsafe; only the exact manifest may be used for a production
apply.

## Safety check

An attempted apply without the production confirmation variables was rejected
before any Firestore read/write transaction:

```text
Refusing to apply the shared linkos-496505 project without M3_MIGRATION_ALLOW_PRODUCTION=true.
```

At the time of this guard test, no migration apply or rollback had been executed.

## Approved apply result

Before applying, a complete Firestore managed export was created and verified:

```text
gs://linkos-496505.firebasestorage.app/backups/m3-legacy-20260823-0035
```

The two manifest-approved updates were then applied one at a time:

- `evt-004-kl-marathon`: two event fields plus one audit log; snapshot verify passed.
- `evt-control-verification`: `reviewStage: initial` plus one audit log; snapshot verify passed.

The final seven-event manifest verify returned zero pending operations, zero
anomalies, zero projection operations and zero manual-review requirements.
The 13 explicitly excluded event trees retained their pre-apply fingerprints.

The earlier safety-check sentence refers to the pre-approval guard test. No
rollback has been executed.

## Post-apply deployed validation

After the migration, the deployed Linkos suites were run against the
manifest-managed UAT dataset:

- `m3-smoke`: passed after one transient network timeout was recovered by the configured retry.
- `m3-full`: 32/32 passed.
- `m3-workstream1`: 7/7 passed.

The final legacy manifest dry-run after these suites returned seven events,
zero changes, zero projections, zero anomalies and zero operations. The UAT
suite is intentionally allowed to mutate only its own `m3-linkos-v1` records.
