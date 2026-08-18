import {
  DeterministicCategoryResult,
  HARD_RULE_VERSION,
  HazardDomain,
  ScoreRating,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';

export interface CategoryHardRuleConstraint {
  ruleId: string;
  version: typeof HARD_RULE_VERSION;
  categoryId: HazardDomain;
  likelihoodFloor: ScoreRating;
  severityFloor: ScoreRating;
  rationale: string;
  guidelineReferences: string[];
  sourceHazardId?: string;
}

export function evaluateCategoryHardRules(
  baseline: DeterministicCategoryResult,
): CategoryHardRuleConstraint[] {
  return ACTIVE_CATEGORY_SCHEMA.categories.map((category) => {
    const domain = baseline.domainSummaries?.find((item) => item.domain === category.id);
    const hazard = baseline.hazards?.find((item) => item.hazardId === domain?.dominantHazardId);
    const likelihoodFloor = hazard?.residualLikelihood ?? 1;
    const severityFloor = hazard?.residualSeverity ?? 1;
    return {
      ruleId: `hard-floor.${HARD_RULE_VERSION}.${category.id}.${hazard?.hazardId ?? 'domain-default'}`,
      version: HARD_RULE_VERSION,
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
