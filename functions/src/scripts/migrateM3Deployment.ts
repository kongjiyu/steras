import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import {
  getFirestore,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import {
  Assignment,
  COLLECTIONS,
  EventControl,
  EventRecord,
  PublicEventControl,
  Stage2Doc,
} from '@shared/types';
import { STERAS_TEST_EVENT_IDS, STERAS_TEST_SHARED_PROJECT_ID } from '../../../shared/sterasTestFixtures';

const DEFAULT_MIGRATION_ID = 'm3-deployment-v1';
const DEFAULT_MANIFEST_FILENAME = 'm3-legacy-migration-manifest.json';
const DEFAULT_ARTIFACT_DIR = 'artifacts/m3-migration';
const MIGRATABLE_EVENT_FIELDS = new Set(['assignedOfficerUids', 'assignedOfficerByAuthority', 'reviewStage']);

export type MigrationAction = 'dry-run' | 'apply' | 'verify' | 'rollback';
export type MigrationOperationKind = 'set' | 'update' | 'delete';

export interface MigrationManifest {
  migrationId: string;
  projectId: string;
  eventIds: string[];
  excludedEventIds?: string[];
  allowedEventFields: Record<string, string[]>;
  allowProjectionChanges?: boolean;
}

export interface MigrationCliOptions {
  action: MigrationAction;
  manifestPath?: string;
  eventId?: string;
  snapshotPath?: string;
  reportPath?: string;
}

interface MigrationOperation {
  kind: MigrationOperationKind;
  ref: DocumentReference;
  eventId: string;
  data?: DocumentData;
  reason: string;
  fields: string[];
}

interface EventPlanSummary {
  eventId: string;
  status: string | null;
  currentVersionId: string | null;
  changedFields: string[];
  candidateOperationCount: number;
  operationCount: number;
  projectionOperationCount: number;
  manualReviewRequired: boolean;
  blockedReasons: string[];
}

interface MigrationStats {
  eventsScanned: number;
  eventsChanged: number;
  assignmentsDenormalized: number;
  reviewStagesInitialized: number;
  projectionsCreatedOrRepaired: number;
  staleProjectionsDeleted: number;
  anomalies: string[];
  blocked: string[];
  manualReviewRequired: string[];
}

interface MigrationPlan {
  projectId: string;
  migrationId: string;
  stats: MigrationStats;
  operations: MigrationOperation[];
  summaries: EventPlanSummary[];
}

interface SnapshotDocument {
  path: string;
  exists: boolean;
  before?: unknown;
  beforeUpdateTime?: string;
  after?: unknown;
  afterExists?: boolean;
  afterUpdateTime?: string;
}

interface MigrationSnapshot {
  projectId: string;
  migrationId: string;
  createdAt: number;
  appliedAt?: number;
  documents: SnapshotDocument[];
  excludedFingerprints: Record<string, string>;
}

interface MigrationReport {
  projectId: string;
  migrationId: string;
  action: MigrationAction;
  generatedAt: number;
  manifestPath?: string;
  snapshotPath?: string;
  stats: MigrationStats;
  summaries: EventPlanSummary[];
  operations: Array<{
    kind: MigrationOperationKind;
    path: string;
    eventId: string;
    fields: string[];
    reason: string;
  }>;
}

export function parseMigrationArgs(argv: string[]): MigrationCliOptions {
  let action: MigrationAction = 'dry-run';
  let actionSeen = false;
  const options: MigrationCliOptions = { action };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run' || argument === '--apply' || argument === '--verify') {
      if (actionSeen) throw new Error('Choose exactly one migration action.');
      action = argument.slice(2) as Exclude<MigrationAction, 'rollback'>;
      options.action = action;
      actionSeen = true;
      continue;
    }
    if (argument === '--rollback' || argument.startsWith('--rollback=')) {
      if (actionSeen) throw new Error('Choose exactly one migration action.');
      const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index];
      if (!value) throw new Error('--rollback requires a snapshot path.');
      options.action = 'rollback';
      options.snapshotPath = value;
      actionSeen = true;
      continue;
    }
    if (argument === '--manifest' || argument.startsWith('--manifest=')) {
      options.manifestPath = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index];
      if (!options.manifestPath) throw new Error('--manifest requires a file path.');
      continue;
    }
    if (argument === '--event' || argument.startsWith('--event=')) {
      options.eventId = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index];
      if (!options.eventId) throw new Error('--event requires an exact event ID.');
      continue;
    }
    if (argument === '--snapshot' || argument.startsWith('--snapshot=')) {
      options.snapshotPath = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index];
      if (!options.snapshotPath) throw new Error('--snapshot requires a file path.');
      continue;
    }
    if (argument === '--report' || argument.startsWith('--report=')) {
      options.reportPath = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index];
      if (!options.reportPath) throw new Error('--report requires a file path.');
      continue;
    }
    throw new Error(`Unknown migration argument: ${argument}`);
  }

  if (options.action === 'rollback' && !options.snapshotPath) {
    throw new Error('--rollback requires a snapshot path.');
  }
  if (options.action === 'apply' && !options.manifestPath) {
    throw new Error('--apply requires --manifest; broad production migration is disabled.');
  }
  if (options.action === 'verify' && !options.manifestPath) {
    throw new Error('--verify requires --manifest.');
  }
  if (options.eventId && options.action === 'rollback') {
    throw new Error('--event cannot be used with --rollback.');
  }
  return options;
}

