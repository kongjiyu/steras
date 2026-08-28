"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractApplicationDocuments = void 0;
exports.extractApplicationDocumentsForUser = extractApplicationDocumentsForUser;
exports.validateDraftDocuments = validateDraftDocuments;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const storage_1 = require("firebase-admin/storage");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const m1TemplateContract_1 = require("../../../shared/m1TemplateContract");
const runtime_1 = require("../config/runtime");
const m1DocumentExtractor_1 = require("../engines/m1DocumentExtractor");
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOCX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_ROLES = new Set(['core_template', 'scenario_template', 'supporting_evidence']);
const EVIDENCE_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_KEYS = new Set(['path', 'role', 'originalName', 'mimeType', 'sizeBytes', 'uploadedAt', 'schemaVersion']);
exports.extractApplicationDocuments = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION, memory: '512MiB', timeoutSeconds: 60 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before extracting application documents.');
    const eventId = request.data.eventId?.trim() ?? '';
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId))
        throw new https_1.HttpsError('invalid-argument', 'A valid eventId is required.');
    return extractApplicationDocumentsForUser(request.auth.uid, eventId);
});
async function extractApplicationDocumentsForUser(uid, eventId, now = Date.now()) {
    const db = (0, firestore_1.getFirestore)();
    const eventRef = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const [eventSnapshot, userSnapshot] = await Promise.all([
        eventRef.get(),
        db.collection(types_1.COLLECTIONS.USERS).doc(uid).get(),
    ]);
    if (!userSnapshot.exists || userSnapshot.data()?.role !== 'organizer') {
        throw new https_1.HttpsError('permission-denied', 'Only organizer accounts can extract application documents.');
    }
    if (!eventSnapshot.exists)
        throw new https_1.HttpsError('not-found', 'Event Draft was not found.');
    const event = { ...eventSnapshot.data(), eventId };
    if (event.organizerId !== uid)
        throw new https_1.HttpsError('permission-denied', 'You do not own this event.');
    if (event.status !== 'Draft' || !event.editableVersionId) {
        throw new https_1.HttpsError('failed-precondition', 'Only the current Draft generation can be extracted.');
    }
    if (!(0, m1TemplateContract_1.isValidM1TemplateSelection)(event.templateSelection)) {
        throw new https_1.HttpsError('failed-precondition', 'Choose a current Core and scenario template first.');
    }
    const documents = validateDraftDocuments(eventId, event.editableVersionId, event.draftDocuments);
    const core = documents.find((document) => document.role === 'core_template');
    const scenario = documents.find((document) => document.role === 'scenario_template');
    const inspected = await Promise.all([core, scenario].map(downloadDocx));
    const [parsedCore, parsedScenario] = await Promise.all(inspected.map((item) => (0, m1DocumentExtractor_1.parseM1Docx)(item.buffer)));
    const identityErrors = (0, m1DocumentExtractor_1.validateTemplateIdentity)(parsedCore, parsedScenario, event.templateSelection.scenarioTemplateId);
    if (identityErrors.length > 0)
        throw new https_1.HttpsError('invalid-argument', identityErrors.join(' '));
    const mapped = (0, m1DocumentExtractor_1.mapM1Documents)(parsedCore, parsedScenario);
    const sourceDocuments = inspected.map((item) => ({
        path: item.document.path,
        role: item.document.role,
        originalName: item.document.originalName,
        mimeType: item.document.mimeType,
        sizeBytes: item.document.sizeBytes,
        sha256: item.sha256,
    }));
    const extractionId = `extract_${(0, node_crypto_1.createHash)('sha256').update(JSON.stringify({
        eventId,
        editableVersionId: event.editableVersionId,
        templateSelection: event.templateSelection,
        sourceDocuments,
        schemaVersion: types_1.M1_EXTRACTION_SCHEMA_VERSION,
    })).digest('hex').slice(0, 32)}`;
    const extraction = {
        extractionId,
        eventId,
        editableVersionId: event.editableVersionId,
        status: mapped.warnings.length === 0 ? 'ready' : 'needs_review',
        schemaVersion: types_1.M1_EXTRACTION_SCHEMA_VERSION,
        templateRegistryVersion: types_1.M1_TEMPLATE_REGISTRY_VERSION,
        coreTemplateId: event.templateSelection.coreTemplateId,
        scenarioTemplateId: event.templateSelection.scenarioTemplateId,
        sourceDocuments,
        extractedFields: mapped.extractedFields,
        rawFieldIds: [...new Set([...parsedCore.fields.keys(), ...parsedScenario.fields.keys()])].sort(),
        warnings: mapped.warnings,
        completionPercent: mapped.completionPercent,
        createdAt: now,
        createdBy: uid,
    };
    const extractionRef = eventRef.collection(types_1.COLLECTIONS.DOCUMENT_EXTRACTIONS).doc(extractionId);
    const auditRef = eventRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${extractionId}_created`);
    await db.runTransaction(async (transaction) => {
        const [currentEventSnapshot, currentExtractionSnapshot, auditSnapshot] = await Promise.all([
            transaction.get(eventRef),
            transaction.get(extractionRef),
            transaction.get(auditRef),
        ]);
        if (!currentEventSnapshot.exists)
            throw new https_1.HttpsError('not-found', 'Event Draft was not found.');
        const currentEvent = { ...currentEventSnapshot.data(), eventId };
        if (currentEvent.organizerId !== uid
            || currentEvent.status !== 'Draft'
            || currentEvent.editableVersionId !== event.editableVersionId
            || draftDocumentFingerprint(currentEvent.draftDocuments) !== draftDocumentFingerprint(event.draftDocuments)
            || JSON.stringify(currentEvent.templateSelection) !== JSON.stringify(event.templateSelection)) {
            throw new https_1.HttpsError('aborted', 'The Draft changed during extraction. Review the current files and retry.');
        }
        if (!currentExtractionSnapshot.exists)
            transaction.create(extractionRef, extraction);
        transaction.update(eventRef, { currentExtractionId: extractionId, updatedAt: now });
        if (!auditSnapshot.exists)
            transaction.create(auditRef, {
                id: auditRef.id,
                eventId,
                action: 'application_documents_extracted',
                actorId: uid,
                actorRole: 'organizer',
                timestamp: now,
                previousStatus: 'Draft',
                newStatus: 'Draft',
                metadata: { extractionId, completionPercent: mapped.completionPercent, warningCount: mapped.warnings.length },
            });
    });
    return extraction;
}
function validateDraftDocuments(eventId, versionId, value) {
    if (!Array.isArray(value))
        throw new https_1.HttpsError('failed-precondition', 'Upload the completed Core and scenario DOCX files before extraction.');
    const documents = value;
    if (documents.length < 2)
        throw new https_1.HttpsError('failed-precondition', 'Upload exactly one completed Core DOCX and one completed scenario DOCX.');
    if (documents.length > 20)
        throw new https_1.HttpsError('failed-precondition', 'The Draft document list exceeds the 20-file limit.');
    const roles = documents.filter((document) => document?.role === 'core_template' || document?.role === 'scenario_template');
    if (roles.filter((document) => document.role === 'core_template').length !== 1
        || roles.filter((document) => document.role === 'scenario_template').length !== 1) {
        throw new https_1.HttpsError('failed-precondition', 'Upload exactly one completed Core DOCX and one completed scenario DOCX.');
    }
    const paths = new Set();
    for (const document of documents) {
        const prefix = `event_documents/${eventId}/${versionId}/`;
        const fileName = typeof document?.path === 'string' && document.path.startsWith(prefix)
            ? document.path.slice(prefix.length)
            : '';
        if (!document || typeof document !== 'object'
            || Object.keys(document).some((key) => !DOCUMENT_KEYS.has(key))
            || document.schemaVersion !== types_1.M1_DOCUMENT_SCHEMA_VERSION
            || !DOCUMENT_ROLES.has(document.role)
            || typeof document.path !== 'string'
            || !document.path.startsWith(prefix)
            || !/^[A-Za-z0-9._-]{1,200}$/.test(fileName)
            || paths.has(document.path)
            || typeof document.originalName !== 'string'
            || document.originalName.trim() !== document.originalName
            || document.originalName.length < 1 || document.originalName.length > 255
            || hasControlCharacter(document.originalName)
            || typeof document.mimeType !== 'string'
            || !Number.isSafeInteger(document.sizeBytes) || document.sizeBytes <= 0 || document.sizeBytes > MAX_DOCX_BYTES
            || !Number.isSafeInteger(document.uploadedAt) || document.uploadedAt <= 0) {
            throw new https_1.HttpsError('invalid-argument', 'Draft document metadata is invalid.');
        }
        paths.add(document.path);
        if ((document.role === 'core_template' || document.role === 'scenario_template')
            && (document.mimeType !== DOCX_MIME || !document.originalName.toLocaleLowerCase().endsWith('.docx'))) {
            throw new https_1.HttpsError('invalid-argument', 'Completed application templates must be DOCX files.');
        }
        if (document.role === 'supporting_evidence' && !EVIDENCE_MIME_TYPES.has(document.mimeType)) {
            throw new https_1.HttpsError('invalid-argument', 'Supporting evidence metadata must identify a PDF, JPEG, PNG, or WebP file.');
        }
    }
    return documents;
}
function hasControlCharacter(value) {
    return [...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
    });
}
async function downloadDocx(document) {
    const file = (0, storage_1.getStorage)().bucket().file(document.path);
    const [exists] = await file.exists();
    if (!exists)
        throw new https_1.HttpsError('failed-precondition', `The uploaded document is missing: ${document.originalName}.`);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (metadata.contentType !== DOCX_MIME || !Number.isSafeInteger(size) || size <= 0 || size > MAX_DOCX_BYTES
        || size !== document.sizeBytes) {
        throw new https_1.HttpsError('invalid-argument', `Storage metadata does not match ${document.originalName}.`);
    }
    const [buffer] = await file.download();
    return { document, buffer, sha256: (0, node_crypto_1.createHash)('sha256').update(buffer).digest('hex') };
}
function draftDocumentFingerprint(value) {
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}
//# sourceMappingURL=extractApplicationDocuments.js.map