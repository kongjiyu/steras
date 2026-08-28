import { createHash } from 'node:crypto';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  AuthorityType,
  COLLECTIONS,
  EventDetails,
  EventRecord,
  EventRiskProfile,
  EventType,
  EventVersion,
  M1_DOCUMENT_SCHEMA_VERSION,
  M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  M1DocumentExtraction,
  M1DraftDocument,
  M1_EXTRACTION_SCHEMA_VERSION,
} from '@shared/types';
import { isValidM1TemplateSelection, m1CategoryForEventType, m1VenueSettingMatchesEnvironment } from '@shared/m1TemplateContract';
import { FUNCTION_REGION } from '../config/runtime';
import { RESOURCE_CUTOVER_LOCK_PATH } from '../config/resourceCutoverLock';
import { inspectStorageEvidence } from '../utils/storageEvidence';
import { validateDraftDocuments } from './extractApplicationDocuments';
import { validateM1EvidenceManifest } from '../engines/m1EvidenceManifest';
import { hasValidActiveRevision } from './applicationLifecycle';

export { isValidEvidenceMetadata } from '../utils/storageEvidence';

interface SubmitEventRequest {
  eventId?: string;
}

export const submitEvent = onCall<SubmitEventRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before submitting an event.');
  const eventId = request.data.eventId?.trim();
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  return submitEventForUser(request.auth.uid, eventId);
});

