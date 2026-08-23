"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testOnlyRollbackHardeningAttempt = exports.HARDENING_CUTOVER_ANCHORS = exports.HARDENING_CUTOVER_BUCKET = exports.HARDENING_CUTOVER_PROJECT = void 0;
exports.parseHardeningCutoverArguments = parseHardeningCutoverArguments;
exports.validateHardeningCutoverOptions = validateHardeningCutoverOptions;
exports.backupChecksum = backupChecksum;
exports.validateHardeningBackup = validateHardeningBackup;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../shared/types");
const resourceCutoverLock_1 = require("../config/resourceCutoverLock");
const onEventCreated_1 = require("../triggers/onEventCreated");
const cutoverResourceV3_1 = require("./cutoverResourceV3");
const firestoreBackupCodec_1 = require("./firestoreBackupCodec");
const resourceCalculator_1 = require("../engines/resourceCalculator");
const resourceContract_1 = require("../engines/resourceContract");
const ruleBased_1 = require("../engines/ruleBased");
const storageEvidence_1 = require("../utils/storageEvidence");
exports.HARDENING_CUTOVER_PROJECT = 'linkos-496505';
exports.HARDENING_CUTOVER_BUCKET = `${exports.HARDENING_CUTOVER_PROJECT}.firebasestorage.app`;
exports.HARDENING_CUTOVER_ANCHORS = 'system_controls/m2_resource_v3_cutover/hardening_anchors';
function parseHardeningCutoverArguments(values) {
    const args = new Map();
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!value.startsWith('--'))
            throw new Error(`Unexpected argument: ${value}`);
        const [key, inline] = value.slice(2).split('=', 2);
        const next = values[index + 1];
        if (inline !== undefined)
            args.set(key, inline);
        else if (next && !next.startsWith('--')) {
            args.set(key, next);
            index += 1;
        }
        else
            args.set(key, 'true');
    }
    return {
        projectId: args.get('project') ?? '',
        mode: (args.get('mode') ?? 'plan'),
        confirmation: args.get('confirm'),
        backupDirectory: node_path_1.default.resolve(args.get('backup-dir')
            ?? process.env.STERAS_BACKUP_DIR
            ?? '/Users/kongjy/Documents/School/steras-backups'),
        backupPath: args.get('backup') ? node_path_1.default.resolve(args.get('backup')) : undefined,
        checksum: args.get('checksum'),
        takeoverSessionId: args.get('takeover-session'),
    };
}
function validateHardeningCutoverOptions(options) {
    if (options.projectId !== exports.HARDENING_CUTOVER_PROJECT)
        throw new Error(`--project must equal ${exports.HARDENING_CUTOVER_PROJECT}.`);
    if (!['plan', 'apply', 'restore'].includes(options.mode))
        throw new Error('--mode must be plan, apply, or restore.');
    if (options.mode !== 'plan' && options.confirmation !== exports.HARDENING_CUTOVER_PROJECT) {
        throw new Error(`Pass --confirm=${exports.HARDENING_CUTOVER_PROJECT} for a mutating operation.`);
    }
    if (!node_path_1.default.isAbsolute(options.backupDirectory))
        throw new Error('--backup-dir must be absolute.');
    if (options.mode === 'restore' && (!options.backupPath || !node_path_1.default.isAbsolute(options.backupPath))) {
        throw new Error('--backup=<absolute path> is required for restore.');
    }
    if (options.mode === 'restore' && !/^[a-f0-9]{64}$/.test(options.checksum ?? '')) {
        throw new Error('--checksum=<sha256 from the trusted anchor> is required for restore.');
    }
}
function backupChecksum(raw) {
    return (0, node_crypto_1.createHash)('sha256').update(raw).digest('hex');
}
function validateHardeningBackup(value) {
    const issues = [];
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return ['backup-object'];
    const backup = value;
    if (backup.manifestVersion !== 1)
        issues.push('manifest-version');
    if (backup.projectId !== exports.HARDENING_CUTOVER_PROJECT)
        issues.push('project');
    if (typeof backup.sessionId !== 'string' || !backup.sessionId)
        issues.push('session');
    if (!Number.isFinite(backup.createdAt))
        issues.push('created-at');
    if (!Array.isArray(backup.events) || !Array.isArray(backup.documents))
        return [...issues, 'collections'];
    const paths = new Set();
    for (const document of backup.documents) {
        if (!document || typeof document.path !== 'string' || !allowedBackupPath(document.path))
            issues.push('document-path');
        else if (paths.has(document.path))
            issues.push('duplicate-path');
        else
            paths.add(document.path);
    }
    for (const event of backup.events) {
        if (!event || typeof event.eventId !== 'string' || event.path !== `${types_1.COLLECTIONS.EVENTS}/${event.eventId}`)
            issues.push('event-path');
        if (event.summary && event.summary.path !== `${event.path}/${types_1.COLLECTIONS.ASSESSMENT_SUMMARIES}/${event.currentVersionId}`)
            issues.push('summary-path');
        if (event.versionInputHash !== undefined && (typeof event.versionInputHash !== 'string' || !/^[a-f0-9]{64}$/.test(event.versionInputHash)))
            issues.push('version-input-hash');
    }
    return [...new Set(issues)];
}
function allowedBackupPath(value) {
    const parts = value.split('/');
    if (parts.length < 4 || parts[0] !== types_1.COLLECTIONS.EVENTS)
        return false;
    return [types_1.COLLECTIONS.ASSESSMENTS, types_1.COLLECTIONS.RESOURCES, types_1.COLLECTIONS.AUDIT_LOGS,
        types_1.COLLECTIONS.DECISIONS, types_1.COLLECTIONS.DECISION_HISTORY].includes(parts[2])
        || (parts.length === 6 && parts[2] === types_1.COLLECTIONS.ASSESSMENTS
            && [types_1.COLLECTIONS.SCORE_REVIEWS, types_1.COLLECTIONS.SCORE_RESOLUTIONS, types_1.COLLECTIONS.MANUAL_ASSESSMENTS].includes(parts[4]));
}
async function inventory(db, sessionId) {
    const backup = { manifestVersion: 1, projectId: exports.HARDENING_CUTOVER_PROJECT, sessionId, createdAt: Date.now(), events: [], documents: [] };
    const candidates = [];
    const excluded = [];
    const events = await db.collection(types_1.COLLECTIONS.EVENTS).get();
    for (const document of events.docs) {
        const event = { eventId: document.id, ...document.data() };
        if (!event.currentVersionId || !['Pending', 'UnderReview'].includes(event.status))
            continue;
        const entry = {
            eventId: event.eventId, path: document.ref.path, currentVersionId: event.currentVersionId,
            ...(event.currentAssessmentId ? { currentAssessmentId: event.currentAssessmentId } : {}),
            ...(event.currentResourceId ? { currentResourceId: event.currentResourceId } : {}),
        };
        const summary = await document.ref.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(event.currentVersionId).get();
        if (summary.exists)
            entry.summary = { path: summary.ref.path, data: (0, firestoreBackupCodec_1.encodeFirestoreValue)(summary.data()) };
        backup.events.push(entry);
        for (const collection of [types_1.COLLECTIONS.ASSESSMENTS, types_1.COLLECTIONS.RESOURCES, types_1.COLLECTIONS.AUDIT_LOGS, types_1.COLLECTIONS.DECISIONS, types_1.COLLECTIONS.DECISION_HISTORY]) {
            const snapshot = await document.ref.collection(collection).get();
            for (const item of snapshot.docs)
                backup.documents.push({ path: item.ref.path, data: (0, firestoreBackupCodec_1.encodeFirestoreValue)(item.data()) });
        }
        const assessments = await document.ref.collection(types_1.COLLECTIONS.ASSESSMENTS).get();
        for (const assessment of assessments.docs)
            for (const collection of [types_1.COLLECTIONS.SCORE_REVIEWS, types_1.COLLECTIONS.SCORE_RESOLUTIONS, types_1.COLLECTIONS.MANUAL_ASSESSMENTS]) {
                for (const item of (await assessment.ref.collection(collection).get()).docs) {
                    backup.documents.push({ path: item.ref.path, data: (0, firestoreBackupCodec_1.encodeFirestoreValue)(item.data()) });
                }
            }
        const currentAssessment = event.currentAssessmentId
            ? assessments.docs.find((assessment) => assessment.id === event.currentAssessmentId)?.data()
            : undefined;
        const version = await document.ref.collection(types_1.COLLECTIONS.VERSIONS).doc(event.currentVersionId).get();
        if (version.exists && (0, onEventCreated_1.isPipelineEventVersion)(version.data(), event.eventId, event.currentVersionId)) {
            entry.versionInputHash = version.data().inputHash;
        }
        if (currentAssessment?.schemaVersion === types_1.ASSESSMENT_SCHEMA_VERSION) {
            const currentIssues = await validateExistingHardeningCurrent(document.ref, event, currentAssessment, version.data(), summary.data());
            if (currentIssues.length > 0) {
                throw new Error(`Invalid current hardening state for ${event.eventId}: ${currentIssues.join(',')}`);
            }
            excluded.push(`${event.eventId}:current_hardening_schema`);
            continue;
        }
        const decisions = await document.ref.collection(types_1.COLLECTIONS.DECISIONS).where('versionId', '==', event.currentVersionId).limit(1).get();
        if (!decisions.empty) {
            excluded.push(`${event.eventId}:downstream_review_exists`);
            continue;
        }
        if (!entry.versionInputHash) {
            excluded.push(`${event.eventId}:invalid_current_version`);
            continue;
        }
        candidates.push(entry);
    }
    return { backup, candidates, excluded };
}
async function validateExistingHardeningCurrent(eventReference, event, assessment, versionValue, summary) {
    const versionId = event.currentVersionId;
    const assessmentId = event.currentAssessmentId;
    if (!versionId || !assessmentId || !(0, onEventCreated_1.isPipelineEventVersion)(versionValue, event.eventId, versionId)
        || assessment.assessmentId !== assessmentId || assessment.eventId !== event.eventId
        || assessment.versionId !== versionId || assessment.schemaVersion !== types_1.ASSESSMENT_SCHEMA_VERSION) {
        return ['identity-or-version'];
    }
    const issues = [];
    if (!summary || summary.assessmentId !== assessmentId || summary.eventId !== event.eventId
        || summary.versionId !== versionId || summary.schemaVersion !== types_1.ASSESSMENT_SCHEMA_VERSION
        || summary.status !== assessment.status)
        issues.push('summary-identity');
    const storageEvidence = await (0, storageEvidence_1.inspectStorageEvidence)(versionValue.documentPaths);
    if (storageEvidence.some((evidence) => {
        const provenance = Array.isArray(assessment.contextEvidence)
            ? assessment.contextEvidence.find((item) => item && typeof item === 'object'
                && item.sourceKind === 'submitted_document'
                && item.sourceLocator === evidence.path)
            : undefined;
        return !provenance || provenance.eligibility !== evidence.status
            || provenance.sourceVersion !== evidence.sourceVersion;
    }))
        issues.push('storage-evidence-binding');
    if (assessment.status === 'manual_review_required') {
        if (event.currentResourceId)
            issues.push('manual-review-resource-pointer');
        if (summary?.resourceQuantities !== undefined || summary?.resourceRecommendation !== undefined) {
            issues.push('manual-review-resource-projection');
        }
        if (!(0, onEventCreated_1.isCurrentManualReviewAssessment)(assessment, event.eventId, versionId, assessmentId)) {
            issues.push('manual-review-contract');
        }
        return issues;
    }
    if (!storageEvidence.some((evidence) => evidence.status === 'eligible'))
        issues.push('storage-evidence-missing');
    if (!(0, onEventCreated_1.isResourceEligibleAssessment)(assessment, event.eventId, versionId, versionValue.eventDetails)) {
        issues.push('assessment-contract');
        return issues;
    }
    if (!event.currentResourceId) {
        issues.push('resource-pointer');
        return issues;
    }
    const resourceSnapshot = await eventReference.collection(types_1.COLLECTIONS.RESOURCES).doc(event.currentResourceId).get();
    const resource = resourceSnapshot.data();
    const result = assessment.status === 'official_ready' ? assessment.officialResult : assessment.provisionalResult;
    const calculation = (0, resourceCalculator_1.computeResources)({
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
    if (!resource || resource.schemaVersion !== types_1.RESOURCE_SCHEMA_VERSION
        || resource.assessmentId !== assessmentId || !(0, resourceContract_1.validateResourceRecommendation)(resource).ok
        || (0, cutoverResourceV3_1.validateResourceDocumentIdentity)(resourceSnapshot.id, resource).length > 0
        || !calculation.ok || resource.resourceInputHash !== calculation.resourceInputHash
        || resource.formulaVersion !== calculation.formulaVersion
        || resource.configVersion !== calculation.configVersion
        || resource.sourceRegistryVersion !== calculation.sourceRegistryVersion
        || (0, resourceCalculator_1.stableStringify)(resource.items) !== (0, resourceCalculator_1.stableStringify)(expectedItems)
        || resource.assessmentReference.assessmentId !== assessmentId
        || (0, cutoverResourceV3_1.validateOrganizerResourceProjection)(resource, summary).length > 0)
        issues.push('resource-binding');
    return issues;
}
async function applyCutover(db, options) {
    const sessionId = (0, node_crypto_1.randomUUID)();
    let recovery;
    let destructiveStarted = false;
    await (0, resourceCutoverLock_1.acquireResourceCutoverLock)(db, sessionId, 'apply', options.takeoverSessionId);
    const heartbeat = (0, resourceCutoverLock_1.startResourceCutoverHeartbeat)(db, sessionId);
    try {
        const state = await inventory(db, sessionId);
        const issues = validateHardeningBackup(state.backup);
        if (issues.length)
            throw new Error(`Backup preflight failed: ${issues.join(',')}`);
        await (0, promises_1.mkdir)(options.backupDirectory, { recursive: true, mode: 0o700 });
        const backupPath = node_path_1.default.join(options.backupDirectory, `m2-hardening-${new Date().toISOString().replaceAll(':', '-')}-${sessionId}.json`);
        const raw = JSON.stringify(state.backup, null, 2);
        const checksum = backupChecksum(raw);
        recovery = { backupPath, checksum };
        await (0, promises_1.writeFile)(backupPath, raw, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await (0, promises_1.writeFile)(`${backupPath}.sha256`, `${checksum}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        const anchor = db.collection(exports.HARDENING_CUTOVER_ANCHORS).doc(sessionId);
        await anchor.create({ sessionId, projectId: options.projectId, backupPath, checksum, status: 'prepared', createdAt: Date.now() });
        await db.runTransaction(async (transaction) => {
            const [lock, currentAnchor] = await Promise.all([
                transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
                transaction.get(anchor),
            ]);
            if (lock.data()?.sessionId !== sessionId || lock.data()?.active !== true
                || !Number.isFinite(lock.data()?.leaseExpiresAt) || lock.data().leaseExpiresAt <= Date.now()
                || currentAnchor.data()?.status !== 'prepared') {
                throw new Error('Cutover fence lost before apply.');
            }
            transaction.update(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH), { phase: 'post_destructive' });
            transaction.update(anchor, { status: 'recovery_required', destructiveStartedAt: Date.now() });
        });
        destructiveStarted = true;
        const failures = [];
        const changed = [];
        for (const candidate of state.candidates) {
            await (0, resourceCutoverLock_1.renewResourceCutoverLease)(db, sessionId);
            const assessmentId = (0, onEventCreated_1.assessmentDocumentId)(candidate.currentVersionId, (0, onEventCreated_1.assessmentInputHashForVersion)(candidate.versionInputHash, `hardening-cutover-${sessionId}`));
            const attemptReference = anchor.collection('attempts').doc(candidate.eventId);
            const attempt = {
                eventId: candidate.eventId,
                eventPath: candidate.path,
                versionId: candidate.currentVersionId,
                assessmentId,
                ...(candidate.currentAssessmentId ? { originalAssessmentId: candidate.currentAssessmentId } : {}),
                ...(candidate.currentResourceId ? { originalResourceId: candidate.currentResourceId } : {}),
                auditPaths: [],
                status: 'pending',
            };
            await writeAttemptFenced(db, attemptReference, attempt, sessionId, true);
            let result;
            try {
                result = await (0, onEventCreated_1.runRiskAndResourcePipeline)(candidate.eventId, Date.now(), false, undefined, {
                    contextGeneration: `hardening-cutover-${sessionId}`,
                    expectedCurrentAssessmentId: candidate.currentAssessmentId,
                    allowUnderReview: true,
                    cutoverSessionId: sessionId,
                    allowLegacyResourcePointer: true,
                    allowLegacyAssessmentReplacement: true,
                });
            }
            catch (error) {
                failures.push({ eventId: candidate.eventId, reason: errorSummary(error) });
                await rollbackAttempt(db, state.backup, attempt, sessionId);
                await writeAttemptFenced(db, attemptReference, { ...attempt, status: 'failed' }, sessionId);
                continue;
            }
            const current = (await db.doc(candidate.path).get()).data();
            if (result.status !== 'processed' || result.assessmentId !== assessmentId
                || result.assessmentStatus !== 'provisional_ready'
                || !['created', 'reused'].includes(result.resourceStatus ?? '')
                || !current || current.currentAssessmentId !== assessmentId || !current.currentResourceId) {
                failures.push({ eventId: candidate.eventId, reason: result.reason ?? 'pointer-not-moved' });
                await rollbackAttempt(db, state.backup, attempt, sessionId);
                await writeAttemptFenced(db, attemptReference, { ...attempt, status: 'failed' }, sessionId);
            }
            else {
                const change = {
                    ...attempt,
                    status: 'succeeded',
                    auditPaths: [
                        `${candidate.path}/${types_1.COLLECTIONS.AUDIT_LOGS}/${assessmentId}-risk-score-computed`,
                        `${candidate.path}/${types_1.COLLECTIONS.AUDIT_LOGS}/${current.currentResourceId}-recommended`,
                    ],
                };
                changed.push(change);
                await writeAttemptFenced(db, attemptReference, change, sessionId);
            }
        }
        const queueFailures = [];
        await (0, cutoverResourceV3_1.drainQueuedResourceEvents)(db, sessionId, queueFailures);
        failures.push(...queueFailures);
        const lockAfterDrain = await (0, resourceCutoverLock_1.assertResourceCutoverFence)(db, sessionId);
        if (lockAfterDrain.queuedEvents.length > 0) {
            throw new Error(`Cutover recovery queue still contains ${lockAfterDrain.queuedEvents.length} event(s).`);
        }
        const verification = await verifyCurrent(db, changed);
        if (verification.length) {
            await rollback(db, state.backup, changed, sessionId);
            await updateAnchorFenced(db, anchor, sessionId, { status: 'rolled_back', failures, verification, completedAt: Date.now() });
        }
        else {
            await updateAnchorFenced(db, anchor, sessionId, { status: 'completed', failures, excluded: state.excluded, changed, completedAt: Date.now() });
        }
        heartbeat.assertHealthy();
        await (0, resourceCutoverLock_1.releaseResourceCutoverLock)(db, sessionId);
        console.info(JSON.stringify({ sessionId, backupPath, checksum, excluded: state.excluded, failures, verification }, null, 2));
    }
    catch (error) {
        const lockReference = db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH);
        try {
            await db.runTransaction(async (transaction) => {
                const lock = await transaction.get(lockReference);
                if (lock.data()?.sessionId === sessionId && lock.data()?.active === true
                    && lock.data()?.phase === 'pre_destructive') {
                    transaction.update(lockReference, { phase: 'pre_destructive_aborted', abortReason: errorSummary(error) });
                }
            });
        }
        catch { /* The original failure and recovery session remain authoritative. */ }
        const restore = destructiveStarted && recovery
            ? ` Restore with --mode=restore --project=${exports.HARDENING_CUTOVER_PROJECT} --confirm=${exports.HARDENING_CUTOVER_PROJECT} --backup=${recovery.backupPath} --checksum=${recovery.checksum} after the lease expires.`
            : ` Retry with --takeover-session=${sessionId} after the lease expires.`;
        throw new Error(`M2 hardening cutover ${sessionId} stopped.${restore} Cause: ${errorSummary(error)}`);
    }
    finally {
        heartbeat.stop();
    }
}
function errorSummary(error) {
    return error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
}
async function writeAttemptFenced(db, reference, attempt, sessionId, create = false) {
    await db.runTransaction(async (transaction) => {
        const [lock, existing] = await Promise.all([
            transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
            transaction.get(reference),
        ]);
        if (lock.data()?.sessionId !== sessionId || lock.data()?.active !== true
            || !Number.isFinite(lock.data()?.leaseExpiresAt) || lock.data().leaseExpiresAt <= Date.now()) {
            throw new Error('Cutover attempt fence lost.');
        }
        if (create && existing.exists)
            throw new Error(`Duplicate hardening attempt: ${attempt.eventId}.`);
        transaction.set(reference, attempt);
    });
}
async function updateAnchorFenced(db, reference, sessionId, update) {
    await db.runTransaction(async (transaction) => {
        const [lock, anchor] = await Promise.all([
            transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)),
            transaction.get(reference),
        ]);
        if (!anchor.exists || anchor.data()?.status !== 'recovery_required'
            || lock.data()?.sessionId !== sessionId || lock.data()?.active !== true
            || !Number.isFinite(lock.data()?.leaseExpiresAt) || lock.data().leaseExpiresAt <= Date.now()) {
            throw new Error('Cutover anchor fence lost.');
        }
        transaction.update(reference, update);
    });
}
async function verifyCurrent(db, changed) {
    const issues = [];
    for (const item of changed) {
        try {
            const eventReference = db.collection(types_1.COLLECTIONS.EVENTS).doc(item.eventId);
            const event = (await eventReference.get()).data();
            if (!event || !['Pending', 'UnderReview'].includes(event.status) || event.currentVersionId !== item.versionId
                || event.currentAssessmentId !== item.assessmentId || !item.assessmentId) {
                issues.push(`${item.eventId}:assessment-pointer`);
                continue;
            }
            const assessment = await eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(item.assessmentId).get();
            const assessmentData = assessment.data();
            const version = (await eventReference.collection(types_1.COLLECTIONS.VERSIONS).doc(item.versionId).get()).data();
            if (!version || !(0, onEventCreated_1.isPipelineEventVersion)(version, item.eventId, item.versionId)
                || !assessmentData || assessmentData.schemaVersion !== types_1.ASSESSMENT_SCHEMA_VERSION
                || assessmentData.status !== 'provisional_ready' || assessmentData.assessmentId !== item.assessmentId
                || assessmentData.eventId !== item.eventId || assessmentData.versionId !== item.versionId
                || assessmentData.aiProposal?.status !== 'success'
                || !assessmentData.contextSnapshot || !Array.isArray(assessmentData.evidence)
                || !Array.isArray(assessmentData.contextEvidence)
                || (0, resourceCalculator_1.validateProvisionalAssessmentResult)(assessmentData.provisionalResult).length > 0
                || (0, resourceCalculator_1.validateAssessmentResultAgainstProposal)(assessmentData.provisionalResult, assessmentData.aiProposal).length > 0) {
                issues.push(`${item.eventId}:assessment-contract`);
                continue;
            }
            const liveVenue = await (0, ruleBased_1.fetchVenueContext)(version.eventDetails);
            if (!assessmentData.contextSnapshot.venue.matched || !assessmentData.contextSnapshot.venue.venueId
                || !liveVenue.matched || liveVenue.venueId !== assessmentData.contextSnapshot.venue.venueId
                || liveVenue.registeredCapacity !== assessmentData.contextSnapshot.venue.registeredCapacity) {
                issues.push(`${item.eventId}:venue-binding`);
            }
            if ((assessmentData.contextSnapshot.weather.data === null
                && (assessmentData.contextSnapshot.weather.measurementStatus !== 'unavailable'
                    || !assessmentData.contextSnapshot.weather.unavailableReason))
                || (assessmentData.contextSnapshot.weather.data !== null
                    && assessmentData.contextSnapshot.weather.measurementStatus !== 'available'))
                issues.push(`${item.eventId}:weather-placeholder`);
            const requiredEvidence = new Set(['crowd', 'venue', 'weather', 'public_health', 'sanitation', 'medical', 'security', 'transport']);
            const eligibleEvidence = new Set(assessmentData.evidence
                .filter((evidence) => evidence.eligibility === 'eligible' && evidence.quality !== 'missing')
                .map((evidence) => evidence.key));
            if ([...requiredEvidence].some((key) => !eligibleEvidence.has(key))
                || !assessmentData.contextEvidence.some((evidence) => evidence.sourceKind === 'submitted_document' && evidence.eligibility === 'eligible')) {
                issues.push(`${item.eventId}:evidence-sufficiency`);
            }
            const storageEvidence = await (0, storageEvidence_1.inspectStorageEvidence)(version.documentPaths);
            if (!storageEvidence.some((evidence) => evidence.status === 'eligible')
                || storageEvidence.some((evidence) => {
                    const provenance = assessmentData.contextEvidence.find((item) => item.sourceKind === 'submitted_document'
                        && item.sourceLocator === evidence.path);
                    return !provenance || provenance.eligibility !== evidence.status
                        || provenance.sourceVersion !== evidence.sourceVersion || provenance.visibility !== 'authority_only';
                }))
                issues.push(`${item.eventId}:storage-evidence-binding`);
            if (!event.currentResourceId) {
                issues.push(`${item.eventId}:resource-pointer`);
                continue;
            }
            const resourceSnapshot = await eventReference.collection(types_1.COLLECTIONS.RESOURCES).doc(event.currentResourceId).get();
            const resource = resourceSnapshot.data();
            const summary = await eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(item.versionId).get();
            if (!resource || resource.schemaVersion !== types_1.RESOURCE_SCHEMA_VERSION || resource.assessmentId !== item.assessmentId
                || !(0, resourceContract_1.validateResourceRecommendation)(resource).ok
                || (0, cutoverResourceV3_1.validateResourceDocumentIdentity)(resourceSnapshot.id, resource).length > 0
                || (0, cutoverResourceV3_1.validateResourceAgainstStoredInputs)(resource, item.eventId, version, assessmentData).length > 0
                || (0, cutoverResourceV3_1.validateOrganizerResourceProjection)(resource, summary.data()).length > 0)
                issues.push(`${item.eventId}:resource-binding`);
        }
        catch {
            issues.push(`${item.eventId}:verification-error`);
        }
    }
    return issues;
}
async function rollback(db, backup, changed, sessionId) {
    await (0, resourceCutoverLock_1.assertResourceCutoverFence)(db, sessionId);
    for (const item of changed)
        await rollbackAttempt(db, backup, item, sessionId);
}
async function rollbackAttempt(db, backup, item, sessionId) {
    const original = backup.events.find((event) => event.eventId === item.eventId);
    if (!original)
        throw new Error(`Rollback manifest is missing event ${item.eventId}.`);
    const eventReference = db.doc(original.path);
    const newResources = await eventReference.collection(types_1.COLLECTIONS.RESOURCES).where('assessmentId', '==', item.assessmentId).get();
    const newAuditPaths = new Set([
        ...item.auditPaths,
        `${eventReference.path}/${types_1.COLLECTIONS.AUDIT_LOGS}/${item.assessmentId}-risk-score-computed`,
        ...newResources.docs.map((resource) => `${eventReference.path}/${types_1.COLLECTIONS.AUDIT_LOGS}/${resource.id}-recommended`),
    ]);
    const oldPaths = new Set(backup.documents.map((document) => document.path));
    await db.runTransaction(async (transaction) => {
        const [lock, event] = await Promise.all([transaction.get(db.doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH)), transaction.get(eventReference)]);
        if (lock.data()?.sessionId !== sessionId || lock.data()?.active !== true
            || !Number.isFinite(lock.data()?.leaseExpiresAt) || lock.data().leaseExpiresAt <= Date.now())
            throw new Error('Rollback fence lost.');
        const current = event.data();
        const pointsToAttempt = current?.currentAssessmentId === item.assessmentId;
        const stillOriginal = current?.currentAssessmentId === original.currentAssessmentId
            && current?.currentResourceId === original.currentResourceId;
        if (!pointsToAttempt && !stillOriginal)
            throw new Error(`Rollback refused for advanced event ${item.eventId}.`);
        if (pointsToAttempt) {
            transaction.update(eventReference, {
                ...(original.currentAssessmentId ? { currentAssessmentId: original.currentAssessmentId } : { currentAssessmentId: firestore_1.FieldValue.delete() }),
                ...(original.currentResourceId ? { currentResourceId: original.currentResourceId } : { currentResourceId: firestore_1.FieldValue.delete() }),
            });
            const summaryReference = eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(original.currentVersionId);
            if (original.summary)
                transaction.set(summaryReference, (0, firestoreBackupCodec_1.decodeFirestoreValue)(original.summary.data, (documentPath) => db.doc(documentPath)));
            else
                transaction.delete(summaryReference);
        }
        const assessmentPath = `${eventReference.path}/${types_1.COLLECTIONS.ASSESSMENTS}/${item.assessmentId}`;
        if (!oldPaths.has(assessmentPath))
            transaction.delete(db.doc(assessmentPath));
        for (const resource of newResources.docs)
            if (!oldPaths.has(resource.ref.path))
                transaction.delete(resource.ref);
        for (const auditPath of newAuditPaths)
            if (!oldPaths.has(auditPath) && allowedBackupPath(auditPath))
                transaction.delete(db.doc(auditPath));
    });
}
/** Emulator-only recovery harness; it is not exported from the deployed Functions entrypoint. */
exports.__testOnlyRollbackHardeningAttempt = rollbackAttempt;
async function restoreCutover(db, options) {
    const raw = await (0, promises_1.readFile)(options.backupPath, 'utf8');
    if (backupChecksum(raw) !== options.checksum)
        throw new Error('Backup checksum mismatch.');
    const backup = JSON.parse(raw);
    const issues = validateHardeningBackup(backup);
    if (issues.length)
        throw new Error(`Backup validation failed: ${issues.join(',')}`);
    const anchor = await db.collection(exports.HARDENING_CUTOVER_ANCHORS).doc(backup.sessionId).get();
    if (!anchor.exists || anchor.data()?.checksum !== options.checksum || anchor.data()?.backupPath !== options.backupPath
        || anchor.data()?.status !== 'recovery_required')
        throw new Error('Trusted recovery anchor does not authorize this restore.');
    const restoreSessionId = (0, node_crypto_1.randomUUID)();
    await (0, resourceCutoverLock_1.acquireResourceCutoverLock)(db, restoreSessionId, 'restore', backup.sessionId);
    const heartbeat = (0, resourceCutoverLock_1.startResourceCutoverHeartbeat)(db, restoreSessionId);
    try {
        const attempts = (await anchor.ref.collection('attempts').get()).docs.map((document) => document.data());
        await rollback(db, backup, attempts, restoreSessionId);
        const restoreIssues = await verifyRollbackState(db, backup, attempts);
        if (restoreIssues.length > 0)
            throw new Error(`Rollback verification failed: ${restoreIssues.join(',')}`);
        const queueFailures = [];
        await (0, cutoverResourceV3_1.drainQueuedResourceEvents)(db, restoreSessionId, queueFailures);
        const lockAfterDrain = await (0, resourceCutoverLock_1.assertResourceCutoverFence)(db, restoreSessionId);
        if (lockAfterDrain.queuedEvents.length > 0) {
            throw new Error(`Restore recovery queue still contains ${lockAfterDrain.queuedEvents.length} event(s).`);
        }
        await updateAnchorFenced(db, anchor.ref, restoreSessionId, { status: 'consumed', restoreSessionId, restoredAt: Date.now() });
        heartbeat.assertHealthy();
        await (0, resourceCutoverLock_1.releaseResourceCutoverLock)(db, restoreSessionId);
    }
    finally {
        heartbeat.stop();
    }
}
async function verifyRollbackState(db, backup, attempts) {
    const issues = [];
    const oldPaths = new Set(backup.documents.map((document) => document.path));
    for (const attempt of attempts) {
        const original = backup.events.find((event) => event.eventId === attempt.eventId);
        if (!original) {
            issues.push(`${attempt.eventId}:manifest-missing`);
            continue;
        }
        const eventReference = db.doc(original.path);
        const [eventSnapshot, assessmentSnapshot, summarySnapshot, newResources] = await Promise.all([
            eventReference.get(),
            eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(attempt.assessmentId).get(),
            eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).doc(attempt.versionId).get(),
            eventReference.collection(types_1.COLLECTIONS.RESOURCES).where('assessmentId', '==', attempt.assessmentId).get(),
        ]);
        const event = eventSnapshot.data();
        if (event?.currentAssessmentId !== original.currentAssessmentId
            || event?.currentResourceId !== original.currentResourceId)
            issues.push(`${attempt.eventId}:pointer-restore`);
        const assessmentPath = `${eventReference.path}/${types_1.COLLECTIONS.ASSESSMENTS}/${attempt.assessmentId}`;
        if (!oldPaths.has(assessmentPath) && assessmentSnapshot.exists)
            issues.push(`${attempt.eventId}:new-assessment-remains`);
        if (newResources.docs.some((document) => !oldPaths.has(document.ref.path)))
            issues.push(`${attempt.eventId}:new-resource-remains`);
        if (original.summary) {
            if (!summarySnapshot.exists
                || (0, resourceCalculator_1.stableStringify)((0, firestoreBackupCodec_1.encodeFirestoreValue)(summarySnapshot.data())) !== (0, resourceCalculator_1.stableStringify)(original.summary.data)) {
                issues.push(`${attempt.eventId}:summary-restore`);
            }
        }
        else if (summarySnapshot.exists)
            issues.push(`${attempt.eventId}:summary-remains`);
    }
    return issues;
}
async function main() {
    const options = parseHardeningCutoverArguments(process.argv.slice(2));
    validateHardeningCutoverOptions(options);
    (0, app_1.initializeApp)({
        credential: (0, app_1.applicationDefault)(),
        projectId: options.projectId,
        storageBucket: exports.HARDENING_CUTOVER_BUCKET,
    });
    const db = (0, firestore_1.getFirestore)();
    if (options.mode === 'plan') {
        const state = await inventory(db, 'dry-run');
        console.info(JSON.stringify({ mode: 'plan', candidates: state.candidates.map((item) => item.eventId), excludedDownstreamDecisions: state.excluded, writes: 0 }, null, 2));
    }
    else if (options.mode === 'apply')
        await applyCutover(db, options);
    else
        await restoreCutover(db, options);
}
if (require.main === module)
    main().catch((error) => { console.error(error); process.exitCode = 1; });
//# sourceMappingURL=cutoverM2Hardening.js.map