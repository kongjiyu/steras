"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overrideResources = void 0;
exports.overrideResourcesForUser = overrideResourcesForUser;
exports.throwResourceOverridesUnavailable = throwResourceOverridesUnavailable;
exports.validateResourceOverrideRequest = validateResourceOverrideRequest;
const https_1 = require("firebase-functions/v2/https");
const runtime_1 = require("../config/runtime");
exports.overrideResources = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before overriding resources.');
    return overrideResourcesForUser(request.auth.uid, request.data);
});
async function overrideResourcesForUser(_uid, request) {
    validateResourceOverrideRequest(request);
    throwResourceOverridesUnavailable();
}
function throwResourceOverridesUnavailable() {
    throw new https_1.HttpsError('failed-precondition', 'Resource adjustments are unavailable until the append-only authority finalisation workflow is enabled.');
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
//# sourceMappingURL=overrideResources.js.map