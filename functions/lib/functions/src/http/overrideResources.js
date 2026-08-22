"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overrideResources = void 0;
exports.overrideResourcesForUser = overrideResourcesForUser;
exports.validateResourceOverrideRequest = validateResourceOverrideRequest;
exports.throwResourceOverridesUnavailable = throwResourceOverridesUnavailable;
const firebase_admin_1 = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
exports.overrideResources = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before overriding resources.');
    return overrideResourcesForUser(request.auth.uid, request.data);
});
async function overrideResourcesForUser(uid, request, now = Date.now()) {
    const { eventId, quantities, rationale } = validateResourceOverrideRequest(request);
    const db = (0, firebase_admin_1.firestore)();
    const eventReference = db.collection(types_1.COLLECTIONS.EVENTS).doc(eventId);
    const userReference = db.collection(types_1.COLLECTIONS.USERS).doc(uid);
    return db.runTransaction(async (transaction) => {
        const [userSnapshot, eventSnapshot, assignmentsSnapshot] = await Promise.all([
            transaction.get(userReference),
            transaction.get(eventReference),
            transaction.get(eventReference.collection(types_1.COLLECTIONS.ASSIGNMENTS)),
        ]);
        const profile = userSnapshot.data();
        const event = eventSnapshot.exists ? { eventId, ...eventSnapshot.data() } : undefined;
        if (!profile || profile.role !== 'authority' || !profile.authorityType)
            throw new https_1.HttpsError('permission-denied', 'Only provisioned authorities can override resources.');
        if (!event || !event.currentVersionId)
            throw new https_1.HttpsError('not-found', 'Submitted event application was not found.');
        const assignment = assignmentsSnapshot.docs
            .map((snapshot) => snapshot.data())
            .find((candidate) => candidate.versionId === event.currentVersionId
            && candidate.authorityType === profile.authorityType
            && candidate.officerUid === uid
            && (candidate.status === 'pending' || candidate.status === 'in_progress'));
        if (!assignment)
            throw new https_1.HttpsError('permission-denied', 'You are not the named officer assigned to this application.');
        if (!['Pending', 'UnderReview'].includes(event.status))
            throw new https_1.HttpsError('failed-precondition', 'Resources can only be changed during active review.');
        const versionId = event.currentVersionId;
        const resourceReference = eventReference.collection(types_1.COLLECTIONS.RESOURCES).doc(versionId);
        const resourceSnapshot = await transaction.get(resourceReference);
        if (!resourceSnapshot.exists)
            throw new https_1.HttpsError('failed-precondition', 'Resource recommendation is not ready.');
        const previous = resourceSnapshot.data();
        const updatedItems = Object.fromEntries(types_1.RESOURCE_KEYS.map((key) => [key, {
                ...previous.items[key],
                baseline: quantities[key],
                planningRange: {
                    min: Math.min(previous.items[key].planningRange.min, quantities[key]),
                    max: Math.max(previous.items[key].planningRange.max, quantities[key]),
                },
                confidence: 'authority_validated',
                authorityReviewRequired: false,
            }]));
        const updated = {
            ...previous,
            items: updatedItems,
            confidenceLevel: 'authority_validated',
            authorityReviewRequired: false,
            notes: `Authority override: ${rationale}`,
            overriddenBy: uid,
            overrideRationale: rationale,
            overriddenAt: now,
        };
        const overrideId = `${versionId}_${profile.authorityType}_${now}`;
        const overrideReference = eventReference.collection(types_1.COLLECTIONS.RESOURCE_OVERRIDES).doc(overrideId);
        const auditReference = eventReference.collection(types_1.COLLECTIONS.AUDIT_LOGS).doc(`${overrideId}_resource_override`);
        transaction.set(resourceReference, updated);
        transaction.create(overrideReference, { overrideId, eventId, versionId, authorityType: profile.authorityType, reviewerId: uid, rationale, previous, updated, overriddenAt: now });
        transaction.create(auditReference, {
            id: auditReference.id, eventId, versionId, action: 'resource_overridden', actorId: uid, actorRole: 'authority', timestamp: now,
            notes: rationale, metadata: { authorityType: profile.authorityType, previous, updated: quantities },
        });
        return { eventId, versionId, resourceId: versionId, overriddenAt: now };
    });
}
function validateResourceOverrideRequest(request) {
    const value = typeof request === 'object' && request !== null ? request : {};
    const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : '';
    const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId is required.');
    if (!isResourceQuantities(value.quantities))
        throw new https_1.HttpsError('invalid-argument', 'Every resource quantity must be a non-negative integer.');
    if (rationale.length < 10 || rationale.length > 1_000)
        throw new https_1.HttpsError('invalid-argument', 'Rationale must be between 10 and 1,000 characters.');
    return { eventId, quantities: value.quantities, rationale };
}
function isResourceQuantities(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const record = value;
    const fields = ['police', 'medicalTeams', 'ambulances', 'toilets', 'wasteBins', 'security', 'fireOfficers'];
    return Object.keys(record).length === fields.length && fields.every((field) => Number.isInteger(record[field]) && record[field] >= 0 && record[field] <= 1_000_000);
}
/** @deprecated Kept only for callers compiled against the pre-M3 disabled guard. */
function throwResourceOverridesUnavailable() {
    throw new https_1.HttpsError('failed-precondition', 'Resource adjustments are unavailable until the append-only authority finalisation workflow is enabled.');
}
//# sourceMappingURL=overrideResources.js.map