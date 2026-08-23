"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESOURCE_CUTOVER_LEASE_MS = exports.RESOURCE_CUTOVER_LOCK_PATH = void 0;
exports.createResourceCutoverQueueToken = createResourceCutoverQueueToken;
exports.acquireResourceCutoverLock = acquireResourceCutoverLock;
exports.renewResourceCutoverLease = renewResourceCutoverLease;
exports.assertResourceCutoverFence = assertResourceCutoverFence;
exports.startResourceCutoverHeartbeat = startResourceCutoverHeartbeat;
exports.releaseResourceCutoverLock = releaseResourceCutoverLock;
const node_crypto_1 = require("node:crypto");
exports.RESOURCE_CUTOVER_LOCK_PATH = 'system_controls/m2_resource_v3_cutover';
exports.RESOURCE_CUTOVER_LEASE_MS = 2 * 60 * 1000;
function createResourceCutoverQueueToken(input) {
    const generationId = input.generationId ?? (0, node_crypto_1.randomUUID)();
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
        tokenId: (0, node_crypto_1.createHash)('sha256').update(identity).digest('hex'),
        eventId: input.eventId,
        ...(input.currentVersionId ? { currentVersionId: input.currentVersionId } : {}),
        ...(input.currentAssessmentId ? { currentAssessmentId: input.currentAssessmentId } : {}),
        ...(input.assessmentInputHash ? { assessmentInputHash: input.assessmentInputHash } : {}),
        ...(input.assessmentStateHash ? { assessmentStateHash: input.assessmentStateHash } : {}),
        generationId,
        queuedAt,
    };
}
async function acquireResourceCutoverLock(db, sessionId, mode, expectedTakeoverSessionId, clock = Date.now) {
    const reference = db.doc(exports.RESOURCE_CUTOVER_LOCK_PATH);
    await db.runTransaction(async (transaction) => {
        const now = typeof clock === 'function' ? clock() : clock;
        const snapshot = await transaction.get(reference);
        const current = snapshot.data();
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
            ? current.queuedEvents.filter((value) => Boolean(value && typeof value === 'object' && typeof value.tokenId === 'string'))
            : [];
        transaction.set(reference, {
            active: true,
            sessionId,
            acquiredAt: now,
            leaseExpiresAt: now + exports.RESOURCE_CUTOVER_LEASE_MS,
            mode,
            phase: mode === 'restore' ? 'restore' : 'pre_destructive',
            queuedEvents,
            ...(mode === 'restore' && expectedTakeoverSessionId
                ? { takeoverOf: expectedTakeoverSessionId }
                : {}),
        });
    });
}
async function renewResourceCutoverLease(db, sessionId, clock = Date.now) {
    const reference = db.doc(exports.RESOURCE_CUTOVER_LOCK_PATH);
    return db.runTransaction(async (transaction) => {
        const now = typeof clock === 'function' ? clock() : clock;
        const leaseExpiresAt = now + exports.RESOURCE_CUTOVER_LEASE_MS;
        const snapshot = await transaction.get(reference);
        const current = snapshot.data();
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
async function assertResourceCutoverFence(db, sessionId, now = Date.now()) {
    const snapshot = await db.doc(exports.RESOURCE_CUTOVER_LOCK_PATH).get();
    const current = snapshot.data();
    if (!snapshot.exists || current?.sessionId !== sessionId || current.active !== true
        || typeof current.leaseExpiresAt !== 'number' || current.leaseExpiresAt <= now) {
        throw new Error('Resource cutover fencing check failed: ownership changed or lease expired.');
    }
    return current;
}
function startResourceCutoverHeartbeat(db, sessionId, intervalMs = 30_000) {
    let ownershipError;
    let running = false;
    const timer = setInterval(() => {
        if (running || ownershipError)
            return;
        running = true;
        void renewResourceCutoverLease(db, sessionId).catch((error) => {
            ownershipError = error;
        }).finally(() => { running = false; });
    }, intervalMs);
    timer.unref();
    return {
        stop: () => clearInterval(timer),
        assertHealthy: () => {
            if (ownershipError)
                throw new Error(`Resource cutover heartbeat lost ownership: ${String(ownershipError)}`);
        },
    };
}
async function releaseResourceCutoverLock(db, sessionId) {
    const reference = db.doc(exports.RESOURCE_CUTOVER_LOCK_PATH);
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists)
            return;
        if (snapshot.data()?.sessionId !== sessionId) {
            throw new Error('Refusing to release a resource cutover lock owned by another session.');
        }
        if (Array.isArray(snapshot.data()?.queuedEvents) && snapshot.data().queuedEvents.length > 0) {
            throw new Error('Refusing to release the resource cutover lock while queued events remain.');
        }
        transaction.delete(reference);
    });
}
//# sourceMappingURL=resourceCutoverLock.js.map