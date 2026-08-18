"use strict";
/**
 * STERAS — Cloud Functions entry point.
 *
 * Module mapping (per PRD §4):
 *   - Module 2 (Smart Risk Assessment): AI predictor + rule-based engine
 *   - Module 3 (Resource Recommendation): resource calculator
 *   - Module 4 (Authority Dashboard): transactional multi-agency review
 *
 * Triggers:
 *   - onEventCreated   — fires when a new event doc is created
 *   - onEventUpdated   — fires on organizer edits (re-runs risk/resources)
 *   - makeAuthorityDecision — records and aggregates authority decisions
 *   - overrideResources     — validates and audits resource adjustments
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.editEventControlList = exports.generateEventControlList = exports.unassignAuthorityOfficers = exports.makeSecondReviewDecision = exports.recordOfficerProposal = exports.assignAuthorityOfficers = exports.proposeEventControlList = exports.listMyNotifications = exports.markNotificationRead = exports.verifyStage1Doc = exports.overrideResources = exports.makeAuthorityDecision = exports.withdrawEvent = exports.submitEvent = exports.manualRecompute = exports.recomputeRiskAndResources = exports.onEventUpdated = exports.onEventCreated = void 0;
const app_1 = require("firebase-admin/app");
// Initialize firebase-admin before any function code runs.
(0, app_1.initializeApp)();
var onEventCreated_1 = require("./triggers/onEventCreated");
Object.defineProperty(exports, "onEventCreated", { enumerable: true, get: function () { return onEventCreated_1.onEventCreated; } });
Object.defineProperty(exports, "onEventUpdated", { enumerable: true, get: function () { return onEventCreated_1.onEventUpdated; } });
var computeRisk_1 = require("./triggers/computeRisk");
Object.defineProperty(exports, "recomputeRiskAndResources", { enumerable: true, get: function () { return computeRisk_1.recomputeRiskAndResources; } });
// HTTP-callable functions (e.g. for manual authority re-trigger, seed runs)
var manualRecompute_1 = require("./http/manualRecompute");
Object.defineProperty(exports, "manualRecompute", { enumerable: true, get: function () { return manualRecompute_1.manualRecompute; } });
var submitEvent_1 = require("./http/submitEvent");
Object.defineProperty(exports, "submitEvent", { enumerable: true, get: function () { return submitEvent_1.submitEvent; } });
var withdrawEvent_1 = require("./http/withdrawEvent");
Object.defineProperty(exports, "withdrawEvent", { enumerable: true, get: function () { return withdrawEvent_1.withdrawEvent; } });
var authorityDecision_1 = require("./http/authorityDecision");
Object.defineProperty(exports, "makeAuthorityDecision", { enumerable: true, get: function () { return authorityDecision_1.makeAuthorityDecision; } });
var overrideResources_1 = require("./http/overrideResources");
Object.defineProperty(exports, "overrideResources", { enumerable: true, get: function () { return overrideResources_1.overrideResources; } });
var verifyStage1Doc_1 = require("./http/verifyStage1Doc");
Object.defineProperty(exports, "verifyStage1Doc", { enumerable: true, get: function () { return verifyStage1Doc_1.verifyStage1Doc; } });
var notifications_1 = require("./http/notifications");
Object.defineProperty(exports, "markNotificationRead", { enumerable: true, get: function () { return notifications_1.markNotificationRead; } });
Object.defineProperty(exports, "listMyNotifications", { enumerable: true, get: function () { return notifications_1.listMyNotifications; } });
// M3 round N+1 — stub. Replaced by M2's `proposeEventControlList` when
// M2 lands it (per integration contract Q5).
var proposeEventControlList_1 = require("./http/proposeEventControlList");
Object.defineProperty(exports, "proposeEventControlList", { enumerable: true, get: function () { return proposeEventControlList_1.proposeEventControlList; } });
// M3 Workstream 1 — officer assignment + multi-stage review.
var assignAuthorityOfficers_1 = require("./http/assignAuthorityOfficers");
Object.defineProperty(exports, "assignAuthorityOfficers", { enumerable: true, get: function () { return assignAuthorityOfficers_1.assignAuthorityOfficers; } });
var recordOfficerProposal_1 = require("./http/recordOfficerProposal");
Object.defineProperty(exports, "recordOfficerProposal", { enumerable: true, get: function () { return recordOfficerProposal_1.recordOfficerProposal; } });
var makeSecondReviewDecision_1 = require("./http/makeSecondReviewDecision");
Object.defineProperty(exports, "makeSecondReviewDecision", { enumerable: true, get: function () { return makeSecondReviewDecision_1.makeSecondReviewDecision; } });
// M3 Workstream 1 polish — reverse an assignment (A15 backup officer swap).
var unassignAuthorityOfficers_1 = require("./http/unassignAuthorityOfficers");
Object.defineProperty(exports, "unassignAuthorityOfficers", { enumerable: true, get: function () { return unassignAuthorityOfficers_1.unassignAuthorityOfficers; } });
// M3 Workstream 2 — event control list model + AI generation (admin).
var generateEventControlList_1 = require("./http/generateEventControlList");
Object.defineProperty(exports, "generateEventControlList", { enumerable: true, get: function () { return generateEventControlList_1.generateEventControlList; } });
var editEventControlList_1 = require("./http/editEventControlList");
Object.defineProperty(exports, "editEventControlList", { enumerable: true, get: function () { return editEventControlList_1.editEventControlList; } });
//# sourceMappingURL=index.js.map