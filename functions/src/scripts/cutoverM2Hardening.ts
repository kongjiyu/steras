import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, Firestore, getFirestore } from 'firebase-admin/firestore';
import {
  ASSESSMENT_SCHEMA_VERSION, COLLECTIONS, EventRecord, EventVersion,
  ProvisionalRiskAssessment, RESOURCE_SCHEMA_VERSION, ResourceRecommendation,
} from '@shared/types';
import {
  acquireResourceCutoverLock,
  assertResourceCutoverFence,
  releaseResourceCutoverLock,
  renewResourceCutoverLease,
  RESOURCE_CUTOVER_LOCK_PATH,
  startResourceCutoverHeartbeat,
} from '../config/resourceCutoverLock';
import {
  assessmentDocumentId, assessmentInputHashForVersion, isPipelineEventVersion,
  isCurrentManualReviewAssessment, isResourceEligibleAssessment, runRiskAndResourcePipeline,
} from '../triggers/onEventCreated';
import {
  drainQueuedResourceEvents, validateOrganizerResourceProjection, validateResourceAgainstStoredInputs,
  validateResourceDocumentIdentity,
} from './cutoverResourceV3';
import { decodeFirestoreValue, EncodedFirestoreValue, encodeFirestoreValue } from './firestoreBackupCodec';
import {
  computeResources,
  stableStringify,
  validateAssessmentResultAgainstProposal,
  validateProvisionalAssessmentResult,
} from '../engines/resourceCalculator';
import { validateResourceRecommendation } from '../engines/resourceContract';
import { fetchVenueContext } from '../engines/ruleBased';
import { inspectStorageEvidence } from '../utils/storageEvidence';

export const HARDENING_CUTOVER_PROJECT = 'linkos-496505';
export const HARDENING_CUTOVER_ANCHORS = 'system_controls/m2_resource_v3_cutover/hardening_anchors';

interface BackupDocument { path: string; data: EncodedFirestoreValue }
interface BackupEvent {
  eventId: string;
  path: string;
  currentVersionId?: string;
  currentAssessmentId?: string;
  currentResourceId?: string;
  versionInputHash?: string;
  summary?: BackupDocument;
}
interface HardeningAttempt {
  eventId: string;
  eventPath: string;
  versionId: string;
  assessmentId: string;
  originalAssessmentId?: string;
  originalResourceId?: string;
  auditPaths: string[];
  status: 'pending' | 'succeeded' | 'failed' | 'rolled_back';
}
export interface HardeningBackup {
  manifestVersion: 1;
  projectId: typeof HARDENING_CUTOVER_PROJECT;
  sessionId: string;
  createdAt: number;
  events: BackupEvent[];
  documents: BackupDocument[];
}

export interface HardeningCutoverOptions {
  projectId: string;
  mode: 'plan' | 'apply' | 'restore';
  confirmation?: string;
  backupDirectory: string;
  backupPath?: string;
  checksum?: string;
  takeoverSessionId?: string;
}

export function parseHardeningCutoverArguments(values: string[]): HardeningCutoverOptions {
  const args = new Map<string, string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) throw new Error(`Unexpected argument: ${value}`);
    const [key, inline] = value.slice(2).split('=', 2);
    const next = values[index + 1];
    if (inline !== undefined) args.set(key, inline);
    else if (next && !next.startsWith('--')) { args.set(key, next); index += 1; }
    else args.set(key, 'true');
  }
  return {
    projectId: args.get('project') ?? '',
    mode: (args.get('mode') ?? 'plan') as HardeningCutoverOptions['mode'],
    confirmation: args.get('confirm'),
    backupDirectory: path.resolve(args.get('backup-dir')
      ?? process.env.STERAS_BACKUP_DIR
      ?? '/Users/kongjy/Documents/School/steras-backups'),
    backupPath: args.get('backup') ? path.resolve(args.get('backup')!) : undefined,
    checksum: args.get('checksum'),
    takeoverSessionId: args.get('takeover-session'),
  };
}

export function validateHardeningCutoverOptions(options: HardeningCutoverOptions): void {
  if (options.projectId !== HARDENING_CUTOVER_PROJECT) throw new Error(`--project must equal ${HARDENING_CUTOVER_PROJECT}.`);
  if (!['plan', 'apply', 'restore'].includes(options.mode)) throw new Error('--mode must be plan, apply, or restore.');
  if (options.mode !== 'plan' && options.confirmation !== HARDENING_CUTOVER_PROJECT) {
    throw new Error(`Pass --confirm=${HARDENING_CUTOVER_PROJECT} for a mutating operation.`);
  }
  if (!path.isAbsolute(options.backupDirectory)) throw new Error('--backup-dir must be absolute.');
  if (options.mode === 'restore' && (!options.backupPath || !path.isAbsolute(options.backupPath))) {
    throw new Error('--backup=<absolute path> is required for restore.');
  }
  if (options.mode === 'restore' && !/^[a-f0-9]{64}$/.test(options.checksum ?? '')) {
    throw new Error('--checksum=<sha256 from the trusted anchor> is required for restore.');
  }
}

