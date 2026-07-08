"use strict";
/**
 * Shared re-export of the risk+resource pipeline for HTTP-callable
 * `manualRecompute` and any other code paths that need to re-run.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recomputeRiskAndResources = void 0;
var onEventCreated_1 = require("./onEventCreated");
Object.defineProperty(exports, "recomputeRiskAndResources", { enumerable: true, get: function () { return onEventCreated_1.runRiskAndResourcePipeline; } });
//# sourceMappingURL=computeRisk.js.map