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
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const firebase_admin_1 = require("firebase-admin");
const types_1 = require("../../../shared/types");
const computeRisk_1 = require("../triggers/computeRisk");
const secrets_1 = require("../config/secrets");
const runtime_1 = require("../config/runtime");
exports.manualRecompute = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION, secrets: secrets_1.ASSESSMENT_SECRETS }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in first.');
    }
    return manualRecomputeForUser(request.auth.uid, request.data.eventId);
});
const defaultDependencies = {
    loadProfile: async (uid) => (await (0, firebase_admin_1.firestore)().collection(types_1.COLLECTIONS.USERS).doc(uid).get()).data(),
    recompute: computeRisk_1.recomputeRiskAndResources,
};
async function manualRecomputeForUser(uid, rawEventId, dependencies = defaultDependencies) {
    const profile = await dependencies.loadProfile(uid);
    validateRecomputeProfile(profile);
    const eventId = validateRecomputeEventId(rawEventId);
    try {
        const result = await dependencies.recompute(eventId);
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
    return eventId;
}
function validateRecomputeProfile(value) {
    const profile = typeof value === 'object' && value !== null ? value : {};
    if (profile.role !== 'authority' || typeof profile.authorityType !== 'string' || !profile.authorityType) {
        throw new https_1.HttpsError('permission-denied', 'Only provisioned authority accounts can retry assessments.');
    }
}
//# sourceMappingURL=manualRecompute.js.map