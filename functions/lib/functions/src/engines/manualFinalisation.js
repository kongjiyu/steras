"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateManualAssessmentInput = validateManualAssessmentInput;
exports.buildManualAssessment = buildManualAssessment;
exports.buildManualOfficialAssessmentResult = buildManualOfficialAssessmentResult;
exports.sameManualAssessment = sameManualAssessment;
exports.isManualAssessmentSourceEligible = isManualAssessmentSourceEligible;
exports.eligibleEvidenceKeys = eligibleEvidenceKeys;
const node_crypto_1 = require("node:crypto");
const types_1 = require("../../../shared/types");
const categorySchema_1 = require("../config/categorySchema");
const ruleBased_1 = require("./ruleBased");
const hardRuleEvaluator_1 = require("./hardRuleEvaluator");
const resourceCalculator_1 = require("./resourceCalculator");
const CATEGORY_IDS = categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => category.id);
function validateManualAssessmentInput(input, evidence) {
    const errors = [];
    if (!isRecord(input))
        return ['input'];
    const hazards = input.hazards;
    const categories = input.categories;
    if (!Array.isArray(hazards) || hazards.length < 1 || hazards.length > 40)
        errors.push('hazard-count');
    if (!Array.isArray(categories) || categories.length !== CATEGORY_IDS.length)
        errors.push('category-count');
    if (!validText(input.rationale, 20, 2000))
        errors.push('assessment-rationale');
    if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey))
        errors.push('idempotency-key');
    const eligible = eligibleEvidenceKeys(evidence);
    const hazardIds = new Set();
    if (Array.isArray(hazards))
        for (const raw of hazards) {
            if (!isRecord(raw)
                || !validText(raw.hazardId, 1, 100) || hazardIds.has(raw.hazardId)
                || !validText(raw.hazardName, 3, 200)
                || !CATEGORY_IDS.includes(raw.categoryId)
                || !validEvidenceReferences(raw.evidenceReferences, eligible, eligible.size > 0)
                || !validText(raw.rationale, 10, 1000))
                errors.push('hazard');
            else
                hazardIds.add(raw.hazardId);
        }
    const seen = new Set();
    if (Array.isArray(categories))
        for (const raw of categories) {
            if (!isRecord(raw) || !CATEGORY_IDS.includes(raw.categoryId) || seen.has(raw.categoryId)) {
                errors.push('category');
                continue;
            }
            seen.add(raw.categoryId);
            if (!isScore(raw.likelihood) || !isScore(raw.severity))
                errors.push(`score-${raw.categoryId}`);
            if (!validText(raw.rationale, 10, 1000))
                errors.push(`rationale-${raw.categoryId}`);
            if (!validEvidenceReferences(raw.evidenceReferences, eligible, false))
                errors.push(`evidence-${raw.categoryId}`);
            const refs = Array.isArray(raw.evidenceReferences) ? raw.evidenceReferences : [];
            if (refs.length === 0 && !validText(raw.missingInformation, 10, 1000))
                errors.push(`missing-information-${raw.categoryId}`);
            if (refs.length > 0 && (typeof raw.missingInformation !== 'string' || raw.missingInformation.length > 1000))
                errors.push(`missing-information-${raw.categoryId}`);
        }
    if (CATEGORY_IDS.some((categoryId) => !seen.has(categoryId)))
        errors.push('missing-category');
    return [...new Set(errors)];
}
function buildManualAssessment(args) {
    const errors = validateManualAssessmentInput(args.input, args.assessment.evidence);
    if (errors.length)
        throw new Error(`invalid-manual-assessment:${errors.join(',')}`);
    return {
        manualAssessmentId: args.manualAssessmentId,
        schemaVersion: types_1.MANUAL_ASSESSMENT_SCHEMA_VERSION,
        eventId: args.assessment.eventId,
        versionId: args.assessment.versionId,
        assessmentId: args.assessment.assessmentId,
        assessmentInputHash: args.assessment.inputHash,
        eventVersionInputHash: args.eventVersionInputHash,
        categorySchemaVersion: types_1.CATEGORY_SCHEMA_VERSION,
        hardRuleVersion: types_1.HARD_RULE_VERSION,
        officialFormulaVersion: types_1.MANUAL_OFFICIAL_FORMULA_VERSION,
        hazards: args.input.hazards.map((hazard) => ({ ...hazard, evidenceReferences: [...hazard.evidenceReferences], rationale: hazard.rationale.trim(), hazardName: hazard.hazardName.trim() })),
        categories: args.input.categories.map((category) => ({ ...category, evidenceReferences: [...category.evidenceReferences], rationale: category.rationale.trim(), missingInformation: category.missingInformation.trim() })),
        rationale: args.input.rationale.trim(),
        submittedBy: args.submittedBy,
        idempotencyKey: args.input.idempotencyKey,
        createdAt: args.createdAt,
    };
}
function buildManualOfficialAssessmentResult(args) {
    const { assessment, manualAssessment, eventDetails, eventVersionInputHash, finalizedAt, finalizedBy } = args;
    assertManualRecordIdentity(assessment, manualAssessment, eventVersionInputHash, finalizedBy);
    const validation = validateManualAssessmentInput(manualAssessment, assessment.evidence);
    if (validation.length)
        throw new Error(`invalid-manual-assessment:${validation.join(',')}`);
    const baseline = (0, ruleBased_1.computeCategoryBasedAssessment)({ eventId: assessment.eventId, eventDetails }, assessment.contextSnapshot, assessment.createdAt);
    const constraints = new Map((0, hardRuleEvaluator_1.evaluateCategoryHardRules)(baseline).map((constraint) => [constraint.categoryId, constraint]));
    const inputs = new Map(manualAssessment.categories.map((category) => [category.categoryId, category]));
    let weightedScore = 0;
    let highestCategoryRiskLevel = 'Low';
    const categories = categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((definition) => {
        const input = inputs.get(definition.id);
        const constraint = constraints.get(definition.id);
        if (!input || !constraint)
            throw new Error(`missing-manual-category:${definition.id}`);
        const validatedLikelihood = Math.max(input.likelihood, constraint.likelihoodFloor);
        const validatedSeverity = Math.max(input.severity, constraint.severityFloor);
        const appliedHardRules = [];
        if (validatedLikelihood > input.likelihood)
            appliedHardRules.push({
                ruleId: `${constraint.ruleId}.likelihood`, categoryId: definition.id, axis: 'likelihood',
                proposedValue: input.likelihood, constrainedValue: validatedLikelihood,
                rationale: `${constraint.rationale} The likelihood floor is ${constraint.likelihoodFloor}.`,
                guidelineReferences: [...constraint.guidelineReferences],
            });
        if (validatedSeverity > input.severity)
            appliedHardRules.push({
                ruleId: `${constraint.ruleId}.severity`, categoryId: definition.id, axis: 'severity',
                proposedValue: input.severity, constrainedValue: validatedSeverity,
                rationale: `${constraint.rationale} The severity floor is ${constraint.severityFloor}.`,
                guidelineReferences: [...constraint.guidelineReferences],
            });
        const matrixScore = validatedLikelihood * validatedSeverity;
        const normalizedScore = matrixScore * 4;
        const weightedContribution = round(normalizedScore * definition.weight);
        const riskLevel = (0, types_1.hirarcRiskLevelFor)(matrixScore);
        weightedScore += normalizedScore * definition.weight;
        highestCategoryRiskLevel = higherRisk(highestCategoryRiskLevel, riskLevel);
        return {
            categoryId: definition.id, categoryName: definition.name,
            manualLikelihood: input.likelihood, manualSeverity: input.severity,
            validatedLikelihood, validatedSeverity, matrixScore, normalizedScore, riskLevel,
            weight: definition.weight, weightedContribution,
            evidenceReferences: [...input.evidenceReferences], rationale: input.rationale,
            missingInformation: input.missingInformation, appliedHardRules,
            guidelineChecks: [...definition.guidelineChecks],
        };
    });
    const overallScore = round(weightedScore);
    const weightedRiskLevel = (0, types_1.riskLevelFor)(overallScore);
    const officialInputHash = (0, node_crypto_1.createHash)('sha256').update((0, resourceCalculator_1.stableStringify)({
        formulaVersion: types_1.MANUAL_OFFICIAL_FORMULA_VERSION,
        categorySchemaVersion: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.version,
        hardRuleVersion: types_1.HARD_RULE_VERSION,
        assessmentSchemaVersion: assessment.schemaVersion,
        assessmentInputHash: assessment.inputHash,
        eventVersionInputHash: manualAssessment.eventVersionInputHash,
        eventDetails,
        aiAttempt: assessment.aiProposal,
        contextSnapshot: assessment.contextSnapshot,
        evidence: assessment.evidence,
        manualAssessment,
    })).digest('hex');
    const result = {
        sourceKind: 'admin_manual', manualAssessmentId: manualAssessment.manualAssessmentId,
        manualHazards: manualAssessment.hazards.map((hazard) => ({ ...hazard, evidenceReferences: [...hazard.evidenceReferences] })),
        categories, overallScore, weightedRiskLevel, highestCategoryRiskLevel,
        overallRiskLevel: higherRisk(weightedRiskLevel, highestCategoryRiskLevel),
        formulaVersion: types_1.MANUAL_OFFICIAL_FORMULA_VERSION,
        categorySchemaVersion: categorySchema_1.ACTIVE_CATEGORY_SCHEMA.version,
        hardRuleVersion: types_1.HARD_RULE_VERSION,
        officialInputHash, calculatedAt: finalizedAt, finalizedAt, finalizedBy,
    };
    const resultErrors = (0, resourceCalculator_1.validateManualOfficialAssessmentResult)(result);
    if (resultErrors.length)
        throw new Error(`invalid-manual-official-result:${resultErrors.join(',')}`);
    return result;
}
function sameManualAssessment(stored, proposed) {
    return (0, resourceCalculator_1.stableStringify)(stored) === (0, resourceCalculator_1.stableStringify)(proposed);
}
function isManualAssessmentSourceEligible(assessment) {
    if (assessment.aiProposal === null)
        return assessment.assessmentReadiness === 'insufficient_data';
    if (!isRecord(assessment.aiProposal))
        return false;
    const attempt = assessment.aiProposal;
    if (attempt.status === 'success' || !['unavailable', 'timeout', 'invalid'].includes(String(attempt.status)))
        return false;
    return typeof attempt.model === 'string' && Boolean(attempt.model.trim())
        && typeof attempt.promptVersion === 'string' && Boolean(attempt.promptVersion.trim())
        && typeof attempt.responseSchemaVersion === 'string' && Boolean(attempt.responseSchemaVersion.trim())
        && typeof attempt.retryable === 'boolean'
        && typeof attempt.errorSummary === 'string' && Boolean(attempt.errorSummary.trim())
        && attempt.cacheStatus === 'not-applicable'
        && Number.isFinite(attempt.generatedAt);
}
function assertManualRecordIdentity(assessment, manual, eventVersionInputHash, finalizedBy) {
    if (!isManualAssessmentSourceEligible(assessment)
        || manual.schemaVersion !== types_1.MANUAL_ASSESSMENT_SCHEMA_VERSION
        || !isSafeManualAssessmentId(manual.manualAssessmentId)
        || manual.eventId !== assessment.eventId || manual.versionId !== assessment.versionId
        || manual.assessmentId !== assessment.assessmentId || manual.assessmentInputHash !== assessment.inputHash
        || typeof eventVersionInputHash !== 'string' || !eventVersionInputHash
        || manual.eventVersionInputHash !== eventVersionInputHash
        || manual.categorySchemaVersion !== types_1.CATEGORY_SCHEMA_VERSION || manual.hardRuleVersion !== types_1.HARD_RULE_VERSION
        || manual.officialFormulaVersion !== types_1.MANUAL_OFFICIAL_FORMULA_VERSION
        || typeof manual.submittedBy !== 'string' || !manual.submittedBy
        || typeof finalizedBy !== 'string' || !finalizedBy
        || !Number.isFinite(manual.createdAt))
        throw new Error('manual-assessment-identity-mismatch');
}
function isSafeManualAssessmentId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function eligibleEvidenceKeys(evidence) {
    if (!Array.isArray(evidence))
        return new Set();
    return new Set(evidence.filter((item) => item && item.eligibility === 'eligible' && item.quality !== 'missing'
        && typeof item.status === 'string'
        && !['unavailable', 'unmatched', 'missing'].includes(item.status.trim().toLowerCase()))
        .map((item) => item.key));
}
function validEvidenceReferences(value, eligible, requireOne) {
    return Array.isArray(value) && (!requireOne || value.length > 0)
        && new Set(value).size === value.length
        && value.every((reference) => typeof reference === 'string' && eligible.has(reference));
}
function validText(value, min, max) {
    return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}
function isScore(value) {
    return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function higherRisk(left, right) {
    const rank = { Low: 0, Medium: 1, High: 2 };
    return rank[left] >= rank[right] ? left : right;
}
//# sourceMappingURL=manualFinalisation.js.map