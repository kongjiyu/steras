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
exports.overrideResources = exports.makeAuthorityDecision = exports.withdrawEvent = exports.submitEvent = exports.manualRecompute = exports.recomputeRiskAndResources = exports.onEventUpdated = exports.onEventCreated = void 0;
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
//# sourceMappingURL=index.js.map