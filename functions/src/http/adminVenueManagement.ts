import { createHash } from 'node:crypto';
import { getFirestore, type DocumentData } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, UserProfile, Venue } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

const VENUE_FIELDS = new Set([
  'venueId', 'expectedRevision', 'idempotencyKey', 'name', 'address', 'state', 'jurisdiction',
  'capacity', 'location', 'verifiedSafeCapacity', 'fireCertificateStatus', 'fireCertificateExpiresAt',
  'nearestHospitalTravelMinutes', 'emergencyAccessVerified', 'riskNotes',
]);
const COMMAND_FIELDS = new Set(['venueId', 'expectedRevision', 'idempotencyKey']);

export interface VenueRegistryInput {
  name: string;
  address: string;
  state: string;
  jurisdiction: string;
  capacity: number;
  location: { lat: number; lng: number };
  verifiedSafeCapacity?: number;
  fireCertificateStatus?: NonNullable<Venue['fireCertificateStatus']>;
  fireCertificateExpiresAt?: number;
  nearestHospitalTravelMinutes?: number;
  emergencyAccessVerified?: boolean;
  riskNotes?: string;
}

interface VenueMutation extends VenueRegistryInput {
  venueId?: string;
  expectedRevision?: number;
  idempotencyKey: string;
}

export const saveVenue = onCall({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before managing venues.');
  const actorId = request.auth.uid;
  const db = getFirestore();
  await requireAdmin(actorId);
  const input = validateVenueMutation(request.data);
  const venueId = input.venueId ?? createHash('sha256').update(`${actorId}:${input.idempotencyKey}`).digest('hex').slice(0, 24);
  const venueRef = db.collection(COLLECTIONS.VENUES).doc(venueId);
  const operation = operationMetadata(actorId, input.idempotencyKey, 'save_venue', { ...input, venueId });
  const operationRef = db.collection(COLLECTIONS.ADMIN_OPERATIONS).doc(operation.operationId);
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const [venueSnapshot, operationSnapshot] = await Promise.all([
      transaction.get(venueRef), transaction.get(operationRef),
    ]);
    if (operationSnapshot.exists) return replayOperation(operationSnapshot.data(), operation, venueId);
    const existing = venueSnapshot.data() as Venue | undefined;
    if (!input.venueId && venueSnapshot.exists) throw new HttpsError('already-exists', 'The generated venue record already exists.');
    if (input.venueId && !existing) throw new HttpsError('not-found', 'Venue was not found.');
    if (existing && existing.active === false) throw new HttpsError('failed-precondition', 'A deactivated venue cannot be edited.');
    const currentRevision = existing?.revision ?? 0;
    if (input.venueId && input.expectedRevision !== currentRevision) throw new HttpsError('aborted', 'The venue changed. Refresh and try again.');
    const revision = currentRevision + 1;
    const replacementFields = venueFields(input);
    const record: Venue = {
      ...(existing ?? {}),
      venueId,
      active: true,
      ...replacementFields,
      verificationStatus: 'unverified',
      revision,
      createdBy: existing?.createdBy ?? actorId,
      createdAt: existing?.createdAt ?? now,
      updatedBy: actorId,
      updatedAt: now,
    };
    // Optional registry facts use replacement semantics. Clearing a field in
    // the Admin form must not silently preserve stale verified information.
    for (const key of ['verifiedSafeCapacity', 'fireCertificateStatus', 'fireCertificateExpiresAt', 'nearestHospitalTravelMinutes', 'emergencyAccessVerified', 'riskNotes'] as const) {
      if (!(key in replacementFields)) delete record[key];
    }
    delete record.verifiedBy;
    delete record.verifiedAt;
    transaction.set(venueRef, record);
    transaction.create(operationRef, { ...operation, targetId: venueId, revision, createdAt: now });
    const auditRef = venueRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${revision}-saved-${operation.operationId.slice(0, 12)}`);
    transaction.create(auditRef, {
      auditId: auditRef.id, action: existing ? 'venue_updated' : 'venue_created', actorId,
      venueId, revision, timestamp: now,
    });
    return { venueId, revision, verificationStatus: 'unverified' as const, idempotent: false };
  });
});

export const verifyVenue = onCall({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before verifying venues.');
  await requireAdmin(request.auth.uid);
  const input = validateVenueCommand(request.data);
  return updateVenueState(request.auth.uid, input, 'verify');
});

export const deactivateVenue = onCall({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before deactivating venues.');
  await requireAdmin(request.auth.uid);
  const input = validateVenueCommand(request.data);
  return updateVenueState(request.auth.uid, input, 'deactivate');
});

async function updateVenueState(actorId: string, input: VenueCommand, action: 'verify' | 'deactivate') {
  const db = getFirestore();
  const venueRef = db.collection(COLLECTIONS.VENUES).doc(input.venueId);
  const operation = operationMetadata(actorId, input.idempotencyKey, `${action}_venue`, input);
  const operationRef = db.collection(COLLECTIONS.ADMIN_OPERATIONS).doc(operation.operationId);
  const now = Date.now();
  return db.runTransaction(async (transaction) => {
    const [venueSnapshot, operationSnapshot] = await Promise.all([transaction.get(venueRef), transaction.get(operationRef)]);
    if (operationSnapshot.exists) return replayOperation(operationSnapshot.data(), operation, input.venueId);
    if (!venueSnapshot.exists) throw new HttpsError('not-found', 'Venue was not found.');
    const venue = { venueId: venueSnapshot.id, ...venueSnapshot.data() } as Venue;
    if (venue.active === false) throw new HttpsError('failed-precondition', 'The venue is already deactivated.');
    const revision = venue.revision ?? 0;
    if (input.expectedRevision !== revision) throw new HttpsError('aborted', 'The venue changed. Refresh and try again.');
    if (action === 'verify') {
      const errors = verificationErrors(venue, now);
      if (errors.length > 0) throw new HttpsError('failed-precondition', errors.join(' '));
    }
    const nextRevision = revision + 1;
    transaction.update(venueRef, action === 'verify' ? {
      verificationStatus: 'verified', verifiedBy: actorId, verifiedAt: now,
      revision: nextRevision, updatedBy: actorId, updatedAt: now,
    } : {
      active: false, deactivatedBy: actorId, deactivatedAt: now,
      revision: nextRevision, updatedBy: actorId, updatedAt: now,
    });
    transaction.create(operationRef, { ...operation, targetId: input.venueId, revision: nextRevision, createdAt: now });
    const auditRef = venueRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${nextRevision}-${action}-${operation.operationId.slice(0, 12)}`);
    transaction.create(auditRef, {
      auditId: auditRef.id, action: action === 'verify' ? 'venue_verified' : 'venue_deactivated',
      actorId, venueId: input.venueId, revision: nextRevision, timestamp: now,
    });
    return {
      venueId: input.venueId, revision: nextRevision,
      verificationStatus: action === 'verify' ? 'verified' as const : venue.verificationStatus ?? 'unverified',
      active: action !== 'deactivate', idempotent: false,
    };
  });
}

