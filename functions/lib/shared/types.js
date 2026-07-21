"use strict";
/** Shared runtime-free contracts used by the React app and Cloud Functions. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_AI_ADJUSTMENT = exports.RESOURCE_FORMULA_VERSION = exports.RULE_VERSION = exports.COLLECTIONS = exports.EVENT_STATUSES = exports.EVENT_TYPES = void 0;
exports.riskLevelFor = riskLevelFor;
exports.finalScoreFor = finalScoreFor;
exports.EVENT_TYPES = [
    { value: 'concert', label: 'Concert / Music' },
    { value: 'festival', label: 'Festival' },
    { value: 'sports', label: 'Sports Event' },
    { value: 'cultural', label: 'Cultural Event' },
    { value: 'religious', label: 'Religious Gathering' },
    { value: 'exhibition', label: 'Exhibition' },
    { value: 'fair', label: 'Fair / Market' },
    { value: 'conference', label: 'Conference' },
    { value: 'other', label: 'Other' },
];
exports.EVENT_STATUSES = [
    { value: 'Draft', label: 'Draft', color: 'gray' },
    { value: 'Pending', label: 'Pending', color: 'amber' },
    { value: 'UnderReview', label: 'Under Review', color: 'blue' },
    { value: 'AmendmentRequested', label: 'Amendment Requested', color: 'orange' },
    { value: 'Approved', label: 'Approved', color: 'green' },
    { value: 'Rejected', label: 'Rejected', color: 'red' },
    { value: 'Withdrawn', label: 'Withdrawn', color: 'gray' },
];
exports.COLLECTIONS = {
    USERS: 'users',
    EVENTS: 'events',
    VERSIONS: 'versions',
    ASSESSMENTS: 'assessments',
    RESOURCES: 'resources',
    DECISIONS: 'decisions',
    DECISION_HISTORY: 'decision_history',
    RESOURCE_OVERRIDES: 'resource_overrides',
    AUDIT_LOGS: 'audit_logs',
    VENUES: 'venues',
    INCIDENTS: 'incidents',
    PUBLIC_EVENTS: 'public_events',
};
exports.RULE_VERSION = '2026-07-v1';
exports.RESOURCE_FORMULA_VERSION = '2026-07-prototype-v1';
exports.MAX_AI_ADJUSTMENT = 15;
function riskLevelFor(score) {
    if (score >= 70)
        return 'High';
    if (score >= 40)
        return 'Medium';
    return 'Low';
}
function finalScoreFor(baselineScore, proposedAdjustment) {
    const baseline = Math.max(0, Math.min(100, Math.round(baselineScore)));
    const validatedAdjustment = Math.max(0, Math.min(exports.MAX_AI_ADJUSTMENT, Math.round(proposedAdjustment)));
    const finalScore = Math.min(100, baseline + validatedAdjustment);
    return { validatedAdjustment, finalScore, finalRiskLevel: riskLevelFor(finalScore) };
}
//# sourceMappingURL=types.js.map