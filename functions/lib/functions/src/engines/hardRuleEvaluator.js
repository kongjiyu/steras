"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCategoryHardRules = evaluateCategoryHardRules;
const types_1 = require("../../../shared/types");
const categorySchema_1 = require("../config/categorySchema");
function evaluateCategoryHardRules(baseline) {
    return categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => {
        const domain = baseline.domainSummaries?.find((item) => item.domain === category.id);
        const hazard = baseline.hazards?.find((item) => item.hazardId === domain?.dominantHazardId);
        const likelihoodFloor = hazard?.residualLikelihood ?? 1;
        const severityFloor = hazard?.residualSeverity ?? 1;
        return {
            ruleId: `hard-floor.${types_1.HARD_RULE_VERSION}.${category.id}.${hazard?.hazardId ?? 'domain-default'}`,
            version: types_1.HARD_RULE_VERSION,
            categoryId: category.id,
            likelihoodFloor,
            severityFloor,
            rationale: hazard
                ? `${hazard.hazardName} sets the category residual floor at ${likelihoodFloor}×${severityFloor}.`
                : `No deterministic hazard was available; the minimum HIRARC floor 1×1 applies to ${category.name}.`,
            guidelineReferences: [...(hazard?.guidelineChecks ?? category.guidelineChecks)],
            ...(hazard ? { sourceHazardId: hazard.hazardId } : {}),
        };
    });
}
//# sourceMappingURL=hardRuleEvaluator.js.map