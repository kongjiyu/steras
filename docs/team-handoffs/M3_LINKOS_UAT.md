# Module 3 — STERAS shared Firebase test runbook

Target: `linkos-496505` / <https://linkos-496505.web.app>

The STERAS test dataset is isolated by the fixed ID `steras-module3-test-v2`. Seed, reset and
cleanup commands refuse to touch a colliding document unless it carries the
matching `sterasTest` ownership marker. Existing non-STERAS test events and accounts are
outside the manifest and must never be removed by these commands.

## Prerequisites

- Node.js 22 and Java 21 (Java 21 is required for Firebase rules emulator tests).
- Firebase CLI login with deploy permission.
- Application Default Credentials with Firebase Auth, Firestore and Storage access.
- A temporary STERAS test password of at least 12 characters. Do not commit it.

PowerShell environment:

```powershell
$env:FIREBASE_PROJECT_ID='linkos-496505'
$env:STERAS_TEST_ALLOW_SHARED_PROJECT='true'
$env:STERAS_TEST_PASSWORD='<temporary-password-at-least-12-characters>'
$env:STERAS_TEST_STORAGE_BUCKET='linkos-496505.firebasestorage.app'
```

## Seed and verify

```powershell
npm run seed:steras:test -- --dry-run
npm run seed:steras:test -- --apply
npm run seed:steras:test -- --verify
```

`--apply` is idempotent: it resets only the 32 owned event trees, their exact
public projections, event-scoped notifications/reports, and exact Storage
prefixes before recreating the dataset.

## Playwright

Set the additional environment variables:

```powershell
$env:STERAS_BASE_URL='https://linkos-496505.web.app'
$env:STERAS_E2E_PROJECT_ID='linkos-496505'
$env:STERAS_E2E_ALLOW_RESET='true'
$env:STERAS_E2E_ALLOW_SHARED_PROJECT='true'
$env:STERAS_E2E_DATASET_ID='steras-module3-test-v2'
$env:STERAS_E2E_PASSWORD=$env:STERAS_TEST_PASSWORD
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

Use the dedicated `steras-test-*@steras.test` identities and verify:

1. Admin initial review and the blocked/provisional decision gates.
2. Officer assignment, proposals, aggregate decision and second review.
3. Control-list generation/editing and organizer read-only display.
4. Stage 1 upload, Use Previous, verify/reject and resubmit.
5. Stage 2 upload, publish/reject/unpublish and public visibility.
6. Public confirm/report rate limits, M4 outcome, notifications and audit logs.
7. Unauthorized roles cannot read or mutate private workflow data.

## Cleanup

Cleanup requires a second exact confirmation and removes the dedicated Auth
accounts, profiles, fixture venues, thirty-two event trees, exact projections and exact
Storage prefixes:

```powershell
$env:STERAS_TEST_CONFIRM_DATASET='steras-module3-test-v2'
npm run seed:steras:test -- --cleanup
```

Never run the broad M3 migration with `--apply` as part of this shared Firebase test run. Existing
legacy events may be assessed with migration dry-run only, then handled under a
separate approved change.