export function sameStringSet(left: string[] | undefined, right: string[]): boolean {
  return JSON.stringify(canonicalStringSet(left)) === JSON.stringify(canonicalStringSet(right));
}

export function sameStringMap(
  left: Record<string, string> | undefined,
  right: Record<string, string>,
): boolean {
  return JSON.stringify(canonicalStringMap(left)) === JSON.stringify(canonicalStringMap(right));
}

export function canonicalStringSet(value: string[] | undefined): string[] {
  return [...new Set((value ?? []).filter((item): item is string => typeof item === 'string'))].sort();
}

export function canonicalStringMap(value: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value ?? {})
      .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function validateMigrationManifest(manifest: MigrationManifest, projectId: string): void {
  if (!manifest || typeof manifest !== 'object') throw new Error('Migration manifest must be an object.');
  if (!manifest.migrationId || !/^[a-z0-9][a-z0-9-]+$/.test(manifest.migrationId)) {
    throw new Error('Migration manifest has an invalid migrationId.');
  }
  if (manifest.projectId !== projectId) {
    throw new Error(`Migration manifest targets ${manifest.projectId}, but credentials target ${projectId}.`);
  }
  if (!Array.isArray(manifest.eventIds) || manifest.eventIds.length === 0) {
    throw new Error('Migration manifest must contain at least one exact eventId.');
  }
  if (new Set(manifest.eventIds).size !== manifest.eventIds.length) {
    throw new Error('Migration manifest contains duplicate event IDs.');
  }
  if (manifest.eventIds.some((eventId) => STERAS_TEST_EVENT_IDS.includes(eventId as (typeof STERAS_TEST_EVENT_IDS)[number]))) {
    throw new Error('Migration manifest cannot include STERAS managed test fixture IDs.');
  }
  const excluded = manifest.excludedEventIds ?? [];
  if (new Set(excluded).size !== excluded.length) throw new Error('Migration manifest has duplicate excluded IDs.');
  if (manifest.eventIds.some((eventId) => excluded.includes(eventId))) {
    throw new Error('An event cannot be both included and excluded.');
  }
  for (const eventId of manifest.eventIds) {
    const fields = manifest.allowedEventFields?.[eventId];
    if (!Array.isArray(fields)) throw new Error(`Manifest is missing allowedEventFields for ${eventId}.`);
    for (const field of fields) {
      if (!MIGRATABLE_EVENT_FIELDS.has(field)) throw new Error(`Unsupported migration field ${field} for ${eventId}.`);
    }
  }
  if (manifest.allowProjectionChanges !== true) manifest.allowProjectionChanges = false;
}

