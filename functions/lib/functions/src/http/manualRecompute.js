"use strict";
/**
 * HTTP-callable function for manual re-computation.
 * Useful for testing, demo, and authority-triggered reruns.
 *
 * Uses firebase-functions v2 onCall API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.manualRecompute = void 0;
exports.manualRecomputeForUser = manualRecomputeForUser;
exports.validateRecomputeEventId = validateRecomputeEventId;
exports.validateRecomputeProfile = validateRecomputeProfile;
exports.validateAuthorityAssignment = validateAuthorityAssignment;
exports.validateRetryableAssessment = validateRetryableAssessment;
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const firebase_admin_1 = require("firebase-admin");
const types_1 = require("../../../shared/types");
const computeRisk_1 = require("../triggers/computeRisk");
const secrets_1 = require("../config/secrets");
const runtime_1 = require("../config/runtime");
const resourceCutoverLock_1 = require("../config/resourceCutoverLock");
exports.manualRecompute = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION, secrets: secrets_1.ASSESSMENT_SECRETS }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in first.');
    }
    const payload = request.data && typeof request.data === 'object' ? request.data : {};
    return manualRecomputeForUser(request.auth.uid, payload.eventId);
});
const defaultDependencies = {
    loadProfile: async (uid) => (await (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.USERS).doc(uid).get()).data(),
    loadEvent: async (eventId) => (await (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.EVENTS).doc(eventId).get()).data(),
    loadAssessment: async (eventId, assessmentId) => (await (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.EVENTS).doc(eventId)
        .collection(types_1.COLLECTIONS.ASSESSMENTS).doc(assessmentId).get()).data(),
    recompute: computeRisk_1.recomputeRiskAndResources,
    loadCutoverLock: async () => (await (0, firebase_admin_1.firestore)().doc(resourceCutoverLock_1.RESOURCE_CUTOVER_LOCK_PATH).get()).exists,
};
async function manualRecomputeForUser(uid, rawEventId, dependencies = defaultDependencies) {
    const profile = await dependencies.loadProfile(uid);
    const authorityType = validateRecomputeProfile(profile);
    const eventId = validateRecomputeEventId(rawEventId);
    const event = await dependencies.loadEvent(eventId);
    const assessmentId = validateAuthorityAssignment(event, authorityType);
    const versionId = validateCurrentVersion(event);
    const assessment = await dependencies.loadAssessment(eventId, assessmentId);
    validateRetryableAssessment(assessment, { eventId, versionId, assessmentId });
    if (await dependencies.loadCutoverLock?.())
        throw new https_1.HttpsError('unavailable', 'Resource migration is in progress. Retry shortly.');
    try {
        const result = await dependencies.recompute(eventId, { uid, authorityType });
        return { success: result.status === 'processed', ...result };
    }
    catch (err) {
        firebase_functions_1.logger.error('[manualRecompute] failed:', err);
        throw new https_1.HttpsError('internal', 'Recompute failed.');
    }
}
function validateRecomputeEventId(value) {
    const eventId = typeof value === 'string' ? value.trim() : '';
    if (!eventId)
        throw new https_1.HttpsError('invalid-argument', 'eventId required.');
    if (eventId.length > 200)
        throw new https_1.HttpsError('invalid-argument', 'eventId must be at most 200 characters.');
    if (!isSafeDocumentId(eventId))
        throw new https_1.HttpsError('invalid-argument', 'eventId must be a valid document id.');
    return eventId;
}
function validateRecomputeProfile(value) {
    const profile = typeof value === 'object' && value !== null ? value : {};
    if (profile.role !== 'authority' || !isAuthorityType(profile.authorityType)) {
        throw new https_1.HttpsError('permission-denied', 'Only provisioned authority accounts can retry assessments.');
    }
    return profile.authorityType;
}
function validateAuthorityAssignment(value, authorityType) {
    const event = typeof value === 'object' && value !== null ? value : {};
    if (!Array.isArray(event.requiredAuthorities) || !event.requiredAuthorities.includes(authorityType)) {
        throw new https_1.HttpsError('permission-denied', 'Your authority is not assigned to this application.');
    }
    const assessmentId = event.currentAssessmentId;
    if (!isSafeDocumentId(assessmentId)) {
        throw new https_1.HttpsError('failed-precondition', 'This application has no assessment that can be retried.');
    }
    return assessmentId;
}
function validateCurrentVersion(value) {
    const event = typeof value === 'object' && value !== null ? value : {};
    if (!isSafeDocumentId(event.currentVersionId)) {
        throw new https_1.HttpsError('failed-precondition', 'This application has no current version that can be retried.');
    }
    return event.currentVersionId;
}
function validateRetryableAssessment(value, expected) {
    const assessment = typeof value === 'object' && value !== null ? value : {};
    if (expected) {
        const identity = value && typeof value === 'object' ? value : {};
        if (identity.eventId !== expected.eventId || identity.versionId !== expected.versionId || identity.assessmentId !== expected.assessmentId) {
            throw new https_1.HttpsError('aborted', 'The assessment generation changed before retry authorization completed.');
        }
    }
    const hasManualLockField = Object.prototype.hasOwnProperty.call(assessment, 'activeManualAssessmentId');
    if (hasManualLockField && !isSafeManualAssessmentId(assessment.activeManualAssessmentId)) {
        throw new https_1.HttpsError('failed-precondition', 'The Admin manual assessment lock is invalid; do not retry this generation.');
    }
    if (isSafeManualAssessmentId(assessment.activeManualAssessmentId)) {
        throw new https_1.HttpsError('failed-precondition', 'An Admin manual assessment is already locked for this application version.');
    }
    if (assessment.status !== 'manual_review_required' && assessment.status !== 'failed') {
        throw new https_1.HttpsError('failed-precondition', 'Only manual-review or failed assessments can be retried.');
    }
}
function isSafeManualAssessmentId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function isSafeDocumentId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function isAuthorityType(value) {
    return value === 'PDRM' || value === 'BOMBA' || value === 'KKM' || value === 'DBKL' || value === 'MOTAC';
}
//# sourceMappingURL=manualRecompute.js.map