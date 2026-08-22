# Module 3 — linkos UAT runbook

Target: `linkos-496505` / <https://linkos-496505.web.app>

The dataset is isolated by the fixed ID `m3-linkos-v1`. Seed, reset and
cleanup commands refuse to touch a colliding document unless it carries the
matching `m3Uat` ownership marker. Existing non-UAT events and accounts are
outside the manifest and must never be removed by these commands.

## Prerequisites

- Node.js 22 and Java 21 (Java 21 is required for Firebase rules emulator tests).
- Firebase CLI login with deploy permission.
- Application Default Credentials with Firebase Auth, Firestore and Storage access.
- A temporary UAT password of at least 12 characters. Do not commit it.

PowerShell environment:

```powershell
$env:FIREBASE_PROJECT_ID='linkos-496505'
$env:M3_UAT_ALLOW_SHARED_PROJECT='true'
$env:M3_UAT_PASSWORD='<temporary-password-at-least-12-characters>'
$env:M3_UAT_STORAGE_BUCKET='linkos-496505.firebasestorage.app'
```

## Seed and verify

```powershell
npm run seed:m3:uat -- --dry-run
npm run seed:m3:uat -- --apply
npm run seed:m3:uat -- --verify
```

`--apply` is idempotent: it resets only the ten owned event trees, their exact
public projections, event-scoped notifications/reports, and exact Storage
prefixes before recreating the dataset.

## Playwright

Set the additional environment variables:

```powershell
$env:STERAS_BASE_URL='https://linkos-496505.web.app'
$env:STERAS_E2E_PROJECT_ID='linkos-496505'
$env:STERAS_E2E_ALLOW_RESET='true'
$env:STERAS_E2E_ALLOW_SHARED_PROJECT='true'
$env:STERAS_E2E_DATASET_ID='m3-linkos-v1'
$env:STERAS_E2E_PASSWORD=$env:M3_UAT_PASSWORD
```

Run sequentially; each project uses one worker and resets only the manifest:

```powershell
npm run test:e2e:m3:smoke
npm run test:e2e:m3:full
npm run test:e2e:m3:workstream1
```

Review `frontend/playwright-report/`, screenshots and retained traces after a
failure. Also inspect Cloud Functions logs for the affected event ID.

## Manual acceptance

Use the dedicated `m3-uat-*@steras.test` identities and verify:

1. Admin initial review and the blocked/provisional decision gates.
2. Officer assignment, proposals, aggregate decision and second review.
3. Control-list generation/editing and organizer read-only display.
4. Stage 1 upload, Use Previous, verify/reject and resubmit.
5. Stage 2 upload, publish/reject/unpublish and public visibility.
6. Public confirm/report rate limits, M4 outcome, notifications and audit logs.
7. Unauthorized roles cannot read or mutate private workflow data.

## Cleanup

Cleanup requires a second exact confirmation and removes the dedicated Auth
accounts, profiles, fixture venue, ten event trees, exact projections and exact
Storage prefixes:

```powershell
$env:M3_UAT_CONFIRM_DATASET='m3-linkos-v1'
npm run seed:m3:uat -- --cleanup
```

Never run the broad M3 migration with `--apply` as part of this UAT. Existing
legacy events may be assessed with migration dry-run only, then handled under a
separate approved change.