export function resolveManifestPath(input?: string): string {
  const candidates = input
    ? [input]
    : [
      resolve(process.cwd(), DEFAULT_MANIFEST_FILENAME),
      resolve(process.cwd(), 'functions', DEFAULT_MANIFEST_FILENAME),
    ];
  for (const candidate of candidates) {
    const resolved = isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
    if (existsSync(resolved)) return resolved;
  }
  throw new Error(`Migration manifest not found. Checked: ${candidates.join(', ')}`);
}

export function loadMigrationManifest(input: string | undefined, projectId: string): { manifest: MigrationManifest; path: string } {
  const path = resolveManifestPath(input);
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as MigrationManifest;
  validateMigrationManifest(manifest, projectId);
  return { manifest, path };
}

export function encodeFirestoreValue(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return { __sterasType: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (Array.isArray(value)) return value.map((item) => encodeFirestoreValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeFirestoreValue(item)]));
  }
  return value;
}

export function decodeFirestoreValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => decodeFirestoreValue(item));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.__sterasType === 'timestamp' && typeof record.seconds === 'number' && typeof record.nanoseconds === 'number') {
      return new Timestamp(record.seconds, record.nanoseconds);
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decodeFirestoreValue(item)]));
  }
  return value;
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(encodeFirestoreValue(value)) ?? null)).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function timestampKey(value: Timestamp | undefined): string | undefined {
  return value ? `${value.seconds}:${value.nanoseconds}` : undefined;
}

function sameSnapshotVersion(snapshot: DocumentSnapshot, expectedExists: boolean, expectedUpdateTime?: string): boolean {
  if (snapshot.exists !== expectedExists) return false;
  if (!expectedExists) return true;
  return timestampKey(snapshot.updateTime) === expectedUpdateTime;
}

function allowedFieldsFor(manifest: MigrationManifest | undefined, eventId: string): Set<string> | undefined {
  if (!manifest) return undefined;
  return new Set(manifest.allowedEventFields[eventId] ?? []);
}

function publicProjectionEqual(left: PublicEventControl, right: PublicEventControl): boolean {
  return left.publicControlId === right.publicControlId
    && left.eventId === right.eventId
    && left.versionId === right.versionId
    && left.controlId === right.controlId
    && left.docId === right.docId
    && left.authority === right.authority
    && left.controlName === right.controlName
    && left.stage2Label === right.stage2Label
    && left.imageUrl === right.imageUrl
    && left.publicConfirmCount === right.publicConfirmCount
    && left.reported === right.reported
    && left.publishedAt === right.publishedAt
    && left.sanitized === right.sanitized
    && left.sanitizedAt === right.sanitizedAt
    && left.sanitizedBy === right.sanitizedBy;
}

function eventOperationAllowed(manifest: MigrationManifest | undefined, eventId: string, fields: string[]): boolean {
  if (!manifest) return true;
  const allowed = allowedFieldsFor(manifest, eventId);
  return fields.every((field) => allowed?.has(field) === true);
}

