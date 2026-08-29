"use strict";
/** Shared runtime-free contracts used by the React app and Cloud Functions. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_SCHEMA_STATUS = exports.PROVISIONAL_FORMULA_VERSION = exports.HARD_RULE_VERSION = exports.SCORING_LOGIC_VERSION = exports.CATEGORY_SCHEMA_VERSION = exports.COLLECTIONS = exports.RESOURCE_KEYS = exports.RESOURCE_SOURCE_REGISTRY_VERSION = exports.RESOURCE_CONFIG_VERSION = exports.RESOURCE_FORMULA_VERSION = exports.RESOURCE_SCHEMA_VERSION = exports.MANUAL_OFFICIAL_FORMULA_VERSION = exports.MANUAL_ASSESSMENT_SCHEMA_VERSION = exports.OFFICIAL_FORMULA_VERSION = exports.SCORE_RESOLUTION_SCHEMA_VERSION = exports.SCORE_REVIEW_SCHEMA_VERSION = exports.WEATHER_POLICY_VERSION = exports.VENUE_BINDING_VERSION = exports.EVIDENCE_SUFFICIENCY_VERSION = exports.CONTEXT_EVIDENCE_SCHEMA_VERSION = exports.ASSESSMENT_SCHEMA_VERSION = exports.M1_EVIDENCE_MANIFEST_SCHEMA_VERSION = exports.M1_EXTRACTION_SCHEMA_VERSION = exports.M1_DOCUMENT_SCHEMA_VERSION = exports.M1_TEMPLATE_REGISTRY_VERSION = exports.EVENT_STATUSES = exports.EVENT_TYPES = void 0;
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
    { value: 'Approved', label: 'Approved', color: 'green' },
    { value: 'Rejected', label: 'Rejected', color: 'red' },
    { value: 'Cancelled', label: 'Cancelled', color: 'gray' },
    { value: 'Withdrawn', label: 'Withdrawn', color: 'gray' },
    { value: 'Manual Review Required', label: 'Manual Review Required', color: 'purple' },
];
exports.M1_TEMPLATE_REGISTRY_VERSION = '2026-08-28-v1';
exports.M1_DOCUMENT_SCHEMA_VERSION = '2026-08-28-document-v1';
exports.M1_EXTRACTION_SCHEMA_VERSION = '2026-08-29-document-fields-v2';
exports.M1_EVIDENCE_MANIFEST_SCHEMA_VERSION = '2026-08-28-evidence-v1';
exports.ASSESSMENT_SCHEMA_VERSION = '2026-08-21-prd-v5-hardening-v1';
exports.CONTEXT_EVIDENCE_SCHEMA_VERSION = '2026-08-21-context-evidence-v1';
exports.EVIDENCE_SUFFICIENCY_VERSION = '2026-08-21-eight-category-v1';
exports.VENUE_BINDING_VERSION = '2026-08-21-canonical-venue-v1';
exports.WEATHER_POLICY_VERSION = '2026-08-21-no-placeholder-v1';
exports.SCORE_REVIEW_SCHEMA_VERSION = '2026-08-20-authority-review-v1';
exports.SCORE_RESOLUTION_SCHEMA_VERSION = '2026-08-20-score-resolution-v1';
exports.OFFICIAL_FORMULA_VERSION = '2026-08-20-authority-official-v1';
exports.MANUAL_ASSESSMENT_SCHEMA_VERSION = '2026-08-21-admin-manual-v1';
exports.MANUAL_OFFICIAL_FORMULA_VERSION = '2026-08-21-admin-manual-official-v1';
exports.RESOURCE_SCHEMA_VERSION = '2026-08-21-prd-v5-hardening-v1';
exports.RESOURCE_FORMULA_VERSION = '2026-08-19-deterministic-v4';
exports.RESOURCE_CONFIG_VERSION = '2026-08-19-prototype-v1';
exports.RESOURCE_SOURCE_REGISTRY_VERSION = '2026-08-19-v1';
exports.RESOURCE_KEYS = [
    'police',
    'security',
    'medicalTeams',
    'ambulances',
    'fireOfficers',
    'toilets',
    'wasteBins',
];
exports.COLLECTIONS = {
    USERS: 'users',
    EVENTS: 'events',
    VERSIONS: 'versions',
    DOCUMENT_EXTRACTIONS: 'document_extractions',
    ASSESSMENTS: 'assessments',
    ASSESSMENT_SUMMARIES: 'assessment_summaries',
    SCORE_REVIEWS: 'score_reviews',
    SCORE_RESOLUTIONS: 'score_resolutions',
    MANUAL_ASSESSMENTS: 'manual_assessments',
    RESOURCES: 'resources',
    DECISIONS: 'decisions',
    DECISION_HISTORY: 'decision_history',
    RESOURCE_OVERRIDES: 'resource_overrides',
    ASSESSMENT_REVIEWS: 'assessment_reviews',
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
    // M3 round N+1 (Workstream 4) — per-user rate-limit counters
    // under each control. Server-only writes; client reads for the
    // UI to show "You confirmed" / "You reported" states.
    STAGE2_CONFIRMS: 'stage2_confirms',
    STAGE2_REPORTS: 'stage2_reports',
    PUBLIC_EVENT_CONTROLS: 'public_event_controls',
    PUBLIC_EVENT_CONTROL_ITEMS: 'items',
    PUBLIC_REPORTS: 'public_reports',
    ADMIN_OPERATIONS: 'admin_operations',
    ADMIN_AUDIT_LOGS: 'admin_audit_logs',
};
exports.CATEGORY_SCHEMA_VERSION = '2026-07-24-all-hazards-v2';
exports.SCORING_LOGIC_VERSION = '2026-07-24-hirarc-residual-v2';
exports.HARD_RULE_VERSION = '2026-08-18-hirarc-floor-v1';
exports.PROVISIONAL_FORMULA_VERSION = '2026-08-18-weighted-safety-floor-v1';
exports.CATEGORY_SCHEMA_STATUS = 'prototype';
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