export async function submitEventForUser(uid: string, eventId: string, now = Date.now()) {
  const db = getFirestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userReference = db.collection(COLLECTIONS.USERS).doc(uid);
  const [preflightUser, preflightEvent, preflightLock] = await db.getAll(
    userReference,
    eventReference,
    db.doc(RESOURCE_CUTOVER_LOCK_PATH),
  );
  if (preflightLock.exists) throw new HttpsError('unavailable', 'Resource migration is in progress. Retry the submission shortly.');
  if (!preflightUser.exists || preflightUser.data()?.role !== 'organizer') throw new HttpsError('permission-denied', 'Only organizer accounts can submit applications.');
  if (!preflightEvent.exists) throw new HttpsError('not-found', 'Event draft was not found.');
  const preflight = { ...preflightEvent.data(), eventId } as EventRecord;
  if (preflight.organizerId !== uid) throw new HttpsError('permission-denied', 'You do not own this event.');
  if ((preflight.currentVersionNumber > 0 && !preflight.activeRevision)
    || (preflight.activeRevision && !hasValidActiveRevision(preflight))) {
    throw new HttpsError('failed-precondition', 'The application revision provenance is invalid.');
  }
  if (!isValidM1TemplateSelection(preflight.templateSelection)) {
    throw new HttpsError('failed-precondition', 'Choose a valid Core and scenario template before submitting.');
  }
  if (m1CategoryForEventType(preflight.eventDetails.type) !== preflight.templateSelection.eventCategory
    || !m1VenueSettingMatchesEnvironment(preflight.templateSelection.venueSetting, preflight.eventDetails.environment)) {
    throw new HttpsError('failed-precondition', 'The template recommendation no longer matches the event type or venue setting.');
  }
  const preflightVersionId = `v${(preflight.currentVersionNumber ?? 0) + 1}`;
  const preflightDocuments = preflight.documentSchemaVersion === M1_DOCUMENT_SCHEMA_VERSION
    ? validateDraftDocuments(eventId, preflightVersionId, preflight.draftDocuments)
    : undefined;
  const preflightExtraction = preflightDocuments
    ? await loadCurrentExtraction(preflight, eventReference)
    : undefined;
  const preflightEvidenceManifest = preflightDocuments
    ? validateCurrentEvidenceManifest(preflight, preflightDocuments)
    : undefined;
  await validateSubmissionAssets(eventId, preflightVersionId, preflight.draftDocumentPaths ?? []);
  await validateCanonicalVenue(preflight.eventDetails);
  const preflightFingerprint = submissionFingerprint(preflight);
  const venueReference = preflight.eventDetails.venueId
    ? db.collection(COLLECTIONS.VENUES).doc(preflight.eventDetails.venueId)
    : undefined;

  return db.runTransaction(async (transaction) => {
    const [userSnapshot, eventSnapshot, cutoverLockSnapshot, venueSnapshot] = await Promise.all([
      transaction.get(userReference),
      transaction.get(eventReference),
      transaction.get(db.doc(RESOURCE_CUTOVER_LOCK_PATH)),
      venueReference ? transaction.get(venueReference) : Promise.resolve(undefined),
    ]);
    if (cutoverLockSnapshot.exists) {
      throw new HttpsError('unavailable', 'Resource migration is in progress. Retry the submission shortly.');
    }
    if (!userSnapshot.exists || userSnapshot.data()?.role !== 'organizer') {
      throw new HttpsError('permission-denied', 'Only organizer accounts can submit applications.');
    }
    if (!eventSnapshot.exists) throw new HttpsError('not-found', 'Event draft was not found.');
    const event = { ...eventSnapshot.data(), eventId } as EventRecord;
    if (submissionFingerprint(event) !== preflightFingerprint) throw new HttpsError('aborted', 'The draft changed during submission. Review it and retry.');
    if (event.organizerId !== uid) throw new HttpsError('permission-denied', 'You do not own this event.');
    if (event.status !== 'Draft') {
      throw new HttpsError('failed-precondition', 'Only draft applications can be submitted. Rejected applications are final.');
    }
    if (!isValidM1TemplateSelection(event.templateSelection)) {
      throw new HttpsError('failed-precondition', 'Choose a valid Core and scenario template before submitting.');
    }
    if (m1CategoryForEventType(event.eventDetails.type) !== event.templateSelection.eventCategory
      || !m1VenueSettingMatchesEnvironment(event.templateSelection.venueSetting, event.eventDetails.environment)) {
      throw new HttpsError('failed-precondition', 'The template recommendation no longer matches the event type or venue setting.');
    }
    if (event.eventDetails.venueId && (!venueSnapshot?.exists
      || validateCanonicalVenueRecord(event.eventDetails, venueSnapshot.data()).length > 0)) {
      throw new HttpsError('failed-precondition', 'The selected venue changed during submission. Review the verified venue and retry.');
    }

    const errors = validateEventDetails(event.eventDetails, now);
    if (errors.length > 0) throw new HttpsError('invalid-argument', errors.join(' '));
    const versionNumber = (event.currentVersionNumber ?? 0) + 1;
    const versionId = `v${versionNumber}`;
    if (event.editableVersionId !== versionId) {
      throw new HttpsError('failed-precondition', 'The editable document version does not match the next submission version.');
    }
    const documentPaths = event.draftDocumentPaths ?? [];
    const allowedPrefix = `event_documents/${eventId}/${versionId}/`;
    if (documentPaths.some((path) => !path.startsWith(allowedPrefix))) {
      throw new HttpsError('invalid-argument', 'One or more uploaded document paths do not belong to this application version.');
    }

    const inputHash = createHash('sha256').update(JSON.stringify({
      eventDetails: event.eventDetails,
      templateSelection: event.templateSelection,
      documentPaths,
      documentUploads: preflightDocuments,
      extractionId: preflightExtraction?.extractionId,
      evidenceManifest: preflightEvidenceManifest,
      evidenceManifestSchemaVersion: preflight.evidenceManifestSchemaVersion,
      revisionSource: preflight.activeRevision,
    })).digest('hex');
    const version: EventVersion = {
      versionId,
      eventId,
      versionNumber,
      eventDetails: event.eventDetails,
      templateSelection: event.templateSelection,
      documentPaths,
      ...(preflightDocuments ? { documentUploads: preflightDocuments } : {}),
      ...(preflightExtraction ? { extractionId: preflightExtraction.extractionId } : {}),
      ...(preflightEvidenceManifest ? {
        evidenceManifest: preflightEvidenceManifest,
        evidenceManifestSchemaVersion: M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
      } : {}),
      ...(preflight.activeRevision ? { revisionSource: preflight.activeRevision } : {}),
      submittedBy: uid,
      submittedAt: now,
      inputHash,
    };
    const versionReference = eventReference.collection(COLLECTIONS.VERSIONS).doc(versionId);
    const versionSnapshot = await transaction.get(versionReference);
    if (versionSnapshot.exists) throw new HttpsError('already-exists', 'This application version has already been submitted.');

    const requiredAuthorities = requiredAuthoritiesFor(event.eventDetails);
    transaction.create(versionReference, version);
    transaction.update(eventReference, {
      status: 'Pending',
      currentVersionId: versionId,
      currentVersionNumber: versionNumber,
      currentAssessmentId: FieldValue.delete(),
      currentResourceId: FieldValue.delete(),
      authorityReviewCompletedAt: FieldValue.delete(),
      authorityReviewCompletedVersionId: FieldValue.delete(),
      editableVersionId: null,
      requiredAuthorities,
      assignedOfficerUids: [],
      assignedOfficerByAuthority: {},
      reviewStage: 'initial',
      initialReview: FieldValue.delete(),
      activeRevision: FieldValue.delete(),
      manualAssessment: FieldValue.delete(),
      verifiedControlIds: [],
      submittedAt: now,
      updatedAt: now,
    });
    const auditReference = eventReference.collection(COLLECTIONS.AUDIT_LOGS).doc(`${now}-submitted-${versionId}`);
    transaction.create(auditReference, {
      id: auditReference.id,
      eventId,
      versionId,
      action: 'event_submitted',
      actorId: uid,
      actorRole: 'organizer',
      timestamp: now,
      previousStatus: event.status,
      newStatus: 'Pending',
      metadata: { inputHash, documentCount: documentPaths.length, requiredAuthorities },
    });
    return { eventId, versionId, versionNumber, status: 'Pending' as const };
  });
}

