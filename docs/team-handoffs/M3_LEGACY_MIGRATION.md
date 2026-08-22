# Module 3 legacy compatibility migration

## Current Linkos inventory

The read-only inventory on `linkos-496505` found 20 event documents:

- Ten `m3-uat-*` documents owned by the `m3-linkos-v1` UAT dataset.
- Three `uat-assessment-*` documents created by older UAT runs.
- Seven `evt-*` mock/Playwright fixtures from the legacy data shape.

Only the seven exact `evt-*` IDs are in
`functions/m3-legacy-migration-manifest.json`. The UAT and temporary
assessment IDs are explicit exclusions and must not be migrated or deleted by
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

Then run the same command for `evt-control-verification`. Verify the full
manifest after both applies:

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
- `evt-control-verification`: set only `reviewStage` to `initial`.
- The other five legacy fixtures: semantic no-op.
- No event status, approval decision, assignment document, control document,
  Stage 1/2 file, public projection, Storage object, Auth identity, or
  notification is changed.

If the dry-run proposes any field outside the manifest, any projection change,
or any inferred `initialReview`, stop and review the report before applying.
