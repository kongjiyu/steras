"use strict";
/** Shared runtime-free contracts used by the React app and Cloud Functions. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESOURCE_GUIDELINE_VERSION = exports.RESOURCE_FORMULA_VERSION = exports.CATEGORY_SCHEMA_STATUS = exports.SCORING_LOGIC_VERSION = exports.CATEGORY_SCHEMA_VERSION = exports.COLLECTIONS = exports.EVENT_STATUSES = exports.EVENT_TYPES = void 0;
exports.riskLevelFor = riskLevelFor;
exports.hirarcRiskLevelFor = hirarcRiskLevelFor;
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
    { value: 'Manual Review Required', label: 'Manual Review Required', color: 'purple' },
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
    HISTORICAL_EVENTS: 'historical_events',
    DATASET_MANIFESTS: 'dataset_manifests',
    PUBLIC_EVENTS: 'public_events',
    NOTIFICATIONS: 'notifications',
    EVENT_CONTROLS: 'event_controls',
    // M3 round N+1 — workstream 1
    OFFICERS: 'officers',
    ASSIGNMENTS: 'assignments',
    STAGE1_DOCS: 'stage1_docs',
    STAGE2_DOCS: 'stage2_docs',
    PUBLIC_EVENT_CONTROLS: 'public_event_controls',
    PUBLIC_REPORTS: 'public_reports',
};
exports.CATEGORY_SCHEMA_VERSION = '2026-07-24-all-hazards-v2';
exports.SCORING_LOGIC_VERSION = '2026-07-24-hirarc-residual-v2';
exports.CATEGORY_SCHEMA_STATUS = 'prototype';
exports.RESOURCE_FORMULA_VERSION = '2026-07-24-prototype-range-v3';
exports.RESOURCE_GUIDELINE_VERSION = '2026-07-24-malaysia-research-v2';
function riskLevelFor(score) {
    if (score >= 70)
        return 'High';
    if (score >= 40)
        return 'Medium';
    return 'Low';
}
function hirarcRiskLevelFor(matrixScore) {
    if (matrixScore >= 15)
        return 'High';
    if (matrixScore >= 5)
        return 'Medium';
    return 'Low';
}
//# sourceMappingURL=types.js.map