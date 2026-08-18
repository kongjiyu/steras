"use strict";
/**
 * Shared re-export of the risk+resource pipeline for HTTP-callable
 * `manualRecompute` and any other code paths that need to re-run.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recomputeRiskAndResources = recomputeRiskAndResources;
const onEventCreated_1 = require("./onEventCreated");
function recomputeRiskAndResources(eventId, authorization) {
    return (0, onEventCreated_1.runRiskAndResourcePipeline)(eventId, Date.now(), true, authorization);
}
//# sourceMappingURL=computeRisk.js.map