export function validateVenueMutation(value: unknown): VenueMutation {
  if (!isRecord(value)) throw new HttpsError('invalid-argument', 'Venue details are required.');
  rejectUnknown(value, VENUE_FIELDS);
  const venueId = optionalDocumentId(value.venueId);
  const expectedRevision = venueId ? requiredRevision(value.expectedRevision) : undefined;
  if (!venueId && value.expectedRevision !== undefined) throw new HttpsError('invalid-argument', 'expectedRevision is only valid when updating a venue.');
  const capacity = integer(value.capacity, 'capacity', 1, 1_000_000);
  const location = validateLocation(value.location);
  const verifiedSafeCapacity = optionalInteger(value.verifiedSafeCapacity, 'verifiedSafeCapacity', 1, capacity);
  const fireCertificateStatus = optionalEnum(value.fireCertificateStatus, 'fireCertificateStatus', ['valid', 'expired', 'not_required', 'unknown'] as const);
  const fireCertificateExpiresAt = optionalInteger(value.fireCertificateExpiresAt, 'fireCertificateExpiresAt', 1, Number.MAX_SAFE_INTEGER);
  if (fireCertificateStatus === 'not_required' && fireCertificateExpiresAt !== undefined) {
    throw new HttpsError('invalid-argument', 'A not-required fire certificate cannot have an expiry date.');
  }
  return {
    ...(venueId ? { venueId, expectedRevision } : {}),
    idempotencyKey: idempotencyKey(value.idempotencyKey),
    name: stringValue(value.name, 'name', 2, 200),
    address: stringValue(value.address, 'address', 5, 500),
    state: stringValue(value.state, 'state', 2, 100),
    jurisdiction: stringValue(value.jurisdiction, 'jurisdiction', 2, 120),
    capacity, location,
    ...(verifiedSafeCapacity !== undefined ? { verifiedSafeCapacity } : {}),
    ...(fireCertificateStatus ? { fireCertificateStatus } : {}),
    ...(fireCertificateExpiresAt !== undefined ? { fireCertificateExpiresAt } : {}),
    ...(value.nearestHospitalTravelMinutes !== undefined ? { nearestHospitalTravelMinutes: integer(value.nearestHospitalTravelMinutes, 'nearestHospitalTravelMinutes', 1, 240) } : {}),
    ...(value.emergencyAccessVerified !== undefined ? { emergencyAccessVerified: booleanValue(value.emergencyAccessVerified, 'emergencyAccessVerified') } : {}),
    ...(optionalString(value.riskNotes, 'riskNotes', 1_000) ? { riskNotes: optionalString(value.riskNotes, 'riskNotes', 1_000) } : {}),
  };
}