export function backupChecksum(raw: string | Buffer): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function validateHardeningBackup(value: unknown): string[] {
  const issues: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['backup-object'];
  const backup = value as Partial<HardeningBackup>;
  if (backup.manifestVersion !== 1) issues.push('manifest-version');
  if (backup.projectId !== HARDENING_CUTOVER_PROJECT) issues.push('project');
  if (typeof backup.sessionId !== 'string' || !backup.sessionId) issues.push('session');
  if (!Number.isFinite(backup.createdAt)) issues.push('created-at');
  if (!Array.isArray(backup.events) || !Array.isArray(backup.documents)) return [...issues, 'collections'];
  const paths = new Set<string>();
  for (const document of backup.documents) {
    if (!document || typeof document.path !== 'string' || !allowedBackupPath(document.path)) issues.push('document-path');
    else if (paths.has(document.path)) issues.push('duplicate-path');
    else paths.add(document.path);
  }
  for (const event of backup.events) {
    if (!event || typeof event.eventId !== 'string' || event.path !== `${COLLECTIONS.EVENTS}/${event.eventId}`) issues.push('event-path');
    if (event.summary && event.summary.path !== `${event.path}/${COLLECTIONS.ASSESSMENT_SUMMARIES}/${event.currentVersionId}`) issues.push('summary-path');
    if (event.versionInputHash !== undefined && (typeof event.versionInputHash !== 'string' || !/^[a-f0-9]{64}$/.test(event.versionInputHash))) issues.push('version-input-hash');
  }
  return [...new Set(issues)];
}

function allowedBackupPath(value: string): boolean {
  const parts = value.split('/');
  if (parts.length < 4 || parts[0] !== COLLECTIONS.EVENTS) return false;
  return [COLLECTIONS.ASSESSMENTS, COLLECTIONS.RESOURCES, COLLECTIONS.AUDIT_LOGS,
    COLLECTIONS.DECISIONS, COLLECTIONS.DECISION_HISTORY].includes(parts[2] as never)
    || (parts.length === 6 && parts[2] === COLLECTIONS.ASSESSMENTS
      && [COLLECTIONS.SCORE_REVIEWS, COLLECTIONS.SCORE_RESOLUTIONS, COLLECTIONS.MANUAL_ASSESSMENTS].includes(parts[4] as never));
}

