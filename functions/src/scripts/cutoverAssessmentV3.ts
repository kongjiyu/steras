import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { ASSESSMENT_SCHEMA_VERSION, COLLECTIONS, EventRecord } from '@shared/types';
import { runRiskAndResourcePipeline } from '../triggers/onEventCreated';
import { EncodedFirestoreValue, decodeFirestoreValue, encodeFirestoreValue } from './firestoreBackupCodec';

const EXPECTED_PROJECT = 'linkos-496505';
const args = parseArguments(process.argv.slice(2));
const projectId = args.get('project') ?? '';
const mode = args.get('mode') ?? 'plan';
const confirmation = args.get('confirm');
const backupDirectory = args.get('backup-dir')
  ?? process.env.STERAS_BACKUP_DIR
  ?? '/Users/kongjy/Documents/School/steras-backups';

if (projectId !== EXPECTED_PROJECT) {
  throw new Error(`Refusing M2 cutover: --project must equal ${EXPECTED_PROJECT}.`);
}
if (!['plan', 'apply', 'restore'].includes(mode)) throw new Error('--mode must be plan, apply, or restore.');
if (mode !== 'plan' && confirmation !== EXPECTED_PROJECT) {
  throw new Error(`Refusing destructive action: pass --confirm=${EXPECTED_PROJECT}.`);
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

interface BackupDocument {
  path: string;
  data: EncodedFirestoreValue;
}

interface CutoverBackup {
  projectId: string;
  assessmentSchemaVersion: string;
  createdAt: string;
  events: Array<{ path: string; updatedAt: number; currentAssessmentId?: string; currentResourceId?: string }>;
  assessments: BackupDocument[];
  resources: BackupDocument[];
  auditReferences: BackupDocument[];
}

async function main() {
  if (mode === 'restore') {
    const backupPath = args.get('backup');
    if (!backupPath) throw new Error('--backup=<absolute path> is required for restore.');
    await restoreBackup(backupPath);
    return;
  }

  const inventory = await inventoryM2();
  console.info(JSON.stringify({
    mode,
    projectId,
    events: inventory.events.length,
    assessments: inventory.assessments.length,
    resources: inventory.resources.length,
    pendingBackfill: inventory.pendingEventIds.length,
  }, null, 2));
  if (mode === 'plan') {
    console.info(`Dry run only. Apply with --mode=apply --project=${EXPECTED_PROJECT} --confirm=${EXPECTED_PROJECT}.`);
    return;
  }
  if (!process.env.MINIMAX_API_KEY || !process.env.OPENWEATHER_API_KEY) {
    throw new Error('MINIMAX_API_KEY and OPENWEATHER_API_KEY are required before apply/backfill.');
  }

  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupDirectory, `m2-v2-${new Date().toISOString().replaceAll(':', '-')}.json`);
  await writeFile(backupPath, JSON.stringify(inventory.backup, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.info(`Backup written to ${backupPath}.`);

  for (const assessment of inventory.assessments) await db.recursiveDelete(db.doc(assessment.path));
  for (const resource of inventory.resources) await db.recursiveDelete(db.doc(resource.path));
  for (const event of inventory.backup.events) {
    const eventId = event.path.split('/').at(-1)!;
    const eventReference = db.doc(event.path);
    for (const summary of (await eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).get()).docs) {
      await db.recursiveDelete(summary.ref);
    }
    const cutoverAuditId = `m2-v3-cutover-${Date.now()}`;
    await eventReference.update({
      currentAssessmentId: FieldValue.delete(),
      currentResourceId: FieldValue.delete(),
    });
    await eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(cutoverAuditId).create({
      id: cutoverAuditId,
      eventId,
      action: 'assessment_schema_cutover',
      actorId: 'system',
      actorRole: 'system',
      timestamp: Date.now(),
      metadata: { from: 'legacy-ready', to: ASSESSMENT_SCHEMA_VERSION, backupPath },
    });
  }

  const failures: Array<{ eventId: string; error: string }> = [];
  for (const eventId of inventory.pendingEventIds) {
    try {
      const result = await runRiskAndResourcePipeline(eventId);
      if (result.status !== 'processed') failures.push({ eventId, error: result.reason ?? 'skipped' });
    } catch (error) {
      failures.push({ eventId, error: error instanceof Error ? error.message : 'Unknown backfill failure' });
    }
  }
  const verification = await verifyCutover();
  console.info(JSON.stringify({ backupPath, failures, verification }, null, 2));
  if (failures.length > 0 || verification.legacyReady > 0 || verification.danglingPointers > 0) {
    throw new Error(`Cutover verification failed. Restore with --mode=restore --project=${EXPECTED_PROJECT} --confirm=${EXPECTED_PROJECT} --backup=${backupPath}`);
  }
}

async function inventoryM2() {
  const eventsSnapshot = await db.collection(COLLECTIONS.EVENTS).get();
  const backup: CutoverBackup = {
    projectId,
    assessmentSchemaVersion: ASSESSMENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    events: [],
    assessments: [],
    resources: [],
    auditReferences: [],
  };
  const pendingEventIds: string[] = [];
  for (const eventDocument of eventsSnapshot.docs) {
    const event = { eventId: eventDocument.id, ...eventDocument.data() } as EventRecord;
    backup.events.push({
      path: eventDocument.ref.path,
      updatedAt: event.updatedAt,
      ...(event.currentAssessmentId ? { currentAssessmentId: event.currentAssessmentId } : {}),
      ...(event.currentResourceId ? { currentResourceId: event.currentResourceId } : {}),
    });
    if (event.status === 'Pending' && event.currentVersionId) pendingEventIds.push(event.eventId);
    for (const document of (await eventDocument.ref.collection(COLLECTIONS.ASSESSMENTS).get()).docs) {
      backup.assessments.push({ path: document.ref.path, data: encodeFirestoreValue(document.data()) });
    }
    for (const document of (await eventDocument.ref.collection(COLLECTIONS.RESOURCES).get()).docs) {
      backup.resources.push({ path: document.ref.path, data: encodeFirestoreValue(document.data()) });
    }
    for (const document of (await eventDocument.ref.collection(COLLECTIONS.AUDIT_LOGS).get()).docs) {
      if (['risk_score_computed', 'resource_recommended'].includes(document.data().action)) {
        backup.auditReferences.push({ path: document.ref.path, data: encodeFirestoreValue(document.data()) });
      }
    }
  }
  return { backup, events: backup.events, assessments: backup.assessments, resources: backup.resources, pendingEventIds };
}

async function verifyCutover() {
  const eventsSnapshot = await db.collection(COLLECTIONS.EVENTS).get();
  let legacyReady = 0;
  let danglingPointers = 0;
  for (const eventDocument of eventsSnapshot.docs) {
    const event = eventDocument.data() as EventRecord;
    if (!event.currentAssessmentId) continue;
    const assessment = await eventDocument.ref.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get();
    if (!assessment.exists) danglingPointers += 1;
    else if (assessment.data()?.status === 'ready' || assessment.data()?.schemaVersion !== ASSESSMENT_SCHEMA_VERSION) legacyReady += 1;
    if (event.currentResourceId) {
      const resource = await eventDocument.ref.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId).get();
      if (!resource.exists) danglingPointers += 1;
    }
  }
  return { legacyReady, danglingPointers };
}