export function validateEventDetails(value: unknown, now = Date.now()): string[] {
  if (!isRecord(value)) return ['Event details are required.'];
  const errors: string[] = [];
  requiredText(value.name, 'Event name', 200, errors);
  requiredText(value.venueName, 'Venue name', 200, errors);
  requiredText(value.venueAddress, 'Venue address', 500, errors);
  requiredText(value.organizerName, 'Organizer name', 200, errors);
  requiredText(value.organizerEmail, 'Organizer email', 320, errors);
  if (typeof value.organizerEmail === 'string' && value.organizerEmail.trim() && !isEmail(value.organizerEmail)) {
    errors.push('Organizer email is invalid.');
  }
  requiredText(value.organizerPhone, 'Organizer phone', 50, errors);
  requiredText(value.emergencyPlanSummary, 'Emergency-plan summary', 2_000, errors);
  optionalText(value.description, 'Description', 2_000, errors);
  if (!EVENT_TYPES.has(value.type as EventType)) errors.push('Event type is invalid.');
  if (!ENVIRONMENTS.has(value.environment as string)) errors.push('Environment is invalid.');
  if (!COVERAGE.has(value.coverage as string)) errors.push('Coverage is invalid.');
  if (!SEATING.has(value.seating as string)) errors.push('Seating is invalid.');
  positiveInteger(value.venueCapacity, 'Venue capacity', errors);
  positiveInteger(value.expectedAttendance, 'Expected attendance', errors);
  if (Number.isInteger(value.venueCapacity) && Number.isInteger(value.expectedAttendance)
    && (value.expectedAttendance as number) > (value.venueCapacity as number)) {
    errors.push('Expected attendance cannot exceed venue capacity.');
  }
  if (!isRecord(value.venueLocation) || !validCoordinate(value.venueLocation.lat, -90, 90) || !validCoordinate(value.venueLocation.lng, -180, 180)) {
    errors.push('Valid venue coordinates are required.');
  }
  if (typeof value.startDatetime !== 'number' || !Number.isFinite(value.startDatetime) || value.startDatetime <= now) errors.push('Start datetime must be in the future.');
  if (typeof value.endDatetime !== 'number' || !Number.isFinite(value.endDatetime)
    || typeof value.startDatetime !== 'number' || !Number.isFinite(value.startDatetime)
    || value.endDatetime <= value.startDatetime) {
    errors.push('End datetime must be after the start datetime.');
  }
  validateRiskProfile(value.riskProfile, errors);
  return errors;
}

const RISK_BOOLEAN_FIELDS = [
  'internationalAttendees', 'alcoholServed', 'foodServed', 'freeDrinkingWater', 'ticketedEntry',
  'overnightAccommodation', 'pyrotechnics', 'temporaryStructures', 'rivalryOrTensionExpected',
  'crowdManagementPlan', 'trafficManagementPlan', 'severeWeatherPlan', 'medicalPlan',
  'evacuationPlanTested', 'authorityCoordinationConfirmed',
] as const satisfies readonly (keyof EventRiskProfile)[];
const RISK_PROFILE_FIELDS = new Set<string>([
  'vulnerableAttendeesPercent', 'standingAttendeesPercent', 'nearestHospitalTravelMinutes', ...RISK_BOOLEAN_FIELDS,
]);