interface VenueCommand { venueId: string; expectedRevision: number; idempotencyKey: string }

export function validateVenueCommand(value: unknown): VenueCommand {
  if (!isRecord(value)) throw new HttpsError('invalid-argument', 'Venue command is required.');
  rejectUnknown(value, COMMAND_FIELDS);
  const venueId = optionalDocumentId(value.venueId);
  if (!venueId) throw new HttpsError('invalid-argument', 'A valid venueId is required.');
  return { venueId, expectedRevision: requiredRevision(value.expectedRevision), idempotencyKey: idempotencyKey(value.idempotencyKey) };
}

export function verificationErrors(venue: Venue, now = Date.now()): string[] {
  const errors: string[] = [];
  if (!venue.active) errors.push('Venue must be active.');
  if (!venue.state?.trim()) errors.push('State is required.');
  if (!venue.jurisdiction?.trim()) errors.push('Jurisdiction is required.');
  if (!Number.isSafeInteger(venue.verifiedSafeCapacity) || (venue.verifiedSafeCapacity ?? 0) < 1 || (venue.verifiedSafeCapacity ?? 0) > venue.capacity) errors.push('Verified safe capacity is required and cannot exceed capacity.');
  if (!venue.fireCertificateStatus || venue.fireCertificateStatus === 'unknown') errors.push('Fire certificate status must be resolved.');
  if (venue.fireCertificateStatus === 'valid' && (!Number.isSafeInteger(venue.fireCertificateExpiresAt) || (venue.fireCertificateExpiresAt ?? 0) <= now)) errors.push('A valid fire certificate requires a future expiry date.');
  if (!Number.isSafeInteger(venue.nearestHospitalTravelMinutes) || (venue.nearestHospitalTravelMinutes ?? 0) < 1 || (venue.nearestHospitalTravelMinutes ?? 0) > 240) errors.push('Hospital travel time is required.');
  if (typeof venue.emergencyAccessVerified !== 'boolean') errors.push('Emergency access verification must be recorded.');
  return errors;
}

