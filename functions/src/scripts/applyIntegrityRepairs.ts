import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import {
  GOVERNANCE_COLLECTION,
  HISTORICAL_OCCURRENCES_COLLECTION,
  LEGACY_SOURCE_FIELDS,
  type GovernanceRecord,
  type IntegrityRepairAction,
  type IntegrityRepairApproval,
  type IntegrityRepairManifest,
} from '@shared/dataIntegrity';

interface Options {
  projectId: string;
  manifestPath: string;
  approvalsPath: string;
  confirmToken: string;
  rollbackDirectory: string;
}

function argument(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseOptions(argv: string[]): Options {
  const projectId = argument(argv, '--project');
  const manifestPath = argument(argv, '--manifest');
  const approvalsPath = argument(argv, '--approvals');
  const confirmToken = argument(argv, '--confirm-token');
  const rollbackDirectory = argument(argv, '--rollback-dir');
  if (!projectId || !manifestPath || !approvalsPath || !confirmToken || !rollbackDirectory) {
    throw new Error('Refusing to apply repairs. Required: --project, --manifest, --approvals, --confirm-token, and --rollback-dir.');
  }
  return { projectId, manifestPath, approvalsPath, confirmToken, rollbackDirectory };
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis?: unknown }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
  return String(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

function legacyPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if ((LEGACY_SOURCE_FIELDS as readonly string[]).includes(key)) paths.push(next);
    paths.push(...legacyPaths(child, next));
  }
  return paths;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

async function collectTree(ref: DocumentReference): Promise<Array<{ path: string; data: Record<string, unknown> | null }>> {
  const snapshot = await ref.get();
  const records: Array<{ path: string; data: Record<string, unknown> | null }> = [{ path: ref.path, data: snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null }];
  if (!snapshot.exists) return records;
  for (const subcollection of await ref.listCollections()) {
    for (const child of (await subcollection.get()).docs) records.push(...await collectTree(child.ref));
  }
  return records;
}

async function writeRollbackExport(db: Firestore, action: IntegrityRepairAction, directory: string): Promise<void> {
  const records: Array<{ path: string; data: Record<string, unknown> | null }> = [];
  const paths = [action.documentPath, ...action.relatedPaths].filter((path, index, all) => all.indexOf(path) === index && path.includes('/'));
  for (const path of paths) records.push(...await collectTree(db.doc(path)));
  await mkdir(resolve(directory), { recursive: true });
  await writeFile(resolve(directory, `${safeFileName(action.actionId)}.json`), `${JSON.stringify({ action, records }, null, 2)}\n`, 'utf8');
}

function approvalsFor(manifest: IntegrityRepairManifest, raw: unknown): IntegrityRepairApproval[] {
  if (!Array.isArray(raw)) throw new Error('Approvals file must contain an array.');
  const actions = new Map(manifest.actions.map((action) => [action.actionId, action]));
  return raw.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Approval entry must be an object.');
    const approval = value as IntegrityRepairApproval;
    const actionId = approval.actionId;
    if (!actionId || !actions.has(actionId)) throw new Error(`Approval references unknown action: ${actionId ?? '(missing)'}.`);
    const action = actions.get(actionId)!;
    if (approval.findingId !== action.findingId || approval.documentPath !== action.documentPath || approval.expectedBeforeHash !== action.expectedBeforeHash || approval.approvedAction !== action.operation) {
      throw new Error(`Approval does not match manifest action ${actionId}.`);
    }
    if (!approval.approvedBy || !approval.approvedAt || Number.isNaN(Date.parse(approval.approvedAt))) throw new Error(`Approval ${actionId} is missing a valid approver or timestamp.`);
    return approval;
  });
}

async function deleteProjection(db: Firestore, action: IntegrityRepairAction): Promise<void> {
  const targets = new Set<string>([action.documentPath]);
  for (const related of action.relatedPaths) if (related.startsWith('events/')) {
    const eventId = related.split('/')[1];
    if (eventId) targets.add(`public_event_controls/${eventId}`);
  }
  for (const target of targets) await db.recursiveDelete(db.doc(target));
}