function validateRiskProfile(value: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push('A complete all-hazards profile is required.'); return; }
  const unknown = Object.keys(value).filter((key) => !RISK_PROFILE_FIELDS.has(key));
  if (unknown.length) errors.push(`All-hazards profile contains unsupported fields: ${unknown.join(', ')}.`);
  for (const key of RISK_BOOLEAN_FIELDS) if (typeof value[key] !== 'boolean') errors.push(`${key} must be answered true or false.`);
  boundedNumber(value.vulnerableAttendeesPercent, 'Vulnerable attendees percent', 0, 100, errors);
  boundedNumber(value.standingAttendeesPercent, 'Standing attendees percent', 0, 100, errors);
  if (value.nearestHospitalTravelMinutes !== undefined) boundedNumber(value.nearestHospitalTravelMinutes, 'Nearest hospital travel time', 0, 240, errors);
}

async function validateSubmissionAssets(eventId: string, versionId: string, paths: string[]): Promise<void> {
  const pathErrors = validateEvidencePaths(eventId, versionId, paths);
  if (pathErrors.length > 0) throw new HttpsError('invalid-argument', pathErrors.join(' '));
  const inspections = await inspectStorageEvidence(paths);
  const missing = inspections.find((item) => item.status === 'missing');
  if (missing) throw new HttpsError('failed-precondition', `Supporting evidence is missing from Storage: ${missing.path}.`);
  if (inspections.some((item) => item.status !== 'eligible')) {
    throw new HttpsError('invalid-argument', 'Application documents must be non-empty DOCX, PDF, JPEG, PNG, or WebP files no larger than 10 MB.');
  }
}

async function validateCanonicalVenue(details: EventDetails): Promise<void> {
  if (!details.venueId) return;
  const snapshot = await getFirestore().collection(COLLECTIONS.VENUES).doc(details.venueId).get();
  if (!snapshot.exists || snapshot.data()?.active !== true || snapshot.data()?.verificationStatus !== 'verified' || snapshot.data()?.deactivatedAt !== undefined) {
    throw new HttpsError('failed-precondition', 'The selected venue is not an active verified registry venue.');
  }
  if (validateCanonicalVenueRecord(details, snapshot.data()).length > 0) {
    throw new HttpsError('failed-precondition', 'The submitted venue identity does not match the verified registry record.');
  }
}

export function validateEvidencePaths(eventId: string, versionId: string, paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 20 || new Set(paths).size !== paths.length) {
    return ['Submit between 1 and 20 unique supporting evidence files.'];
  }
  const prefix = `event_documents/${eventId}/${versionId}/`;
  return paths.some((path) => typeof path !== 'string' || !path.startsWith(prefix) || path.length > 1_024)
    ? ['One or more uploaded document paths do not belong to this application version.']
    : [];
}

export function validateCanonicalVenueRecord(details: EventDetails, value: unknown): string[] {
  if (!isRecord(value) || value.active !== true || value.verificationStatus !== 'verified' || value.deactivatedAt !== undefined) {
    return ['The selected venue is not an active verified registry venue.'];
  }
  const location = isRecord(value.location) ? value.location : {};
  const canonicalCapacity = value.verifiedSafeCapacity ?? value.capacity;
  return normalizeText(details.venueName) !== normalizeText(value.name)
    || normalizeText(details.venueAddress) !== normalizeText(value.address)
    || details.venueCapacity !== canonicalCapacity
    || !sameCoordinate(details.venueLocation?.lat, location.lat)
    || !sameCoordinate(details.venueLocation?.lng, location.lng)
    ? ['The submitted venue identity does not match the verified registry record.']
    : [];
}

function submissionFingerprint(event: EventRecord): string {
  return createHash('sha256').update(JSON.stringify({
    status: event.status,
    currentVersionNumber: event.currentVersionNumber,
    editableVersionId: event.editableVersionId,
    eventDetails: event.eventDetails,
    templateSelection: event.templateSelection,
    documentPaths: event.draftDocumentPaths,
    documentUploads: event.draftDocuments,
    documentSchemaVersion: event.documentSchemaVersion,
    currentExtractionId: event.currentExtractionId,
    evidenceManifest: event.draftEvidenceManifest,
    evidenceManifestSchemaVersion: event.evidenceManifestSchemaVersion,
    activeRevision: event.activeRevision,
  })).digest('hex');
}

