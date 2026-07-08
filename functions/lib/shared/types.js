"use strict";
/**
 * STERAS — Shared TypeScript types & enums
 * Used by both frontend (src/) and Cloud Functions (functions/src/).
 * Pure types only — no runtime imports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISAGREEMENT_THRESHOLD = exports.COLLECTIONS = exports.EVENT_STATUSES = exports.EVENT_TYPES = void 0;
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
    { value: 'Pending', label: 'Pending', color: 'amber' },
    { value: 'UnderReview', label: 'Under Review', color: 'blue' },
    { value: 'AmendmentRequested', label: 'Amendment Requested', color: 'orange' },
    { value: 'Approved', label: 'Approved', color: 'green' },
    { value: 'Rejected', label: 'Rejected', color: 'red' },
    { value: 'Withdrawn', label: 'Withdrawn', color: 'gray' },
];
// =====================================================================
// FIRESTORE COLLECTION NAMES (constants — never hardcode strings elsewhere)
// =====================================================================
exports.COLLECTIONS = {
    USERS: 'users',
    EVENTS: 'events',
    RISK_SCORES: 'risk_scores',
    RESOURCES: 'resources',
    AUDIT_LOGS: 'audit_logs',
    VENUES: 'venues',
    INCIDENTS: 'incidents',
    PUBLIC_EVENTS: 'public_events',
};
// Disagreement threshold per PRD §4 (Module 2)
exports.DISAGREEMENT_THRESHOLD = 15;
//# sourceMappingURL=types.js.map