async function restoreBackup(backupPath: string) {
  if (!path.isAbsolute(backupPath)) throw new Error('--backup must be an absolute path.');
  const backup = JSON.parse(await readFile(backupPath, 'utf8')) as CutoverBackup;
  if (backup.projectId !== projectId) throw new Error('Backup project ID does not match --project.');
  const expectedAssessmentPaths = new Set(backup.assessments.map((document) => document.path));
  const expectedResourcePaths = new Set(backup.resources.map((document) => document.path));
  for (const event of backup.events) {
    const reference = db.doc(event.path);
    for (const document of (await reference.collection(COLLECTIONS.ASSESSMENTS).get()).docs) {
      if (!expectedAssessmentPaths.has(document.ref.path)) await db.recursiveDelete(document.ref);
    }
    for (const document of (await reference.collection(COLLECTIONS.RESOURCES).get()).docs) {
      if (!expectedResourcePaths.has(document.ref.path)) await db.recursiveDelete(document.ref);
    }
    for (const document of (await reference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).get()).docs) {
      await db.recursiveDelete(document.ref);
    }
  }
  for (const document of [...backup.assessments, ...backup.resources]) {
    const decoded = decodeFirestoreValue(document.data, (referencePath) => db.doc(referencePath));
    await db.doc(document.path).set(decoded as FirebaseFirestore.DocumentData);
  }
  for (const event of backup.events) {
    await db.doc(event.path).update({
      currentAssessmentId: event.currentAssessmentId ?? FieldValue.delete(),
      currentResourceId: event.currentResourceId ?? FieldValue.delete(),
      updatedAt: event.updatedAt,
    });
  }
  console.info(`Restored ${backup.assessments.length} assessments and ${backup.resources.length} resources from ${backupPath}.`);
}

function parseArguments(values: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) throw new Error(`Unexpected argument: ${value}`);
    const [rawKey, ...inlineValue] = value.slice(2).split('=');
    if (!rawKey) throw new Error('Empty option name is not allowed.');
    if (inlineValue.length > 0) {
      parsed.set(rawKey, inlineValue.join('='));
      continue;
    }
    const following = values[index + 1];
    if (following && !following.startsWith('--')) {
      parsed.set(rawKey, following);
      index += 1;
    } else {
      parsed.set(rawKey, 'true');
    }
  }
  return parsed;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
