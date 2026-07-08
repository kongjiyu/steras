"use strict";
/**
 * STERAS — Cloud Functions entry point.
 *
 * Module mapping (per PRD §4):
 *   - Module 2 (Smart Risk Assessment): AI predictor + rule-based engine
 *   - Module 3 (Resource Recommendation): resource calculator
 *   - Module 4 (Authority Dashboard): triggered on event creation + decision
 *
 * Triggers:
 *   - onEventCreated   — fires when a new event doc is created
 *   - onEventUpdated   — fires on organizer edits (re-runs risk/resources)
 *   - onDecisionMade   — fires when authority sets status to Approved/Rejected
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.manualRecompute = exports.recomputeRiskAndResources = exports.onDecisionMade = exports.onEventUpdated = exports.onEventCreated = void 0;
const app_1 = require("firebase-admin/app");
// Initialize firebase-admin before any function code runs.
(0, app_1.initializeApp)();
var onEventCreated_1 = require("./triggers/onEventCreated");
Object.defineProperty(exports, "onEventCreated", { enumerable: true, get: function () { return onEventCreated_1.onEventCreated; } });
Object.defineProperty(exports, "onEventUpdated", { enumerable: true, get: function () { return onEventCreated_1.onEventUpdated; } });
var onDecisionMade_1 = require("./triggers/onDecisionMade");
Object.defineProperty(exports, "onDecisionMade", { enumerable: true, get: function () { return onDecisionMade_1.onDecisionMade; } });
var computeRisk_1 = require("./triggers/computeRisk");
Object.defineProperty(exports, "recomputeRiskAndResources", { enumerable: true, get: function () { return computeRisk_1.recomputeRiskAndResources; } });
// HTTP-callable functions (e.g. for manual authority re-trigger, seed runs)
var manualRecompute_1 = require("./http/manualRecompute");
Object.defineProperty(exports, "manualRecompute", { enumerable: true, get: function () { return manualRecompute_1.manualRecompute; } });
//# sourceMappingURL=index.js.map