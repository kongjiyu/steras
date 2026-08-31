# Module 3 legacy compatibility migration

## Current STERAS/Firebase inventory

The final inventory on Firebase project `linkos-496505` contains 40 event documents:

- Thirty-two `steras-test-*` documents owned by the `steras-module3-test-v2` STERAS test dataset.
- Eight `evt-*` mock/legacy fixtures from the historical data shape.

Only the seven exact `evt-*` IDs are in
`functions/m3-legacy-migration-manifest.json`. The STERAS test IDs and
temporary assessment IDs are explicit exclusions and must not be migrated by
this operation.

## Safe commands

Run from the repository root. The service-account key is supplied through
`GOOGLE_APPLICATION_CREDENTIALS`; never put its contents in a report or Git.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\to\linkos-496505-firebase-adminsdk.json'
$env:FIREBASE_PROJECT_ID='linkos-496505'
npm run migrate:m3:dry-run
```

The exact manifest dry-run is read-only. It must report zero public projection
operations and no anomalies or manual-review requirements. `--apply` is
blocked unless the operator explicitly sets:

```powershell
$env:M3_MIGRATION_ALLOW_PRODUCTION='true'
$env:M3_MIGRATION_CONFIRM_ID='m3-legacy-linkos-2026-08'
```

Before applying, create a Firestore managed export and save a report. Apply
one event at a time with an explicit snapshot path:

```powershell
npm --workspace functions run migrate:m3 -- --apply `
  --manifest m3-legacy-migration-manifest.json `
  --event evt-004-kl-marathon `
  --snapshot artifacts/m3-migration/evt-004.snapshot.json `
  --report artifacts/m3-migration/evt-004.apply.json
```

After the exact event apply, verify the full manifest:

```powershell
npm run migrate:m3:verify -- --snapshot artifacts/m3-migration/evt-control-verification.snapshot.json
```

Rollback is guarded by the snapshot's post-apply fingerprint and stops if an
operator changed a migrated document after the migration:

```powershell
npm --workspace functions run migrate:m3 -- --rollback artifacts/m3-migration/evt-004.snapshot.json
```

## Expected changes

- `evt-004-kl-marathon`: backfill `assignedOfficerUids` and
  `assignedOfficerByAuthority` from active assignments for version `v2`.
- The other six legacy fixtures: semantic no-op.
- No event status, approval decision, assignment document, control document,
  Stage 1/2 file, public projection, Storage object, Auth identity, or
  notification is changed.

If the dry-run proposes any field outside the manifest, any projection change,
or any inferred `initialReview`, stop and review the report before applying.

## Application decision-contract migration

This is a separate, narrower migration for the old Application
`AmendmentRequested` workflow. It is not the seven-event compatibility
migration above and must not be combined with a broad event scan.

It is locked to exactly `evt-004-kl-marathon` on
`linkos-496505`. The safe order is:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\to\linkos-496505-firebase-adminsdk.json'
$env:FIREBASE_PROJECT_ID='linkos-496505'
$env:M3_DECISION_MIGRATION_PROJECT_ID='linkos-496505'
$env:M3_DECISION_MIGRATION_ALLOW_SHARED_PROJECT='true'
$env:M3_DECISION_MIGRATION_CONFIRM='REJECT_APPLICATION_AMENDMENTS'
npm run migrate:m3:decision-contract:dry-run
npm run migrate:m3:decision-contract:snapshot
npm run migrate:m3:decision-contract:apply
npm run migrate:m3:decision-contract:verify
```

The snapshot command writes only the one target event tree, assignments,
officer workload documents, audit logs, and public projections to
`artifacts/m3-migration/decision-contract-snapshot.json`. Apply refuses to
start unless that exact snapshot exists and matches the migration identity and
allowlist. Keep the snapshot outside Git and retain it with the deployment
evidence for emergency manual recovery.