async function requireAdmin(uid: string) {
  const profile = await getFirestore().collection(COLLECTIONS.USERS).doc(uid).get();
  if ((profile.data() as UserProfile | undefined)?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only an authorised administrator can manage venues.');
  }
}

function venueFields(input: VenueRegistryInput): VenueRegistryInput {
  return {
    name: input.name, address: input.address, state: input.state, jurisdiction: input.jurisdiction,
    capacity: input.capacity, location: input.location,
    ...(input.verifiedSafeCapacity !== undefined ? { verifiedSafeCapacity: input.verifiedSafeCapacity } : {}),
    ...(input.fireCertificateStatus ? { fireCertificateStatus: input.fireCertificateStatus } : {}),
    ...(input.fireCertificateExpiresAt !== undefined ? { fireCertificateExpiresAt: input.fireCertificateExpiresAt } : {}),
    ...(input.nearestHospitalTravelMinutes !== undefined ? { nearestHospitalTravelMinutes: input.nearestHospitalTravelMinutes } : {}),
    ...(input.emergencyAccessVerified !== undefined ? { emergencyAccessVerified: input.emergencyAccessVerified } : {}),
    ...(input.riskNotes ? { riskNotes: input.riskNotes } : {}),
  };
}

function operationMetadata(actorId: string, key: string, kind: string, payload: unknown) {
  const operationId = createHash('sha256').update(`${actorId}:${key}`).digest('hex');
  const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { operationId, actorId, kind, payloadHash };
}

function replayOperation(existing: DocumentData | undefined, expected: ReturnType<typeof operationMetadata>, targetId: string) {
  if (existing?.kind !== expected.kind || existing?.payloadHash !== expected.payloadHash) {
    throw new HttpsError('already-exists', 'This idempotency key was already used for a different request.');
  }
  return { venueId: existing.targetId as string ?? targetId, revision: existing.revision as number | undefined, idempotent: true };
}

function validateLocation(value: unknown): { lat: number; lng: number } {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'lat' && key !== 'lng')) throw new HttpsError('invalid-argument', 'location must contain only lat and lng.');
  return { lat: finite(value.lat, 'location.lat', -90, 90), lng: finite(value.lng, 'location.lng', -180, 180) };
}
function requiredRevision(value: unknown): number { return integer(value, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER); }
function idempotencyKey(value: unknown): string {
  const key = stringValue(value, 'idempotencyKey', 8, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new HttpsError('invalid-argument', 'idempotencyKey contains unsupported characters.');
  return key;
}
function optionalDocumentId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new HttpsError('invalid-argument', 'venueId is invalid.');
  return value;
}
function stringValue(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${field} is required.`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw new HttpsError('invalid-argument', `${field} must be ${min}-${max} characters.`);
  return text;
}
function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === '') return undefined;
  return stringValue(value, field, 1, max);
}
function finite(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new HttpsError('invalid-argument', `${field} must be between ${min} and ${max}.`);
  return value;
}
function integer(value: unknown, field: string, min: number, max: number): number {
  const number = finite(value, field, min, max);
  if (!Number.isSafeInteger(number)) throw new HttpsError('invalid-argument', `${field} must be a safe integer.`);
  return number;
}
function optionalInteger(value: unknown, field: string, min: number, max: number): number | undefined {
  return value === undefined ? undefined : integer(value, field, min, max);
}
function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new HttpsError('invalid-argument', `${field} must be true or false.`);
  return value;
}
function optionalEnum<T extends string>(value: unknown, field: string, choices: readonly T[]): T | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new HttpsError('invalid-argument', `${field} is invalid.`);
  return value as T;
}
function rejectUnknown(value: Record<string, unknown>, allowed: Set<string>) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new HttpsError('invalid-argument', `Unsupported fields: ${unknown.join(', ')}.`);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
