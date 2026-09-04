import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  EventRecord,
  M1_DOCUMENT_SCHEMA_VERSION,
  M1DraftDocument,
  M1DocumentExtraction,
  M1_EXTRACTION_SCHEMA_VERSION,
  M1_TEMPLATE_REGISTRY_VERSION,
} from '@shared/types';
import { isValidM1TemplateSelection } from '@shared/m1TemplateContract';
import { FUNCTION_REGION } from '../config/runtime';
import { mapM1Documents, parseM1Docx, parseM1Pdf, validateCombinedTemplateIdentity, validateTemplateIdentity } from '../engines/m1DocumentExtractor';

interface ExtractApplicationDocumentsRequest {
  eventId?: string;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const APPLICATION_MIME_TYPES = new Set([DOCX_MIME, PDF_MIME]);
const MAX_DOCX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_ROLES = new Set(['core_template', 'scenario_template', 'combined_application', 'supporting_evidence']);
const EVIDENCE_MIME_TYPES = new Set([PDF_MIME, DOCX_MIME, 'image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_KEYS = new Set(['path', 'role', 'originalName', 'mimeType', 'sizeBytes', 'uploadedAt', 'schemaVersion']);

export const extractApplicationDocuments = onCall<ExtractApplicationDocumentsRequest>(
  { region: FUNCTION_REGION, memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before extracting application documents.');
    const eventId = request.data.eventId?.trim() ?? '';
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new HttpsError('invalid-argument', 'A valid eventId is required.');
    return extractApplicationDocumentsForUser(request.auth.uid, eventId);
  },
);

export async function extractApplicationDocumentsForUser(uid: string, eventId: string, now = Date.now()): Promise<M1DocumentExtraction> {
  const db = getFirestore();
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const [eventSnapshot, userSnapshot] = await Promise.all([
    eventRef.get(),
    db.collection(COLLECTIONS.USERS).doc(uid).get(),
  ]);
  if (!userSnapshot.exists || userSnapshot.data()?.role !== 'organizer') {
    throw new HttpsError('permission-denied', 'Only organizer accounts can extract application documents.');
  }
  if (!eventSnapshot.exists) throw new HttpsError('not-found', 'Event Draft was not found.');
  const event = { ...eventSnapshot.data(), eventId } as EventRecord;
  if (event.organizerId !== uid) throw new HttpsError('permission-denied', 'You do not own this event.');
  if (event.status !== 'Draft' || !event.editableVersionId) {
    throw new HttpsError('failed-precondition', 'Only the current Draft generation can be extracted.');
  }
  if (!isValidM1TemplateSelection(event.templateSelection)) {
    throw new HttpsError('failed-precondition', 'Choose a current Core and scenario template first.');
  }
  const documents = validateDraftDocuments(eventId, event.editableVersionId, event.draftDocuments);
  const combined = documents.find((document) => document.role === 'combined_application');
  const applicationDocuments = combined
    ? [combined]
    : [
      documents.find((document) => document.role === 'core_template')!,
      documents.find((document) => document.role === 'scenario_template')!,
    ];
  const inspected = await Promise.all(applicationDocuments.map(downloadApplicationDocument));
  let parsed: Awaited<ReturnType<typeof parseM1Docx>>[];
  try {
    parsed = await Promise.all(inspected.map((item) => item.document.mimeType === PDF_MIME
      ? parseM1Pdf(item.buffer)
      : parseM1Docx(item.buffer)));
  } catch (error) {
    throw new HttpsError('invalid-argument', error instanceof Error ? error.message : 'The application document could not be extracted.');
  }
  const [parsedCore, parsedScenario] = combined ? [parsed[0], parsed[0]] : [parsed[0], parsed[1]];
  const identityErrors = combined
    ? validateCombinedTemplateIdentity(parsed[0], event.templateSelection.scenarioTemplateId)
    : validateTemplateIdentity(parsedCore, parsedScenario, event.templateSelection.scenarioTemplateId);
  if (identityErrors.length > 0) throw new HttpsError('invalid-argument', identityErrors.join(' '));
  const mapped = mapM1Documents(parsedCore, parsedScenario);
  const sourceDocuments = inspected.map((item) => ({
    path: item.document.path,
    role: item.document.role as 'core_template' | 'scenario_template' | 'combined_application',
    originalName: item.document.originalName,
    mimeType: item.document.mimeType,
    sizeBytes: item.document.sizeBytes,
    sha256: item.sha256,
  }));
  const extractionId = `extract_${createHash('sha256').update(JSON.stringify({
    eventId,
    editableVersionId: event.editableVersionId,
    templateSelection: event.templateSelection,
    sourceDocuments,
    schemaVersion: M1_EXTRACTION_SCHEMA_VERSION,
  })).digest('hex').slice(0, 32)}`;
  const extraction: M1DocumentExtraction = {
    extractionId,
    eventId,
    editableVersionId: event.editableVersionId,
    status: mapped.warnings.length === 0 ? 'ready' : 'needs_review',
    schemaVersion: M1_EXTRACTION_SCHEMA_VERSION,
    templateRegistryVersion: M1_TEMPLATE_REGISTRY_VERSION,
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
  const extractionRef = eventRef.collection(COLLECTIONS.DOCUMENT_EXTRACTIONS).doc(extractionId);
  const auditRef = eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${extractionId}_created`);
  await db.runTransaction(async (transaction) => {
    const [currentEventSnapshot, currentExtractionSnapshot, auditSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(extractionRef),
      transaction.get(auditRef),
    ]);
    if (!currentEventSnapshot.exists) throw new HttpsError('not-found', 'Event Draft was not found.');
    const currentEvent = { ...currentEventSnapshot.data(), eventId } as EventRecord;
    if (currentEvent.organizerId !== uid
      || currentEvent.status !== 'Draft'
      || currentEvent.editableVersionId !== event.editableVersionId
      || draftDocumentFingerprint(currentEvent.draftDocuments) !== draftDocumentFingerprint(event.draftDocuments)
      || JSON.stringify(currentEvent.templateSelection) !== JSON.stringify(event.templateSelection)) {
      throw new HttpsError('aborted', 'The Draft changed during extraction. Review the current files and retry.');
    }
    if (!currentExtractionSnapshot.exists) transaction.create(extractionRef, extraction);
    transaction.update(eventRef, { currentExtractionId: extractionId, updatedAt: now });
    if (!auditSnapshot.exists) transaction.create(auditRef, {
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

export function validateDraftDocuments(eventId: string, versionId: string, value: unknown): M1DraftDocument[] {
  if (!Array.isArray(value)) throw new HttpsError('failed-precondition', 'Upload a combined application PDF/DOCX or the completed Core and scenario PDF/DOCX files before extraction.');
  const documents = value as M1DraftDocument[];
  if (documents.length < 1) throw new HttpsError('failed-precondition', 'Upload a combined application PDF/DOCX or the two completed PDF/DOCX files.');
  if (documents.length > 20) throw new HttpsError('failed-precondition', 'The Draft document list exceeds the 20-file limit.');
  const coreCount = documents.filter((document) => document?.role === 'core_template').length;
  const scenarioCount = documents.filter((document) => document?.role === 'scenario_template').length;
  const combinedCount = documents.filter((document) => document?.role === 'combined_application').length;
  const splitValid = combinedCount === 0 && coreCount === 1 && scenarioCount === 1;
  const combinedValid = combinedCount === 1 && coreCount === 0 && scenarioCount === 0;
  if (!splitValid && !combinedValid) {
    throw new HttpsError('failed-precondition', 'Use either one combined application PDF/DOCX or exactly one completed Core PDF/DOCX and one completed scenario PDF/DOCX.');
  }
  const paths = new Set<string>();
  for (const document of documents) {
    const prefix = `event_documents/${eventId}/${versionId}/`;
    const fileName = typeof document?.path === 'string' && document.path.startsWith(prefix)
      ? document.path.slice(prefix.length)
      : '';
    if (!document || typeof document !== 'object'
      || Object.keys(document).some((key) => !DOCUMENT_KEYS.has(key))
      || document.schemaVersion !== M1_DOCUMENT_SCHEMA_VERSION
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
      throw new HttpsError('invalid-argument', 'Draft document metadata is invalid.');
    }
    paths.add(document.path);
    if (document.role !== 'supporting_evidence' && !isApplicationDocumentFormat(document)) {
      throw new HttpsError('invalid-argument', 'Completed application documents must be PDF or DOCX files with matching file extensions.');
    }
    if (document.role === 'supporting_evidence' && !EVIDENCE_MIME_TYPES.has(document.mimeType)) {
      throw new HttpsError('invalid-argument', 'Supporting evidence metadata must identify a PDF, DOCX, JPEG, PNG, or WebP file.');
    }
  }
  return documents;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

async function downloadApplicationDocument(document: M1DraftDocument): Promise<{ document: M1DraftDocument; buffer: Buffer; sha256: string }> {
  const file = getStorage().bucket().file(document.path);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('failed-precondition', `The uploaded document is missing: ${document.originalName}.`);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (!APPLICATION_MIME_TYPES.has(document.mimeType) || metadata.contentType !== document.mimeType
    || !Number.isSafeInteger(size) || size <= 0 || size > MAX_DOCX_BYTES
    || size !== document.sizeBytes) {
    throw new HttpsError('invalid-argument', `Storage metadata does not match ${document.originalName}.`);
  }
  const [buffer] = await file.download();
  return { document, buffer, sha256: createHash('sha256').update(buffer).digest('hex') };
}

function isApplicationDocumentFormat(document: M1DraftDocument): boolean {
  const lowerName = document.originalName.toLocaleLowerCase();
  return (document.mimeType === PDF_MIME && lowerName.endsWith('.pdf'))
    || (document.mimeType === DOCX_MIME && lowerName.endsWith('.docx'));
}

function draftDocumentFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}