async function inventory(db: Firestore, sessionId: string): Promise<{ backup: HardeningBackup; candidates: BackupEvent[]; excluded: string[] }> {
  const backup: HardeningBackup = { manifestVersion: 1, projectId: HARDENING_CUTOVER_PROJECT, sessionId, createdAt: Date.now(), events: [], documents: [] };
  const candidates: BackupEvent[] = [];
  const excluded: string[] = [];
  const events = await db.collection(COLLECTIONS.EVENTS).get();
  for (const document of events.docs) {
    const event = { eventId: document.id, ...document.data() } as EventRecord;
    if (!event.currentVersionId || !['Pending', 'UnderReview'].includes(event.status)) continue;
    const entry: BackupEvent = {
      eventId: event.eventId, path: document.ref.path, currentVersionId: event.currentVersionId,
      ...(event.currentAssessmentId ? { currentAssessmentId: event.currentAssessmentId } : {}),
      ...(event.currentResourceId ? { currentResourceId: event.currentResourceId } : {}),
    };
    const summary = await document.ref.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(event.currentVersionId).get();
    if (summary.exists) entry.summary = { path: summary.ref.path, data: encodeFirestoreValue(summary.data()) };
    backup.events.push(entry);
    for (const collection of [COLLECTIONS.ASSESSMENTS, COLLECTIONS.RESOURCES, COLLECTIONS.AUDIT_LOGS, COLLECTIONS.DECISIONS, COLLECTIONS.DECISION_HISTORY]) {
      const snapshot = await document.ref.collection(collection).get();
      for (const item of snapshot.docs) backup.documents.push({ path: item.ref.path, data: encodeFirestoreValue(item.data()) });
    }
    const assessments = await document.ref.collection(COLLECTIONS.ASSESSMENTS).get();
    for (const assessment of assessments.docs) for (const collection of [COLLECTIONS.SCORE_REVIEWS, COLLECTIONS.SCORE_RESOLUTIONS, COLLECTIONS.MANUAL_ASSESSMENTS]) {
      for (const item of (await assessment.ref.collection(collection).get()).docs) {
        backup.documents.push({ path: item.ref.path, data: encodeFirestoreValue(item.data()) });
      }
    }
    const currentAssessment = event.currentAssessmentId
      ? assessments.docs.find((assessment) => assessment.id === event.currentAssessmentId)?.data()
      : undefined;
    const version = await document.ref.collection(COLLECTIONS.VERSIONS).doc(event.currentVersionId).get();
    if (version.exists && isPipelineEventVersion(version.data(), event.eventId, event.currentVersionId)) {
      entry.versionInputHash = version.data()!.inputHash;
    }
    if (currentAssessment?.schemaVersion === ASSESSMENT_SCHEMA_VERSION) {
      const currentIssues = await validateExistingHardeningCurrent(
        document.ref, event, currentAssessment, version.data(), summary.data(),
      );
      if (currentIssues.length > 0) {
        throw new Error(`Invalid current hardening state for ${event.eventId}: ${currentIssues.join(',')}`);
      }
      excluded.push(`${event.eventId}:current_hardening_schema`);
      continue;
    }
    const decisions = await document.ref.collection(COLLECTIONS.DECISIONS).where('versionId', '==', event.currentVersionId).limit(1).get();
    if (!decisions.empty) { excluded.push(`${event.eventId}:downstream_review_exists`); continue; }
    if (!entry.versionInputHash) { excluded.push(`${event.eventId}:invalid_current_version`); continue; }
    candidates.push(entry);
  }
  return { backup, candidates, excluded };
}

async function validateExistingHardeningCurrent(
  eventReference: FirebaseFirestore.DocumentReference,
  event: EventRecord,
  assessment: FirebaseFirestore.DocumentData,
  versionValue: FirebaseFirestore.DocumentData | undefined,
  summary: FirebaseFirestore.DocumentData | undefined,
): Promise<string[]> {
  const versionId = event.currentVersionId;
  const assessmentId = event.currentAssessmentId;
  if (!versionId || !assessmentId || !isPipelineEventVersion(versionValue, event.eventId, versionId)
    || assessment.assessmentId !== assessmentId || assessment.eventId !== event.eventId
    || assessment.versionId !== versionId || assessment.schemaVersion !== ASSESSMENT_SCHEMA_VERSION) {
    return ['identity-or-version'];
  }
  const issues: string[] = [];
  if (!summary || summary.assessmentId !== assessmentId || summary.eventId !== event.eventId
    || summary.versionId !== versionId || summary.schemaVersion !== ASSESSMENT_SCHEMA_VERSION
    || summary.status !== assessment.status) issues.push('summary-identity');
  const storageEvidence = await inspectStorageEvidence(versionValue.documentPaths);
  if (storageEvidence.some((evidence) => {
    const provenance = Array.isArray(assessment.contextEvidence)
      ? assessment.contextEvidence.find((item: unknown) => item && typeof item === 'object'
        && (item as Record<string, unknown>).sourceKind === 'submitted_document'
        && (item as Record<string, unknown>).sourceLocator === evidence.path)
      : undefined;
    return !provenance || provenance.eligibility !== evidence.status
      || provenance.sourceVersion !== evidence.sourceVersion;
  })) issues.push('storage-evidence-binding');
  if (assessment.status === 'manual_review_required') {
    if (event.currentResourceId) issues.push('manual-review-resource-pointer');
    if (summary?.resourceQuantities !== undefined || summary?.resourceRecommendation !== undefined) {
      issues.push('manual-review-resource-projection');
    }
    if (!isCurrentManualReviewAssessment(assessment, event.eventId, versionId, assessmentId)) {
      issues.push('manual-review-contract');
    }
    return issues;
  }
  if (!storageEvidence.some((evidence) => evidence.status === 'eligible')) issues.push('storage-evidence-missing');
  if (!isResourceEligibleAssessment(assessment, event.eventId, versionId, versionValue.eventDetails)) {
    issues.push('assessment-contract');
    return issues;
  }
  if (!event.currentResourceId) {
    issues.push('resource-pointer');
    return issues;
  }
  const resourceSnapshot = await eventReference.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId).get();
  const resource = resourceSnapshot.data() as ResourceRecommendation | undefined;
  const result = assessment.status === 'official_ready' ? assessment.officialResult : assessment.provisionalResult;
  const calculation = computeResources({
    eventId: event.eventId,
    versionId,
    assessmentId,
    eventDetails: versionValue.eventDetails,
    assessmentResult: result,
  });
  const expectedItems = calculation.ok && assessment.status === 'official_ready'
    ? Object.fromEntries(Object.entries(calculation.items).map(([key, item]) => [key, {
        ...item, confidence: 'authority_validated', authorityReviewRequired: false,
      }]))
    : calculation.ok ? calculation.items : undefined;
  if (!resource || resource.schemaVersion !== RESOURCE_SCHEMA_VERSION
    || resource.assessmentId !== assessmentId || !validateResourceRecommendation(resource).ok
    || validateResourceDocumentIdentity(resourceSnapshot.id, resource).length > 0
    || !calculation.ok || resource.resourceInputHash !== calculation.resourceInputHash
    || resource.formulaVersion !== calculation.formulaVersion
    || resource.configVersion !== calculation.configVersion
    || resource.sourceRegistryVersion !== calculation.sourceRegistryVersion
    || stableStringify(resource.items) !== stableStringify(expectedItems)
    || resource.assessmentReference.assessmentId !== assessmentId
    || validateOrganizerResourceProjection(resource, summary).length > 0) issues.push('resource-binding');
  return issues;
}

