"use strict";
/**
 * HTTP-callable function for manual re-computation.
 * Useful for testing, demo, and authority-triggered reruns.
 *
 * Uses firebase-functions v2 onCall API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.manualRecompute = void 0;
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const computeRisk_1 = require("../triggers/computeRisk");
exports.manualRecompute = (0, https_1.onCall)(async (request) => {
    // Require auth.
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in first.');
    }
    const eventId = request.data.eventId;
    if (!eventId) {
        throw new https_1.HttpsError('invalid-argument', 'eventId required.');
    }
    try {
        await (0, computeRisk_1.recomputeRiskAndResources)(eventId);
        return { success: true, eventId };
    }
    catch (err) {
        firebase_functions_1.logger.error('[manualRecompute] failed:', err);
        throw new https_1.HttpsError('internal', 'Recompute failed.');
    }
});
//# sourceMappingURL=manualRecompute.js.map