async function buildEventPlan(
  db: Firestore,
  eventDoc: DocumentSnapshot,
  manifest: MigrationManifest | undefined,
  now: number,
): Promise<{ operations: MigrationOperation[]; summary: EventPlanSummary; stats: Partial<MigrationStats> }> {
  const event = eventDoc.data() as EventRecord;
  const eventId = eventDoc.id;
  const eventRef = eventDoc.ref;
  const currentVersionId = event.currentVersionId;
  const operations: MigrationOperation[] = [];
  const blockedReasons: string[] = [];
  const anomalies: string[] = [];
  const manualReviewRequired: string[] = [];
  const eventUpdates: Record<string, unknown> = {};
  let assignmentChanged = false;
  let reviewStageChanged = false;
  let projectionOperationCount = 0;

  if (!currentVersionId) {
    if (['UnderReview', 'Approved'].includes(event.status)) anomalies.push(`${eventId}: missing currentVersionId`);
    return {
      operations,
      summary: {
        eventId,
        status: event.status ?? null,
        currentVersionId: null,
        changedFields: [],
        candidateOperationCount: 0,
        operationCount: 0,
        projectionOperationCount: 0,
        manualReviewRequired: false,
        blockedReasons: [],
      },
      stats: { anomalies, blocked: blockedReasons, manualReviewRequired },
    };
  }

  const assignmentsSnapshot = await eventRef.collection(COLLECTIONS.ASSIGNMENTS).get();
  const currentAssignments = assignmentsSnapshot.docs
    .map((doc) => doc.data() as Assignment)
    .filter((assignment) => assignment.versionId === currentVersionId && assignment.status !== 'revoked');
  const assignedOfficerUids = canonicalStringSet(currentAssignments.map((assignment) => assignment.officerUid));
  const assignedOfficerByAuthority = canonicalStringMap(
    Object.fromEntries(currentAssignments.map((assignment) => [assignment.authorityType, assignment.officerUid])),
  );

  if (!sameStringSet(event.assignedOfficerUids, assignedOfficerUids)) {
    eventUpdates.assignedOfficerUids = assignedOfficerUids;
    assignmentChanged = true;
  }
  if (!sameStringMap(event.assignedOfficerByAuthority, assignedOfficerByAuthority)) {
    eventUpdates.assignedOfficerByAuthority = assignedOfficerByAuthority;
    assignmentChanged = true;
  }

  if (event.status === 'UnderReview') {
    if (currentAssignments.length > 0 && !event.initialReview?.decision) {
      manualReviewRequired.push(`${eventId}: assignments exist but initialReview is missing; no approval will be inferred.`);
    } else {
      const desiredStage = currentAssignments.length === 0
        ? 'initial'
        : currentAssignments.every((assignment) => assignment.status === 'completed' && !!assignment.decision)
          ? 'second'
          : 'authority';
      if (event.reviewStage !== desiredStage) {
        eventUpdates.reviewStage = desiredStage;
        reviewStageChanged = true;
      }
    }
  }

  const controlsSnapshot = await eventRef.collection(COLLECTIONS.EVENT_CONTROLS).get();
  const controls = controlsSnapshot.docs
    .map((doc) => ({ id: doc.id, control: doc.data() as EventControl }))
    .filter(({ control }) => control.versionId === currentVersionId);
  const publicItemsSnapshot = await db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId).collection(COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS).get();
  const existingPublic = new Map(publicItemsSnapshot.docs.map((doc) => [doc.id, doc.data() as PublicEventControl]));
  const expectedPublicIds = new Set<string>();
  const projectionOperations: MigrationOperation[] = [];

  for (const { id: controlId, control } of controls) {
    if (!control.stage2Requirement) continue;
    const stage2Snapshot = await eventRef
      .collection(COLLECTIONS.EVENT_CONTROLS)
      .doc(controlId)
      .collection(COLLECTIONS.STAGE2_DOCS)
      .doc(`${controlId}-s2`)
      .get();
    const publicRef = db
      .collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS)
      .doc(eventId)
      .collection(COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS)
      .doc(`${controlId}-stage2`);
    const privateDoc = stage2Snapshot.exists ? stage2Snapshot.data() as Stage2Doc : undefined;
    const existing = existingPublic.get(`${controlId}-stage2`);
    if (privateDoc?.published) {
      if (!privateDoc.imageUrl || !privateDoc.docId) {
        blockedReasons.push(`${eventId}: published Stage 2 document ${controlId} is missing imageUrl or docId.`);
        continue;
      }
      expectedPublicIds.add(`${controlId}-stage2`);
      const projection: PublicEventControl = {
        publicControlId: `${controlId}-stage2`,
        eventId,
        versionId: currentVersionId,
        controlId,
        docId: privateDoc.docId,
        authority: control.authority,
        controlName: control.controlName,
        stage2Label: control.stage2Requirement.label,
        imageUrl: privateDoc.imageUrl,
        publicConfirmCount: privateDoc.publicConfirmCount ?? 0,
        ...(privateDoc.m4TicketId ? { reported: true } : {}),
        publishedAt: privateDoc.publishedAt ?? privateDoc.uploadedAt,
        sanitized: true,
        sanitizedAt: existing?.sanitizedAt ?? privateDoc.publishedAt ?? privateDoc.uploadedAt,
        sanitizedBy: 'system',
      };
      if (!existing || !publicProjectionEqual(existing, projection)) {
        projectionOperations.push({ kind: 'set', ref: publicRef, eventId, data: projection, reason: 'repair_public_stage2_projection', fields: ['publicProjection'] });
      }
    }
  }

  for (const publicId of existingPublic.keys()) {
    if (!expectedPublicIds.has(publicId)) {
      const staleRef = publicItemsSnapshot.docs.find((doc) => doc.id === publicId)?.ref
        ?? db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId).collection(COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS).doc(publicId);
      projectionOperations.push({ kind: 'delete', ref: staleRef, eventId, reason: 'delete_stale_public_stage2_projection', fields: ['publicProjection'] });
    }
  }

  const changedFields = Object.keys(eventUpdates);
  const candidateOperationCount = changedFields.length > 0 ? 1 : 0;
  if (changedFields.length > 0 && !eventOperationAllowed(manifest, eventId, changedFields)) {
    const allowed = allowedFieldsFor(manifest, eventId);
    const disallowed = changedFields.filter((field) => !allowed?.has(field));
    blockedReasons.push(`${eventId}: unexpected event fields ${disallowed.join(', ')}.`);
  }
  if (projectionOperations.length > 0 && manifest && manifest.allowProjectionChanges !== true) {
    blockedReasons.push(`${eventId}: ${projectionOperations.length} public projection operation(s) are outside this manifest.`);
  }
  if (manualReviewRequired.length > 0) blockedReasons.push(...manualReviewRequired);

  const candidateOperations = [...projectionOperations];
  if (changedFields.length > 0) {
    candidateOperations.push({ kind: 'update', ref: eventRef, eventId, data: eventUpdates, reason: 'backfill_m3_event_fields', fields: changedFields });
  }
  if (candidateOperations.length > 0 && blockedReasons.length === 0) {
    operations.push(...candidateOperations);
    operations.push({
      kind: 'set',
      ref: eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${manifest?.migrationId ?? DEFAULT_MIGRATION_ID}_${currentVersionId}`),
      eventId,
      data: {
        id: `${manifest?.migrationId ?? DEFAULT_MIGRATION_ID}_${currentVersionId}`,
        eventId,
        versionId: currentVersionId,
        action: 'deployment_migration',
        actorId: 'system',
        actorRole: 'system',
        timestamp: now,
        notes: 'Authority approval compatibility migration applied.',
        metadata: {
          migrationId: manifest?.migrationId ?? DEFAULT_MIGRATION_ID,
          assignedOfficerCount: assignedOfficerUids.length,
          reviewStage: eventUpdates.reviewStage ?? event.reviewStage ?? null,
          changedFields,
        },
      },
      reason: 'write_migration_audit_log',
      fields: ['auditLog'],
    });
  }

  projectionOperationCount = projectionOperations.length;
  return {
    operations,
    summary: {
      eventId,
      status: event.status ?? null,
      currentVersionId,
      changedFields,
      candidateOperationCount: candidateOperationCount + projectionOperations.length,
      operationCount: operations.length,
      projectionOperationCount,
      manualReviewRequired: manualReviewRequired.length > 0,
      blockedReasons,
    },
    stats: {
      eventsChanged: operations.length > 0 ? 1 : 0,
      assignmentsDenormalized: assignmentChanged ? 1 : 0,
      reviewStagesInitialized: reviewStageChanged ? 1 : 0,
      projectionsCreatedOrRepaired: projectionOperations.filter((operation) => operation.kind === 'set').length,
      staleProjectionsDeleted: projectionOperations.filter((operation) => operation.kind === 'delete').length,
      anomalies,
      blocked: blockedReasons,
      manualReviewRequired,
    },
  };
}

function emptyStats(eventsScanned = 0): MigrationStats {
  return {
    eventsScanned,
    eventsChanged: 0,
    assignmentsDenormalized: 0,
    reviewStagesInitialized: 0,
    projectionsCreatedOrRepaired: 0,
    staleProjectionsDeleted: 0,
    anomalies: [],
    blocked: [],
    manualReviewRequired: [],
  };
}

function mergeStats(target: MigrationStats, source: Partial<MigrationStats>): void {
  target.eventsChanged += source.eventsChanged ?? 0;
  target.assignmentsDenormalized += source.assignmentsDenormalized ?? 0;
  target.reviewStagesInitialized += source.reviewStagesInitialized ?? 0;
  target.projectionsCreatedOrRepaired += source.projectionsCreatedOrRepaired ?? 0;
  target.staleProjectionsDeleted += source.staleProjectionsDeleted ?? 0;
  target.anomalies.push(...(source.anomalies ?? []));
  target.blocked.push(...(source.blocked ?? []));
  target.manualReviewRequired.push(...(source.manualReviewRequired ?? []));
}

async function captureEventTreeFingerprint(ref: DocumentReference): Promise<string> {
  const entries: Array<{ path: string; exists: boolean; data?: unknown }> = [];
  async function walk(documentRef: DocumentReference): Promise<void> {
    const snapshot = await documentRef.get();
    entries.push({ path: documentRef.path, exists: snapshot.exists, ...(snapshot.exists ? { data: encodeFirestoreValue(snapshot.data()) } : {}) });
    for (const collection of await documentRef.listCollections()) {
      const documents = await collection.get();
      for (const document of documents.docs) await walk(document.ref);
    }
  }
  await walk(ref);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return fingerprint(entries);
}

async function captureExcludedFingerprints(db: Firestore, eventIds: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const eventId of eventIds) {
    result[`events/${eventId}`] = await captureEventTreeFingerprint(db.collection(COLLECTIONS.EVENTS).doc(eventId));
    result[`public_event_controls/${eventId}`] = await captureEventTreeFingerprint(db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId));
  }
  return result;
}

async function buildMigrationPlan(
  db: Firestore,
  projectId: string,
  manifest: MigrationManifest | undefined,
  eventId: string | undefined,
  now: number,
): Promise<MigrationPlan> {
  const query = eventId
    ? db.collection(COLLECTIONS.EVENTS).where('__name__', '==', eventId)
    : manifest
      ? db.collection(COLLECTIONS.EVENTS).where('__name__', 'in', manifest.eventIds)
      : db.collection(COLLECTIONS.EVENTS);
  const snapshot = await query.get();
  const stats = emptyStats(snapshot.size);
  const operations: MigrationOperation[] = [];
  const summaries: EventPlanSummary[] = [];
  if (manifest) {
    const foundIds = new Set(snapshot.docs.map((document) => document.id));
    for (const requestedId of eventId ? [eventId] : manifest.eventIds) {
      if (!foundIds.has(requestedId)) stats.anomalies.push(`${requestedId}: event document not found`);
    }
  }
  for (const eventDoc of snapshot.docs) {
    const eventPlan = await buildEventPlan(db, eventDoc, manifest, now);
    operations.push(...eventPlan.operations);
    summaries.push(eventPlan.summary);
    mergeStats(stats, eventPlan.stats);
  }
  return { projectId, migrationId: manifest?.migrationId ?? DEFAULT_MIGRATION_ID, stats, operations, summaries };
}

function ensureArtifactDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function defaultArtifactPath(kind: string, migrationId: string): string {
  return resolve(process.cwd(), DEFAULT_ARTIFACT_DIR, `${migrationId}-${kind}-${Date.now()}.json`);
}

function writeJson(path: string, value: unknown): void {
  ensureArtifactDirectory(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function reportFromPlan(plan: MigrationPlan, action: MigrationAction, manifestPath?: string, snapshotPath?: string): MigrationReport {
  return {
    projectId: plan.projectId,
    migrationId: plan.migrationId,
    action,
    generatedAt: Date.now(),
    ...(manifestPath ? { manifestPath } : {}),
    ...(snapshotPath ? { snapshotPath } : {}),
    stats: plan.stats,
    summaries: plan.summaries,
    operations: plan.operations.map((operation) => ({
      kind: operation.kind,
      path: operation.ref.path,
      eventId: operation.eventId,
      fields: operation.fields,
      reason: operation.reason,
    })),
  };
}

async function captureSnapshot(
  db: Firestore,
  plan: MigrationPlan,
  manifest: MigrationManifest,
): Promise<MigrationSnapshot> {
  const documents: SnapshotDocument[] = [];
  const uniqueRefs = new Map(plan.operations.map((operation) => [operation.ref.path, operation.ref]));
  for (const ref of uniqueRefs.values()) {
    const snapshot = await ref.get();
    documents.push({
      path: ref.path,
      exists: snapshot.exists,
      ...(snapshot.exists ? { before: encodeFirestoreValue(snapshot.data()), beforeUpdateTime: timestampKey(snapshot.updateTime) } : {}),
    });
  }
  return {
    projectId: plan.projectId,
    migrationId: plan.migrationId,
    createdAt: Date.now(),
    documents,
    excludedFingerprints: await captureExcludedFingerprints(db, manifest.excludedEventIds ?? []),
  };
}

async function addAfterState(db: Firestore, snapshot: MigrationSnapshot): Promise<void> {
  for (const document of snapshot.documents) {
    const current = await db.doc(document.path).get();
    document.afterExists = current.exists;
    document.after = current.exists ? encodeFirestoreValue(current.data()) : undefined;
    document.afterUpdateTime = timestampKey(current.updateTime);
  }
  snapshot.appliedAt = Date.now();
}

async function commitOperations(db: Firestore, operations: MigrationOperation[], snapshot: MigrationSnapshot): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const currentByPath = new Map<string, DocumentSnapshot>();
    for (const operation of operations) {
      if (!currentByPath.has(operation.ref.path)) currentByPath.set(operation.ref.path, await transaction.get(operation.ref));
    }
    for (const document of snapshot.documents) {
      const current = currentByPath.get(document.path);
      if (!current || !sameSnapshotVersion(current, document.exists, document.beforeUpdateTime)) {
        throw new Error(`Migration precondition failed for ${document.path}; data changed after dry-run.`);
      }
    }
    for (const operation of operations) {
      if (operation.kind === 'set') transaction.set(operation.ref, operation.data ?? {}, { merge: true });
      if (operation.kind === 'update') transaction.update(operation.ref, operation.data ?? {});
      if (operation.kind === 'delete') transaction.delete(operation.ref);
    }
  });
}

function assertProductionGuard(projectId: string, action: MigrationAction): void {
  if (projectId === STERAS_TEST_SHARED_PROJECT_ID && action !== 'dry-run' && process.env.M3_MIGRATION_ALLOW_PRODUCTION !== 'true') {
    throw new Error(`Refusing to ${action} the shared ${projectId} project without M3_MIGRATION_ALLOW_PRODUCTION=true.`);
  }
  if (projectId === STERAS_TEST_SHARED_PROJECT_ID && action !== 'dry-run' && process.env.M3_MIGRATION_CONFIRM_ID !== 'm3-legacy-linkos-2026-08') {
    throw new Error('Set M3_MIGRATION_CONFIRM_ID=m3-legacy-linkos-2026-08 for this exact migration.');
  }
}

async function verifyExcludedFingerprints(db: Firestore, snapshot: MigrationSnapshot): Promise<string[]> {
  const failures: string[] = [];
  for (const [key, expected] of Object.entries(snapshot.excludedFingerprints)) {
    const [collection, eventId] = key.split('/');
    const actual = await captureEventTreeFingerprint(db.collection(collection).doc(eventId));
    if (actual !== expected) failures.push(key);
  }
  return failures;
}

async function runRollback(db: Firestore, projectId: string, snapshotPath: string): Promise<void> {
  const snapshot = JSON.parse(readFileSync(resolve(process.cwd(), snapshotPath), 'utf8')) as MigrationSnapshot;
  if (snapshot.projectId !== projectId) throw new Error(`Snapshot targets ${snapshot.projectId}, not ${projectId}.`);
  if (!snapshot.appliedAt) throw new Error('Snapshot has no completed apply state; rollback is not necessary.');
  await db.runTransaction(async (transaction) => {
    const currentByPath = new Map<string, DocumentSnapshot>();
    for (const document of snapshot.documents) currentByPath.set(document.path, await transaction.get(db.doc(document.path)));
    for (const document of snapshot.documents) {
      const current = currentByPath.get(document.path);
      const currentFingerprint = current?.exists ? fingerprint(current.data()) : fingerprint(null);
      const expectedAfterFingerprint = document.afterExists ? fingerprint(decodeFirestoreValue(document.after)) : fingerprint(null);
      if (!current || current.exists !== document.afterExists || currentFingerprint !== expectedAfterFingerprint) {
        throw new Error(`Rollback stopped because ${document.path} changed after migration.`);
      }
    }
    for (const document of snapshot.documents) {
      const ref = db.doc(document.path);
      if (document.exists) transaction.set(ref, (decodeFirestoreValue(document.before) ?? {}) as DocumentData);
      else transaction.delete(ref);
    }
  });
  console.info(JSON.stringify({ projectId, action: 'rollback', migrationId: snapshot.migrationId, documentsRestored: snapshot.documents.length }, null, 2));
}

export async function runMigration(options: MigrationCliOptions): Promise<void> {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? STERAS_TEST_SHARED_PROJECT_ID;
  assertProductionGuard(projectId, options.action);

  if (options.action === 'rollback') {
    const app = initializeApp({ credential: applicationDefault(), projectId });
    await runRollback(getFirestore(app), projectId, options.snapshotPath as string);
    return;
  }

  const loadedManifest = options.manifestPath ? loadMigrationManifest(options.manifestPath, projectId) : undefined;
  const eventId = options.eventId ?? process.env.M3_MIGRATION_EVENT_ID?.trim();
  if (loadedManifest && eventId && !loadedManifest.manifest.eventIds.includes(eventId)) {
    throw new Error(`Event ${eventId} is not in the migration manifest.`);
  }
  const app = initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore(app);
  const plan = await buildMigrationPlan(db, projectId, loadedManifest?.manifest, eventId, Date.now());
  const report = reportFromPlan(plan, options.action, loadedManifest?.path, options.snapshotPath);

  if (options.action === 'dry-run') {
    if (options.reportPath) writeJson(options.reportPath, report);
    console.info(JSON.stringify(report, null, 2));
    return;
  }

  if (plan.stats.anomalies.length > 0 || plan.stats.blocked.length > 0 || plan.stats.manualReviewRequired.length > 0) {
    throw new Error('Migration blocked. Review anomalies, blocked and manualReviewRequired in the dry-run report before applying.');
  }
  if (!loadedManifest) throw new Error('A validated manifest is required for apply/verify.');

  if (options.action === 'verify') {
    if (plan.operations.length > 0) throw new Error(`Verification failed: ${plan.operations.length} operation(s) are still pending.`);
    if (options.snapshotPath) {
      const snapshot = JSON.parse(readFileSync(resolve(process.cwd(), options.snapshotPath), 'utf8')) as MigrationSnapshot;
      const excludedFailures = await verifyExcludedFingerprints(db, snapshot);
      if (excludedFailures.length > 0) throw new Error(`Excluded data changed: ${excludedFailures.join(', ')}`);
    }
    console.info(JSON.stringify({ ...report, verified: true }, null, 2));
    return;
  }

  const snapshotPath = options.snapshotPath
    ? resolve(process.cwd(), options.snapshotPath)
    : defaultArtifactPath('snapshot', plan.migrationId);
  const snapshot = await captureSnapshot(db, plan, loadedManifest.manifest);
  writeJson(snapshotPath, snapshot);
  await commitOperations(db, plan.operations, snapshot);
  await addAfterState(db, snapshot);
  writeJson(snapshotPath, snapshot);
  report.snapshotPath = snapshotPath;
  if (options.reportPath) writeJson(options.reportPath, report);
  console.info(JSON.stringify({ ...report, snapshotPath, applied: true }, null, 2));
}

if (require.main === module) {
  runMigration(parseMigrationArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
