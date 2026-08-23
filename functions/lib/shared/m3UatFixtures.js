"use strict";
/** Runtime-free identifiers for the isolated Module 3 UAT dataset. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.M3_UAT_ACCOUNT_EMAILS = exports.M3_UAT_RETIRED_EVENT_IDS = exports.M3_UAT_EVENT_IDS = exports.M3_UAT_EVENTS = exports.M3_UAT_SHARED_PROJECT_ID = exports.M3_UAT_DATASET_ID = void 0;
exports.isM3UatEventId = isM3UatEventId;
exports.M3_UAT_DATASET_ID = 'm3-linkos-v1';
exports.M3_UAT_SHARED_PROJECT_ID = 'linkos-496505';
exports.M3_UAT_EVENTS = {
    initialReady: 'm3-uat-01-initial-ready',
    complianceBlocked: 'm3-uat-02-compliance-blocked',
    provisionalReview: 'm3-uat-03-provisional-review',
    awaitingAssignment: 'm3-uat-04-awaiting-assignment',
    authorityPartial: 'm3-uat-05-authority-partial',
    secondReview: 'm3-uat-06-second-review',
    rejected: 'm3-uat-07-rejected',
    secondReviewRejected: 'm3-uat-08-second-review-rejected',
    controlVerification: 'm3-uat-09-control-verification',
    publicStage2: 'm3-uat-10-public-stage2',
};
exports.M3_UAT_EVENT_IDS = Object.freeze(Object.values(exports.M3_UAT_EVENTS));
/** Legacy fixture ID retired when the application AmendmentRequested flow was removed. */
exports.M3_UAT_RETIRED_EVENT_IDS = Object.freeze(['m3-uat-08-amendment']);
exports.M3_UAT_ACCOUNT_EMAILS = {
    admin: 'm3-uat-admin@steras.test',
    organizer: 'm3-uat-organizer@steras.test',
    public: 'm3-uat-public@steras.test',
    PDRM: 'm3-uat-pdrm@steras.test',
    BOMBA: 'm3-uat-bomba@steras.test',
    KKM: 'm3-uat-kkm@steras.test',
    DBKL: 'm3-uat-dbkl@steras.test',
    MOTAC: 'm3-uat-motac@steras.test',
};
function isM3UatEventId(value) {
    return exports.M3_UAT_EVENT_IDS.includes(value);
}
//# sourceMappingURL=m3UatFixtures.js.map