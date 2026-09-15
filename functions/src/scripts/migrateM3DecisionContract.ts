/**
 * One-time, exact-ID migration for the Module 3 application decision contract.
 *
 * This is intentionally separate from the broader M3 deployment migration. It
 * only handles the one explicitly approved legacy record that was created
 * under the old AmendmentRequested application workflow. The former UAT
 * fixture records are retired and are handled by the exact cleanup list, not
 * by this migration.
 *
 * The migration is read-only by default. Applying it requires an explicit
 * project id, a shared-project write flag, and a confirmation token. It never
 * scans or mutates any other event, user, projection, or Storage path.
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { STERAS_TEST_DATASET_ID, STERAS_TEST_SHARED_PROJECT_ID } from '@shared/sterasTestFixtures';
import { COLLECTIONS, type Assignment, type EventRecord } from '@shared/types';

export const DECISION_MIGRATION_ID = 'm3-application-decision-contract-v1' as const;
export const DECISION_MIGRATION_PROJECT_ID = STERAS_TEST_SHARED_PROJECT_ID;
export const DECISION_MIGRATION_CONFIRMATION = 'REJECT_APPLICATION_AMENDMENTS' as const;
export const DECISION_MIGRATION_EVENT_IDS = [
  'evt-004-kl-marathon',
] as const;

export type DecisionMigrationAction = 'dry-run' | 'snapshot' | 'apply' | 'verify';

export interface DecisionMigrationOptions {
  action: DecisionMigrationAction;
  eventIds?: string[];
  reportPath?: string;
  snapshotPath?: string;
}

/**
 * A JSON-safe, exact-ID backup of the documents touched by this migration.
 * This is deliberately an evidence/recovery artifact, not a broad Firestore
 * export. It contains no credentials and never includes documents outside the
 * explicit migration ID allowlist.
 */
export interface DecisionMigrationSnapshotEvent {
  eventId: string;
  event?: Record<string, unknown>;
  assignments: Array<{ id: string; data: Record<string, unknown> }>;
  officers: Array<{ id: string; data: Record<string, unknown> }>;
  auditLogs: Array<{ id: string; data: Record<string, unknown> }>;
  publicEvent?: Record<string, unknown>;
}

export interface DecisionMigrationSnapshot {
  migrationId: typeof DECISION_MIGRATION_ID;
  projectId: typeof DECISION_MIGRATION_PROJECT_ID;
  generatedAt: number;
  events: DecisionMigrationSnapshotEvent[];
}

export interface DecisionMigrationEventReport {
  eventId: string;
  exists: boolean;
  markerValid: boolean;
  beforeStatus?: string;
  afterStatus: 'Rejected';
  currentVersionId?: string;
  assignmentIds: string[];
  assignmentsToClose: string[];
  publicEventExists?: boolean;
  changed: boolean;
  blockedReasons: string[];
}

export interface DecisionMigrationReport {
  migrationId: typeof DECISION_MIGRATION_ID;
  projectId: typeof DECISION_MIGRATION_PROJECT_ID;
  action: DecisionMigrationAction;
  generatedAt: number;
  events: DecisionMigrationEventReport[];
  changedEventCount: number;
  blockedReasons: string[];
}

function exactEventIds(input?: string[]): string[] {
  const ids = input ?? [...DECISION_MIGRATION_EVENT_IDS];
  if (ids.length === 0) throw new Error('At least one exact event ID is required.');
  const allowed = new Set<string>(DECISION_MIGRATION_EVENT_IDS);
  for (const id of ids) {
    if (!allowed.has(id)) throw new Error(`Refusing event ${id}; this tool only permits the exact migration IDs in its approved allowlist.`);
  }
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate event IDs are not allowed.');
  return ids;
}

