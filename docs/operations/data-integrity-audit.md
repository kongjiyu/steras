# Production data integrity audit

This runbook is for the read-only integrity auditor and the approval-gated repair tool. It does not contain credentials and it does not enable automatic production repair.

## Read-only audit

Run with Application Default Credentials for the target project:

```powershell
npm run audit:data -- --project linkos-496505 --output "$env:TEMP\steras-integrity-$((Get-Date).ToString('yyyyMMdd-HHmmss'))" --fail-on critical
```

The report includes top-level and nested collection counts, Storage object count, stable finding IDs, document paths, before-hashes, severity, and a proposed action. It never prints document field values, names, email addresses, phone numbers, or file contents. A successful count check requires the sum of `collectionDocumentCounts.documents` to equal `scannedDocuments`.

Repeat the audit before acting. If a finding ID or before-hash changes, discard the old manifest and generate a new one.

## Prepare a repair manifest

```powershell
npm run audit:data:manifest -- --project linkos-496505 `
  --audit C:\path\to\integrity-audit.json `
  --output C:\path\to\repair-manifest.json
```

The manifest is only a proposal. `manual_review` and `migrate_identifier` actions are intentionally not implicit writes. Identifier migration requires a separately verified replacement mapping.

## Approval-gated apply

Create an approvals JSON array containing only the individually reviewed actions. Each entry must copy the manifest `actionId`, `findingId`, `documentPath`, `expectedBeforeHash`, and operation name, plus the approving operator and ISO timestamp. Then run:

```powershell
npm run audit:data:apply -- --project linkos-496505 `
  --manifest C:\path\to\repair-manifest.json `
  --approvals C:\path\to\approved-actions.json `
  --confirm-token STERAS-APPLY:<manifestId> `
  --rollback-dir C:\secure\private\rollback\<auditRunId>
```

The command refuses to write unless the project, manifest, approval rows, exact confirmation token, and current before-hashes all match. It writes a private rollback export before each selected action and aborts on the first stale precondition. Run a fresh read-only audit after each approved batch. Never commit reports, approval files, rollback exports, or ADC material.

## CI prevention

The `production-integrity-audit` job has no schedule and is disabled unless the repository variable `STERAS_PRODUCTION_AUDIT_ENABLED` is `true`. When enabled for an internal push or internal pull request, GitHub OIDC authenticates a service account that has only Firestore/Storage metadata read access. Fork pull requests run emulator contract tests only.

Dataset-specific presentation seeders retain verification/dry-run support but reject apply/cleanup outside an emulator (`FIRESTORE_EMULATOR_HOST`). They must not be used as production repair tools.
