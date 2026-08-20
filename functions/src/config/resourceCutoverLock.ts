import { createHash, randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';

export const RESOURCE_CUTOVER_LOCK_PATH = 'system_controls/m2_resource_v3_cutover';
export const RESOURCE_CUTOVER_LEASE_MS = 2 * 60 * 1000;

export interface ResourceCutoverQueueToken {
  tokenId: string;
  eventId: string;
  currentVersionId?: string;
  currentAssessmentId?: string;
  assessmentInputHash?: string;
  assessmentStateHash?: string;
  generationId: string;
  queuedAt: number;
}

export interface ResourceCutoverLock {
  active: true;
  sessionId: string;
  acquiredAt: number;
  leaseExpiresAt: number;
  mode: 'apply' | 'restore';
  phase: 'pre_destructive' | 'pre_destructive_aborted' | 'post_destructive' | 'restore';
  queuedEvents: ResourceCutoverQueueToken[];
  takeoverOf?: string;
  abortReason?: string;
}

export function createResourceCutoverQueueToken(input: {
  eventId: string;
  currentVersionId?: string;
  currentAssessmentId?: string;
  assessmentInputHash?: string;
  assessmentStateHash?: string;
  generationId?: string;
  queuedAt?: number;
}): ResourceCutoverQueueToken {
  const generationId = input.generationId ?? randomUUID();
  const queuedAt = input.queuedAt ?? Date.now();
  const identity = JSON.stringify({
    eventId: input.eventId,
    currentVersionId: input.currentVersionId ?? null,
    currentAssessmentId: input.currentAssessmentId ?? null,
    assessmentInputHash: input.assessmentInputHash ?? null,
    assessmentStateHash: input.assessmentStateHash ?? null,
    generationId,
  });
  return {
    tokenId: createHash('sha256').update(identity).digest('hex'),
    eventId: input.eventId,
    ...(input.currentVersionId ? { currentVersionId: input.currentVersionId } : {}),
    ...(input.currentAssessmentId ? { currentAssessmentId: input.currentAssessmentId } : {}),
    ...(input.assessmentInputHash ? { assessmentInputHash: input.assessmentInputHash } : {}),
    ...(input.assessmentStateHash ? { assessmentStateHash: input.assessmentStateHash } : {}),
    generationId,
    queuedAt,
  };
}

export async function acquireResourceCutoverLock(
  db: Firestore,
  sessionId: string,
  mode: ResourceCutoverLock['mode'],
  expectedTakeoverSessionId?: string,
  clock: number | (() => number) = Date.now,
): Promise<void> {
  const reference = db.doc(RESOURCE_CUTOVER_LOCK_PATH);
  await db.runTransaction(async (transaction) => {
    const now = typeof clock === 'function' ? clock() : clock;
    const snapshot = await transaction.get(reference);
    const current = snapshot.data() as Partial<ResourceCutoverLock> | undefined;
    const leaseExpired = typeof current?.leaseExpiresAt === 'number' && current.leaseExpiresAt <= now;
    const takeoverAllowed = Boolean(expectedTakeoverSessionId) && (mode === 'apply'
      ? current?.mode === 'apply'
        && (current.phase === 'pre_destructive_aborted'
          || (current.phase === 'pre_destructive' && leaseExpired))
        && current.sessionId === expectedTakeoverSessionId
      : (current?.mode === 'apply'
          && current.phase === 'post_destructive'
          && leaseExpired
          && current.sessionId === expectedTakeoverSessionId)
        || (current?.mode === 'restore' && current.takeoverOf === expectedTakeoverSessionId && leaseExpired));
    if (mode === 'restore' && (!snapshot.exists || !takeoverAllowed)) {
      throw new Error('Restore takeover requires the matching post-destructive apply or restore lineage lock.');
    }
    if (snapshot.exists && current?.active === true && !takeoverAllowed) {
      throw new Error(`Resource cutover is already locked by session ${String(current.sessionId)}.`);
    }
    const queuedEvents = snapshot.exists && takeoverAllowed
      && Array.isArray(current?.queuedEvents)
      ? current.queuedEvents.filter((value): value is ResourceCutoverQueueToken => Boolean(
        value && typeof value === 'object' && typeof (value as ResourceCutoverQueueToken).tokenId === 'string',
      ))
      : [];
    transaction.set(reference, {
      active: true,
      sessionId,
      acquiredAt: now,
      leaseExpiresAt: now + RESOURCE_CUTOVER_LEASE_MS,
      mode,
      phase: mode === 'restore' ? 'restore' : 'pre_destructive',
      queuedEvents,
      ...(mode === 'restore' && expectedTakeoverSessionId
        ? { takeoverOf: expectedTakeoverSessionId }
        : {}),
    } satisfies ResourceCutoverLock);
  });
}

export async function renewResourceCutoverLease(
  db: Firestore,
  sessionId: string,
  clock: number | (() => number) = Date.now,
): Promise<number> {
  const reference = db.doc(RESOURCE_CUTOVER_LOCK_PATH);
  return db.runTransaction(async (transaction) => {
    const now = typeof clock === 'function' ? clock() : clock;
    const leaseExpiresAt = now + RESOURCE_CUTOVER_LEASE_MS;
    const snapshot = await transaction.get(reference);
    const current = snapshot.data() as Partial<ResourceCutoverLock> | undefined;
    if (!snapshot.exists || current?.sessionId !== sessionId || current.active !== true) {
      throw new Error('Resource cutover lease ownership changed.');
    }
    if (typeof current.leaseExpiresAt !== 'number' || current.leaseExpiresAt <= now) {
      throw new Error('Resource cutover lease expired before renewal.');
    }
    transaction.update(reference, { leaseExpiresAt });
    return leaseExpiresAt;
  });
}

export async function assertResourceCutoverFence(
  db: Firestore,
  sessionId: string,
  now = Date.now(),
): Promise<ResourceCutoverLock> {
  const snapshot = await db.doc(RESOURCE_CUTOVER_LOCK_PATH).get();
  const current = snapshot.data() as ResourceCutoverLock | undefined;
  if (!snapshot.exists || current?.sessionId !== sessionId || current.active !== true
    || typeof current.leaseExpiresAt !== 'number' || current.leaseExpiresAt <= now) {
    throw new Error('Resource cutover fencing check failed: ownership changed or lease expired.');
  }
  return current;
}

export function startResourceCutoverHeartbeat(
  db: Firestore,
  sessionId: string,
  intervalMs = 30_000,
): { stop: () => void; assertHealthy: () => void } {
  let ownershipError: unknown;
  let running = false;
  const timer = setInterval(() => {
    if (running || ownershipError) return;
    running = true;
    void renewResourceCutoverLease(db, sessionId).catch((error: unknown) => {
      ownershipError = error;
    }).finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
  return {
    stop: () => clearInterval(timer),
    assertHealthy: () => {
      if (ownershipError) throw new Error(`Resource cutover heartbeat lost ownership: ${String(ownershipError)}`);
    },
  };
}

export async function releaseResourceCutoverLock(db: Firestore, sessionId: string): Promise<void> {
  const reference = db.doc(RESOURCE_CUTOVER_LOCK_PATH);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return;
    if (snapshot.data()?.sessionId !== sessionId) {
      throw new Error('Refusing to release a resource cutover lock owned by another session.');
    }
    if (Array.isArray(snapshot.data()?.queuedEvents) && snapshot.data()!.queuedEvents.length > 0) {
      throw new Error('Refusing to release the resource cutover lock while queued events remain.');
    }
    transaction.delete(reference);
  });
}
