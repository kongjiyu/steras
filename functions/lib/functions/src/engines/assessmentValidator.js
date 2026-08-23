"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAndCalculateProvisional = validateAndCalculateProvisional;
const types_1 = require("../../../shared/types");
const categorySchema_1 = require("../config/categorySchema");
const hardRuleEvaluator_1 = require("./hardRuleEvaluator");
const proposalContract_1 = require("./proposalContract");
function validateAndCalculateProvisional(proposal, baseline, now = Date.now()) {
    const warnings = [];
    const proposalCategoryIds = proposal.categories.map((category) => category.categoryId);
    if (proposalCategoryIds.length !== categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.length
        || new Set(proposalCategoryIds).size !== proposalCategoryIds.length
        || proposalCategoryIds.some((categoryId) => !categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.some((definition) => definition.id === categoryId))) {
        return invalid(warnings, 'MiniMax categories must contain every configured category exactly once.');
    }
    if ((0, proposalContract_1.hasCanonicalDuplicateHazardIds)(proposal.hazards.map((hazard) => hazard.hazardId))) {
        return invalid(warnings, 'MiniMax hazards contain duplicate normalized hazard IDs.');
    }
    if ([...proposal.categories, ...proposal.hazards].some((item) => !(0, proposalContract_1.isCanonicalEvidenceReferenceList)(item.evidenceReferences))) {
        return invalid(warnings, 'MiniMax proposal contains duplicate evidence references.');
    }
    const eligibleEvidence = new Set(baseline.evidence.filter(isEligibleEvidence).map((item) => item.key));
    const hardRules = new Map((0, hardRuleEvaluator_1.evaluateCategoryHardRules)(baseline).map((rule) => [rule.categoryId, rule]));
    const categories = [];
    const validatedHazards = proposal.hazards.flatMap((hazard) => {
        const evidenceReferences = hazard.evidenceReferences.filter((key) => eligibleEvidence.has(key));
        const unsupported = hazard.evidenceReferences.filter((key) => !eligibleEvidence.has(key));
        if (unsupported.length > 0) {
            warnings.push(warning('unsupported_evidence_reference', hazard.categoryId, `Unsupported evidence references were removed from hazard ${hazard.hazardId}: ${unsupported.join(', ')}.`, unsupported));
        }
        if (evidenceReferences.length === 0) {
            warnings.push(warning('missing_evidence', hazard.categoryId, `Hazard ${hazard.hazardId} was omitted because it has no eligible evidence reference.`, []));
            return [];
        }
        return [{ ...hazard, evidenceReferences }];
    });
    for (const definition of categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories) {
        const proposed = proposal.categories.find((category) => category.categoryId === definition.id);
        if (!proposed) {
            return invalid(warnings, `MiniMax did not return category ${definition.id}.`);
        }
        const evidenceReferences = proposed.evidenceReferences.filter((key) => eligibleEvidence.has(key));
        const unsupported = proposed.evidenceReferences.filter((key) => !eligibleEvidence.has(key));
        if (unsupported.length > 0) {
            warnings.push(warning('unsupported_evidence_reference', definition.id, `Unsupported evidence references were removed: ${unsupported.join(', ')}.`, unsupported));
        }
        if (evidenceReferences.length === 0) {
            warnings.push(warning('missing_evidence', definition.id, 'No eligible evidence reference remained after validation.', []));
            return invalid(warnings, `Category ${definition.id} has no eligible evidence reference.`);
        }
        if (proposed.confidence === 'low') {
            warnings.push(warning('low_confidence', definition.id, 'MiniMax marked this category as low confidence.', evidenceReferences));
        }
        if (proposed.missingInformation.length > 0) {
            warnings.push(warning('missing_evidence', definition.id, `MiniMax reported missing information: ${proposed.missingInformation.join('; ')}.`, evidenceReferences));
        }
        const hardRule = hardRules.get(definition.id);
        if (!hardRule)
            return invalid(warnings, `No hard-rule constraint exists for category ${definition.id}.`);
        categories.push(validateCategory(proposed, definition, hardRule, evidenceReferences, warnings));
    }
    const overallScore = round(categories.reduce((total, category) => total + category.normalizedScore * category.weight, 0));
    const weightedRiskLevel = (0, types_1.riskLevelFor)(overallScore);
    const highestCategoryRiskLevel = categories.reduce((highest, category) => higherRisk(highest, category.riskLevel), 'Low');
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
            formulaVersion: types_1.PROVISIONAL_FORMULA_VERSION,
            categorySchemaVersion: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.version,
            hardRuleVersion: types_1.HARD_RULE_VERSION,
            calculatedAt: now,
        },
    };
}
function isEligibleEvidence(item) {
    if (item.eligibility !== 'eligible')
        return false;
    if (item.quality === 'missing')
        return false;
    return !new Set(['unavailable', 'unmatched', 'missing']).has(item.status.trim().toLowerCase());
}
function validateCategory(proposed, definition, hardRule, evidenceReferences, warnings) {
    const appliedHardRules = [];
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
        riskLevel: (0, types_1.hirarcRiskLevelFor)(matrixScore),
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
function applyFloor(proposed, floor, axis, hardRule, applied, warnings) {
    if (proposed >= floor)
        return proposed;
    const rule = {
        ruleId: `${hardRule.ruleId}.${axis}`,
        categoryId: hardRule.categoryId,
        axis,
        proposedValue: proposed,
        constrainedValue: floor,
        rationale: `${hardRule.rationale} The ${axis} floor is ${floor}.`,
        guidelineReferences: [...hardRule.guidelineReferences],
    };
    applied.push(rule);
    warnings.push(warning('hard_rule_adjustment', hardRule.categoryId, `${axis} was raised from ${proposed} to ${floor} by ${rule.ruleId}.`, []));
    return floor;
}
function warning(code, categoryId, message, evidenceReferences) {
    return {
        warningId: `${code}.${categoryId}.${message.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`,
        code,
        categoryId,
        message,
        evidenceReferences,
    };
}
function invalid(warnings, reason) {
    return { ok: false, warnings, reason };
}
function higherRisk(left, right) {
    const order = { Low: 0, Medium: 1, High: 2 };
    return order[left] >= order[right] ? left : right;
}
function round(value) {
    return Math.round(value * 100) / 100;
}
//# sourceMappingURL=assessmentValidator.js.map