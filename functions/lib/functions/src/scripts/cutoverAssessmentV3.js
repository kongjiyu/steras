"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../shared/types");
const onEventCreated_1 = require("../triggers/onEventCreated");
const firestoreBackupCodec_1 = require("./firestoreBackupCodec");
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
if (!['plan', 'apply', 'restore'].includes(mode))
    throw new Error('--mode must be plan, apply, or restore.');
if (mode !== 'plan' && confirmation !== EXPECTED_PROJECT) {
    throw new Error(`Refusing destructive action: pass --confirm=${EXPECTED_PROJECT}.`);
}
(0, app_1.initializeApp)({ credential: (0, app_1.applicationDefault)(), projectId });
const db = (0, firestore_1.getFirestore)();
async function main() {
    if (mode === 'restore') {
        const backupPath = args.get('backup');
        if (!backupPath)
            throw new Error('--backup=<absolute path> is required for restore.');
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
    await (0, promises_1.mkdir)(backupDirectory, { recursive: true, mode: 0o700 });
    const backupPath = node_path_1.default.join(backupDirectory, `m2-v2-${new Date().toISOString().replaceAll(':', '-')}.json`);
    await (0, promises_1.writeFile)(backupPath, JSON.stringify(inventory.backup, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    console.info(`Backup written to ${backupPath}.`);
    for (const assessment of inventory.assessments)
        await db.recursiveDelete(db.doc(assessment.path));
    for (const resource of inventory.resources)
        await db.recursiveDelete(db.doc(resource.path));
    for (const event of inventory.backup.events) {
        const eventId = event.path.split('/').at(-1);
        const eventReference = db.doc(event.path);
        for (const summary of (await eventReference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).get()).docs) {
            await db.recursiveDelete(summary.ref);
        }
        const cutoverAuditId = `m2-v3-cutover-${Date.now()}`;
        await eventReference.update({
            currentAssessmentId: firestore_1.FieldValue.delete(),
            currentResourceId: firestore_1.FieldValue.delete(),
        });
        await eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(cutoverAuditId).create({
            id: cutoverAuditId,
            eventId,
            action: 'assessment_schema_cutover',
            actorId: 'system',
            actorRole: 'system',
            timestamp: Date.now(),
            metadata: { from: 'legacy-ready', to: types_1.ASSESSMENT_SCHEMA_VERSION, backupPath },
        });
    }
    const failures = [];
    for (const eventId of inventory.pendingEventIds) {
        try {
            const result = await (0, onEventCreated_1.runRiskAndResourcePipeline)(eventId);
            if (result.status !== 'processed')
                failures.push({ eventId, error: result.reason ?? 'skipped' });
        }
        catch (error) {
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
    const eventsSnapshot = await db.collection(types_1.COLLECTIONS.EVENTS).get();
    const backup = {
        projectId,
        assessmentSchemaVersion: types_1.ASSESSMENT_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        events: [],
        assessments: [],
        resources: [],
        auditReferences: [],
    };
    const pendingEventIds = [];
    for (const eventDocument of eventsSnapshot.docs) {
        const event = { eventId: eventDocument.id, ...eventDocument.data() };
        backup.events.push({
            path: eventDocument.ref.path,
            updatedAt: event.updatedAt,
            ...(event.currentAssessmentId ? { currentAssessmentId: event.currentAssessmentId } : {}),
            ...(event.currentResourceId ? { currentResourceId: event.currentResourceId } : {}),
        });
        if (event.status === 'Pending' && event.currentVersionId)
            pendingEventIds.push(event.eventId);
        for (const document of (await eventDocument.ref.collection(types_1.COLLECTIONS.ASSESSMENTS).get()).docs) {
            backup.assessments.push({ path: document.ref.path, data: (0, firestoreBackupCodec_1.encodeFirestoreValue)(document.data()) });
        }
        for (const document of (await eventDocument.ref.collection(types_1.COLLECTIONS.RESOURCES).get()).docs) {
            backup.resources.push({ path: document.ref.path, data: (0, firestoreBackupCodec_1.encodeFirestoreValue)(document.data()) });
        }
        for (const document of (await eventDocument.ref.collection(types_1.COLLECTIONS.AUDIT_LOGS).get()).docs) {
            if (['risk_score_computed', 'resource_recommended'].includes(document.data().action)) {
                backup.auditReferences.push({ path: document.ref.path, data: (0, firestoreBackupCodec_1.encodeFirestoreValue)(document.data()) });
            }
        }
    }
    return { backup, events: backup.events, assessments: backup.assessments, resources: backup.resources, pendingEventIds };
}
async function verifyCutover() {
    const eventsSnapshot = await db.collection(types_1.COLLECTIONS.EVENTS).get();
    let legacyReady = 0;
    let danglingPointers = 0;
    for (const eventDocument of eventsSnapshot.docs) {
        const event = eventDocument.data();
        if (!event.currentAssessmentId)
            continue;
        const assessment = await eventDocument.ref.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).get();
        if (!assessment.exists)
            danglingPointers += 1;
        else if (assessment.data()?.status === 'ready' || assessment.data()?.schemaVersion !== types_1.ASSESSMENT_SCHEMA_VERSION)
            legacyReady += 1;
        if (event.currentResourceId) {
            const resource = await eventDocument.ref.collection(types_1.COLLECTIONS.RESOURCES).doc(event.currentResourceId).get();
            if (!resource.exists)
                danglingPointers += 1;
        }
    }
    return { legacyReady, danglingPointers };
}
async function restoreBackup(backupPath) {
    if (!node_path_1.default.isAbsolute(backupPath))
        throw new Error('--backup must be an absolute path.');
    const backup = JSON.parse(await (0, promises_1.readFile)(backupPath, 'utf8'));
    if (backup.projectId !== projectId)
        throw new Error('Backup project ID does not match --project.');
    const expectedAssessmentPaths = new Set(backup.assessments.map((document) => document.path));
    const expectedResourcePaths = new Set(backup.resources.map((document) => document.path));
    for (const event of backup.events) {
        const reference = db.doc(event.path);
        for (const document of (await reference.collection(types_1.COLLECTIONS.ASSESSMENTS).get()).docs) {
            if (!expectedAssessmentPaths.has(document.ref.path))
                await db.recursiveDelete(document.ref);
        }
        for (const document of (await reference.collection(types_1.COLLECTIONS.RESOURCES).get()).docs) {
            if (!expectedResourcePaths.has(document.ref.path))
                await db.recursiveDelete(document.ref);
        }
        for (const document of (await reference.collection(types_1.COLLECTIONS.ASSESSMENT_SUMMARIES).get()).docs) {
            await db.recursiveDelete(document.ref);
        }
    }
    for (const document of [...backup.assessments, ...backup.resources]) {
        const decoded = (0, firestoreBackupCodec_1.decodeFirestoreValue)(document.data, (referencePath) => db.doc(referencePath));
        await db.doc(document.path).set(decoded);
    }
    for (const event of backup.events) {
        await db.doc(event.path).update({
            currentAssessmentId: event.currentAssessmentId ?? firestore_1.FieldValue.delete(),
            currentResourceId: event.currentResourceId ?? firestore_1.FieldValue.delete(),
            updatedAt: event.updatedAt,
        });
    }
    console.info(`Restored ${backup.assessments.length} assessments and ${backup.resources.length} resources from ${backupPath}.`);
}
function parseArguments(values) {
    const parsed = new Map();
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!value.startsWith('--'))
            throw new Error(`Unexpected argument: ${value}`);
        const [rawKey, ...inlineValue] = value.slice(2).split('=');
        if (!rawKey)
            throw new Error('Empty option name is not allowed.');
        if (inlineValue.length > 0) {
            parsed.set(rawKey, inlineValue.join('='));
            continue;
        }
        const following = values[index + 1];
        if (following && !following.startsWith('--')) {
            parsed.set(rawKey, following);
            index += 1;
        }
        else {
            parsed.set(rawKey, 'true');
        }
    }
    return parsed;
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
//# sourceMappingURL=cutoverAssessmentV3.js.map