"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivateVenue = exports.verifyVenue = exports.saveVenue = void 0;
exports.validateVenueMutation = validateVenueMutation;
exports.validateVenueCommand = validateVenueCommand;
exports.verificationErrors = verificationErrors;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const VENUE_FIELDS = new Set([
    'venueId', 'expectedRevision', 'idempotencyKey', 'name', 'address', 'state', 'jurisdiction',
    'capacity', 'location', 'verifiedSafeCapacity', 'fireCertificateStatus', 'fireCertificateExpiresAt',
    'nearestHospitalTravelMinutes', 'emergencyAccessVerified', 'riskNotes',
]);
const COMMAND_FIELDS = new Set(['venueId', 'expectedRevision', 'idempotencyKey']);
exports.saveVenue = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before managing venues.');
    const actorId = request.auth.uid;
    const db = (0, firestore_1.getFirestore)();
    await requireAdmin(actorId);
    const input = validateVenueMutation(request.data);
    const venueId = input.venueId ?? (0, node_crypto_1.createHash)('sha256').update(`${actorId}:${input.idempotencyKey}`).digest('hex').slice(0, 24);
    const venueRef = db.collection(types_1.COLLECTIONS.VENUES).doc(venueId);
    const operation = operationMetadata(actorId, input.idempotencyKey, 'save_venue', { ...input, venueId });
    const operationRef = db.collection(types_1.COLLECTIONS.ADMIN_OPERATIONS).doc(operation.operationId);
    const now = Date.now();
    return db.runTransaction(async (transaction) => {
        const [venueSnapshot, operationSnapshot] = await Promise.all([
            transaction.get(venueRef), transaction.get(operationRef),
        ]);
        if (operationSnapshot.exists)
            return replayOperation(operationSnapshot.data(), operation, venueId);
        const existing = venueSnapshot.data();
        if (!input.venueId && venueSnapshot.exists)
            throw new https_1.HttpsError('already-exists', 'The generated venue record already exists.');
        if (input.venueId && !existing)
            throw new https_1.HttpsError('not-found', 'Venue was not found.');
        if (existing && existing.active === false)
            throw new https_1.HttpsError('failed-precondition', 'A deactivated venue cannot be edited.');
        const currentRevision = existing?.revision ?? 0;
        if (input.venueId && input.expectedRevision !== currentRevision)
            throw new https_1.HttpsError('aborted', 'The venue changed. Refresh and try again.');
        const revision = currentRevision + 1;
        const replacementFields = venueFields(input);
        const record = {
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
        for (const key of ['verifiedSafeCapacity', 'fireCertificateStatus', 'fireCertificateExpiresAt', 'nearestHospitalTravelMinutes', 'emergencyAccessVerified', 'riskNotes']) {
            if (!(key in replacementFields))
                delete record[key];
        }
        delete record.verifiedBy;
        delete record.verifiedAt;
        transaction.set(venueRef, record);
        transaction.create(operationRef, { ...operation, targetId: venueId, revision, createdAt: now });
        const auditRef = venueRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${revision}-saved-${operation.operationId.slice(0, 12)}`);
        transaction.create(auditRef, {
            auditId: auditRef.id, action: existing ? 'venue_updated' : 'venue_created', actorId,
            venueId, revision, timestamp: now,
        });
        return { venueId, revision, verificationStatus: 'unverified', idempotent: false };
    });
});
exports.verifyVenue = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before verifying venues.');
    await requireAdmin(request.auth.uid);
    const input = validateVenueCommand(request.data);
    return updateVenueState(request.auth.uid, input, 'verify');
});
exports.deactivateVenue = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before deactivating venues.');
    await requireAdmin(request.auth.uid);
    const input = validateVenueCommand(request.data);
    return updateVenueState(request.auth.uid, input, 'deactivate');
});
async function updateVenueState(actorId, input, action) {
    const db = (0, firestore_1.getFirestore)();
    const venueRef = db.collection(types_1.COLLECTIONS.VENUES).doc(input.venueId);
    const operation = operationMetadata(actorId, input.idempotencyKey, `${action}_venue`, input);
    const operationRef = db.collection(types_1.COLLECTIONS.ADMIN_OPERATIONS).doc(operation.operationId);
    const now = Date.now();
    return db.runTransaction(async (transaction) => {
        const [venueSnapshot, operationSnapshot] = await Promise.all([transaction.get(venueRef), transaction.get(operationRef)]);
        if (operationSnapshot.exists)
            return replayOperation(operationSnapshot.data(), operation, input.venueId);
        if (!venueSnapshot.exists)
            throw new https_1.HttpsError('not-found', 'Venue was not found.');
        const venue = { venueId: venueSnapshot.id, ...venueSnapshot.data() };
        if (venue.active === false)
            throw new https_1.HttpsError('failed-precondition', 'The venue is already deactivated.');
        const revision = venue.revision ?? 0;
        if (input.expectedRevision !== revision)
            throw new https_1.HttpsError('aborted', 'The venue changed. Refresh and try again.');
        if (action === 'verify') {
            const errors = verificationErrors(venue, now);
            if (errors.length > 0)
                throw new https_1.HttpsError('failed-precondition', errors.join(' '));
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
        const auditRef = venueRef.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${nextRevision}-${action}-${operation.operationId.slice(0, 12)}`);
        transaction.create(auditRef, {
            auditId: auditRef.id, action: action === 'verify' ? 'venue_verified' : 'venue_deactivated',
            actorId, venueId: input.venueId, revision: nextRevision, timestamp: now,
        });
        return {
            venueId: input.venueId, revision: nextRevision,
            verificationStatus: action === 'verify' ? 'verified' : venue.verificationStatus ?? 'unverified',
            active: action !== 'deactivate', idempotent: false,
        };
    });
}
function validateVenueMutation(value) {
    if (!isRecord(value))
        throw new https_1.HttpsError('invalid-argument', 'Venue details are required.');
    rejectUnknown(value, VENUE_FIELDS);
    const venueId = optionalDocumentId(value.venueId);
    const expectedRevision = venueId ? requiredRevision(value.expectedRevision) : undefined;
    if (!venueId && value.expectedRevision !== undefined)
        throw new https_1.HttpsError('invalid-argument', 'expectedRevision is only valid when updating a venue.');
    const capacity = integer(value.capacity, 'capacity', 1, 1_000_000);
    const location = validateLocation(value.location);
    const verifiedSafeCapacity = optionalInteger(value.verifiedSafeCapacity, 'verifiedSafeCapacity', 1, capacity);
    const fireCertificateStatus = optionalEnum(value.fireCertificateStatus, 'fireCertificateStatus', ['valid', 'expired', 'not_required', 'unknown']);
    const fireCertificateExpiresAt = optionalInteger(value.fireCertificateExpiresAt, 'fireCertificateExpiresAt', 1, Number.MAX_SAFE_INTEGER);
    if (fireCertificateStatus === 'not_required' && fireCertificateExpiresAt !== undefined) {
        throw new https_1.HttpsError('invalid-argument', 'A not-required fire certificate cannot have an expiry date.');
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
function validateVenueCommand(value) {
    if (!isRecord(value))
        throw new https_1.HttpsError('invalid-argument', 'Venue command is required.');
    rejectUnknown(value, COMMAND_FIELDS);
    const venueId = optionalDocumentId(value.venueId);
    if (!venueId)
        throw new https_1.HttpsError('invalid-argument', 'A valid venueId is required.');
    return { venueId, expectedRevision: requiredRevision(value.expectedRevision), idempotencyKey: idempotencyKey(value.idempotencyKey) };
}
function verificationErrors(venue, now = Date.now()) {
    const errors = [];
    if (!venue.active)
        errors.push('Venue must be active.');
    if (!venue.state?.trim())
        errors.push('State is required.');
    if (!venue.jurisdiction?.trim())
        errors.push('Jurisdiction is required.');
    if (!Number.isSafeInteger(venue.verifiedSafeCapacity) || (venue.verifiedSafeCapacity ?? 0) < 1 || (venue.verifiedSafeCapacity ?? 0) > venue.capacity)
        errors.push('Verified safe capacity is required and cannot exceed capacity.');
    if (!venue.fireCertificateStatus || venue.fireCertificateStatus === 'unknown')
        errors.push('Fire certificate status must be resolved.');
    if (venue.fireCertificateStatus === 'valid' && (!Number.isSafeInteger(venue.fireCertificateExpiresAt) || (venue.fireCertificateExpiresAt ?? 0) <= now))
        errors.push('A valid fire certificate requires a future expiry date.');
    if (!Number.isSafeInteger(venue.nearestHospitalTravelMinutes) || (venue.nearestHospitalTravelMinutes ?? 0) < 1 || (venue.nearestHospitalTravelMinutes ?? 0) > 240)
        errors.push('Hospital travel time is required.');
    if (typeof venue.emergencyAccessVerified !== 'boolean')
        errors.push('Emergency access verification must be recorded.');
    return errors;
}
async function requireAdmin(uid) {
    const profile = await (0, firestore_1.getFirestore)().collection(types_1.COLLECTIONS.USERS).doc(uid).get();
    if (profile.data()?.role !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'Only an authorised administrator can manage venues.');
    }
}
function venueFields(input) {
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
function operationMetadata(actorId, key, kind, payload) {
    const operationId = (0, node_crypto_1.createHash)('sha256').update(`${actorId}:${key}`).digest('hex');
    const payloadHash = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(payload)).digest('hex');
    return { operationId, actorId, kind, payloadHash };
}
function replayOperation(existing, expected, targetId) {
    if (existing?.kind !== expected.kind || existing?.payloadHash !== expected.payloadHash) {
        throw new https_1.HttpsError('already-exists', 'This idempotency key was already used for a different request.');
    }
    return { venueId: existing.targetId ?? targetId, revision: existing.revision, idempotent: true };
}
function validateLocation(value) {
    if (!isRecord(value) || Object.keys(value).some((key) => key !== 'lat' && key !== 'lng'))
        throw new https_1.HttpsError('invalid-argument', 'location must contain only lat and lng.');
    return { lat: finite(value.lat, 'location.lat', -90, 90), lng: finite(value.lng, 'location.lng', -180, 180) };
}
function requiredRevision(value) { return integer(value, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER); }
function idempotencyKey(value) {
    const key = stringValue(value, 'idempotencyKey', 8, 100);
    if (!/^[A-Za-z0-9_-]+$/.test(key))
        throw new https_1.HttpsError('invalid-argument', 'idempotencyKey contains unsupported characters.');
    return key;
}
function optionalDocumentId(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
        throw new https_1.HttpsError('invalid-argument', 'venueId is invalid.');
    return value;
}
function stringValue(value, field, min, max) {
    if (typeof value !== 'string')
        throw new https_1.HttpsError('invalid-argument', `${field} is required.`);
    const text = value.trim();
    if (text.length < min || text.length > max)
        throw new https_1.HttpsError('invalid-argument', `${field} must be ${min}-${max} characters.`);
    return text;
}
function optionalString(value, field, max) {
    if (value === undefined || value === '')
        return undefined;
    return stringValue(value, field, 1, max);
}
function finite(value, field, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
        throw new https_1.HttpsError('invalid-argument', `${field} must be between ${min} and ${max}.`);
    return value;
}
function integer(value, field, min, max) {
    const number = finite(value, field, min, max);
    if (!Number.isSafeInteger(number))
        throw new https_1.HttpsError('invalid-argument', `${field} must be a safe integer.`);
    return number;
}
function optionalInteger(value, field, min, max) {
    return value === undefined ? undefined : integer(value, field, min, max);
}
function booleanValue(value, field) {
    if (typeof value !== 'boolean')
        throw new https_1.HttpsError('invalid-argument', `${field} must be true or false.`);
    return value;
}
function optionalEnum(value, field, choices) {
    if (value === undefined || value === '')
        return undefined;
    if (typeof value !== 'string' || !choices.includes(value))
        throw new https_1.HttpsError('invalid-argument', `${field} is invalid.`);
    return value;
}
function rejectUnknown(value, allowed) {
    const unknown = Object.keys(value).filter((key) => !allowed.has(key));
    if (unknown.length > 0)
        throw new https_1.HttpsError('invalid-argument', `Unsupported fields: ${unknown.join(', ')}.`);
}
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
//# sourceMappingURL=adminVenueManagement.js.map