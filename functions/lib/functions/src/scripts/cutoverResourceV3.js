"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESOURCE_CUTOVER_TRANSACTION_WRITE_LIMIT = exports.RESOURCE_CUTOVER_START_AUDIT_COLLECTION = exports.RESOURCE_CUTOVER_PROJECT = void 0;
exports.parseResourceCutoverArguments = parseResourceCutoverArguments;
exports.validateResourceCutoverOptions = validateResourceCutoverOptions;
exports.validateResourceRevisionGraph = validateResourceRevisionGraph;
exports.validateCurrentResourceTip = validateCurrentResourceTip;
exports.validateResourceAgainstStoredInputs = validateResourceAgainstStoredInputs;
exports.validateResourceDocumentIdentity = validateResourceDocumentIdentity;
exports.shouldAbortResourceCutover = shouldAbortResourceCutover;
exports.validateOrganizerResourceProjection = validateOrganizerResourceProjection;
exports.classifyResourceCutoverState = classifyResourceCutoverState;
exports.assertSafeResourceCutoverApply = assertSafeResourceCutoverApply;
exports.createAndVerifyCutoverStartAudit = createAndVerifyCutoverStartAudit;
exports.verifyCutoverStartAudit = verifyCutoverStartAudit;
exports.transitionCutoverAnchor = transitionCutoverAnchor;
exports.drainQueuedResourceEvents = drainQueuedResourceEvents;
exports.abortResourceCutoverBeforeMutation = abortResourceCutoverBeforeMutation;
exports.restoreBackup = restoreBackup;
exports.preflightResourceCutoverCapacity = preflightResourceCutoverCapacity;
exports.backupChecksumFor = backupChecksumFor;
exports.validateResourceCutoverBackup = validateResourceCutoverBackup;
exports.validateDecodedRestoreRelationships = validateDecodedRestoreRelationships;
exports.assessmentStateHashFor = assessmentStateHashFor;
const promises_1 = require("node:fs/promises");
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../shared/types");
const onEventCreated_1 = require("../triggers/onEventCreated");
const resourceCutoverLock_1 = require("../config/resourceCutoverLock");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const resourceContract_1 = require("../engines/resourceContract");
const firestoreBackupCodec_1 = require("./firestoreBackupCodec");
exports.RESOURCE_CUTOVER_PROJECT = 'linkos-496505';
exports.RESOURCE_CUTOVER_START_AUDIT_COLLECTION = 'system_controls/m2_resource_v3_cutover/cutover_start_audits';
exports.RESOURCE_CUTOVER_TRANSACTION_WRITE_LIMIT = 450;
const RESOURCE_CUTOVER_TRANSACTION_READ_LIMIT = 400;
const RESOURCE_CUTOVER_TRANSACTION_BYTE_LIMIT = 6 * 1024 * 1024;
const RESOURCE_CUTOVER_DOCUMENT_OVERHEAD_BYTES = 2048;
function parseResourceCutoverArguments(values) {
    const args = new Map();
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!value.startsWith('--'))
            throw new Error(`Unexpected argument: ${value}`);
        const [rawKey, ...inline] = value.slice(2).split('=');
        if (!rawKey)
            throw new Error('Empty option name is not allowed.');
        if (inline.length > 0)
            args.set(rawKey, inline.join('='));
        else {
            const next = values[index + 1];
            if (next && !next.startsWith('--')) {
                args.set(rawKey, next);
                index += 1;
            }
            else
                args.set(rawKey, 'true');
        }
    }
    const mode = (args.get('mode') ?? 'plan');
    return {
        projectId: args.get('project') ?? '',
        mode,
        confirmation: args.get('confirm'),
        backupDirectory: node_path_1.default.resolve(args.get('backup-dir')
            ?? process.env.STERAS_BACKUP_DIR
            ?? '/Users/kongjy/Documents/School/steras-backups'),
        backupPath: args.get('backup') ? node_path_1.default.resolve(args.get('backup')) : undefined,
        backupChecksum: args.get('checksum'),
        takeoverSessionId: args.get('takeover-session'),
    };
}
function validateResourceCutoverOptions(options) {
    if (options.projectId !== exports.RESOURCE_CUTOVER_PROJECT) {
        throw new Error(`Refusing resource cutover: --project must equal ${exports.RESOURCE_CUTOVER_PROJECT}.`);
    }
    if (!['plan', 'apply', 'restore'].includes(options.mode))
        throw new Error('--mode must be plan, apply, or restore.');
    if (options.mode !== 'plan' && options.confirmation !== exports.RESOURCE_CUTOVER_PROJECT) {
        throw new Error(`Refusing destructive action: pass --confirm=${exports.RESOURCE_CUTOVER_PROJECT}.`);
    }
    if (options.mode === 'restore' && (!options.backupPath || !node_path_1.default.isAbsolute(options.backupPath))) {
        throw new Error('--backup=<absolute path> is required for restore.');
    }
    if (options.mode === 'restore' && !/^[a-f0-9]{64}$/.test(options.backupChecksum ?? '')) {
        throw new Error('--checksum=<sha256 from the cutover audit> is required for restore.');
    }
    if (options.takeoverSessionId !== undefined && !options.takeoverSessionId.trim()) {
        throw new Error('--takeover-session must be a non-empty prior session ID.');
    }
    if (!node_path_1.default.isAbsolute(options.backupDirectory) || node_path_1.default.resolve(options.backupDirectory) !== options.backupDirectory) {
        throw new Error('--backup-dir must resolve to a canonical absolute path.');
    }
    if (options.backupPath
        && (!node_path_1.default.isAbsolute(options.backupPath) || node_path_1.default.resolve(options.backupPath) !== options.backupPath)) {
        throw new Error('--backup must resolve to a canonical absolute path.');
    }
}
function validateResourceRevisionGraph(resources) {
    const issues = [];
    const byId = new Map(resources.map((resource) => [resource.resourceId, resource]));
    const rootsByStageVersion = new Map();
    const groups = new Map();
    const childCounts = new Map();
    for (const resource of resources) {
        if (resource.schemaVersion !== types_1.RESOURCE_SCHEMA_VERSION)
            issues.push(`${resource.resourceId}:legacy-schema`);
        if (Object.keys(resource.items ?? {}).length !== types_1.RESOURCE_KEYS.length
            || types_1.RESOURCE_KEYS.some((key) => !resource.items?.[key]))
            issues.push(`${resource.resourceId}:incomplete-items`);
        const group = `${resource.versionId}:${resource.stage}`;
        groups.set(group, [...(groups.get(group) ?? []), resource]);
        if (!resource.supersedesResourceId) {
            rootsByStageVersion.set(group, [...(rootsByStageVersion.get(group) ?? []), resource.resourceId]);
        }
        else {
            childCounts.set(resource.supersedesResourceId, (childCounts.get(resource.supersedesResourceId) ?? 0) + 1);
        }
        const visited = new Set([resource.resourceId]);
        let previousId = resource.supersedesResourceId;
        while (previousId) {
            if (visited.has(previousId)) {
                issues.push(`${resource.resourceId}:cycle`);
                break;
            }
            visited.add(previousId);
            const previous = byId.get(previousId);
            if (!previous) {
                issues.push(`${resource.resourceId}:dangling-predecessor`);
                break;
            }
            if (previous.versionId !== resource.versionId)
                issues.push(`${resource.resourceId}:predecessor-version-mismatch`);
            if (previous.stage !== resource.stage)
                issues.push(`${resource.resourceId}:predecessor-stage-mismatch`);
            if (previous.revision >= resource.revision)
                issues.push(`${resource.resourceId}:non-monotonic-revision`);
            previousId = previous.supersedesResourceId;
        }
    }
    for (const [group, roots] of rootsByStageVersion) {
        if (roots.length > 1)
            issues.push(`${group}:multiple-roots`);
    }
    for (const [predecessorId, count] of childCounts) {
        if (count > 1)
            issues.push(`${predecessorId}:branched-successors`);
    }
    for (const [group, members] of groups) {
        const revisions = members.map((resource) => resource.revision).sort((left, right) => left - right);
        if (new Set(revisions).size !== revisions.length)
            issues.push(`${group}:duplicate-revision`);
        if (revisions.some((revision, index) => revision !== index + 1))
            issues.push(`${group}:noncontiguous-revisions`);
        for (const resource of members) {
            if (resource.revision === 1 && resource.supersedesResourceId)
                issues.push(`${resource.resourceId}:root-revision-mismatch`);
            if (resource.revision > 1) {
                const predecessor = resource.supersedesResourceId ? byId.get(resource.supersedesResourceId) : undefined;
                if (!predecessor || predecessor.revision !== resource.revision - 1) {
                    issues.push(`${resource.resourceId}:noncontiguous-predecessor`);
                }
            }
        }
    }
    return [...new Set(issues)];
}
function validateCurrentResourceTip(resources, currentResourceId) {
    const current = resources.find((resource) => resource.resourceId === currentResourceId);
    if (!current)
        return ['dangling-current-pointer'];
    const group = resources.filter((resource) => resource.versionId === current.versionId && resource.stage === current.stage);
    const tip = group.sort((left, right) => right.revision - left.revision)[0];
    return tip?.resourceId === currentResourceId ? [] : ['current-pointer-not-tip'];
}
function validateResourceAgainstStoredInputs(resource, eventId, version, assessment) {
    const issues = [];
    if (!version || version.eventId !== eventId || version.versionId !== resource.versionId)
        return ['stored-version-mismatch'];
    if (!assessment
        || assessment.schemaVersion !== types_1.ASSESSMENT_SCHEMA_VERSION
        || assessment.status !== 'provisional_ready'
        || assessment.eventId !== eventId
        || assessment.versionId !== version.versionId
        || assessment.assessmentId !== resource.assessmentId)
        return ['stored-assessment-mismatch'];
    if (resource.stage !== 'provisional'
        || resource.assessmentReference.stage !== 'provisional'
        || resource.assessmentReference.assessmentId !== assessment.assessmentId
        || resource.assessmentReference.proposalId !== assessment.provisionalResult.proposalId) {
        issues.push('assessment-reference-mismatch');
    }
    const calculation = (0, resourceCalculator_1.computeResources)({
        eventId,
        versionId: version.versionId,
        assessmentId: assessment.assessmentId,
        eventDetails: version.eventDetails,
        assessmentResult: assessment.provisionalResult,
    });
    if (!calculation.ok)
        return [...issues, `stored-input-calculation-${calculation.code}`];
    if (resource.resourceInputHash !== calculation.resourceInputHash)
        issues.push('recomputed-hash-mismatch');
    if (resource.formulaVersion !== calculation.formulaVersion
        || resource.configVersion !== calculation.configVersion
        || resource.sourceRegistryVersion !== calculation.sourceRegistryVersion)
        issues.push('recomputed-version-mismatch');
    if (stableJson(resource.items) !== stableJson(calculation.items))
        issues.push('recomputed-items-mismatch');
    return issues;
}
function validateResourceDocumentIdentity(documentId, resource) {
    const deterministicId = `${resource.stage}-${resource.versionId}-${resource.resourceInputHash}`;
    return documentId === resource.resourceId && resource.resourceId === deterministicId
        ? []
        : ['resource-document-identity'];
}
function shouldAbortResourceCutover(verificationIssues) {
    return verificationIssues.length > 0;
}
function validateOrganizerResourceProjection(resource, summary) {
    if (!isRecord(summary) || !isRecord(summary.resourceQuantities) || !isRecord(summary.resourceRecommendation)) {
        return ['missing-summary-projection'];
    }
    const projection = summary.resourceRecommendation;
    if (projection.resourceId !== resource.resourceId
        || projection.revision !== resource.revision
        || projection.stage !== resource.stage
        || !isRecord(projection.items)
        || typeof projection.disclaimer !== 'string'
        || !projection.disclaimer)
        return ['summary-metadata-mismatch'];
    for (const key of types_1.RESOURCE_KEYS) {
        const item = projection.items[key];
        if (!isRecord(item)
            || summary.resourceQuantities[key] !== resource.items[key].baseline
            || item.baseline !== resource.items[key].baseline
            || !isRecord(item.planningRange)
            || item.planningRange.min !== resource.items[key].planningRange.min
            || item.planningRange.max !== resource.items[key].planningRange.max)
            return [`summary-${key}-mismatch`];
    }
    return [];
}
function classifyResourceCutoverState(documents, currentPointers) {
    const legacyPaths = [];
    const v3Resources = [];
    const issues = [];
    const v3ByEvent = new Map();
    const pathByResourceId = new Map();
    for (const document of documents) {
        const segments = document.path.split('/');
        const eventPath = segments.slice(0, 2).join('/');
        if (!isRecord(document.data) || document.data.schemaVersion !== types_1.RESOURCE_SCHEMA_VERSION) {
            legacyPaths.push(document.path);
            continue;
        }
        const validation = (0, resourceContract_1.validateResourceRecommendation)(document.data);
        if (!validation.ok) {
            issues.push(...validation.errors.map((error) => `${document.path}:${error}`));
            continue;
        }
        const resource = document.data;
        issues.push(...validateResourceDocumentIdentity(segments[3] ?? '', resource)
            .map((issue) => `${document.path}:${issue}`));
        if (resource.eventId !== segments[1])
            issues.push(`${document.path}:event-id-mismatch`);
        v3Resources.push(resource);
        v3ByEvent.set(eventPath, [...(v3ByEvent.get(eventPath) ?? []), resource]);
        pathByResourceId.set(`${eventPath}/${resource.resourceId}`, document.path);
    }
    for (const [eventPath, resources] of v3ByEvent) {
        issues.push(...validateResourceRevisionGraph(resources).map((issue) => `${eventPath}:${issue}`));
        const pointer = currentPointers.find((entry) => entry.eventPath === eventPath)?.currentResourceId;
        if (pointer && pathByResourceId.has(`${eventPath}/${pointer}`)) {
            issues.push(...validateCurrentResourceTip(resources, pointer).map((issue) => `${eventPath}:${issue}`));
        }
        else if (pointer) {
            issues.push(`${eventPath}:dangling-current-pointer`);
        }
    }
    const hasInvalidV3 = documents.some((document) => isRecord(document.data)
        && document.data.schemaVersion === types_1.RESOURCE_SCHEMA_VERSION)
        && v3Resources.length < documents.filter((document) => isRecord(document.data)
            && document.data.schemaVersion === types_1.RESOURCE_SCHEMA_VERSION).length;
    const state = issues.length > 0 || hasInvalidV3
        ? 'invalid_v3'
        : legacyPaths.length > 0 && v3Resources.length > 0
            ? 'mixed'
            : v3Resources.length > 0
                ? 'v3_only'
                : legacyPaths.length > 0 ? 'legacy_only' : 'empty';
    return { legacyPaths, v3Resources, issues: [...new Set(issues)], state };
}
function assertSafeResourceCutoverApply(classification) {
    if (classification.state === 'invalid_v3') {
        throw new Error(`Refusing resource cutover because stored V3 resources are invalid: ${classification.issues.join(', ')}`);
    }
    if (classification.state === 'mixed') {
        throw new Error('Refusing resource cutover in a mixed legacy/V3 state; no documents were deleted.');
    }
    if (classification.state === 'v3_only') {
        throw new Error('Refusing resource cutover rerun because valid V3 resources already exist; they were preserved.');
    }
}
async function createAndVerifyCutoverStartAudit(db, audit) {
    if (!node_path_1.default.isAbsolute(audit.backupPath) || node_path_1.default.resolve(audit.backupPath) !== audit.backupPath) {
        throw new Error('Cutover start audit backupPath must be canonical and absolute.');
    }
    const normalized = {
        ...audit,
        lifecycle: audit.lifecycle ?? 'recovery_required',
        phase: audit.phase ?? 'post_destructive',
    };
    const reference = db.collection(exports.RESOURCE_CUTOVER_START_AUDIT_COLLECTION).doc(audit.sessionId);
    await reference.create(normalized);
    const stored = await reference.get();
    if (!stored.exists || stableJson(stored.data()) !== stableJson(normalized)) {
        throw new Error('Cutover start audit readback did not match the intended immutable anchor.');
    }
    return reference.path;
}
async function verifyCutoverStartAudit(db, backup, backupPath, backupChecksum, allowedLifecycles = ['recovery_required', 'restore_in_progress']) {
    if (!node_path_1.default.isAbsolute(backupPath) || node_path_1.default.resolve(backupPath) !== backupPath) {
        throw new Error('Backup path must be canonical and absolute.');
    }
    if (!backup.cutoverSessionId)
        throw new Error('Backup is not bound to a cutover session.');
    const snapshot = await db.collection(exports.RESOURCE_CUTOVER_START_AUDIT_COLLECTION).doc(backup.cutoverSessionId).get();
    const audit = snapshot.data();
    const expectedBackupId = node_path_1.default.basename(node_path_1.default.dirname(backupPath));
    if (!snapshot.exists
        || audit?.action !== 'resource_cutover_start'
        || audit.sessionId !== backup.cutoverSessionId
        || audit.projectId !== exports.RESOURCE_CUTOVER_PROJECT
        || audit.backupId !== expectedBackupId
        || audit.backupPath !== backupPath
        || audit.backupChecksum !== backupChecksum
        || audit.resourceSchemaVersion !== types_1.RESOURCE_SCHEMA_VERSION
        || !allowedLifecycles.includes(audit.lifecycle)
        || !Number.isFinite(audit.createdAt)) {
        throw new Error('Trusted cutover start audit is missing or does not match the backup session, path, and checksum.');
    }
    return audit;
}
async function transitionCutoverAnchor(db, applySessionId, sessionId, transition) {
    const lockReference = db.doc('system_controls/m2_resource_v3_cutover');
    const auditReference = db.collection(exports.RESOURCE_CUTOVER_START_AUDIT_COLLECTION).doc(applySessionId);
    await db.runTransaction(async (transaction) => {
        const [lockSnapshot, auditSnapshot] = await Promise.all([
            transaction.get(lockReference), transaction.get(auditReference),
        ]);
        const lock = lockSnapshot.data();
        const audit = auditSnapshot.data();
        const now = Date.now();
        if (!lock || !audit || lock.sessionId !== sessionId || lock.leaseExpiresAt <= now) {
            throw new Error('Cutover lifecycle ownership changed or lease expired.');
        }
        if (transition === 'post_destructive') {
            if (lock.mode !== 'apply' || lock.phase !== 'pre_destructive' || audit.lifecycle !== 'prepared')
                throw new Error('Invalid post-destructive transition.');
            transaction.update(lockReference, { phase: 'post_destructive' });
            transaction.update(auditReference, { lifecycle: 'recovery_required', phase: 'post_destructive' });
        }
        else if (transition === 'restore_in_progress') {
            if (lock.mode !== 'restore' || lock.takeoverOf !== applySessionId
                || !['recovery_required', 'restore_in_progress'].includes(audit.lifecycle))
                throw new Error('Backup is not eligible for restore.');
            transaction.update(auditReference, { lifecycle: 'restore_in_progress', phase: 'restore', restoreSessionId: sessionId });
        }
        else {
            if (lock.queuedEvents.length > 0)
                throw new Error('Queued events remain during lifecycle completion.');
            if (transition === 'completed') {
                if (lock.mode !== 'apply' || audit.lifecycle !== 'recovery_required')
                    throw new Error('Invalid apply completion transition.');
                transaction.update(auditReference, { lifecycle: 'completed', phase: 'completed', completedAt: now });
            }
            else {
                if (lock.mode !== 'restore' || audit.lifecycle !== 'restore_in_progress' || audit.restoreSessionId !== sessionId)
                    throw new Error('Invalid restore completion transition.');
                transaction.update(auditReference, { lifecycle: 'consumed', phase: 'consumed', consumedAt: now });
            }
            transaction.delete(lockReference);
        }
    });
}
async function main() {
    const options = parseResourceCutoverArguments(process.argv.slice(2));
    validateResourceCutoverOptions(options);
    (0, app_1.initializeApp)({ credential: (0, app_1.applicationDefault)(), projectId: options.projectId });
    const db = (0, firestore_1.getFirestore)();
    if (options.mode === 'restore') {
        const backup = await readVerifiedBackup(options.backupPath, options.backupChecksum);
        const preflightRelationships = validateDecodedRestoreRelationships(backup, decodeBackupDocuments(db, backup));
        if (preflightRelationships.length > 0) {
            throw new Error(`Backup resource relationships are invalid: ${preflightRelationships.join(', ')}`);
        }
        await verifyCutoverStartAudit(db, backup, options.backupPath, options.backupChecksum);
        const sessionId = `restore-${(0, node_crypto_1.randomUUID)()}`;
        await (0, resourceCutoverLock_1.acquireResourceCutoverLock)(db, sessionId, 'restore', backup.cutoverSessionId);
        const heartbeat = (0, resourceCutoverLock_1.startResourceCutoverHeartbeat)(db, sessionId);
        try {
            await preflightResourceCutoverCapacity(db, backup, () => (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId));
            heartbeat.assertHealthy();
            await transitionCutoverAnchor(db, backup.cutoverSessionId, sessionId, 'restore_in_progress');
            await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId);
            const failures = [];
            await restoreBackup(db, options.backupPath, options.backupChecksum, backup.cutoverSessionId, sessionId);
            let released = false;
            for (let attempt = 0; attempt < 5 && !released; attempt += 1) {
                await drainQueuedResourceEvents(db, sessionId, failures);
                await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId);
                try {
                    await transitionCutoverAnchor(db, backup.cutoverSessionId, sessionId, 'consumed');
                    released = true;
                }
                catch (error) {
                    if (!(error instanceof Error) || !error.message.includes('queued events remain'))
                        throw error;
                }
            }
            if (!released)
                throw new Error('Restore completed but queued resource events could not be drained; rerun restore to take over safely.');
        }
        finally {
            heartbeat.stop();
        }
        return;
    }
    const inventory = await inventoryResources(db, options.projectId);
    console.info(JSON.stringify({
        mode: options.mode,
        projectId: options.projectId,
        events: inventory.backup.events.length,
        resources: inventory.backup.resources.length,
        overrides: inventory.backup.overrides.length,
        pendingBackfill: inventory.pendingEventIds.length,
    }, null, 2));
    if (options.mode === 'plan') {
        console.info(`Dry run only. Apply with --mode=apply --project=${exports.RESOURCE_CUTOVER_PROJECT} --confirm=${exports.RESOURCE_CUTOVER_PROJECT}.`);
        return;
    }
    const sessionId = `apply-${(0, node_crypto_1.randomUUID)()}`;
    await (0, resourceCutoverLock_1.acquireResourceCutoverLock)(db, sessionId, 'apply', options.takeoverSessionId);
    const heartbeat = (0, resourceCutoverLock_1.startResourceCutoverHeartbeat)(db, sessionId);
    try {
        const lockedInventory = await inventoryResources(db, options.projectId, () => (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId)).catch(async (error) => {
            await abortResourceCutoverBeforeMutation(db, sessionId, `locked-inventory:${errorSummary(error)}`);
            throw error;
        });
        await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId);
        try {
            await preflightResourceCutoverCapacity(db, lockedInventory.backup, () => (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId));
        }
        catch (error) {
            await abortResourceCutoverBeforeMutation(db, sessionId, `capacity-preflight:${errorSummary(error)}`);
            throw error;
        }
        try {
            assertSafeResourceCutoverApply(lockedInventory.classification);
        }
        catch (error) {
            await abortResourceCutoverBeforeMutation(db, sessionId, `classification:${errorSummary(error)}`);
            throw error;
        }
        lockedInventory.backup.cutoverSessionId = sessionId;
        const timestampDirectory = node_path_1.default.join(options.backupDirectory, new Date().toISOString().replaceAll(':', '-'));
        const backupPath = node_path_1.default.join(timestampDirectory, 'm2-resource-v3.json');
        const checksumPath = `${backupPath}.sha256`;
        const backupJson = JSON.stringify(lockedInventory.backup, null, 2);
        const backupChecksum = (0, node_crypto_1.createHash)('sha256').update(backupJson).digest('hex');
        const backupId = node_path_1.default.basename(timestampDirectory);
        try {
            const roundTrippedBackup = validateResourceCutoverBackup(JSON.parse(backupJson));
            const roundTripRelationships = validateDecodedRestoreRelationships(roundTrippedBackup, decodeBackupDocuments(db, roundTrippedBackup));
            if (roundTripRelationships.length > 0) {
                throw new Error(`Locked backup relationships are invalid: ${roundTripRelationships.join(', ')}`);
            }
            await (0, promises_1.mkdir)(timestampDirectory, { recursive: true, mode: 0o700 });
            validateResourceCutoverBackup(lockedInventory.backup);
            await (0, promises_1.writeFile)(backupPath, backupJson, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            await (0, promises_1.writeFile)(checksumPath, `${backupChecksum}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        }
        catch (error) {
            await abortResourceCutoverBeforeMutation(db, sessionId, `backup-write:${errorSummary(error)}`);
            throw error;
        }
        console.info(`Resource backup written to ${backupPath}.`);
        await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId);
        let startAuditPath;
        try {
            startAuditPath = await createAndVerifyCutoverStartAudit(db, {
                action: 'resource_cutover_start',
                sessionId,
                projectId: exports.RESOURCE_CUTOVER_PROJECT,
                backupId,
                backupPath,
                backupChecksum,
                resourceSchemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
                createdAt: Date.now(),
                lifecycle: 'prepared',
                phase: 'pre_destructive',
            });
        }
        catch (error) {
            await abortResourceCutoverBeforeMutation(db, sessionId, `start-audit:${errorSummary(error)}`);
            throw error;
        }
        await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId);
        // The durable anchor is moved to recovery_required before the first destructive write.
        try {
            heartbeat.assertHealthy();
            await transitionCutoverAnchor(db, sessionId, sessionId, 'post_destructive');
        }
        catch (error) {
            await abortResourceCutoverBeforeMutation(db, sessionId, `post-destructive-anchor:${errorSummary(error)}`);
            throw error;
        }
        for (const resourcePath of lockedInventory.classification.legacyPaths) {
            await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId);
            await db.runTransaction(async (transaction) => {
                const lock = await transaction.get(db.doc('system_controls/m2_resource_v3_cutover'));
                if (lock.data()?.sessionId !== sessionId || lock.data()?.leaseExpiresAt <= Date.now())
                    throw new Error('Apply fencing check failed before legacy delete.');
                transaction.delete(db.doc(resourcePath));
            });
        }
        for (const event of lockedInventory.backup.events) {
            await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId);
            const eventReference = db.doc(event.path);
            const eventId = eventReference.id;
            await db.runTransaction(async (transaction) => {
                const lock = await transaction.get(db.doc('system_controls/m2_resource_v3_cutover'));
                if (lock.data()?.sessionId !== sessionId || lock.data()?.leaseExpiresAt <= Date.now())
                    throw new Error('Apply fencing check failed before event cleanup.');
                for (const summary of lockedInventory.backup.summaries.filter((item) => item.path.startsWith(`${event.path}/${types_1.COLLECTIONS.ASSESSMENT_SUMMARIES}/`))) {
                    transaction.update(db.doc(summary.path), {
                        resourceQuantities: firestore_1.FieldValue.delete(),
                        resourceRecommendation: firestore_1.FieldValue.delete(),
                    });
                }
                transaction.update(eventReference, { currentResourceId: firestore_1.FieldValue.delete() });
                const auditId = `resource-v3-cutover-${sessionId}-${eventId}-${(0, node_crypto_1.randomUUID)()}`;
                transaction.create(eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), {
                    id: auditId, eventId, action: 'resource_schema_cutover', actorId: 'system', actorRole: 'system', timestamp: Date.now(),
                    metadata: { from: 'legacy-resource', to: types_1.RESOURCE_SCHEMA_VERSION, backupId, backupChecksum, startAuditPath },
                });
            });
        }
        const failures = [];
        for (const eventId of lockedInventory.pendingEventIds) {
            await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId);
            try {
                const result = await (0, onEventCreated_1.recomputeResourceForStoredAssessment)(eventId, Date.now(), { cutoverSessionId: sessionId });
                if (result.status === 'failed')
                    failures.push({ eventId, reason: result.reason ?? 'unknown' });
            }
            catch (error) {
                failures.push({ eventId, reason: error instanceof Error ? error.message : 'unknown' });
            }
            const outcome = failures.find((failure) => failure.eventId === eventId);
            const auditId = `resource-v3-backfill-${sessionId}-${eventId}-${(0, node_crypto_1.randomUUID)()}`;
            await db.runTransaction(async (transaction) => {
                const lock = await transaction.get(db.doc('system_controls/m2_resource_v3_cutover'));
                if (lock.data()?.sessionId !== sessionId || lock.data()?.leaseExpiresAt <= Date.now())
                    throw new Error('Apply fencing check failed before backfill audit.');
                transaction.create(db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId).collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), {
                    id: auditId, eventId, action: 'resource_schema_cutover', actorId: 'system', actorRole: 'system', timestamp: Date.now(),
                    metadata: { phase: 'backfill', outcome: outcome ? 'failed' : 'succeeded', ...(outcome ? { reason: outcome.reason } : {}) },
                });
            });
        }
        let verification = await verifyResources(db, () => (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId));
        let released = false;
        for (let attempt = 0; attempt < 5 && !released; attempt += 1) {
            await drainQueuedResourceEvents(db, sessionId, failures);
            await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId);
            verification = await verifyResources(db, () => (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId));
            if (shouldAbortResourceCutover(verification.issues))
                break;
            try {
                heartbeat.assertHealthy();
                await transitionCutoverAnchor(db, sessionId, sessionId, 'completed');
                released = true;
            }
            catch (error) {
                if (!(error instanceof Error) || !error.message.includes('queued events remain'))
                    throw error;
            }
        }
        console.info(JSON.stringify({ backupPath, failures, verification }, null, 2));
        if (shouldAbortResourceCutover(verification.issues) || !released) {
            throw new Error(`Resource cutover verification failed. Restore with --mode=restore --project=${exports.RESOURCE_CUTOVER_PROJECT} `
                + `--confirm=${exports.RESOURCE_CUTOVER_PROJECT} --backup=${backupPath} --checksum=${backupChecksum}`);
        }
    }
    finally {
        heartbeat.stop();
    }
}
async function drainQueuedResourceEvents(db, sessionId, failures, hooks = {}) {
    const lockReference = db.doc('system_controls/m2_resource_v3_cutover');
    const lock = await lockReference.get();
    if (lock.data()?.sessionId !== sessionId)
        throw new Error('Resource cutover lock ownership changed while draining queued events.');
    const rawQueuedEvents = lock.data()?.queuedEvents;
    const queuedEvents = Array.isArray(rawQueuedEvents)
        ? rawQueuedEvents.filter(isResourceCutoverQueueToken)
        : [];
    const acknowledgedTokens = [];
    const retryableTokens = [];
    for (const token of queuedEvents) {
        await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId);
        const { eventId } = token;
        let result;
        let caughtError;
        const generationMatches = await queuedGenerationMatches(db, token);
        if (hooks.abortMode) {
            await hooks.beforeAbortTransaction?.(token);
            const acknowledged = await processAbortQueuedToken(db, sessionId, token);
            if (acknowledged)
                acknowledgedTokens.push(token);
            else {
                retryableTokens.push(token);
                failures.push({ eventId, reason: 'abort-preserved-uncertain-or-resource-eligible-generation' });
            }
            continue;
        }
        if (generationMatches) {
            try {
                result = await (hooks.recompute ?? onEventCreated_1.recomputeResourceForStoredAssessment)(eventId, Date.now(), { cutoverSessionId: sessionId });
            }
            catch (error) {
                caughtError = error;
            }
        }
        let reason = !generationMatches
            ? 'queue-generation-superseded'
            : caughtError
                ? `exception:${errorSummary(caughtError)}`
                : result?.status === 'failed'
                    ? result.reason ?? 'queued-recompute-failed'
                    : undefined;
        let disposition;
        if (!generationMatches)
            disposition = 'terminal_failure';
        else if (!reason)
            disposition = 'succeeded';
        else if (caughtError)
            disposition = 'retryable_failure';
        else {
            try {
                disposition = await queuedFailureDisposition(db, eventId, reason);
            }
            catch (error) {
                reason = `${reason};disposition-exception:${errorSummary(error)}`;
                disposition = 'retryable_failure';
            }
        }
        if (reason)
            failures.push({ eventId, reason });
        if (disposition === 'retryable_failure')
            retryableTokens.push(token);
        else
            acknowledgedTokens.push(token);
        const auditId = `resource-v3-queued-backfill-${sessionId}-${eventId}-${(0, node_crypto_1.randomUUID)()}`;
        await db.runTransaction(async (transaction) => {
            const eventReference = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
            const summaryReference = token.currentVersionId
                ? eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(token.currentVersionId)
                : undefined;
            const assessmentReference = token.currentAssessmentId
                ? eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(token.currentAssessmentId)
                : undefined;
            const [current, eventSnapshot, assessmentSnapshot] = await Promise.all([
                transaction.get(lockReference), transaction.get(eventReference),
                assessmentReference ? transaction.get(assessmentReference) : Promise.resolve(undefined),
            ]);
            if (current.data()?.sessionId !== sessionId || current.data()?.leaseExpiresAt <= Date.now()) {
                throw new Error('Resource cutover fencing check failed while auditing queued event.');
            }
            transaction.create(db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId).collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), {
                id: auditId, eventId, action: 'resource_schema_cutover', actorId: 'system', actorRole: 'system', timestamp: Date.now(),
                metadata: {
                    phase: 'queued-backfill', outcome: disposition === 'succeeded' ? 'succeeded' : 'failed', disposition,
                    queueTokenId: token.tokenId, queueGenerationId: token.generationId,
                    ...(result?.resourceId ? { resourceId: result.resourceId } : {}), ...(reason ? { reason } : {}),
                },
            });
            const terminalAssessment = assessmentSnapshot?.data();
            const exactTerminalGeneration = reason !== 'queue-generation-superseded'
                && assessmentSnapshot?.exists
                && (token.assessmentInputHash === undefined || terminalAssessment?.inputHash === token.assessmentInputHash)
                && (token.assessmentStateHash === undefined
                    || assessmentStateHashFor(terminalAssessment) === token.assessmentStateHash)
                && ['failed', 'manual_review_required'].includes(String(terminalAssessment?.status));
            if (disposition === 'terminal_failure' && exactTerminalGeneration
                && eventSnapshot.data()?.currentVersionId === token.currentVersionId
                && eventSnapshot.data()?.currentAssessmentId === token.currentAssessmentId) {
                transaction.update(eventReference, { currentResourceId: firestore_1.FieldValue.delete(), updatedAt: Date.now() });
                if (summaryReference)
                    transaction.set(summaryReference, {
                        resourceQuantities: firestore_1.FieldValue.delete(), resourceRecommendation: firestore_1.FieldValue.delete(),
                    }, { merge: true });
            }
            if (disposition !== 'retryable_failure') {
                transaction.update(lockReference, { queuedEvents: firestore_1.FieldValue.arrayRemove(token) });
            }
        });
    }
    return {
        acknowledgedTokenIds: acknowledgedTokens.map((token) => token.tokenId),
        retryableTokenIds: retryableTokens.map((token) => token.tokenId),
    };
}
function isResourceCutoverQueueToken(value) {
    return isRecord(value)
        && typeof value.tokenId === 'string'
        && typeof value.eventId === 'string'
        && typeof value.generationId === 'string'
        && Number.isFinite(value.queuedAt);
}
async function queuedGenerationMatches(db, token) {
    const eventSnapshot = await db.collection(types_1.COLLECTIONS.EVENTS).doc(token.eventId).get();
    const event = eventSnapshot.data();
    if (!event
        || event.currentVersionId !== token.currentVersionId
        || event.currentAssessmentId !== token.currentAssessmentId)
        return false;
    if (!token.currentAssessmentId)
        return true;
    const assessment = await eventSnapshot.ref.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(token.currentAssessmentId).get();
    if (!assessment.exists)
        return false;
    if (token.assessmentInputHash !== undefined && assessment.data()?.inputHash !== token.assessmentInputHash)
        return false;
    return token.assessmentStateHash === undefined
        || assessmentStateHashFor(assessment.data()) === token.assessmentStateHash;
}
async function processAbortQueuedToken(db, sessionId, token) {
    return db.runTransaction(async (transaction) => {
        const lockReference = db.doc('system_controls/m2_resource_v3_cutover');
        const eventReference = db.collection(types_1.COLLECTIONS.EVENTS).doc(token.eventId);
        const assessmentReference = token.currentAssessmentId
            ? eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(token.currentAssessmentId) : undefined;
        const summaryReference = token.currentVersionId
            ? eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(token.currentVersionId) : undefined;
        const [lock, event, assessment] = await Promise.all([
            transaction.get(lockReference), transaction.get(eventReference),
            assessmentReference ? transaction.get(assessmentReference) : Promise.resolve(undefined),
        ]);
        if (lock.data()?.sessionId !== sessionId || lock.data()?.leaseExpiresAt <= Date.now()) {
            throw new Error('Abort token fencing check failed.');
        }
        const assessmentData = assessment?.data();
        const exact = event.data()?.currentVersionId === token.currentVersionId
            && event.data()?.currentAssessmentId === token.currentAssessmentId
            && assessment?.exists
            && (token.assessmentInputHash === undefined || assessmentData?.inputHash === token.assessmentInputHash)
            && (token.assessmentStateHash === undefined || assessmentStateHashFor(assessmentData) === token.assessmentStateHash);
        const terminal = exact && ['failed', 'manual_review_required'].includes(String(assessmentData?.status));
        if (exact && !terminal)
            return false;
        const auditId = `resource-v3-abort-token-${sessionId}-${token.eventId}-${(0, node_crypto_1.randomUUID)()}`;
        transaction.create(eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(auditId), {
            id: auditId, eventId: token.eventId, action: 'resource_schema_cutover', actorId: 'system', actorRole: 'system', timestamp: Date.now(),
            metadata: { phase: 'abort-queue', disposition: exact ? 'terminal_failure' : 'superseded', queueTokenId: token.tokenId },
        });
        if (terminal) {
            transaction.update(eventReference, { currentResourceId: firestore_1.FieldValue.delete(), updatedAt: Date.now() });
            if (summaryReference)
                transaction.set(summaryReference, {
                    resourceQuantities: firestore_1.FieldValue.delete(), resourceRecommendation: firestore_1.FieldValue.delete(),
                }, { merge: true });
        }
        transaction.update(lockReference, { queuedEvents: firestore_1.FieldValue.arrayRemove(token) });
        return true;
    });
}
async function queuedFailureDisposition(db, eventId, reason) {
    if (['event-or-assessment-changed', 'resource-cutover-in-progress'].includes(reason))
        return 'retryable_failure';
    const eventSnapshot = await db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId).get();
    const event = eventSnapshot.data();
    if (!event?.currentAssessmentId)
        return 'terminal_failure';
    const assessment = await eventSnapshot.ref.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get();
    const status = assessment.data()?.status;
    if (status === 'processing')
        return 'retryable_failure';
    if (['manual_review_required', 'failed', 'official_ready'].includes(String(status)))
        return 'terminal_failure';
    return 'terminal_failure';
}
async function abortResourceCutoverBeforeMutation(db, sessionId, reason) {
    const failures = [];
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            await drainQueuedResourceEvents(db, sessionId, failures, { abortMode: true });
            await (0, resourceCutoverLock_1.releaseResourceCutoverLock)(db, sessionId);
            return;
        }
        catch (error) {
            lastError = error;
            if (!(error instanceof Error) || !error.message.includes('queued events remain'))
                break;
        }
    }
    const lockReference = db.doc('system_controls/m2_resource_v3_cutover');
    const lock = await lockReference.get();
    if (lock.exists && lock.data()?.sessionId === sessionId) {
        await db.runTransaction(async (transaction) => {
            const current = await transaction.get(lockReference);
            if (current.data()?.sessionId !== sessionId)
                throw new Error('Abort fencing check failed because ownership changed.');
            transaction.update(lockReference, { phase: 'pre_destructive_aborted', abortReason: reason });
        });
    }
    const queued = Array.isArray(lock.data()?.queuedEvents)
        ? lock.data().queuedEvents.map((token) => token.tokenId)
        : [];
    throw new Error(`Pre-destructive cutover abort could not release session ${sessionId} (${reason}). `
        + `Queued events remain retryable: ${queued.join(', ') || 'unknown'}. `
        + `Recover with --takeover-session=${sessionId}. Last error: ${errorSummary(lastError)}`);
}
function errorSummary(error) {
    return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
async function inventoryResources(db, projectId, heartbeat) {
    const backup = {
        projectId, resourceSchemaVersion: types_1.RESOURCE_SCHEMA_VERSION, createdAt: new Date().toISOString(),
        manifest: {
            version: 2,
            eventPaths: [],
            managedCollections: ['resources', 'resource_overrides'],
            managedAuditActions: ['resource_recommended', 'resource_overridden', 'resource_schema_cutover'],
        },
        events: [], resources: [], overrides: [], summaries: [], auditReferences: [],
    };
    const pendingEventIds = [];
    const rawResources = [];
    const currentPointers = [];
    for (const eventDocument of (await db.collection(types_1.COLLECTIONS.EVENTS).get()).docs) {
        await heartbeat?.();
        const event = { eventId: eventDocument.id, ...eventDocument.data() };
        const currentAssessment = event.currentAssessmentId
            ? await eventDocument.ref.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get()
            : undefined;
        backup.events.push({
            path: eventDocument.ref.path,
            updatedAt: event.updatedAt,
            ...(event.currentVersionId ? { currentVersionId: event.currentVersionId } : {}),
            ...(event.currentAssessmentId ? { currentAssessmentId: event.currentAssessmentId } : {}),
            ...(event.currentResourceId ? { currentResourceId: event.currentResourceId } : {}),
            ...(currentAssessment?.exists ? { assessmentStateHash: assessmentStateHashFor(currentAssessment.data()) } : {}),
        });
        currentPointers.push({ eventPath: eventDocument.ref.path, ...(event.currentResourceId ? { currentResourceId: event.currentResourceId } : {}) });
        backup.manifest.eventPaths.push(eventDocument.ref.path);
        if (event.status === 'Pending' && event.currentVersionId && event.currentAssessmentId) {
            const assessment = await eventDocument.ref.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get();
            if (assessment.data()?.status === 'provisional_ready' && assessment.data()?.versionId === event.currentVersionId) {
                pendingEventIds.push(event.eventId);
            }
        }
        for (const document of (await eventDocument.ref.collection(types_1.COLLECTIONS.RESOURCES).get()).docs) {
            backup.resources.push(backupDocument(document));
            rawResources.push({ path: document.ref.path, data: document.data() });
        }
        for (const document of (await eventDocument.ref.collection(types_1.COLLECTIONS.RESOURCE_OVERRIDES).get()).docs)
            backup.overrides.push(backupDocument(document));
        for (const document of (await eventDocument.ref.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).get()).docs) {
            const data = document.data();
            if ('resourceQuantities' in data || 'resourceRecommendation' in data) {
                backup.summaries.push({
                    path: document.ref.path,
                    data: (0, firestoreBackupCodec_1.encodeFirestoreValue)({
                        ...('resourceQuantities' in data ? { resourceQuantities: data.resourceQuantities } : {}),
                        ...('resourceRecommendation' in data ? { resourceRecommendation: data.resourceRecommendation } : {}),
                    }),
                });
            }
        }
        for (const document of (await eventDocument.ref.collection(types_1.COLLECTIONS.AUDIT_LOGS).get()).docs) {
            if (['resource_recommended', 'resource_overridden', 'resource_schema_cutover'].includes(String(document.data().action))) {
                backup.auditReferences.push(backupDocument(document));
            }
        }
    }
    return {
        backup,
        pendingEventIds,
        classification: classifyResourceCutoverState(rawResources, currentPointers),
    };
}
function backupDocument(document) {
    return { path: document.ref.path, data: (0, firestoreBackupCodec_1.encodeFirestoreValue)(document.data()) };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
async function verifyResources(db, heartbeat) {
    const issues = [];
    for (const eventDocument of (await db.collection(types_1.COLLECTIONS.EVENTS).get()).docs) {
        await heartbeat?.();
        const event = eventDocument.data();
        const resourceDocuments = (await eventDocument.ref.collection(types_1.COLLECTIONS.RESOURCES).get()).docs;
        const resources = resourceDocuments.map((document) => document.data());
        for (const document of resourceDocuments) {
            const resource = document.data();
            const validation = (0, resourceContract_1.validateResourceRecommendation)(resource);
            issues.push(...validation.errors.map((error) => `${eventDocument.id}:${resource.resourceId}:${error}`));
            issues.push(...validateResourceDocumentIdentity(document.id, resource)
                .map((issue) => `${eventDocument.id}:${document.id}:${issue}`));
            if (resource.formulaVersion !== types_1.RESOURCE_FORMULA_VERSION
                || resource.configVersion !== types_1.RESOURCE_CONFIG_VERSION
                || resource.sourceRegistryVersion !== types_1.RESOURCE_SOURCE_REGISTRY_VERSION) {
                issues.push(`${eventDocument.id}:${resource.resourceId}:inactive-resource-versions`);
            }
            const [versionSnapshot, assessmentSnapshot] = await Promise.all([
                eventDocument.ref.collection(types_1.COLLECTIONS.VERSIONS).doc(resource.versionId).get(),
                eventDocument.ref.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(resource.assessmentId).get(),
            ]);
            issues.push(...validateResourceAgainstStoredInputs(resource, eventDocument.id, versionSnapshot.data(), assessmentSnapshot.data()).map((issue) => `${eventDocument.id}:${resource.resourceId}:${issue}`));
        }
        issues.push(...validateResourceRevisionGraph(resources).map((issue) => `${eventDocument.id}:${issue}`));
        if (event.currentResourceId) {
            const currentDocument = resourceDocuments.find((document) => document.id === event.currentResourceId);
            const current = currentDocument?.data();
            if (!current || current.resourceId !== currentDocument?.id)
                issues.push(`${eventDocument.id}:dangling-current-pointer`);
            else {
                issues.push(...validateCurrentResourceTip(resources, event.currentResourceId)
                    .map((issue) => `${eventDocument.id}:${issue}`));
                if (current.versionId !== event.currentVersionId)
                    issues.push(`${eventDocument.id}:version-mismatch`);
                const summary = event.currentVersionId
                    ? await eventDocument.ref.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(event.currentVersionId).get()
                    : undefined;
                const projectionIssues = validateOrganizerResourceProjection(current, summary?.data());
                issues.push(...projectionIssues.map((issue) => `${eventDocument.id}:${issue}`));
            }
        }
        else if (event.currentVersionId) {
            const summary = await eventDocument.ref.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(event.currentVersionId).get();
            const data = summary.data();
            if (isRecord(data) && ('resourceQuantities' in data || 'resourceRecommendation' in data)) {
                issues.push(`${eventDocument.id}:stale-summary-without-pointer`);
            }
        }
    }
    return { issues: [...new Set(issues)] };
}
async function restoreBackup(db, backupPath, expectedChecksum, expectedCutoverSessionId, restoreSessionId, hooks = {}) {
    const backup = await readVerifiedBackup(backupPath, expectedChecksum);
    if (backup.cutoverSessionId !== expectedCutoverSessionId) {
        throw new Error('Backup cutover session changed after the restore lock was acquired.');
    }
    // Decode every value before the first mutation. A malformed payload must never
    // leave Firestore partially restored.
    const decodedDocuments = decodeBackupDocuments(db, backup);
    const relationshipIssues = validateDecodedRestoreRelationships(backup, decodedDocuments);
    if (relationshipIssues.length > 0) {
        throw new Error(`Backup resource relationships are invalid: ${relationshipIssues.join(', ')}`);
    }
    const anchor = await verifyCutoverStartAudit(db, backup, backupPath, expectedChecksum, ['restore_in_progress']);
    const lock = await db.doc('system_controls/m2_resource_v3_cutover').get();
    if (!lock.exists || lock.data()?.active !== true || lock.data()?.sessionId !== restoreSessionId
        || lock.data()?.mode !== 'restore' || !Number.isFinite(lock.data()?.leaseExpiresAt)
        || lock.data().leaseExpiresAt <= Date.now() || anchor.restoreSessionId !== restoreSessionId) {
        throw new Error('Restore lock ownership is missing, expired, or changed before mutation.');
    }
    await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, restoreSessionId);
    await preflightResourceCutoverCapacity(db, backup, () => (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, restoreSessionId));
    const expectedByCollection = new Map([
        [types_1.COLLECTIONS.RESOURCES, new Set(backup.resources.map((document) => document.path))],
        [types_1.COLLECTIONS.RESOURCE_OVERRIDES, new Set(backup.overrides.map((document) => document.path))],
    ]);
    const expectedAuditPaths = new Set(backup.auditReferences.map((document) => document.path));
    const affectedEvents = [];
    const deferredEventIds = [];
    const deferredTokens = [];
    // Classify every event before deleting anything. A newer assessment generation is
    // deferred wholesale, so its resources, overrides, audits and projection stay untouched.
    for (const event of backup.events) {
        const eventReference = db.doc(event.path);
        const eventSnapshot = await eventReference.get();
        const current = eventSnapshot.data();
        const assessmentSnapshot = current?.currentAssessmentId
            ? await eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(current.currentAssessmentId).get()
            : undefined;
        const sameAssessmentState = Boolean(current)
            && current?.currentVersionId === event.currentVersionId
            && current?.currentAssessmentId === event.currentAssessmentId
            && (event.assessmentStateHash === undefined
                ? !assessmentSnapshot?.exists
                : assessmentSnapshot?.exists && assessmentStateHashFor(assessmentSnapshot.data()) === event.assessmentStateHash);
        if (!sameAssessmentState) {
            deferredEventIds.push(eventReference.id);
            deferredTokens.push((0, resourceCutoverLock_1.createResourceCutoverQueueToken)({
                eventId: eventReference.id,
                currentVersionId: current?.currentVersionId,
                currentAssessmentId: current?.currentAssessmentId,
                assessmentInputHash: assessmentSnapshot?.data()?.inputHash,
                assessmentStateHash: assessmentSnapshot?.exists ? assessmentStateHashFor(assessmentSnapshot.data()) : undefined,
                generationId: `restore-${restoreSessionId}-${current?.currentVersionId ?? 'none'}-${current?.currentAssessmentId ?? 'none'}`,
            }));
        }
        else
            affectedEvents.push(event);
    }
    if (deferredTokens.length > 0) {
        await db.runTransaction(async (transaction) => {
            const lockReference = db.doc('system_controls/m2_resource_v3_cutover');
            const lock = await transaction.get(lockReference);
            if (lock.data()?.sessionId !== restoreSessionId || lock.data()?.leaseExpiresAt <= Date.now()) {
                throw new Error('Restore fencing check failed while queuing deferred generations.');
            }
            transaction.update(lockReference, { queuedEvents: firestore_1.FieldValue.arrayUnion(...deferredTokens) });
        });
    }
    for (const event of affectedEvents) {
        await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, restoreSessionId);
        const eventReference = db.doc(event.path);
        await hooks.beforeAffectedEventTransaction?.(eventReference.id);
        await db.runTransaction(async (transaction) => {
            const [eventSnapshot, assessmentSnapshot, lockSnapshot, currentSummaries, currentResources, currentOverrides, currentAudits] = await Promise.all([
                transaction.get(eventReference),
                event.currentAssessmentId
                    ? transaction.get(eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId))
                    : Promise.resolve(undefined),
                transaction.get(db.doc('system_controls/m2_resource_v3_cutover')),
                transaction.get(eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES)),
                transaction.get(eventReference.collection(types_1.COLLECTIONS.RESOURCES)),
                transaction.get(eventReference.collection(types_1.COLLECTIONS.RESOURCE_OVERRIDES)),
                transaction.get(eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS)),
            ]);
            if (!lockSnapshot?.exists || lockSnapshot.data()?.active !== true
                || lockSnapshot.data()?.sessionId !== restoreSessionId || lockSnapshot.data()?.mode !== 'restore'
                || !Number.isFinite(lockSnapshot.data()?.leaseExpiresAt)
                || lockSnapshot.data().leaseExpiresAt <= Date.now() || anchor.restoreSessionId !== restoreSessionId) {
                throw new Error('Restore lock ownership changed while restoring an event projection.');
            }
            const current = eventSnapshot.data();
            const sameAssessmentState = Boolean(current)
                && current?.currentVersionId === event.currentVersionId
                && current?.currentAssessmentId === event.currentAssessmentId
                && (event.assessmentStateHash === undefined
                    ? !assessmentSnapshot?.exists
                    : assessmentSnapshot?.exists && assessmentStateHashFor(assessmentSnapshot.data()) === event.assessmentStateHash);
            if (!sameAssessmentState) {
                deferredEventIds.push(eventReference.id);
                transaction.update(db.doc('system_controls/m2_resource_v3_cutover'), {
                    queuedEvents: firestore_1.FieldValue.arrayUnion((0, resourceCutoverLock_1.createResourceCutoverQueueToken)({
                        eventId: eventReference.id,
                        currentVersionId: current?.currentVersionId,
                        currentAssessmentId: current?.currentAssessmentId,
                        assessmentInputHash: assessmentSnapshot?.data()?.inputHash,
                        assessmentStateHash: assessmentSnapshot?.exists ? assessmentStateHashFor(assessmentSnapshot.data()) : undefined,
                        generationId: `restore-race-${restoreSessionId}-${current?.currentVersionId ?? 'none'}-${current?.currentAssessmentId ?? 'none'}`,
                    })),
                });
                return;
            }
            const expectedResources = expectedByCollection.get(types_1.COLLECTIONS.RESOURCES) ?? new Set();
            const expectedOverrides = expectedByCollection.get(types_1.COLLECTIONS.RESOURCE_OVERRIDES) ?? new Set();
            for (const document of currentResources.docs)
                if (!expectedResources.has(document.ref.path))
                    transaction.delete(document.ref);
            for (const document of currentOverrides.docs)
                if (!expectedOverrides.has(document.ref.path))
                    transaction.delete(document.ref);
            for (const document of currentAudits.docs) {
                const action = String(document.data().action);
                if (backup.manifest.managedAuditActions.includes(action)
                    && !expectedAuditPaths.has(document.ref.path))
                    transaction.delete(document.ref);
            }
            for (const document of decodedDocuments.filter((entry) => !entry.path.includes(`/${types_1.COLLECTIONS.ASSESSMENT_SUMMARIES}/`)
                && entry.path.startsWith(`${event.path}/`)))
                transaction.set(db.doc(document.path), document.decoded);
            transaction.update(eventReference, {
                currentResourceId: event.currentResourceId ?? firestore_1.FieldValue.delete(),
            });
            const eventSummaryDocuments = decodedDocuments.filter((document) => document.path.startsWith(`${event.path}/${types_1.COLLECTIONS.ASSESSMENT_SUMMARIES}/`));
            const projectionByPath = new Map(eventSummaryDocuments.map((document) => [document.path, document.decoded]));
            for (const summaryDocument of currentSummaries.docs) {
                const projection = projectionByPath.get(summaryDocument.ref.path);
                transaction.set(summaryDocument.ref, {
                    resourceQuantities: projection && 'resourceQuantities' in projection
                        ? projection.resourceQuantities
                        : firestore_1.FieldValue.delete(),
                    resourceRecommendation: projection && 'resourceRecommendation' in projection
                        ? projection.resourceRecommendation
                        : firestore_1.FieldValue.delete(),
                }, { merge: true });
            }
            const currentSummaryPaths = new Set(currentSummaries.docs.map((document) => document.ref.path));
            if (eventSummaryDocuments.some((document) => !currentSummaryPaths.has(document.path))) {
                throw new Error(`Refusing to recreate a missing assessment summary while restoring ${event.path}.`);
            }
        });
    }
    const restoreIssues = await verifyRestoredBackup(db, backup, new Set(deferredEventIds));
    if (restoreIssues.length > 0) {
        throw new Error(`Resource restore verification failed: ${restoreIssues.join(', ')}`);
    }
    console.info(`Restored ${backup.resources.length} resource documents from ${backupPath}.`);
    return { deferredEventIds: [...new Set(deferredEventIds)] };
}
async function preflightResourceCutoverCapacity(db, backup, heartbeat) {
    for (const event of backup.events) {
        await heartbeat?.();
        const eventReference = db.doc(event.path);
        const [resources, overrides, audits, summaries] = await Promise.all([
            eventReference.collection(types_1.COLLECTIONS.RESOURCES).get(),
            eventReference.collection(types_1.COLLECTIONS.RESOURCE_OVERRIDES).get(),
            eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).get(),
            eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).get(),
        ]);
        const managedAudits = audits.docs.filter((document) => backup.manifest.managedAuditActions.includes(String(document.data().action)));
        const backupWrites = [...backup.resources, ...backup.overrides, ...backup.auditReferences]
            .filter((document) => document.path.startsWith(`${event.path}/`));
        const summaryWrites = summaries.docs.length;
        const conservativeWrites = resources.size + overrides.size + managedAudits.length
            + backupWrites.length + summaryWrites + 2; // event pointer plus worst-case queue/lock update
        const conservativeReads = 3 + summaries.size + resources.size + overrides.size + audits.size;
        const readDocuments = [
            ...summaries.docs, ...resources.docs, ...overrides.docs, ...audits.docs,
        ];
        const encodedReadBytes = readDocuments.reduce((sum, document) => sum + Buffer.byteLength(JSON.stringify((0, firestoreBackupCodec_1.encodeFirestoreValue)(document.data()))), 0);
        const writePayloadBytes = backupWrites.reduce((sum, document) => sum + Buffer.byteLength(JSON.stringify(document)), 0) + backup.summaries.filter((document) => document.path.startsWith(`${event.path}/`))
            .reduce((sum, document) => sum + Buffer.byteLength(JSON.stringify(document)), 0);
        const estimatedBytes = encodedReadBytes + writePayloadBytes
            + (conservativeReads + conservativeWrites) * RESOURCE_CUTOVER_DOCUMENT_OVERHEAD_BYTES;
        if (conservativeWrites > exports.RESOURCE_CUTOVER_TRANSACTION_WRITE_LIMIT
            || conservativeReads > RESOURCE_CUTOVER_TRANSACTION_READ_LIMIT
            || estimatedBytes > RESOURCE_CUTOVER_TRANSACTION_BYTE_LIMIT) {
            throw new Error(`Resource cutover transaction capacity exceeded for ${event.path}: ${conservativeReads} reads, ${conservativeWrites} writes, ${estimatedBytes} bytes.`);
        }
    }
}
function backupChecksumFor(rawBackup) {
    return (0, node_crypto_1.createHash)('sha256').update(rawBackup).digest('hex');
}
async function readVerifiedBackup(backupPath, expectedChecksum) {
    if (!/^[a-f0-9]{64}$/.test(expectedChecksum))
        throw new Error('Expected backup checksum is invalid.');
    const rawBackup = await (0, promises_1.readFile)(backupPath, 'utf8');
    const actualChecksum = backupChecksumFor(rawBackup);
    if (actualChecksum !== expectedChecksum) {
        throw new Error('Backup checksum does not match the separately supplied cutover audit checksum.');
    }
    return validateResourceCutoverBackup(JSON.parse(rawBackup));
}
function decodeBackupDocuments(db, backup) {
    return [...backup.resources, ...backup.overrides, ...backup.summaries, ...backup.auditReferences]
        .map((document) => ({
        path: document.path,
        decoded: (0, firestoreBackupCodec_1.decodeFirestoreValue)(document.data, (referencePath) => db.doc(referencePath)),
    }));
}
function validateResourceCutoverBackup(value) {
    if (!isRecord(value))
        throw new Error('Backup must be a JSON object.');
    const allowedKeys = new Set([
        'projectId', 'resourceSchemaVersion', 'createdAt', 'cutoverSessionId', 'manifest',
        'events', 'resources', 'overrides', 'summaries', 'auditReferences',
    ]);
    if (Object.keys(value).some((key) => !allowedKeys.has(key)))
        throw new Error('Backup contains unknown top-level fields.');
    if (value.projectId !== exports.RESOURCE_CUTOVER_PROJECT)
        throw new Error('Backup project ID does not match the fixed resource cutover project.');
    if (value.resourceSchemaVersion !== types_1.RESOURCE_SCHEMA_VERSION)
        throw new Error('Backup resource schema version is not supported.');
    if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)))
        throw new Error('Backup createdAt is invalid.');
    if (value.cutoverSessionId !== undefined
        && (typeof value.cutoverSessionId !== 'string' || !value.cutoverSessionId.trim())) {
        throw new Error('Backup cutoverSessionId is invalid.');
    }
    if (!isRecord(value.manifest)
        || !hasOnlyKeys(value.manifest, ['version', 'eventPaths', 'managedCollections', 'managedAuditActions'])
        || value.manifest.version !== 2
        || !sameStringArray(value.manifest.managedCollections, ['resources', 'resource_overrides'])
        || !sameStringArray(value.manifest.managedAuditActions, ['resource_recommended', 'resource_overridden', 'resource_schema_cutover'])
        || !Array.isArray(value.manifest.eventPaths))
        throw new Error('Backup manifest is invalid.');
    if (!Array.isArray(value.events) || !Array.isArray(value.resources) || !Array.isArray(value.overrides)
        || !Array.isArray(value.summaries) || !Array.isArray(value.auditReferences))
        throw new Error('Backup document arrays are invalid.');
    const eventPaths = new Set();
    for (const rawEvent of value.events) {
        if (!isRecord(rawEvent)
            || !hasOnlyKeys(rawEvent, [
                'path', 'updatedAt', 'currentVersionId', 'currentAssessmentId', 'currentResourceId', 'assessmentStateHash',
            ])
            || typeof rawEvent.path !== 'string'
            || !isEventPath(rawEvent.path)
            || !Number.isFinite(rawEvent.updatedAt)
            || (rawEvent.currentVersionId !== undefined && typeof rawEvent.currentVersionId !== 'string')
            || (rawEvent.currentAssessmentId !== undefined && typeof rawEvent.currentAssessmentId !== 'string')
            || (rawEvent.currentResourceId !== undefined && typeof rawEvent.currentResourceId !== 'string')
            || (rawEvent.assessmentStateHash !== undefined && !/^[a-f0-9]{64}$/.test(String(rawEvent.assessmentStateHash)))
            || ((rawEvent.currentAssessmentId === undefined) !== (rawEvent.assessmentStateHash === undefined))) {
            throw new Error('Backup event entry is invalid.');
        }
        if (eventPaths.has(rawEvent.path))
            throw new Error(`Duplicate backup event path: ${rawEvent.path}`);
        eventPaths.add(rawEvent.path);
    }
    if (!sameSet(value.manifest.eventPaths, eventPaths))
        throw new Error('Backup manifest event scope does not match event entries.');
    const seenDocumentPaths = new Set();
    validateBackupDocuments(value.resources, types_1.COLLECTIONS.RESOURCES, eventPaths, seenDocumentPaths);
    validateBackupDocuments(value.overrides, types_1.COLLECTIONS.RESOURCE_OVERRIDES, eventPaths, seenDocumentPaths);
    validateBackupDocuments(value.summaries, types_1.COLLECTIONS.ASSESSMENT_SUMMARIES, eventPaths, seenDocumentPaths);
    validateBackupDocuments(value.auditReferences, types_1.COLLECTIONS.AUDIT_LOGS, eventPaths, seenDocumentPaths, true);
    const resourcePaths = new Set(value.resources.map((document) => document.path));
    for (const rawEvent of value.events) {
        if (rawEvent.currentResourceId
            && !resourcePaths.has(`${rawEvent.path}/${types_1.COLLECTIONS.RESOURCES}/${rawEvent.currentResourceId}`)) {
            throw new Error(`Backup event pointer is not backed by a resource document: ${rawEvent.path}`);
        }
    }
    for (const summary of value.summaries) {
        const keys = encodedMapKeys(summary.data);
        if (!keys || keys.length === 0 || keys.some((key) => !['resourceQuantities', 'resourceRecommendation'].includes(key))) {
            throw new Error(`Backup summary must contain resource projection fields only: ${summary.path}`);
        }
    }
    return value;
}
function validateDecodedRestoreRelationships(backup, documents) {
    const issues = [];
    const resources = new Map();
    for (const document of documents.filter((entry) => entry.path.includes(`/${types_1.COLLECTIONS.RESOURCES}/`))) {
        const segments = document.path.split('/');
        if (!isRecord(document.decoded)
            || typeof document.decoded.resourceId !== 'string'
            || document.decoded.resourceId !== segments[3]) {
            issues.push(`${document.path}:resource-document-id-mismatch`);
            continue;
        }
        if (typeof document.decoded.eventId === 'string' && document.decoded.eventId !== segments[1]) {
            issues.push(`${document.path}:resource-event-id-mismatch`);
        }
        if (document.decoded.schemaVersion === types_1.RESOURCE_SCHEMA_VERSION) {
            const validation = (0, resourceContract_1.validateResourceRecommendation)(document.decoded);
            issues.push(...validation.errors.map((error) => `${document.path}:${error}`));
            if (validation.ok)
                issues.push(...validateResourceDocumentIdentity(segments[3], document.decoded)
                    .map((issue) => `${document.path}:${issue}`));
        }
        resources.set(document.path, document.decoded);
    }
    for (const event of backup.events) {
        if (event.currentResourceId && !resources.has(`${event.path}/${types_1.COLLECTIONS.RESOURCES}/${event.currentResourceId}`)) {
            issues.push(`${event.path}:pointer-resource-missing`);
        }
    }
    for (const document of documents.filter((entry) => entry.path.includes(`/${types_1.COLLECTIONS.ASSESSMENT_SUMMARIES}/`))) {
        if (!isRecord(document.decoded)
            || Object.keys(document.decoded).some((key) => !['resourceQuantities', 'resourceRecommendation'].includes(key))) {
            issues.push(`${document.path}:summary-not-resource-projection-only`);
            continue;
        }
        const recommendation = document.decoded.resourceRecommendation;
        if (recommendation !== undefined) {
            if (!isRecord(recommendation) || typeof recommendation.resourceId !== 'string') {
                issues.push(`${document.path}:summary-resource-id-invalid`);
            }
            else {
                const eventPath = document.path.split('/').slice(0, 2).join('/');
                if (!resources.has(`${eventPath}/${types_1.COLLECTIONS.RESOURCES}/${recommendation.resourceId}`)) {
                    issues.push(`${document.path}:summary-resource-missing`);
                }
            }
        }
        if (document.decoded.resourceQuantities !== undefined && !isRecord(document.decoded.resourceQuantities)) {
            issues.push(`${document.path}:summary-quantities-invalid`);
        }
    }
    return [...new Set(issues)];
}
async function verifyRestoredBackup(db, backup, deferredEventIds) {
    const issues = [];
    const expectedDocuments = [...backup.resources, ...backup.overrides, ...backup.auditReferences];
    for (const document of expectedDocuments) {
        if (deferredEventIds.has(document.path.split('/')[1]))
            continue;
        const snapshot = await db.doc(document.path).get();
        if (!snapshot.exists || stableJson((0, firestoreBackupCodec_1.encodeFirestoreValue)(snapshot.data())) !== stableJson(document.data)) {
            issues.push(`${document.path}:restore-content-mismatch`);
        }
    }
    const expectedPathsByCollection = new Map([
        [types_1.COLLECTIONS.RESOURCES, new Set(backup.resources.map((document) => document.path))],
        [types_1.COLLECTIONS.RESOURCE_OVERRIDES, new Set(backup.overrides.map((document) => document.path))],
    ]);
    const expectedAuditPaths = new Set(backup.auditReferences.map((document) => document.path));
    for (const event of backup.events) {
        const eventReference = db.doc(event.path);
        const restoredEvent = (await eventReference.get()).data();
        if (deferredEventIds.has(eventReference.id))
            continue;
        if (restoredEvent?.currentResourceId !== event.currentResourceId) {
            issues.push(`${event.path}:event-pointer-mismatch`);
        }
        if (event.currentResourceId
            && !(await eventReference.collection(types_1.COLLECTIONS.RESOURCES).doc(event.currentResourceId).get()).exists) {
            issues.push(`${event.path}:dangling-restored-pointer`);
        }
        for (const collectionName of backup.manifest.managedCollections) {
            const expected = expectedPathsByCollection.get(collectionName) ?? new Set();
            for (const document of (await eventReference.collection(collectionName).get()).docs) {
                if (!expected.has(document.ref.path))
                    issues.push(`${document.ref.path}:unexpected-restored-document`);
            }
        }
        {
            const expectedProjections = backup.summaries.filter((document) => document.path.startsWith(`${event.path}/${types_1.COLLECTIONS.ASSESSMENT_SUMMARIES}/`));
            const expectedByPath = new Map(expectedProjections.map((document) => [document.path, document.data]));
            const currentSummaries = await eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).get();
            for (const currentSummary of currentSummaries.docs) {
                const currentData = currentSummary.data();
                const encodedCurrentProjection = (0, firestoreBackupCodec_1.encodeFirestoreValue)({
                    ...('resourceQuantities' in currentData ? { resourceQuantities: currentData.resourceQuantities } : {}),
                    ...('resourceRecommendation' in currentData ? { resourceRecommendation: currentData.resourceRecommendation } : {}),
                });
                const encodedExpected = expectedByPath.get(currentSummary.ref.path) ?? (0, firestoreBackupCodec_1.encodeFirestoreValue)({});
                if (stableJson(encodedCurrentProjection) !== stableJson(encodedExpected)) {
                    issues.push(`${currentSummary.ref.path}:restore-projection-mismatch`);
                }
            }
            for (const expectedProjection of expectedProjections) {
                if (!currentSummaries.docs.some((document) => document.ref.path === expectedProjection.path)) {
                    issues.push(`${expectedProjection.path}:missing-restored-summary`);
                }
            }
        }
        for (const document of (await eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).get()).docs) {
            if (backup.manifest.managedAuditActions.includes(String(document.data().action)) && !expectedAuditPaths.has(document.ref.path))
                issues.push(`${document.ref.path}:unexpected-restored-audit`);
        }
    }
    return issues;
}
function validateBackupDocuments(values, collectionName, eventPaths, seenPaths, requireManagedAuditAction = false) {
    for (const value of values) {
        if (!isRecord(value)
            || !hasOnlyKeys(value, ['path', 'data'])
            || typeof value.path !== 'string'
            || !isEncodedFirestoreValue(value.data)) {
            throw new Error(`Backup ${collectionName} entry is invalid.`);
        }
        const segments = value.path.split('/');
        const eventPath = segments.slice(0, 2).join('/');
        if (segments.length !== 4 || segments[0] !== types_1.COLLECTIONS.EVENTS || segments[2] !== collectionName
            || !validDocumentSegment(segments[1]) || !validDocumentSegment(segments[3]) || !eventPaths.has(eventPath)) {
            throw new Error(`Backup path is outside the allowed ${collectionName} scope: ${value.path}`);
        }
        if (seenPaths.has(value.path))
            throw new Error(`Duplicate backup document path: ${value.path}`);
        if (requireManagedAuditAction) {
            const action = encodedMapString(value.data, 'action');
            if (!action || !['resource_recommended', 'resource_overridden', 'resource_schema_cutover'].includes(action)) {
                throw new Error(`Backup audit is outside the managed resource action scope: ${value.path}`);
            }
        }
        seenPaths.add(value.path);
    }
}
function isEncodedFirestoreValue(value) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
        return typeof value !== 'number' || Number.isFinite(value);
    if (!isRecord(value) || typeof value.type !== 'string')
        return false;
    if (value.type === 'map')
        return isRecord(value.values) && Object.values(value.values).every(isEncodedFirestoreValue);
    if (value.type === 'array')
        return Array.isArray(value.values) && value.values.every(isEncodedFirestoreValue);
    if (value.type === 'timestamp')
        return Number.isSafeInteger(value.seconds) && Number.isSafeInteger(value.nanoseconds);
    if (value.type === 'geopoint')
        return Number.isFinite(value.latitude) && Number.isFinite(value.longitude);
    if (value.type === 'bytes')
        return typeof value.base64 === 'string';
    if (value.type === 'reference')
        return typeof value.path === 'string' && value.path.split('/').length % 2 === 0;
    if (value.type === 'date')
        return typeof value.iso === 'string' && Number.isFinite(Date.parse(value.iso));
    return value.type === 'special-number' && ['NaN', 'Infinity', '-Infinity'].includes(String(value.value));
}
function isEventPath(value) {
    const segments = value.split('/');
    return segments.length === 2 && segments[0] === types_1.COLLECTIONS.EVENTS && validDocumentSegment(segments[1]);
}
function validDocumentSegment(value) {
    return value.length > 0 && value !== '.' && value !== '..';
}
function sameStringArray(value, expected) {
    return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index]);
}
function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every((key) => allowed.includes(key));
}
function encodedMapString(value, key) {
    if (!isRecord(value) || value.type !== 'map' || !isRecord(value.values))
        return undefined;
    const entry = value.values[key];
    return typeof entry === 'string' ? entry : undefined;
}
function encodedMapKeys(value) {
    if (!isRecord(value) || value.type !== 'map' || !isRecord(value.values))
        return undefined;
    return Object.keys(value.values);
}
function sameSet(value, expected) {
    return Array.isArray(value)
        && value.every((entry) => typeof entry === 'string')
        && value.length === expected.size
        && value.every((entry) => expected.has(entry));
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (isRecord(value))
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
function assessmentStateHashFor(value) {
    return (0, node_crypto_1.createHash)('sha256').update(stableJson((0, firestoreBackupCodec_1.encodeFirestoreValue)(value))).digest('hex');
}
if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=cutoverResourceV3.js.map