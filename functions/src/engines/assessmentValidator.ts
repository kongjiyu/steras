import {
  AICategoryProposal,
  AISuccessfulProposal,
  AppliedHardRule,
  DeterministicCategoryResult,
  EvidenceKey,
  HARD_RULE_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  ProvisionalAssessmentResult,
  RiskLevel,
  ScoreRating,
  ValidatedCategoryResult,
  ValidationWarning,
  hirarcRiskLevelFor,
  riskLevelFor,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { CategoryHardRuleConstraint, evaluateCategoryHardRules } from './hardRuleEvaluator';
import { hasCanonicalDuplicateHazardIds, isCanonicalEvidenceReferenceList } from './proposalContract';

export type ProvisionalValidationResult =
  | { ok: true; warnings: ValidationWarning[]; result: ProvisionalAssessmentResult }
  | { ok: false; warnings: ValidationWarning[]; reason: string };

export function validateAndCalculateProvisional(
  proposal: AISuccessfulProposal,
  baseline: DeterministicCategoryResult,
  now = Date.now(),
): ProvisionalValidationResult {
  const warnings: ValidationWarning[] = [];
  const proposalCategoryIds = proposal.categories.map((category) => category.categoryId);
  if (proposalCategoryIds.length !== ACTIVE_CATEGORY_SCHEMA.categories.length
    || new Set(proposalCategoryIds).size !== proposalCategoryIds.length
    || proposalCategoryIds.some((categoryId) => !ACTIVE_CATEGORY_SCHEMA.categories.some((definition) => definition.id === categoryId))) {
    return invalid(warnings, 'MiniMax categories must contain every configured category exactly once.');
  }
  if (hasCanonicalDuplicateHazardIds(proposal.hazards.map((hazard) => hazard.hazardId))) {
    return invalid(warnings, 'MiniMax hazards contain duplicate normalized hazard IDs.');
  }
  if ([...proposal.categories, ...proposal.hazards].some((item) => !isCanonicalEvidenceReferenceList(item.evidenceReferences))) {
    return invalid(warnings, 'MiniMax proposal contains duplicate evidence references.');
  }
  const eligibleEvidence = new Set(baseline.evidence.filter(isEligibleEvidence).map((item) => item.key));
  const hardRules = new Map(evaluateCategoryHardRules(baseline).map((rule) => [rule.categoryId, rule]));
  const categories: ValidatedCategoryResult[] = [];
  const validatedHazards = proposal.hazards.flatMap((hazard) => {
    const evidenceReferences = hazard.evidenceReferences.filter((key) => eligibleEvidence.has(key));
    const unsupported = hazard.evidenceReferences.filter((key) => !eligibleEvidence.has(key));
    if (unsupported.length > 0) {
      warnings.push(warning(
        'unsupported_evidence_reference',
        hazard.categoryId,
        `Unsupported evidence references were removed from hazard ${hazard.hazardId}: ${unsupported.join(', ')}.`,
        unsupported,
      ));
    }
    if (evidenceReferences.length === 0) {
      warnings.push(warning(
        'missing_evidence',
        hazard.categoryId,
        `Hazard ${hazard.hazardId} was omitted because it has no eligible evidence reference.`,
        [],
      ));
      return [];
    }
    return [{ ...hazard, evidenceReferences }];
  });

  for (const definition of ACTIVE_CATEGORY_SCHEMA.categories) {
    const proposed = proposal.categories.find((category) => category.categoryId === definition.id);
    if (!proposed) {
      return invalid(warnings, `MiniMax did not return category ${definition.id}.`);
    }
    const evidenceReferences = proposed.evidenceReferences.filter((key) => eligibleEvidence.has(key));
    const unsupported = proposed.evidenceReferences.filter((key) => !eligibleEvidence.has(key));
    if (unsupported.length > 0) {
      warnings.push(warning(
        'unsupported_evidence_reference',
        definition.id,
        `Unsupported evidence references were removed: ${unsupported.join(', ')}.`,
        unsupported,
      ));
    }
    if (evidenceReferences.length === 0) {
      warnings.push(warning('missing_evidence', definition.id, 'No eligible evidence reference remained after validation.', []));
      return invalid(warnings, `Category ${definition.id} has no eligible evidence reference.`);
    }
    if (proposed.confidence === 'low') {
      warnings.push(warning('low_confidence', definition.id, 'MiniMax marked this category as low confidence.', evidenceReferences));
    }
    if (proposed.missingInformation.length > 0) {
      warnings.push(warning(
        'missing_evidence',
        definition.id,
        `MiniMax reported missing information: ${proposed.missingInformation.join('; ')}.`,
        evidenceReferences,
      ));
    }
    const hardRule = hardRules.get(definition.id);
    if (!hardRule) return invalid(warnings, `No hard-rule constraint exists for category ${definition.id}.`);
    categories.push(validateCategory(proposed, definition, hardRule, evidenceReferences, warnings));
  }

  const overallScore = round(categories.reduce(
    (total, category) => total + category.normalizedScore * category.weight,
    0,
  ));
  const weightedRiskLevel = riskLevelFor(overallScore);
  const highestCategoryRiskLevel = categories.reduce<RiskLevel>(
    (highest, category) => higherRisk(highest, category.riskLevel),
    'Low',
  );
  return {
    ok: true,
    warnings,
    result: {
      proposalId: proposal.proposalId,
      validatedHazards,
      categories,
      overallScore,
      weightedRiskLevel,
      highestCategoryRiskLevel,
      overallRiskLevel: higherRisk(weightedRiskLevel, highestCategoryRiskLevel),
      formulaVersion: PROVISIONAL_FORMULA_VERSION,
      categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
      hardRuleVersion: HARD_RULE_VERSION,
      calculatedAt: now,
    },
  };
}

function isEligibleEvidence(item: DeterministicCategoryResult['evidence'][number]): boolean {
  if (item.eligibility !== 'eligible') return false;
  if (item.quality === 'missing') return false;
  return !new Set(['unavailable', 'unmatched', 'missing']).has(item.status.trim().toLowerCase());
}

function validateCategory(
  proposed: AICategoryProposal,
  definition: (typeof ACTIVE_CATEGORY_SCHEMA.categories)[number],
  hardRule: CategoryHardRuleConstraint,
  evidenceReferences: EvidenceKey[],
  warnings: ValidationWarning[],
): ValidatedCategoryResult {
  const appliedHardRules: AppliedHardRule[] = [];
  const validatedLikelihood = applyFloor(proposed.likelihood, hardRule.likelihoodFloor, 'likelihood', hardRule, appliedHardRules, warnings);
  const validatedSeverity = applyFloor(proposed.severity, hardRule.severityFloor, 'severity', hardRule, appliedHardRules, warnings);
  const matrixScore = validatedLikelihood * validatedSeverity;
  const normalizedScore = matrixScore * 4;
  const weight = definition.weight;

  return {
    categoryId: proposed.categoryId,
    categoryName: definition.name,
    proposedLikelihood: proposed.likelihood,
    proposedSeverity: proposed.severity,
    validatedLikelihood,
    validatedSeverity,
    matrixScore,
    normalizedScore,
    riskLevel: hirarcRiskLevelFor(matrixScore),
    weight,
    weightedContribution: round(normalizedScore * weight),
    evidenceReferences,
    rationale: proposed.rationale,
    confidence: proposed.confidence,
    concerns: proposed.concerns,
    missingInformation: proposed.missingInformation,
    appliedHardRules,
    guidelineChecks: [...definition.guidelineChecks],
  };
}

function applyFloor(
  proposed: ScoreRating,
  floor: ScoreRating,
  axis: 'likelihood' | 'severity',
  hardRule: CategoryHardRuleConstraint,
  applied: AppliedHardRule[],
  warnings: ValidationWarning[],
): ScoreRating {
  if (proposed >= floor) return proposed;
  const rule: AppliedHardRule = {
    ruleId: `${hardRule.ruleId}.${axis}`,
    categoryId: hardRule.categoryId,
    axis,
    proposedValue: proposed,
    constrainedValue: floor,
    rationale: `${hardRule.rationale} The ${axis} floor is ${floor}.`,
    guidelineReferences: [...hardRule.guidelineReferences],
  };
  applied.push(rule);
  warnings.push(warning(
    'hard_rule_adjustment',
    hardRule.categoryId,
    `${axis} was raised from ${proposed} to ${floor} by ${rule.ruleId}.`,
    [],
  ));
  return floor;
}

function warning(
  code: ValidationWarning['code'],
  categoryId: string,
  message: string,
  evidenceReferences: EvidenceKey[],
): ValidationWarning {
  return {
    warningId: `${code}.${categoryId}.${message.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`,
    code,
    categoryId,
    message,
    evidenceReferences,
  };
}

function invalid(warnings: ValidationWarning[], reason: string): ProvisionalValidationResult {
  return { ok: false, warnings, reason };
}

function higherRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  const order: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2 };
  return order[left] >= order[right] ? left : right;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