async function createHistoricalOccurrence(db: Firestore, action: IntegrityRepairAction): Promise<void> {
  const incidentRef = db.doc(action.documentPath);
  await db.runTransaction(async (tx) => {
    const incidentSnapshot = await tx.get(incidentRef);
    if (!incidentSnapshot.exists) throw new Error(`Incident disappeared before repair: ${action.documentPath}.`);
    if (hash(incidentSnapshot.data()) !== action.expectedBeforeHash) throw new Error(`Precondition failed for ${action.documentPath}: document changed after audit.`);
    const incident = incidentSnapshot.data() as Record<string, unknown>;
    const historicalEventId = `hist-${createHash('sha256').update(action.documentPath).digest('hex').slice(0, 24)}`;
    const historicalRef = db.collection(HISTORICAL_OCCURRENCES_COLLECTION).doc(historicalEventId);
    const existing = await tx.get(historicalRef);
    const occurredAt = Number(incident.occurredAt ?? incident.date ?? Date.now());
    const eventSnapshot = incident.eventSnapshot && typeof incident.eventSnapshot === 'object' ? incident.eventSnapshot as Record<string, unknown> : undefined;
    const sourceEventKey = typeof incident.eventId === 'string' ? incident.eventId : String(incident.legacyEventKey ?? 'unknown');
    const occurrence = {
      historicalEventId,
      sourceEventKey,
      sourceIncidentId: String(incident.incidentId ?? action.documentPath.split('/').pop() ?? ''),
      eventName: String(incident.eventName ?? eventSnapshot?.name ?? sourceEventKey),
      eventType: String(incident.eventType ?? eventSnapshot?.type ?? 'other'),
      ...(typeof incident.venueId === 'string' ? { venueId: incident.venueId } : {}),
      ...(typeof incident.organizerId === 'string' ? { organizerId: incident.organizerId } : {}),
      occurredAt: Number.isFinite(occurredAt) ? occurredAt : Date.now(),
      ...(typeof incident.eventVersionId === 'string' ? { sourceVersionId: incident.eventVersionId } : {}),
      visibility: 'private' as const,
      source: 'legacy_incident_import' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (!existing.exists) tx.create(historicalRef, occurrence);
    tx.update(incidentRef, {
      historicalEventId,
      eventReference: { kind: 'historical_occurrence', historicalEventId, legacyEventKey: sourceEventKey },
      updatedAt: Date.now(),
    });
  });
}

async function migrateLegacyMetadata(db: Firestore, action: IntegrityRepairAction): Promise<void> {
  const sourceRef = db.doc(action.documentPath);
  await db.runTransaction(async (tx) => {
    const sourceSnapshot = await tx.get(sourceRef);
    if (!sourceSnapshot.exists) throw new Error(`Source disappeared before repair: ${action.documentPath}.`);
    const source = sourceSnapshot.data() as Record<string, unknown>;
    if (hash(source) !== action.expectedBeforeHash) throw new Error(`Precondition failed for ${action.documentPath}: document changed after audit.`);
    const paths = legacyPaths(source);
    if (paths.length === 0) return;
    const now = Date.now();
    const governanceId = createHash('sha256').update(action.documentPath).digest('hex').slice(0, 32);
    const governanceRef = db.collection(GOVERNANCE_COLLECTION).doc(governanceId);
    const governance: GovernanceRecord = {
      sourcePath: action.documentPath,
      sourceBatchId: 'integrity-repair',
      verificationStatus: 'unverified',
      visibility: 'private',
      originalId: action.documentPath.split('/').pop(),
      createdAt: now,
      updatedAt: now,
    };
    const patch: Record<string, FirebaseFirestore.FieldValue> = {};
    for (const path of paths) patch[path] = FieldValue.delete();
    tx.set(governanceRef, governance, { merge: true });
    tx.update(sourceRef, patch);
  });
}

async function applyAction(db: Firestore, action: IntegrityRepairAction): Promise<'applied' | 'skipped'> {
  switch (action.operation) {
    case 'quarantine_public_projection':
      await deleteProjection(db, action);
      return 'applied';
    case 'create_historical_occurrence':
      await createHistoricalOccurrence(db, action);
      return 'applied';
    case 'migrate_legacy_metadata':
      await migrateLegacyMetadata(db, action);
      return 'applied';
    case 'migrate_identifier':
      throw new Error(`Identifier migration requires a verified replacement mapping and is not implicit: ${action.documentPath}.`);
    case 'manual_review':
      return 'skipped';
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(resolve(options.manifestPath), 'utf8')) as IntegrityRepairManifest;
  const approvals = approvalsFor(manifest, JSON.parse(await readFile(resolve(options.approvalsPath), 'utf8')));
  if (manifest.projectId !== options.projectId) throw new Error(`Project mismatch: manifest=${manifest.projectId}, requested=${options.projectId}.`);
  if (options.confirmToken !== `STERAS-APPLY:${manifest.manifestId}`) throw new Error('Invalid confirmation token. Expected the exact manifest-bound token; no writes were attempted.');
  const app = initializeApp({ credential: applicationDefault(), projectId: options.projectId }, `integrity-repair-${manifest.manifestId}`);
  const db = getFirestore(app);
  const selected = approvals.map((approval) => manifest.actions.find((action) => action.actionId === approval.actionId)!).filter(Boolean);
  for (const action of selected) {
    const snapshot = await db.doc(action.documentPath).get();
    if (!snapshot.exists) throw new Error(`Precondition failed for ${action.documentPath}: document does not exist.`);
    if (hash(snapshot.data()) !== action.expectedBeforeHash) throw new Error(`Precondition failed for ${action.documentPath}: document changed after audit.`);
    await writeRollbackExport(db, action, options.rollbackDirectory);
  }
  const results: Array<{ actionId: string; operation: string; status: string }> = [];
  for (const action of selected) results.push({ actionId: action.actionId, operation: action.operation, status: await applyAction(db, action) });
  console.log(JSON.stringify({ manifestId: manifest.manifestId, projectId: options.projectId, selectedActions: selected.length, results, rollbackDirectory: resolve(options.rollbackDirectory) }, null, 2));
}

if (require.main === module) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

export const __testOnly = { hash, legacyPaths, operation: applyAction };