export function parseDecisionMigrationArgs(argv: string[]): DecisionMigrationOptions {
  let action: DecisionMigrationAction = 'dry-run';
  let actionSeen = false;
  const options: DecisionMigrationOptions = { action };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run' || argument === '--snapshot' || argument === '--apply' || argument === '--verify') {
      if (actionSeen) throw new Error('Choose exactly one migration action.');
      action = argument.slice(2) as DecisionMigrationAction;
      options.action = action;
      actionSeen = true;
      continue;
    }
    if (argument === '--event' || argument.startsWith('--event=')) {
      const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index];
      if (!value) throw new Error('--event requires one exact event ID.');
      options.eventIds = [...(options.eventIds ?? []), value];
      continue;
    }
    if (argument === '--report' || argument.startsWith('--report=')) {
      const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index];
      if (!value) throw new Error('--report requires a file path.');
      options.reportPath = value;
      continue;
    }
    if (argument === '--snapshot-file' || argument.startsWith('--snapshot-file=')) {
      const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index];
      if (!value) throw new Error('--snapshot-file requires a snapshot JSON path.');
      options.snapshotPath = value;
      continue;
    }
    throw new Error(`Unknown migration argument: ${argument}`);
  }
  exactEventIds(options.eventIds);
  return options;
}

export function assertDecisionMigrationAuthorization(action: DecisionMigrationAction, env: NodeJS.ProcessEnv = process.env): void {
  const projectId = env.M3_DECISION_MIGRATION_PROJECT_ID;
  if (projectId !== DECISION_MIGRATION_PROJECT_ID) {
    throw new Error(`Set M3_DECISION_MIGRATION_PROJECT_ID=${DECISION_MIGRATION_PROJECT_ID}; refusing an unspecified or different project.`);
  }
  if (action === 'apply') {
    if (env.M3_DECISION_MIGRATION_ALLOW_SHARED_PROJECT !== 'true') {
      throw new Error('Set M3_DECISION_MIGRATION_ALLOW_SHARED_PROJECT=true to authorize the shared-project write.');
    }
    if (env.M3_DECISION_MIGRATION_CONFIRM !== DECISION_MIGRATION_CONFIRMATION) {
      throw new Error(`Set M3_DECISION_MIGRATION_CONFIRM=${DECISION_MIGRATION_CONFIRMATION} to confirm the exact migration.`);
    }
  }
}

function snapshotValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === undefined) return null;
  if (value instanceof Date) return { __type: 'date', value: value.toISOString() };
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return { __type: 'timestamp', millis: (value as { toMillis: () => number }).toMillis() };
  }
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, snapshotValue(item)]));
  }
  return String(value);
}

function snapshotDocument(data: DocumentData): Record<string, unknown> {
  return snapshotValue(data) as Record<string, unknown>;
}

export async function buildDecisionMigrationSnapshot(db: Firestore, eventIds?: string[]): Promise<DecisionMigrationSnapshot> {
  const ids = exactEventIds(eventIds);
  const events = await Promise.all(ids.map(async (eventId): Promise<DecisionMigrationSnapshotEvent> => {
    const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
    const eventSnapshot = await eventRef.get();
    const assignmentsSnapshot = await eventRef.collection(COLLECTIONS.ASSIGNMENTS).get();
    const auditLogsSnapshot = await eventRef.collection(COLLECTIONS.AUDIT_LOGS).get();
    const publicEventSnapshot = await db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId).get();
    const officerIds = [...new Set(assignmentsSnapshot.docs
      .map((doc) => doc.data().officerUid)
      .filter((officerUid): officerUid is string => typeof officerUid === 'string'))];
    const officerSnapshots = await Promise.all(officerIds.map(async (officerId) => ({
      id: officerId,
      snapshot: await db.collection(COLLECTIONS.OFFICERS).doc(officerId).get(),
    })));
    return {
      eventId,
      ...(eventSnapshot.exists ? { event: snapshotDocument(eventSnapshot.data() ?? {}) } : {}),
      assignments: assignmentsSnapshot.docs.map((doc) => ({ id: doc.id, data: snapshotDocument(doc.data()) })),
      officers: officerSnapshots.filter(({ snapshot }) => snapshot.exists).map(({ id, snapshot }) => ({ id, data: snapshotDocument(snapshot.data() ?? {}) })),
      auditLogs: auditLogsSnapshot.docs.map((doc) => ({ id: doc.id, data: snapshotDocument(doc.data()) })),
      ...(publicEventSnapshot.exists ? { publicEvent: snapshotDocument(publicEventSnapshot.data() ?? {}) } : {}),
    };
  }));
  return {
    migrationId: DECISION_MIGRATION_ID,
    projectId: DECISION_MIGRATION_PROJECT_ID,
    generatedAt: Date.now(),
    events,
  };
}