async function applyCutover(db: Firestore, options: HardeningCutoverOptions): Promise<void> {
  const sessionId = randomUUID();
  let recovery: { backupPath: string; checksum: string } | undefined;
  let destructiveStarted = false;
  await acquireResourceCutoverLock(db, sessionId, 'apply', options.takeoverSessionId);
  const heartbeat = startResourceCutoverHeartbeat(db, sessionId);
  try {
    const state = await inventory(db, sessionId);
    const issues = validateHardeningBackup(state.backup);
    if (issues.length) throw new Error(`Backup preflight failed: ${issues.join(',')}`);
    await mkdir(options.backupDirectory, { recursive: true, mode: 0o700 });
    const backupPath = path.join(options.backupDirectory, `m2-hardening-${new Date().toISOString().replaceAll(':', '-')}-${sessionId}.json`);
    const raw = JSON.stringify(state.backup, null, 2);
    const checksum = backupChecksum(raw);
    recovery = { backupPath, checksum };
    await writeFile(backupPath, raw, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await writeFile(`${backupPath}.sha256`, `${checksum}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const anchor = db.collection(HARDENING_CUTOVER_ANCHORS).doc(sessionId);
    await anchor.create({ sessionId, projectId: options.projectId, backupPath, checksum, status: 'prepared', createdAt: Date.now() });
    await db.runTransaction(async (transaction) => {
      const [lock, currentAnchor] = await Promise.all([
        transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
        transaction.get(anchor),
      ]);
      if (lock.data()?.sessionId !== sessionId || lock.data()?.active !== true
        || !Number.isFinite(lock.data()?.leaseExpiresAt) || lock.data()!.leaseExpiresAt <= Date.now()
        || currentAnchor.data()?.status !== 'prepared') {
        throw new Error('Cutover fence lost before apply.');
      }
      transaction.update(db.doc(RESOURCE_CUTOVER_LOCK_PATH), { phase: 'post_destructive' });
      transaction.update(anchor, { status: 'recovery_required', destructiveStartedAt: Date.now() });
    });
    destructiveStarted = true;
    const failures: Array<{ eventId: string; reason: string }> = [];
    const changed: HardeningAttempt[] = [];
    for (const candidate of state.candidates) {
      await renewResourceCutoverLease(db, sessionId);
      const assessmentId = assessmentDocumentId(candidate.currentVersionId!, assessmentInputHashForVersion(
        candidate.versionInputHash!, `hardening-cutover-${sessionId}`,
      ));
      const attemptReference = anchor.collection('attempts').doc(candidate.eventId);
      const attempt: HardeningAttempt = {
        eventId: candidate.eventId,
        eventPath: candidate.path,
        versionId: candidate.currentVersionId!,
        assessmentId,
        ...(candidate.currentAssessmentId ? { originalAssessmentId: candidate.currentAssessmentId } : {}),
        ...(candidate.currentResourceId ? { originalResourceId: candidate.currentResourceId } : {}),
        auditPaths: [],
        status: 'pending',
      };
      await writeAttemptFenced(db, attemptReference, attempt, sessionId, true);
      let result;
      try {
        result = await runRiskAndResourcePipeline(candidate.eventId, Date.now(), false, undefined, {
          contextGeneration: `hardening-cutover-${sessionId}`,
          expectedCurrentAssessmentId: candidate.currentAssessmentId,
          allowUnderReview: true,
          cutoverSessionId: sessionId,
          allowLegacyResourcePointer: true,
          allowLegacyAssessmentReplacement: true,
        });
      } catch (error) {
        failures.push({ eventId: candidate.eventId, reason: errorSummary(error) });
        await rollbackAttempt(db, state.backup, attempt, sessionId);
        await writeAttemptFenced(db, attemptReference, { ...attempt, status: 'failed' }, sessionId);
        continue;
      }
      const current = (await db.doc(candidate.path).get()).data() as EventRecord | undefined;
      if (result.status !== 'processed' || result.assessmentId !== assessmentId
        || result.assessmentStatus !== 'provisional_ready'
        || !['created', 'reused'].includes(result.resourceStatus ?? '')
        || !current || current.currentAssessmentId !== assessmentId || !current.currentResourceId) {
        failures.push({ eventId: candidate.eventId, reason: result.reason ?? 'pointer-not-moved' });
        await rollbackAttempt(db, state.backup, attempt, sessionId);
        await writeAttemptFenced(db, attemptReference, { ...attempt, status: 'failed' }, sessionId);
      } else {
        const change: HardeningAttempt = {
          ...attempt,
          status: 'succeeded',
          auditPaths: [
            `${candidate.path}/${COLLECTIONS.AUDIT_LOGS}/${assessmentId}-risk-score-computed`,
            `${candidate.path}/${COLLECTIONS.AUDIT_LOGS}/${current.currentResourceId}-recommended`,
          ],
        };
        changed.push(change);
        await writeAttemptFenced(db, attemptReference, change, sessionId);
      }
    }
    const queueFailures: Array<{ eventId: string; reason: string }> = [];
    await drainQueuedResourceEvents(db, sessionId, queueFailures);
    failures.push(...queueFailures);
    const lockAfterDrain = await assertResourceCutoverFence(db, sessionId);
    if (lockAfterDrain.queuedEvents.length > 0) {
      throw new Error(`Cutover recovery queue still contains ${lockAfterDrain.queuedEvents.length} event(s).`);
    }
    const verification = await verifyCurrent(db, changed);
    if (verification.length) {
      await rollback(db, state.backup, changed, sessionId);
      await updateAnchorFenced(db, anchor, sessionId, { status: 'rolled_back', failures, verification, completedAt: Date.now() });
    } else {
      await updateAnchorFenced(db, anchor, sessionId, { status: 'completed', failures, excluded: state.excluded, changed, completedAt: Date.now() });
    }
    heartbeat.assertHealthy();
    await releaseResourceCutoverLock(db, sessionId);
    console.info(JSON.stringify({ sessionId, backupPath, checksum, excluded: state.excluded, failures, verification }, null, 2));
  } catch (error) {
    const lockReference = db.doc(RESOURCE_CUTOVER_LOCK_PATH);
    try {
      await db.runTransaction(async (transaction) => {
        const lock = await transaction.get(lockReference);
        if (lock.data()?.sessionId === sessionId && lock.data()?.active === true
          && lock.data()?.phase === 'pre_destructive') {
          transaction.update(lockReference, { phase: 'pre_destructive_aborted', abortReason: errorSummary(error) });
        }
      });
    } catch { /* The original failure and recovery session remain authoritative. */ }
    const restore = destructiveStarted && recovery
      ? ` Restore with --mode=restore --project=${HARDENING_CUTOVER_PROJECT} --confirm=${HARDENING_CUTOVER_PROJECT} --backup=${recovery.backupPath} --checksum=${recovery.checksum} after the lease expires.`
      : ` Retry with --takeover-session=${sessionId} after the lease expires.`;
    throw new Error(`M2 hardening cutover ${sessionId} stopped.${restore} Cause: ${errorSummary(error)}`);
  } finally { heartbeat.stop(); }
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
}

async function writeAttemptFenced(
  db: Firestore,
  reference: FirebaseFirestore.DocumentReference,
  attempt: HardeningAttempt,
  sessionId: string,
  create = false,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const [lock, existing] = await Promise.all([
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
      transaction.get(reference),
    ]);
    if (lock.data()?.sessionId !== sessionId || lock.data()?.active !== true
      || !Number.isFinite(lock.data()?.leaseExpiresAt) || lock.data()!.leaseExpiresAt <= Date.now()) {
      throw new Error('Cutover attempt fence lost.');
    }
    if (create && existing.exists) throw new Error(`Duplicate hardening attempt: ${attempt.eventId}.`);
    transaction.set(reference, attempt);
  });
}

async function updateAnchorFenced(
  db: Firestore,
  reference: FirebaseFirestore.DocumentReference,
  sessionId: string,
  update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const [lock, anchor] = await Promise.all([
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
      transaction.get(reference),
    ]);
    if (!anchor.exists || anchor.data()?.status !== 'recovery_required'
      || lock.data()?.sessionId !== sessionId || lock.data()?.active !== true
      || !Number.isFinite(lock.data()?.leaseExpiresAt) || lock.data()!.leaseExpiresAt <= Date.now()) {
      throw new Error('Cutover anchor fence lost.');
    }
    transaction.update(reference, update);
  });
}

async function verifyCurrent(db: Firestore, changed: HardeningAttempt[]): Promise<string[]> {
  const issues: string[] = [];
  for (const item of changed) {
    try {
    const eventReference = db.collection(COLLECTIONS.EVENTS).doc(item.eventId);
    const event = (await eventReference.get()).data() as EventRecord | undefined;
    if (!event || !['Pending', 'UnderReview'].includes(event.status) || event.currentVersionId !== item.versionId
      || event.currentAssessmentId !== item.assessmentId || !item.assessmentId) {
      issues.push(`${item.eventId}:assessment-pointer`); continue;
    }
    const assessment = await eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(item.assessmentId).get();
    const assessmentData = assessment.data() as ProvisionalRiskAssessment | undefined;
    const version = (await eventReference.collection(COLLECTIONS.VERSIONS).doc(item.versionId).get()).data() as EventVersion | undefined;
    if (!version || !isPipelineEventVersion(version, item.eventId, item.versionId)
      || !assessmentData || assessmentData.schemaVersion !== ASSESSMENT_SCHEMA_VERSION
      || assessmentData.status !== 'provisional_ready' || assessmentData.assessmentId !== item.assessmentId
      || assessmentData.eventId !== item.eventId || assessmentData.versionId !== item.versionId
      || assessmentData.aiProposal?.status !== 'success'
      || !assessmentData.contextSnapshot || !Array.isArray(assessmentData.evidence)
      || !Array.isArray(assessmentData.contextEvidence)
      || validateProvisionalAssessmentResult(assessmentData.provisionalResult).length > 0
      || validateAssessmentResultAgainstProposal(assessmentData.provisionalResult, assessmentData.aiProposal).length > 0) {
      issues.push(`${item.eventId}:assessment-contract`);
      continue;
    }
    const liveVenue = await fetchVenueContext(version.eventDetails);
    if (!assessmentData.contextSnapshot.venue.matched || !assessmentData.contextSnapshot.venue.venueId
      || !liveVenue.matched || liveVenue.venueId !== assessmentData.contextSnapshot.venue.venueId
      || liveVenue.registeredCapacity !== assessmentData.contextSnapshot.venue.registeredCapacity) {
      issues.push(`${item.eventId}:venue-binding`);
    }
    if ((assessmentData.contextSnapshot.weather.data === null
      && (assessmentData.contextSnapshot.weather.measurementStatus !== 'unavailable'
        || !assessmentData.contextSnapshot.weather.unavailableReason))
      || (assessmentData.contextSnapshot.weather.data !== null
        && assessmentData.contextSnapshot.weather.measurementStatus !== 'available')) issues.push(`${item.eventId}:weather-placeholder`);
    const requiredEvidence = new Set(['crowd', 'venue', 'weather', 'public_health', 'sanitation', 'medical', 'security', 'transport']);
    const eligibleEvidence = new Set<string>(assessmentData.evidence
      .filter((evidence) => evidence.eligibility === 'eligible' && evidence.quality !== 'missing')
      .map((evidence) => evidence.key));
    if ([...requiredEvidence].some((key) => !eligibleEvidence.has(key))
      || !assessmentData.contextEvidence.some((evidence) => evidence.sourceKind === 'submitted_document' && evidence.eligibility === 'eligible')) {
      issues.push(`${item.eventId}:evidence-sufficiency`);
    }
    const storageEvidence = await inspectStorageEvidence(version.documentPaths);
    if (!storageEvidence.some((evidence) => evidence.status === 'eligible')
      || storageEvidence.some((evidence) => {
        const provenance = assessmentData.contextEvidence.find((item) => item.sourceKind === 'submitted_document'
          && item.sourceLocator === evidence.path);
        return !provenance || provenance.eligibility !== evidence.status
          || provenance.sourceVersion !== evidence.sourceVersion || provenance.visibility !== 'authority_only';
      })) issues.push(`${item.eventId}:storage-evidence-binding`);
    if (!event.currentResourceId) { issues.push(`${item.eventId}:resource-pointer`); continue; }
    const resourceSnapshot = await eventReference.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId).get();
    const resource = resourceSnapshot.data() as ResourceRecommendation | undefined;
    const summary = await eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(item.versionId).get();
    if (!resource || resource.schemaVersion !== RESOURCE_SCHEMA_VERSION || resource.assessmentId !== item.assessmentId
      || !validateResourceRecommendation(resource).ok
      || validateResourceDocumentIdentity(resourceSnapshot.id, resource).length > 0
      || validateResourceAgainstStoredInputs(resource, item.eventId, version, assessmentData).length > 0
      || validateOrganizerResourceProjection(resource, summary.data()).length > 0) issues.push(`${item.eventId}:resource-binding`);
    } catch {
      issues.push(`${item.eventId}:verification-error`);
    }
  }
  return issues;
}

async function rollback(
  db: Firestore,
  backup: HardeningBackup,
  changed: HardeningAttempt[],
  sessionId: string,
): Promise<void> {
  await assertResourceCutoverFence(db, sessionId);
  for (const item of changed) await rollbackAttempt(db, backup, item, sessionId);
}

async function rollbackAttempt(db: Firestore, backup: HardeningBackup, item: HardeningAttempt, sessionId: string): Promise<void> {
  const original = backup.events.find((event) => event.eventId === item.eventId);
  if (!original) throw new Error(`Rollback manifest is missing event ${item.eventId}.`);
  const eventReference = db.doc(original.path);
  const newResources = await eventReference.collection(COLLECTIONS.RESOURCES).where('assessmentId', '==', item.assessmentId).get();
  const newAuditPaths = new Set([
    ...item.auditPaths,
    `${eventReference.path}/${COLLECTIONS.AUDIT_LOGS}/${item.assessmentId}-risk-score-computed`,
    ...newResources.docs.map((resource) => `${eventReference.path}/${COLLECTIONS.AUDIT_LOGS}/${resource.id}-recommended`),
  ]);
  const oldPaths = new Set(backup.documents.map((document) => document.path));
  await db.runTransaction(async (transaction) => {
    const [lock, event] = await Promise.all([transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)), transaction.get(eventReference)]);
    if (lock.data()?.sessionId !== sessionId || lock.data()?.active !== true
      || !Number.isFinite(lock.data()?.leaseExpiresAt) || lock.data()!.leaseExpiresAt <= Date.now()) throw new Error('Rollback fence lost.');
    const current = event.data() as EventRecord | undefined;
    const pointsToAttempt = current?.currentAssessmentId === item.assessmentId;
    const stillOriginal = current?.currentAssessmentId === original.currentAssessmentId
      && current?.currentResourceId === original.currentResourceId;
    if (!pointsToAttempt && !stillOriginal) throw new Error(`Rollback refused for advanced event ${item.eventId}.`);
    if (pointsToAttempt) {
      transaction.update(eventReference, {
        ...(original.currentAssessmentId ? { currentAssessmentId: original.currentAssessmentId } : { currentAssessmentId: FieldValue.delete() }),
        ...(original.currentResourceId ? { currentResourceId: original.currentResourceId } : { currentResourceId: FieldValue.delete() }),
      });
      const summaryReference = eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(original.currentVersionId!);
      if (original.summary) transaction.set(summaryReference, decodeFirestoreValue(original.summary.data, (documentPath) => db.doc(documentPath)) as FirebaseFirestore.DocumentData);
      else transaction.delete(summaryReference);
    }
    const assessmentPath = `${eventReference.path}/${COLLECTIONS.ASSESSMENTS}/${item.assessmentId}`;
    if (!oldPaths.has(assessmentPath)) transaction.delete(db.doc(assessmentPath));
    for (const resource of newResources.docs) if (!oldPaths.has(resource.ref.path)) transaction.delete(resource.ref);
    for (const auditPath of newAuditPaths) if (!oldPaths.has(auditPath) && allowedBackupPath(auditPath)) transaction.delete(db.doc(auditPath));
  });
}

/** Emulator-only recovery harness; it is not exported from the deployed Functions entrypoint. */
export const __testOnlyRollbackHardeningAttempt = rollbackAttempt;

async function restoreCutover(db: Firestore, options: HardeningCutoverOptions): Promise<void> {
  const raw = await readFile(options.backupPath!, 'utf8');
  if (backupChecksum(raw) !== options.checksum) throw new Error('Backup checksum mismatch.');
  const backup = JSON.parse(raw) as HardeningBackup;
  const issues = validateHardeningBackup(backup);
  if (issues.length) throw new Error(`Backup validation failed: ${issues.join(',')}`);
  const anchor = await db.collection(HARDENING_CUTOVER_ANCHORS).doc(backup.sessionId).get();
  if (!anchor.exists || anchor.data()?.checksum !== options.checksum || anchor.data()?.backupPath !== options.backupPath
    || anchor.data()?.status !== 'recovery_required') throw new Error('Trusted recovery anchor does not authorize this restore.');
  const restoreSessionId = randomUUID();
  await acquireResourceCutoverLock(db, restoreSessionId, 'restore', backup.sessionId);
  const heartbeat = startResourceCutoverHeartbeat(db, restoreSessionId);
  try {
    const attempts = (await anchor.ref.collection('attempts').get()).docs.map((document) => document.data() as HardeningAttempt);
    await rollback(db, backup, attempts, restoreSessionId);
    const restoreIssues = await verifyRollbackState(db, backup, attempts);
    if (restoreIssues.length > 0) throw new Error(`Rollback verification failed: ${restoreIssues.join(',')}`);
    const queueFailures: Array<{ eventId: string; reason: string }> = [];
    await drainQueuedResourceEvents(db, restoreSessionId, queueFailures);
    const lockAfterDrain = await assertResourceCutoverFence(db, restoreSessionId);
    if (lockAfterDrain.queuedEvents.length > 0) {
      throw new Error(`Restore recovery queue still contains ${lockAfterDrain.queuedEvents.length} event(s).`);
    }
    await updateAnchorFenced(db, anchor.ref, restoreSessionId, { status: 'consumed', restoreSessionId, restoredAt: Date.now() });
    heartbeat.assertHealthy();
    await releaseResourceCutoverLock(db, restoreSessionId);
  } finally { heartbeat.stop(); }
}

async function verifyRollbackState(
  db: Firestore,
  backup: HardeningBackup,
  attempts: HardeningAttempt[],
): Promise<string[]> {
  const issues: string[] = [];
  const oldPaths = new Set(backup.documents.map((document) => document.path));
  for (const attempt of attempts) {
    const original = backup.events.find((event) => event.eventId === attempt.eventId);
    if (!original) { issues.push(`${attempt.eventId}:manifest-missing`); continue; }
    const eventReference = db.doc(original.path);
    const [eventSnapshot, assessmentSnapshot, summarySnapshot, newResources] = await Promise.all([
      eventReference.get(),
      eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(attempt.assessmentId).get(),
      eventReference.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(attempt.versionId).get(),
      eventReference.collection(COLLECTIONS.RESOURCES).where('assessmentId', '==', attempt.assessmentId).get(),
    ]);
    const event = eventSnapshot.data();
    if (event?.currentAssessmentId !== original.currentAssessmentId
      || event?.currentResourceId !== original.currentResourceId) issues.push(`${attempt.eventId}:pointer-restore`);
    const assessmentPath = `${eventReference.path}/${COLLECTIONS.ASSESSMENTS}/${attempt.assessmentId}`;
    if (!oldPaths.has(assessmentPath) && assessmentSnapshot.exists) issues.push(`${attempt.eventId}:new-assessment-remains`);
    if (newResources.docs.some((document) => !oldPaths.has(document.ref.path))) issues.push(`${attempt.eventId}:new-resource-remains`);
    if (original.summary) {
      if (!summarySnapshot.exists
        || stableStringify(encodeFirestoreValue(summarySnapshot.data())) !== stableStringify(original.summary.data)) {
        issues.push(`${attempt.eventId}:summary-restore`);
      }
    } else if (summarySnapshot.exists) issues.push(`${attempt.eventId}:summary-remains`);
  }
  return issues;
}

async function main(): Promise<void> {
  const options = parseHardeningCutoverArguments(process.argv.slice(2));
  validateHardeningCutoverOptions(options);
  initializeApp({ credential: applicationDefault(), projectId: options.projectId });
  const db = getFirestore();
  if (options.mode === 'plan') {
    const state = await inventory(db, 'dry-run');
    console.info(JSON.stringify({ mode: 'plan', candidates: state.candidates.map((item) => item.eventId), excludedDownstreamDecisions: state.excluded, writes: 0 }, null, 2));
  } else if (options.mode === 'apply') await applyCutover(db, options);
  else await restoreCutover(db, options);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
