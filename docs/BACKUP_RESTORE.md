# Firestore Backup and Restore

Use managed exports before a release, schema migration, or destructive seed reset. The Firebase project must be on Blaze and the operator must have Firestore export/import and Storage access.

## Export

```bash
gcloud firestore export \
  gs://linkos-496505.firebasestorage.app/backups/<backup-id> \
  --project=linkos-496505
```

Confirm the operation is `SUCCESSFUL` and inspect the backup objects:

```bash
gcloud firestore operations list --project=linkos-496505
gcloud storage ls --recursive \
  gs://linkos-496505.firebasestorage.app/backups/<backup-id>
```

## Restore

Never import into staging or production as an exploratory test. First create an isolated Firebase recovery project with matching Firestore location and grant its Firestore service agent access to the backup bucket.

After confirming the target project in the terminal, import explicitly:

```bash
gcloud firestore import \
  gs://linkos-496505.firebasestorage.app/backups/<backup-id> \
  --project=<isolated-recovery-project-id>
```

Verify document counts, immutable versions, decisions, audit logs, and public/private separation before approving any production recovery. Managed import merges documents; it does not delete documents absent from the backup.

## Verified Backup

The Phase 8 rehearsal exported 312 documents to `backups/phase8-20260714` on 14 July 2026. The export contains its overall metadata, all-kinds metadata, and three data shards.