function markerValid(eventId: string, event: EventRecord & Record<string, unknown>): boolean {
  if (eventId === 'evt-004-kl-marathon') return true;
  const marker = event.sterasTest as { datasetId?: string; fixtureId?: string } | undefined;
  return marker?.datasetId === STERAS_TEST_DATASET_ID && marker.fixtureId === eventId;
}

function isAlreadyMigrated(event: Record<string, unknown>): boolean {
  const marker = event.decisionContractMigration as { migrationId?: string } | undefined;
  return marker?.migrationId === DECISION_MIGRATION_ID;
}

async function buildEventReport(db: Firestore, eventId: string): Promise<DecisionMigrationEventReport> {
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const eventSnapshot = await eventRef.get();
  if (!eventSnapshot.exists) {
    return {
      eventId,
      exists: false,
      markerValid: false,
      afterStatus: 'Rejected',
      assignmentIds: [],
      assignmentsToClose: [],
      changed: false,
      blockedReasons: [`${eventId}: event does not exist.`],
    };
  }
  const event = eventSnapshot.data() as EventRecord & Record<string, unknown>;
  const assignmentsSnapshot = await eventRef.collection(COLLECTIONS.ASSIGNMENTS).get();
  const assignments = assignmentsSnapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as Assignment & Record<string, unknown> }));
  const activeAssignments = assignments.filter(({ data }) => data.status !== 'revoked' && !data.closedAt);
  const publicEventExists = (await db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId).get()).exists;
  const blockedReasons: string[] = [];
  if (!markerValid(eventId, event)) blockedReasons.push(`${eventId}: marker is not an approved legacy record.`);
  if (!isAlreadyMigrated(event) && (event.status as unknown) !== 'AmendmentRequested' && event.status !== 'Rejected') {
    blockedReasons.push(`${eventId}: status ${String(event.status)} is not AmendmentRequested or an idempotent Rejected.`);
  }
  return {
    eventId,
    exists: true,
    markerValid: markerValid(eventId, event),
    beforeStatus: event.status,
    afterStatus: 'Rejected',
    currentVersionId: event.currentVersionId,
    assignmentIds: assignments.map(({ id }) => id),
    assignmentsToClose: activeAssignments.map(({ id }) => id),
    publicEventExists,
    changed: !isAlreadyMigrated(event),
    blockedReasons,
  };
}

export async function buildDecisionMigrationReport(db: Firestore, options: DecisionMigrationOptions): Promise<DecisionMigrationReport> {
  const eventIds = exactEventIds(options.eventIds);
  const events = await Promise.all(eventIds.map((eventId) => buildEventReport(db, eventId)));
  return {
    migrationId: DECISION_MIGRATION_ID,
    projectId: DECISION_MIGRATION_PROJECT_ID,
    action: options.action,
    generatedAt: Date.now(),
    events,
    changedEventCount: events.filter((event) => event.changed && event.blockedReasons.length === 0).length,
    blockedReasons: events.flatMap((event) => event.blockedReasons),
  };
}

