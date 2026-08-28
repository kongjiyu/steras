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
exports.unpublishStage2Doc = exports.publishStage2Doc = exports.reportStage2Doc = exports.confirmStage2Doc = exports.submitStage2Doc = exports.submitStage1Doc = exports.editEventControlList = exports.generateEventControlList = exports.unassignAuthorityOfficers = exports.makeSecondReviewDecision = exports.recordOfficerProposal = exports.assignAuthorityOfficers = exports.proposeEventControlList = exports.listMyNotifications = exports.markNotificationRead = exports.verifyStage1Doc = exports.reviewAssessmentScores = exports.overrideResources = exports.makeInitialReviewDecision = exports.retryManualOfficialFinalisation = exports.submitAdminManualAssessment = exports.retryOfficialFinalisation = exports.resolveAuthorityScoreConflict = exports.submitAuthorityScoreReview = exports.makeAuthorityDecision = exports.withdrawEvent = exports.extractApplicationDocuments = exports.submitEvent = exports.manualRecompute = exports.onEventStatusChanged = exports.onM4ReportOutcome = exports.recomputeRiskAndResources = exports.refreshAssessmentContext = exports.onEventUpdated = exports.onEventCreated = void 0;
const app_1 = require("firebase-admin/app");
// Initialize firebase-admin before any function code runs.
(0, app_1.initializeApp)();
var onEventCreated_1 = require("./triggers/onEventCreated");
Object.defineProperty(exports, "onEventCreated", { enumerable: true, get: function () { return onEventCreated_1.onEventCreated; } });
Object.defineProperty(exports, "onEventUpdated", { enumerable: true, get: function () { return onEventCreated_1.onEventUpdated; } });
var refreshAssessmentContext_1 = require("./triggers/refreshAssessmentContext");
Object.defineProperty(exports, "refreshAssessmentContext", { enumerable: true, get: function () { return refreshAssessmentContext_1.refreshAssessmentContext; } });
var computeRisk_1 = require("./triggers/computeRisk");
Object.defineProperty(exports, "recomputeRiskAndResources", { enumerable: true, get: function () { return computeRisk_1.recomputeRiskAndResources; } });
var onM4ReportOutcome_1 = require("./triggers/onM4ReportOutcome");
Object.defineProperty(exports, "onM4ReportOutcome", { enumerable: true, get: function () { return onM4ReportOutcome_1.onM4ReportOutcome; } });
var onEventStatusChanged_1 = require("./triggers/onEventStatusChanged");
Object.defineProperty(exports, "onEventStatusChanged", { enumerable: true, get: function () { return onEventStatusChanged_1.onEventStatusChanged; } });
// HTTP-callable functions (e.g. for manual authority re-trigger, seed runs)
var manualRecompute_1 = require("./http/manualRecompute");
Object.defineProperty(exports, "manualRecompute", { enumerable: true, get: function () { return manualRecompute_1.manualRecompute; } });
var submitEvent_1 = require("./http/submitEvent");
Object.defineProperty(exports, "submitEvent", { enumerable: true, get: function () { return submitEvent_1.submitEvent; } });
var extractApplicationDocuments_1 = require("./http/extractApplicationDocuments");
Object.defineProperty(exports, "extractApplicationDocuments", { enumerable: true, get: function () { return extractApplicationDocuments_1.extractApplicationDocuments; } });
var withdrawEvent_1 = require("./http/withdrawEvent");
Object.defineProperty(exports, "withdrawEvent", { enumerable: true, get: function () { return withdrawEvent_1.withdrawEvent; } });
var authorityDecision_1 = require("./http/authorityDecision");
Object.defineProperty(exports, "makeAuthorityDecision", { enumerable: true, get: function () { return authorityDecision_1.makeAuthorityDecision; } });
var authorityScoreReview_1 = require("./http/authorityScoreReview");
Object.defineProperty(exports, "submitAuthorityScoreReview", { enumerable: true, get: function () { return authorityScoreReview_1.submitAuthorityScoreReview; } });
Object.defineProperty(exports, "resolveAuthorityScoreConflict", { enumerable: true, get: function () { return authorityScoreReview_1.resolveAuthorityScoreConflict; } });
Object.defineProperty(exports, "retryOfficialFinalisation", { enumerable: true, get: function () { return authorityScoreReview_1.retryOfficialFinalisation; } });
var adminManualAssessment_1 = require("./http/adminManualAssessment");
Object.defineProperty(exports, "submitAdminManualAssessment", { enumerable: true, get: function () { return adminManualAssessment_1.submitAdminManualAssessment; } });
Object.defineProperty(exports, "retryManualOfficialFinalisation", { enumerable: true, get: function () { return adminManualAssessment_1.retryManualOfficialFinalisation; } });
var initialReview_1 = require("./http/initialReview");
Object.defineProperty(exports, "makeInitialReviewDecision", { enumerable: true, get: function () { return initialReview_1.makeInitialReviewDecision; } });
var overrideResources_1 = require("./http/overrideResources");
Object.defineProperty(exports, "overrideResources", { enumerable: true, get: function () { return overrideResources_1.overrideResources; } });
var reviewAssessmentScores_1 = require("./http/reviewAssessmentScores");
Object.defineProperty(exports, "reviewAssessmentScores", { enumerable: true, get: function () { return reviewAssessmentScores_1.reviewAssessmentScores; } });
var verifyStage1Doc_1 = require("./http/verifyStage1Doc");
Object.defineProperty(exports, "verifyStage1Doc", { enumerable: true, get: function () { return verifyStage1Doc_1.verifyStage1Doc; } });
var notifications_1 = require("./http/notifications");
Object.defineProperty(exports, "markNotificationRead", { enumerable: true, get: function () { return notifications_1.markNotificationRead; } });
Object.defineProperty(exports, "listMyNotifications", { enumerable: true, get: function () { return notifications_1.listMyNotifications; } });
// M3 control-list proposal: MiniMax-backed with a deterministic fallback.
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
// M3 Workstream 3 — organizer Stage 1 upload (FR-M3-20, FR-M3-26,
// UC-28, UC-29). Two paths: upload (base64 in Firestore) or
// use_previous (one-click receipt shortcut per M3 owner decision
// 2026-08-19).
var submitStage1Doc_1 = require("./http/submitStage1Doc");
Object.defineProperty(exports, "submitStage1Doc", { enumerable: true, get: function () { return submitStage1Doc_1.submitStage1Doc; } });
// M3 Workstream 4 — Stage 2 organizer upload + public confirm/report
// (FR-M3-27, FR-M3-28, FR-M3-29 first half, UC-35..38). submitStage2Doc
// is organizer-only (auto-publishes on upload); confirmStage2Doc +
// reportStage2Doc are any-signed-in-public with per-user rate limits.
var submitStage2Doc_1 = require("./http/submitStage2Doc");
Object.defineProperty(exports, "submitStage2Doc", { enumerable: true, get: function () { return submitStage2Doc_1.submitStage2Doc; } });
var confirmStage2Doc_1 = require("./http/confirmStage2Doc");
Object.defineProperty(exports, "confirmStage2Doc", { enumerable: true, get: function () { return confirmStage2Doc_1.confirmStage2Doc; } });
var reportStage2Doc_1 = require("./http/reportStage2Doc");
Object.defineProperty(exports, "reportStage2Doc", { enumerable: true, get: function () { return reportStage2Doc_1.reportStage2Doc; } });
// M3 Workstream 5 — admin publish gate (FR-M3-21, UC-14, UC-15). The
// admin reviews each organizer upload and either publishes (makes it
// public) or rejects (with a reason; organizer can re-upload). This
// is what lets us tighten the `stage2_docs` Firestore rule back to a
// per-doc `published == true` check.
var publishStage2Doc_1 = require("./http/publishStage2Doc");
Object.defineProperty(exports, "publishStage2Doc", { enumerable: true, get: function () { return publishStage2Doc_1.publishStage2Doc; } });
var unpublishStage2Doc_1 = require("./http/unpublishStage2Doc");
Object.defineProperty(exports, "unpublishStage2Doc", { enumerable: true, get: function () { return unpublishStage2Doc_1.unpublishStage2Doc; } });
//# sourceMappingURL=index.js.map