"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overrideResources = void 0;
exports.overrideResourcesForUser = overrideResourcesForUser;
exports.validateResourceOverrideRequest = validateResourceOverrideRequest;
const node_crypto_1 = require("node:crypto");
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const resourceContract_1 = require("../engines/resourceContract");
exports.overrideResources = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before overriding resources.');
    return overrideResourcesForUser(request.auth.uid, request.data);
});
async function overrideResourcesForUser(uid, request, now = Date.now()) {
    const { eventId, quantities, rationale, idempotencyKey } = validateResourceOverrideRequest(request);
    const db = (0, firebase_admin_1.firestore)();
    const eventReference = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const userReference = db.collection(types_1.COLLECTIONS.USERS).doc(uid);
    return db.runTransaction(async (transaction) => {
        const overrideQuery = eventReference.collection(types_1.COLLECTIONS.RESOURCE_OVERRIDES)
            .where('idempotencyKey', '==', idempotencyKey).limit(1);
        const [userSnapshot, eventSnapshot, assignmentsSnapshot, existingOverrideSnapshot] = await Promise.all([
            transaction.get(userReference),
            transaction.get(eventReference),
            transaction.get(eventReference.collection(types_1.COLLECTIONS.ASSIGNMENTS)),
            transaction.get(overrideQuery),
        ]);
        const profile = userSnapshot.data();
        const event = eventSnapshot.exists ? { eventId, ...eventSnapshot.data() } : undefined;
        if (!profile || profile.role !== 'authority' || !profile.authorityType) {
            throw new https_1.HttpsError('permission-denied', 'Only provisioned authorities can override resources.');
        }
        if (!event || !event.currentVersionId || !event.currentAssessmentId || !event.currentResourceId) {
            throw new https_1.HttpsError('failed-precondition', 'The application current-generation pointers are incomplete.');
        }
        if (!safeDocumentId(event.currentVersionId) || !safeDocumentId(event.currentAssessmentId)
            || !safeDocumentId(event.currentResourceId)) {
            throw new https_1.HttpsError('failed-precondition', 'The application current-generation pointers are invalid.');
        }
        const assignment = assignmentsSnapshot.docs
            .map((snapshot) => snapshot.data())
            .find((candidate) => candidate.versionId === event.currentVersionId
            && candidate.authorityType === profile.authorityType
            && candidate.officerUid === uid
            && (candidate.status === 'pending' || candidate.status === 'in_progress'));
        if (!assignment)
            throw new https_1.HttpsError('permission-denied', 'You are not the named officer assigned to this application.');
        if (!['Pending', 'UnderReview'].includes(event.status)) {
            throw new https_1.HttpsError('failed-precondition', 'Resources can only be changed during active review.');
        }
        const resourceReference = eventReference.collection(types_1.COLLECTIONS.RESOURCES).doc(event.currentResourceId);
        const assessmentReference = eventReference.collection(types_1.COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId);
        const [resourceSnapshot, assessmentSnapshot] = await Promise.all([
            transaction.get(resourceReference),
            transaction.get(assessmentReference),
        ]);
        const resource = resourceSnapshot.data();
        const assessment = assessmentSnapshot.data();
        if (!resourceSnapshot.exists || !resource || !(0, resourceContract_1.validateResourceRecommendation)(resource).ok
            || resource.resourceId !== event.currentResourceId
            || resource.eventId !== eventId
            || resource.versionId !== event.currentVersionId
            || resource.assessmentId !== event.currentAssessmentId
            || !assessmentSnapshot.exists
            || assessment?.assessmentId !== event.currentAssessmentId
            || assessment.eventId !== eventId
            || assessment.versionId !== event.currentVersionId) {
            throw new https_1.HttpsError('failed-precondition', 'The current assessment/resource contract is invalid or not ready.');
        }
        const existingOverride = existingOverrideSnapshot.docs[0];
        if (existingOverride) {
            const existing = existingOverride.data();
            if (existing.eventId !== eventId || existing.versionId !== event.currentVersionId
                || existing.baseResourceId !== event.currentResourceId || existing.reviewerId !== uid
                || !sameQuantities(existing.quantities, quantities) || existing.rationale !== rationale) {
                throw new https_1.HttpsError('already-exists', 'The idempotency key is already bound to different override content.');
            }
            return {
                eventId,
                versionId: event.currentVersionId,
                assessmentId: event.currentAssessmentId,
                resourceId: event.currentResourceId,
                baseResourceId: event.currentResourceId,
                overrideId: existing.overrideId,
                quantities: existing.quantities,
                overriddenAt: existing.overriddenAt,
                idempotent: true,
            };
        }
        const previousOverridesSnapshot = await transaction.get(eventReference.collection(types_1.COLLECTIONS.RESOURCE_OVERRIDES)
            .where('baseResourceId', '==', event.currentResourceId));
        const previousOverrides = previousOverridesSnapshot.docs
            .map((snapshot) => snapshot.data())
            .filter((candidate) => candidate.eventId === eventId
            && candidate.versionId === event.currentVersionId
            && candidate.baseResourceId === event.currentResourceId
            && isResourceQuantities(candidate.quantities))
            .sort((left, right) => right.overriddenAt - left.overriddenAt);
        const previous = previousOverrides[0];
        const previousQuantities = previous?.quantities ?? toResourceQuantities(resource);
        const overrideId = `override-${(0, node_crypto_1.createHash)('sha256').update(`${uid}:${idempotencyKey}`).digest('hex').slice(0, 32)}`;
        const overrideReference = eventReference.collection(types_1.COLLECTIONS.RESOURCE_OVERRIDES).doc(overrideId);
        const auditReference = eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${overrideId}_resource_override`);
        const record = {
            overrideId,
            eventId,
            versionId: event.currentVersionId,
            assessmentId: event.currentAssessmentId,
            baseResourceId: event.currentResourceId,
            resourceId: event.currentResourceId,
            authorityType: profile.authorityType,
            reviewerId: uid,
            rationale,
            previousQuantities,
            quantities,
            idempotencyKey,
            ...(previous ? { supersedesOverrideId: previous.overrideId } : {}),
            overriddenAt: now,
        };
        transaction.create(overrideReference, record);
        transaction.create(auditReference, {
            id: auditReference.id,
            eventId,
            versionId: event.currentVersionId,
            action: 'resource_overridden',
            actorId: uid,
            actorRole: 'authority',
            timestamp: now,
            notes: rationale,
            metadata: {
                authorityType: profile.authorityType,
                resourceId: event.currentResourceId,
                baseResourceId: event.currentResourceId,
                previousQuantities,
                quantities,
                overrideId,
            },
        });
        return {
            eventId,
            versionId: event.currentVersionId,
            assessmentId: event.currentAssessmentId,
            resourceId: event.currentResourceId,
            baseResourceId: event.currentResourceId,
            overrideId,
            quantities,
            overriddenAt: now,
            idempotent: false,
        };
    });
}
function validateResourceOverrideRequest(request) {
    const value = typeof request === 'object' && request !== null ? request : {};
    const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
    const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
    const idempotencyKey = typeof value.idempotencyKey === 'string' ? value.idempotencyKey.trim() : '';
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!isResourceQuantities(value.quantities))
        throw new https_1.HttpsError('invalid-argument', 'Every resource quantity must be a non-negative integer.');
    if (rationale.length < 10 || rationale.length > 1_000)
        throw new https_1.HttpsError('invalid-argument', 'Rationale must be between 10 and 1,000 characters.');
    if (!safeIdempotencyKey(idempotencyKey))
        throw new https_1.HttpsError('invalid-argument', 'idempotencyKey must be 8-128 characters.');
    return { eventId, quantities: value.quantities, rationale, idempotencyKey };
}
function isResourceQuantities(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const record = value;
    return Object.keys(record).length === types_1.RESOURCE_KEYS.length
        && types_1.RESOURCE_KEYS.every((field) => Number.isInteger(record[field])
            && record[field] >= 0 && record[field] <= 1_000_000);
}
function toResourceQuantities(resource) {
    return Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, resource.items[key].baseline]));
}
function sameQuantities(left, right) {
    return isResourceQuantities(left) && types_1.RESOURCE_KEYS.every((key) => left[key] === right[key]);
}
function safeDocumentId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function safeIdempotencyKey(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}
//# sourceMappingURL=overrideResources.js.map