async function applyEvent(db: Firestore, eventId: string): Promise<void> {
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  await db.runTransaction(async (tx) => {
    const eventSnapshot = await tx.get(eventRef);
    if (!eventSnapshot.exists) throw new Error(`${eventId}: event does not exist.`);
    const event = eventSnapshot.data() as EventRecord & Record<string, unknown>;
    if (!markerValid(eventId, event)) throw new Error(`${eventId}: marker is not an approved legacy record.`);
    if (isAlreadyMigrated(event)) return;
    if ((event.status as unknown) !== 'AmendmentRequested' && event.status !== 'Rejected') {
      throw new Error(`${eventId}: refusing status ${String(event.status)}.`);
    }
    const assignmentSnapshot = await tx.get(eventRef.collection(COLLECTIONS.ASSIGNMENTS));
    const now = Date.now();
    const activeAssignments = assignmentSnapshot.docs
      .map((doc) => ({ ref: doc.ref, id: doc.id, data: doc.data() as Assignment & Record<string, unknown> }))
      .filter(({ data }) => data.status !== 'revoked' && !data.closedAt);
    const officerSnapshots = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const assignment of activeAssignments) {
      const officerRef = db.collection(COLLECTIONS.OFFICERS).doc(assignment.data.officerUid);
      officerSnapshots.set(assignment.data.officerUid, await tx.get(officerRef));
    }
    for (const assignment of activeAssignments) {
      const closeData: DocumentData = assignment.data.status === 'completed'
        ? { closedAt: now, closedBy: `migration:${DECISION_MIGRATION_ID}` }
        : {
          status: 'revoked',
          revokedAt: now,
          revokedBy: `migration:${DECISION_MIGRATION_ID}`,
          revokedReason: 'Event application decision contract migration closed the legacy review.',
      };
      tx.update(assignment.ref, closeData);
      const officerSnapshot = officerSnapshots.get(assignment.data.officerUid);
      const workloadCount = Number(officerSnapshot?.data()?.workloadCount ?? 0);
      if (officerSnapshot?.exists && workloadCount > 0) {
        tx.update(db.collection(COLLECTIONS.OFFICERS).doc(assignment.data.officerUid), { workloadCount: FieldValue.increment(-1), updatedAt: now });
      }
    }
    tx.update(eventRef, {
      status: 'Rejected',
      reviewStage: 'closed',
      assignedOfficerUids: [],
      assignedOfficerByAuthority: {},
      editableVersionId: FieldValue.delete(),
      updatedAt: now,
      decisionContractMigration: {
        migrationId: DECISION_MIGRATION_ID,
        datasetId: event.sterasTest && typeof event.sterasTest === 'object' ? (event.sterasTest as Record<string, unknown>).datasetId ?? null : null,
        migratedAt: now,
        previousStatus: event.status,
        closedAssignmentIds: activeAssignments.map(({ id }) => id),
      },
    });
    const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${DECISION_MIGRATION_ID}_${now}`);
    tx.create(auditRef, {
      id: auditRef.id,
      eventId,
      versionId: event.currentVersionId ?? null,
      action: 'deployment_migration',
      actorId: `migration:${DECISION_MIGRATION_ID}`,
      actorRole: 'system',
      timestamp: now,
      previousStatus: event.status,
      newStatus: 'Rejected',
      notes: 'Closed the legacy AmendmentRequested decision; the rejected version is immutable and may be corrected only through the versioned application revision workflow.',
      metadata: {
        migrationId: DECISION_MIGRATION_ID,
        closedAssignmentIds: activeAssignments.map(({ id }) => id),
      },
    });
    tx.delete(db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId));
  });
}

async function verifyDecisionMigration(db: Firestore, eventIds: string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const eventId of eventIds) {
    const eventSnapshot = await db.collection(COLLECTIONS.EVENTS).doc(eventId).get();
    if (!eventSnapshot.exists) {
      problems.push(`${eventId}: event missing.`);
      continue;
    }
    const event = eventSnapshot.data() as EventRecord & Record<string, unknown>;
    if (!markerValid(eventId, event)) problems.push(`${eventId}: marker invalid.`);
    if (event.status !== 'Rejected') problems.push(`${eventId}: status is ${String(event.status)}.`);
    if (event.editableVersionId) problems.push(`${eventId}: editableVersionId remains.`);
    if ((event.assignedOfficerUids ?? []).length > 0) problems.push(`${eventId}: assignedOfficerUids remains populated.`);
    if (event.reviewStage !== 'closed') problems.push(`${eventId}: reviewStage is not closed.`);
    if ((await db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId).get()).exists) problems.push(`${eventId}: public event projection remains.`);
    const assignments = await db.collection(COLLECTIONS.EVENTS).doc(eventId).collection(COLLECTIONS.ASSIGNMENTS).get();
    if (assignments.docs.some((doc) => !['completed', 'revoked'].includes(String(doc.data().status)) && !doc.data().closedAt)) {
      problems.push(`${eventId}: an active assignment remains.`);
    }
  }
  return problems;
}

function writeReport(report: DecisionMigrationReport, reportPath?: string): void {
  if (!reportPath) return;
  const target = resolve(reportPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(report, null, 2), 'utf8');
}

function writeSnapshot(snapshot: DecisionMigrationSnapshot, snapshotPath?: string): void {
  if (!snapshotPath) throw new Error('Snapshot action requires --report <snapshot-file.json>.');
  const target = resolve(snapshotPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(snapshot, null, 2), 'utf8');
}

export function assertDecisionMigrationSnapshot(snapshotPath: string, eventIds?: string[]): DecisionMigrationSnapshot {
  let snapshot: DecisionMigrationSnapshot;
  try {
    snapshot = JSON.parse(readFileSync(resolve(snapshotPath), 'utf8')) as DecisionMigrationSnapshot;
  } catch (error) {
    throw new Error(`Unable to read migration snapshot ${snapshotPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const expectedIds = exactEventIds(eventIds);
  const actualIds = snapshot.events?.map(({ eventId }) => eventId) ?? [];
  if (snapshot.migrationId !== DECISION_MIGRATION_ID || snapshot.projectId !== DECISION_MIGRATION_PROJECT_ID) {
    throw new Error('Migration snapshot identity does not match this exact decision-contract migration.');
  }
  if (!Number.isFinite(snapshot.generatedAt) || snapshot.generatedAt <= 0) {
    throw new Error('Migration snapshot has no valid generation timestamp.');
  }
  if (actualIds.length !== expectedIds.length || expectedIds.some((eventId) => !actualIds.includes(eventId))) {
    throw new Error('Migration snapshot does not contain exactly the requested migration IDs.');
  }
  if (snapshot.events.some((event) => !event.event || !Array.isArray(event.assignments) || !Array.isArray(event.officers) || !Array.isArray(event.auditLogs))) {
    throw new Error('Migration snapshot is incomplete; every event must include its event, assignment, officer, and audit-log records.');
  }
  return snapshot;
}

async function main(): Promise<void> {
  const options = parseDecisionMigrationArgs(process.argv.slice(2));
  assertDecisionMigrationAuthorization(options.action);
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: DECISION_MIGRATION_PROJECT_ID });
  if (app.options.projectId !== DECISION_MIGRATION_PROJECT_ID) {
    throw new Error(`Firebase Admin app targets ${app.options.projectId ?? 'unknown'}, expected ${DECISION_MIGRATION_PROJECT_ID}.`);
  }
  const db = getFirestore(app);
  const report = await buildDecisionMigrationReport(db, options);
  if (options.action !== 'snapshot') writeReport(report, options.reportPath);
  console.log(JSON.stringify(report, null, 2));
  if (report.blockedReasons.length > 0) throw new Error(`Migration blocked:\n${report.blockedReasons.join('\n')}`);
  if (options.action === 'snapshot') {
    const snapshot = await buildDecisionMigrationSnapshot(db, options.eventIds);
    writeSnapshot(snapshot, options.reportPath);
    console.log(`Exact migration snapshot written to ${resolve(options.reportPath as string)}.`);
  } else if (options.action === 'apply') {
    if (!options.snapshotPath) throw new Error('Apply requires --snapshot-file from a successful exact-ID snapshot.');
    assertDecisionMigrationSnapshot(options.snapshotPath, options.eventIds);
    for (const eventId of exactEventIds(options.eventIds)) await applyEvent(db, eventId);
    const problems = await verifyDecisionMigration(db, exactEventIds(options.eventIds));
    if (problems.length > 0) throw new Error(`Post-apply verification failed:\n${problems.join('\n')}`);
    console.log('Decision contract migration applied and verified.');
  } else if (options.action === 'verify') {
    const problems = await verifyDecisionMigration(db, exactEventIds(options.eventIds));
    if (problems.length > 0) throw new Error(`Verification failed:\n${problems.join('\n')}`);
    console.log('Decision contract migration verification passed.');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
