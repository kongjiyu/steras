import { createHash } from 'node:crypto';
import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  AuthorityType,
  COLLECTIONS,
  EventDetails,
  EventRecord,
  EventType,
  EventVersion,
} from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

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
  const db = firestore();
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const userReference = db.collection(COLLECTIONS.USERS).doc(uid);

  return db.runTransaction(async (transaction) => {
    const [userSnapshot, eventSnapshot] = await Promise.all([
      transaction.get(userReference),
      transaction.get(eventReference),
    ]);
    if (!userSnapshot.exists || userSnapshot.data()?.role !== 'organizer') {
      throw new HttpsError('permission-denied', 'Only organizer accounts can submit applications.');
    }
    if (!eventSnapshot.exists) throw new HttpsError('not-found', 'Event draft was not found.');
    const event = { eventId, ...eventSnapshot.data() } as EventRecord;
    if (event.organizerId !== uid) throw new HttpsError('permission-denied', 'You do not own this event.');
    if (!['Draft', 'AmendmentRequested'].includes(event.status)) {
      throw new HttpsError('failed-precondition', 'Only drafts or amendment requests can be submitted.');
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

    const inputHash = createHash('sha256').update(JSON.stringify({ eventDetails: event.eventDetails, documentPaths })).digest('hex');
    const version: EventVersion = {
      versionId,
      eventId,
      versionNumber,
      eventDetails: event.eventDetails,
      documentPaths,
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
      currentAssessmentId: firestore.FieldValue.delete(),
      currentResourceId: firestore.FieldValue.delete(),
      editableVersionId: null,
      requiredAuthorities,
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
  return errors;
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