function validateCurrentEvidenceManifest(event: EventRecord, documents: M1DraftDocument[]) {
  if (event.evidenceManifestSchemaVersion !== M1_EVIDENCE_MANIFEST_SCHEMA_VERSION || !event.templateSelection) {
    throw new HttpsError('failed-precondition', 'Complete the current supporting-evidence checklist before submission.');
  }
  const result = validateM1EvidenceManifest(event.eventDetails, event.templateSelection, documents, event.draftEvidenceManifest);
  if (result.errors.length > 0) throw new HttpsError('failed-precondition', result.errors.join(' '));
  return result.manifest;
}

async function loadCurrentExtraction(
  event: EventRecord,
  eventReference: FirebaseFirestore.DocumentReference,
): Promise<M1DocumentExtraction> {
  if (!event.currentExtractionId || !/^[A-Za-z0-9_-]{1,128}$/.test(event.currentExtractionId)) {
    throw new HttpsError('failed-precondition', 'Extract and review the completed Core and scenario DOCX files before submission.');
  }
  const snapshot = await eventReference.collection(COLLECTIONS.DOCUMENT_EXTRACTIONS).doc(event.currentExtractionId).get();
  if (!snapshot.exists) throw new HttpsError('failed-precondition', 'The current document extraction could not be found. Extract the files again.');
  const extraction = snapshot.data() as M1DocumentExtraction;
  const expectedPaths = (event.draftDocuments ?? [])
    .filter((document) => document.role === 'core_template' || document.role === 'scenario_template')
    .map((document) => `${document.role}:${document.path}:${document.originalName}:${document.mimeType}:${document.sizeBytes}`)
    .sort();
  const actualPaths = Array.isArray(extraction.sourceDocuments)
    ? extraction.sourceDocuments.map((document) => `${document.role}:${document.path}:${document.originalName}:${document.mimeType}:${document.sizeBytes}`).sort()
    : [];
  if (extraction.extractionId !== event.currentExtractionId
    || extraction.eventId !== event.eventId
    || extraction.editableVersionId !== event.editableVersionId
    || extraction.schemaVersion !== M1_EXTRACTION_SCHEMA_VERSION
    || extraction.templateRegistryVersion !== event.templateSelection?.templateRegistryVersion
    || extraction.coreTemplateId !== event.templateSelection?.coreTemplateId
    || extraction.scenarioTemplateId !== event.templateSelection?.scenarioTemplateId
    || !['ready', 'needs_review'].includes(extraction.status)
    || JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new HttpsError('failed-precondition', 'The document extraction is stale or does not match the current Draft files. Extract the files again.');
  }
  return extraction;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

function sameCoordinate(left: unknown, right: unknown): boolean {
  return typeof left === 'number' && Number.isFinite(left) && typeof right === 'number' && Number.isFinite(right) && Math.abs(left - right) <= 0.00001;
}

function boundedNumber(value: unknown, label: string, min: number, max: number, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) errors.push(`${label} must be between ${min} and ${max}.`);
}

export function requiredAuthoritiesFor(details: EventDetails): AuthorityType[] {
  const authorities = new Set<AuthorityType>(['PDRM', 'BOMBA', 'KKM']);
  if (['festival', 'cultural', 'religious'].includes(details.type)) authorities.add('MOTAC');
  if (/kuala lumpur|\bkl\b/i.test(details.venueAddress)) authorities.add('DBKL');
  return [...authorities];
}

const EVENT_TYPES = new Set<EventType>(['concert', 'festival', 'sports', 'cultural', 'religious', 'exhibition', 'fair', 'conference', 'other']);
const ENVIRONMENTS = new Set(['indoor', 'outdoor', 'mixed']);
const COVERAGE = new Set(['covered', 'partially_covered', 'uncovered']);
const SEATING = new Set(['seated', 'standing', 'mixed']);

function requiredText(value: unknown, label: string, max: number, errors: string[]) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) errors.push(`${label} is required and must be at most ${max} characters.`);
}

function optionalText(value: unknown, label: string, max: number, errors: string[]) {
  if (value !== undefined && (typeof value !== 'string' || value.length > max)) errors.push(`${label} must be at most ${max} characters.`);
}

function positiveInteger(value: unknown, label: string, errors: string[]) {
  if (!Number.isInteger(value) || (value as number) <= 0) errors.push(`${label} must be a positive integer.`);
}

function validCoordinate(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
