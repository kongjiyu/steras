"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeResources = computeResources;
exports.validateProvisionalAssessmentResult = validateProvisionalAssessmentResult;
exports.validateAssessmentResultAgainstProposal = validateAssessmentResultAgainstProposal;
exports.validateAssessmentResultAgainstHardRules = validateAssessmentResultAgainstHardRules;
exports.stableStringify = stableStringify;
exports.matchesDeterministicResourceItems = matchesDeterministicResourceItems;
const node_crypto_1 = require("node:crypto");
const types_1 = require("../../../shared/types");
const resourceRecommendationConfig_1 = require("../config/resourceRecommendationConfig");
const categorySchema_1 = require("../config/categorySchema");
const hardRuleEvaluator_1 = require("./hardRuleEvaluator");
class ResourceCalculationFault extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
/** Deterministic provisional calculation; callers add revision and timestamps. */
function computeResources(input, config = resourceRecommendationConfig_1.ACTIVE_RESOURCE_CONFIG) {
    try {
        validateInput(input, config);
        const source = numericSource(config);
        const categoryLevels = categoryRiskLevels(input.assessmentResult, config.assessmentCategoryIds);
        const items = Object.fromEntries(types_1.RESOURCE_KEYS.map((resource) => [
            resource,
            calculateItem(resource, input.eventDetails, input.assessmentResult.overallRiskLevel, categoryLevels, config, source),
        ]));
        validateCompleteItems(items);
        return {
            ok: true,
            resourceInputHash: resourceInputHash(input, config),
            formulaVersion: config.formulaVersion,
            configVersion: config.configVersion,
            sourceRegistryVersion: config.sourceRegistryVersion,
            items,
        };
    }
    catch (error) {
        if (error instanceof ResourceCalculationFault)
            return { ok: false, code: error.code, message: error.message };
        return {
            ok: false,
            code: 'unsafe_calculation',
            message: error instanceof Error ? error.message : 'Unknown resource calculation failure.',
        };
    }
}
function validateInput(input, config) {
    for (const [field, value] of Object.entries({
        eventId: input.eventId,
        versionId: input.versionId,
        assessmentId: input.assessmentId,
        proposalId: input.assessmentResult?.proposalId,
    })) {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new ResourceCalculationFault('missing_input', `${field} is required.`);
        }
    }
    const attendance = input.eventDetails?.expectedAttendance;
    if (attendance === undefined || attendance === null) {
        throw new ResourceCalculationFault('missing_input', 'expectedAttendance is required.');
    }
    if (!Number.isFinite(attendance) || !Number.isSafeInteger(attendance) || attendance <= 0) {
        throw new ResourceCalculationFault('invalid_input', 'expectedAttendance must be a positive safe integer.');
    }
    if (!(input.eventDetails.type in config.securityEventMultipliers)) {
        throw new ResourceCalculationFault('invalid_input', `Unsupported event type: ${String(input.eventDetails.type)}.`);
    }
    if (!['indoor', 'outdoor', 'mixed'].includes(input.eventDetails.environment)) {
        throw new ResourceCalculationFault('invalid_input', `Unsupported event environment: ${String(input.eventDetails.environment)}.`);
    }
    if (!isRiskLevel(input.assessmentResult.overallRiskLevel)) {
        throw new ResourceCalculationFault('invalid_input', 'Assessment overallRiskLevel is invalid.');
    }
    const assessmentErrors = validateProvisionalAssessmentResult(input.assessmentResult, config.assessmentCategoryIds);
    if (assessmentErrors.length > 0) {
        throw new ResourceCalculationFault('invalid_input', `Invalid provisional assessment result: ${assessmentErrors.join(', ')}.`);
    }
    const versions = [config.formulaVersion, config.configVersion, config.sourceRegistryVersion];
    if (versions.some((version) => typeof version !== 'string' || version.trim().length === 0)) {
        throw new ResourceCalculationFault('incomplete_provenance', 'Resource calculation versions are incomplete.');
    }
    if (!Number.isFinite(config.planningRangeMultiplier) || config.planningRangeMultiplier < 1) {
        throw new ResourceCalculationFault('invalid_input', 'Planning range multiplier must be finite and at least 1.');
    }
    for (const resource of types_1.RESOURCE_KEYS) {
        const baseline = config.baselines[resource];
        if (!baseline || !positiveFinite(baseline.divisor) || !nonNegativeSafeInteger(baseline.minimum)) {
            throw new ResourceCalculationFault('invalid_input', `Invalid baseline configuration for ${resource}.`);
        }
        if (!config.reviewingAuthorities[resource]) {
            throw new ResourceCalculationFault('incomplete_provenance', `Reviewing authority is missing for ${resource}.`);
        }
    }
    if (!positiveFinite(config.toiletSecondaryDivisor)) {
        throw new ResourceCalculationFault('invalid_input', 'Toilet secondary divisor must be positive and finite.');
    }
    for (const [eventType, multiplier] of Object.entries(config.securityEventMultipliers)) {
        if (!positiveFinite(multiplier)) {
            throw new ResourceCalculationFault('invalid_input', `Invalid security multiplier for ${eventType}.`);
        }
    }
    const modifierGroups = [
        config.highOverallModifiers,
        config.indoorModifiers,
        ...Object.values(config.highCategoryModifiers),
    ];
    for (const modifiers of modifierGroups) {
        for (const [resource, modifier] of Object.entries(modifiers)) {
            if (!nonNegativeSafeInteger(modifier)) {
                throw new ResourceCalculationFault('invalid_input', `Invalid resource modifier for ${resource}.`);
            }
        }
    }
}
function numericSource(config) {
    const source = resourceRecommendationConfig_1.RESOURCE_SOURCE_REGISTRY[config.numericSourceId];
    if (!source || source.verificationStatus !== 'prototype_unverified' || source.kind !== 'internal_prototype') {
        throw new ResourceCalculationFault('incomplete_provenance', 'Numeric resource rules require an internal prototype_unverified source snapshot.');
    }
    return { ...source };
}
function categoryRiskLevels(result, expectedCategoryIds) {
    if (!Array.isArray(result.categories)) {
        throw new ResourceCalculationFault('missing_input', 'Assessment categories are required.');
    }
    const levels = new Map();
    for (const category of result.categories) {
        if (levels.has(category.categoryId)) {
            throw new ResourceCalculationFault('invalid_input', `Duplicate assessment category: ${category.categoryId}.`);
        }
        if (!isRiskLevel(category.riskLevel)) {
            throw new ResourceCalculationFault('invalid_input', `Invalid risk level for category ${category.categoryId}.`);
        }
        levels.set(category.categoryId, category.riskLevel);
    }
    if (levels.size !== expectedCategoryIds.length) {
        throw new ResourceCalculationFault('missing_input', 'The complete validated assessment category set is required.');
    }
    for (const required of expectedCategoryIds) {
        if (!levels.has(required)) {
            throw new ResourceCalculationFault('missing_input', `Required assessment category is missing: ${required}.`);
        }
    }
    for (const categoryId of levels.keys()) {
        if (!expectedCategoryIds.includes(categoryId)) {
            throw new ResourceCalculationFault('invalid_input', `Unknown assessment category: ${categoryId}.`);
        }
    }
    return levels;
}
function calculateItem(resource, details, overallRisk, categoryLevels, config, source) {
    const attendanceReference = {
        inputId: 'event.expectedAttendance', kind: 'event_field', path: 'eventDetails.expectedAttendance', value: details.expectedAttendance,
    };
    const overallReference = {
        inputId: 'assessment.overallRiskLevel',
        kind: 'assessment_overall',
        path: 'assessmentResult.overallRiskLevel',
        value: overallRisk,
    };
    const inputReferences = [attendanceReference, overallReference];
    const appliedRules = [];
    const baselineConfig = config.baselines[resource];
    let baseline;
    if (resource === 'security') {
        const eventTypeReference = {
            inputId: 'event.type', kind: 'event_field', path: 'eventDetails.type', value: details.type,
        };
        inputReferences.push(eventTypeReference);
        const attendanceBase = safeCeil(details.expectedAttendance / baselineConfig.divisor, `${resource} attendance ratio`);
        const multiplier = config.securityEventMultipliers[details.type];
        baseline = Math.max(baselineConfig.minimum, safeCeil(attendanceBase * multiplier, `${resource} event type multiplier`));
        appliedRules.push(rule('resource.security.attendance-event-type', `Ceiling of 1 per ${baselineConfig.divisor} attendees, multiplied by ${multiplier} for ${details.type}, with minimum ${baselineConfig.minimum}.`, [attendanceReference.inputId, eventTypeReference.inputId], source.sourceId, baseline));
    }
    else if (resource === 'toilets') {
        const primary = safeCeil(details.expectedAttendance / baselineConfig.divisor, 'toilets primary attendance ratio');
        const secondary = safeCeil(details.expectedAttendance / config.toiletSecondaryDivisor, 'toilets secondary attendance ratio');
        baseline = Math.max(baselineConfig.minimum, safeAdd(primary, secondary, 'toilets combined attendance ratios'));
        appliedRules.push(rule('resource.toilets.combined-attendance', `Sum of ceilings at 1 per ${baselineConfig.divisor} and 1 per ${config.toiletSecondaryDivisor} attendees, with minimum ${baselineConfig.minimum}.`, [attendanceReference.inputId], source.sourceId, baseline));
    }
    else {
        const attendanceBase = safeCeil(details.expectedAttendance / baselineConfig.divisor, `${resource} attendance ratio`);
        baseline = Math.max(baselineConfig.minimum, attendanceBase);
        appliedRules.push(rule(`resource.${resource}.attendance`, `Ceiling of 1 per ${baselineConfig.divisor} attendees with minimum ${baselineConfig.minimum}.`, [attendanceReference.inputId], source.sourceId, baseline));
    }
    const overallModifier = config.highOverallModifiers[resource] ?? 0;
    if (overallModifier > 0) {
        if (overallRisk === 'High') {
            baseline = safeAdd(baseline, overallModifier, `${resource} overall risk modifier`);
            appliedRules.push(rule(`resource.${resource}.high-overall-risk`, 'Add the configured high overall risk uplift.', [overallReference.inputId], source.sourceId, overallModifier));
        }
    }
    for (const categoryId of ['crowd', 'weather_environment', 'venue_fire']) {
        const modifier = config.highCategoryModifiers[categoryId]?.[resource] ?? 0;
        if (modifier <= 0)
            continue;
        const reference = {
            inputId: `assessment.category.${categoryId}.riskLevel`,
            kind: 'assessment_category',
            path: `assessmentResult.categories.${categoryId}.riskLevel`,
            value: categoryLevels.get(categoryId),
        };
        inputReferences.push(reference);
        if (reference.value === 'High') {
            baseline = safeAdd(baseline, modifier, `${resource} ${categoryId} modifier`);
            appliedRules.push(rule(`resource.${resource}.high-${categoryId}`, `Add the configured uplift when ${categoryId} risk is High.`, [reference.inputId], source.sourceId, modifier));
        }
    }
    const indoorModifier = config.indoorModifiers[resource] ?? 0;
    if (indoorModifier > 0) {
        const reference = {
            inputId: 'event.environment', kind: 'event_field', path: 'eventDetails.environment', value: details.environment,
        };
        inputReferences.push(reference);
        if (details.environment === 'indoor') {
            baseline = safeAdd(baseline, indoorModifier, `${resource} indoor modifier`);
            appliedRules.push(rule(`resource.${resource}.indoor`, 'Add the configured indoor-event uplift.', [reference.inputId], source.sourceId, indoorModifier));
        }
    }
    const planningMax = safeCeil(baseline * config.planningRangeMultiplier, `${resource} planning range`);
    appliedRules.push(rule(`resource.${resource}.planning-range`, `Apply the configured ${config.planningRangeMultiplier} planning-range multiplier to the calculated baseline.`, inputReferences.map((reference) => reference.inputId), source.sourceId, planningMax - baseline));
    const assumptions = [{
            assumptionId: `resource.${resource}.prototype-baseline`,
            statement: 'This numeric baseline is an internal academic prototype, not an authority minimum.',
            sourceIds: [source.sourceId],
        }];
    return {
        status: 'ready',
        resource,
        baseline,
        planningRange: { min: baseline, max: planningMax },
        inputReferences,
        assumptions,
        appliedRules,
        sourceSnapshots: [{ ...source }],
        authoritySource: {
            status: 'not_supplied',
            reason: 'No verified authority-issued numeric resource ratio has been supplied for this prototype.',
        },
        confidence: 'prototype',
        reviewingAuthority: config.reviewingAuthorities[resource],
        authorityReviewRequired: true,
    };
}
function validateProvisionalAssessmentResult(result, expectedCategoryIds = resourceRecommendationConfig_1.ACTIVE_RESOURCE_CONFIG.assessmentCategoryIds) {
    const errors = [];
    const evidenceKeys = new Set(['weather', 'crowd', 'venue', 'history', 'holiday', 'public_health', 'sanitation', 'medical', 'security', 'transport', 'compliance']);
    if (!result || typeof result !== 'object')
        return ['result'];
    if (typeof result.proposalId !== 'string' || !result.proposalId.trim())
        errors.push('proposal-id');
    if (result.formulaVersion !== types_1.PROVISIONAL_FORMULA_VERSION)
        errors.push('formula-version');
    if (result.hardRuleVersion !== types_1.HARD_RULE_VERSION)
        errors.push('hard-rule-version');
    if (result.categorySchemaVersion !== categorySchema_1.ACTIVE_CATEGORY_SCHEMA.version)
        errors.push('category-schema-version');
    if (!Array.isArray(result.validatedHazards))
        errors.push('validated-hazards');
    if (!Array.isArray(result.categories))
        return [...errors, 'categories'];
    const validatedHazards = Array.isArray(result.validatedHazards) ? result.validatedHazards : [];
    const expected = new Map(categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => [category.id, category.weight]));
    const expectedDefinitions = new Map(categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.map((category) => [category.id, category]));
    const seen = new Set();
    const hazardIds = new Set();
    for (const hazard of validatedHazards) {
        if (!hazard || typeof hazard !== 'object'
            || typeof hazard.hazardId !== 'string' || !hazard.hazardId.trim() || hazardIds.has(hazard.hazardId)
            || typeof hazard.hazardName !== 'string' || !hazard.hazardName.trim()
            || !expected.has(hazard.categoryId)
            || !Array.isArray(hazard.evidenceReferences) || hazard.evidenceReferences.length === 0
            || new Set(hazard.evidenceReferences).size !== hazard.evidenceReferences.length
            || hazard.evidenceReferences.some((reference) => typeof reference !== 'string' || !evidenceKeys.has(reference))
            || typeof hazard.rationale !== 'string' || !hazard.rationale.trim()) {
            errors.push('validated-hazard-shape');
        }
        else {
            hazardIds.add(hazard.hazardId);
        }
    }
    let weightedScore = 0;
    let highest = 'Low';
    if (result.categories.length !== expectedCategoryIds.length)
        errors.push('category-count');
    for (const rawCategory of result.categories) {
        if (!isRuntimeRecord(rawCategory)) {
            errors.push('category-shape');
            continue;
        }
        const category = rawCategory;
        const weight = expected.get(category.categoryId);
        const definition = expectedDefinitions.get(category.categoryId);
        if (!expectedCategoryIds.includes(category.categoryId) || weight === undefined || seen.has(category.categoryId)) {
            errors.push(`category-${category.categoryId || 'unknown'}`);
            continue;
        }
        seen.add(category.categoryId);
        const authorityLikelihood = isScore(rawCategory.authorityLikelihood)
            ? rawCategory.authorityLikelihood
            : category.proposedLikelihood;
        const authoritySeverity = isScore(rawCategory.authoritySeverity)
            ? rawCategory.authoritySeverity
            : category.proposedSeverity;
        const matrix = category.validatedLikelihood * category.validatedSeverity;
        const normalized = matrix * 4;
        const hardRuleErrors = validateAppliedHardRules(category, authorityLikelihood, authoritySeverity);
        if (!isScore(category.proposedLikelihood) || !isScore(category.proposedSeverity)
            || !isScore(category.validatedLikelihood) || !isScore(category.validatedSeverity)
            || category.validatedLikelihood < authorityLikelihood
            || category.validatedSeverity < authoritySeverity
            || category.matrixScore !== matrix
            || category.normalizedScore !== normalized
            || category.weight !== weight
            || category.weightedContribution !== round(normalized * weight)
            || category.riskLevel !== (0, types_1.hirarcRiskLevelFor)(matrix)
            || typeof category.categoryName !== 'string' || category.categoryName !== definition?.name
            || !Array.isArray(category.evidenceReferences) || category.evidenceReferences.length === 0
            || new Set(category.evidenceReferences).size !== category.evidenceReferences.length
            || category.evidenceReferences.some((reference) => typeof reference !== 'string' || !evidenceKeys.has(reference))
            || typeof category.rationale !== 'string' || !category.rationale.trim()
            || !['low', 'medium', 'high'].includes(category.confidence)
            || !stringArray(category.concerns) || !stringArray(category.missingInformation)
            || !sameStringSet(category.guidelineChecks, definition?.guidelineChecks ?? [])
            || hardRuleErrors.length > 0)
            errors.push(`calculation-${category.categoryId}`);
        weightedScore += normalized * weight;
        highest = higherRisk(highest, (0, types_1.hirarcRiskLevelFor)(matrix));
    }
    if (expectedCategoryIds.some((categoryId) => !seen.has(categoryId)))
        errors.push('missing-category');
    const overallScore = round(weightedScore);
    const weightedRisk = (0, types_1.riskLevelFor)(overallScore);
    if (result.overallScore !== overallScore
        || result.weightedRiskLevel !== weightedRisk
        || result.highestCategoryRiskLevel !== highest
        || result.overallRiskLevel !== higherRisk(weightedRisk, highest))
        errors.push('overall-calculation');
    if (!Number.isFinite(result.calculatedAt))
        errors.push('calculated-at');
    return [...new Set(errors)];
}
function validateAssessmentResultAgainstProposal(result, proposal) {
    const errors = [];
    const proposedCategories = new Map(proposal.categories.map((category) => [category.categoryId, category]));
    if (proposedCategories.size !== categorySchema_1.ACTIVE_CATEGORY_SCHEMA.categories.length)
        errors.push('proposal-category-count');
    for (const category of result.categories) {
        const proposed = proposedCategories.get(category.categoryId);
        if (!proposed
            || proposed.likelihood !== category.proposedLikelihood
            || proposed.severity !== category.proposedSeverity
            || proposed.rationale !== category.rationale
            || proposed.confidence !== category.confidence
            || stableStringify(proposed.concerns) !== stableStringify(category.concerns)
            || stableStringify(proposed.missingInformation) !== stableStringify(category.missingInformation)
            || category.evidenceReferences.some((reference) => !proposed.evidenceReferences.includes(reference))) {
            errors.push(`proposal-category-${category.categoryId}`);
        }
    }
    const proposedHazards = new Map(proposal.hazards.map((hazard) => [hazard.hazardId, hazard]));
    for (const hazard of result.validatedHazards) {
        const proposed = proposedHazards.get(hazard.hazardId);
        if (!proposed
            || proposed.hazardName !== hazard.hazardName
            || proposed.categoryId !== hazard.categoryId
            || proposed.rationale !== hazard.rationale
            || hazard.evidenceReferences.some((reference) => !proposed.evidenceReferences.includes(reference))) {
            errors.push(`proposal-hazard-${hazard.hazardId}`);
        }
    }
    return errors;
}
function validateAssessmentResultAgainstHardRules(result, baseline) {
    const errors = [];
    const constraints = new Map((0, hardRuleEvaluator_1.evaluateCategoryHardRules)(baseline).map((constraint) => [constraint.categoryId, constraint]));
    for (const category of result.categories) {
        const constraint = constraints.get(category.categoryId);
        if (!constraint) {
            errors.push(`hard-rule-${category.categoryId}`);
            continue;
        }
        for (const axis of ['likelihood', 'severity']) {
            const official = category;
            const proposed = axis === 'likelihood'
                ? official.authorityLikelihood ?? category.proposedLikelihood
                : official.authoritySeverity ?? category.proposedSeverity;
            const validated = axis === 'likelihood' ? category.validatedLikelihood : category.validatedSeverity;
            const floor = axis === 'likelihood' ? constraint.likelihoodFloor : constraint.severityFloor;
            const applied = category.appliedHardRules.filter((rule) => rule.axis === axis);
            if (validated !== Math.max(proposed, floor))
                errors.push(`hard-rule-floor-${category.categoryId}-${axis}`);
            if (proposed < floor) {
                const expectedId = `${constraint.ruleId}.${axis}`;
                if (applied.length !== 1
                    || applied[0].ruleId !== expectedId
                    || applied[0].categoryId !== category.categoryId
                    || applied[0].proposedValue !== proposed
                    || applied[0].constrainedValue !== floor
                    || applied[0].rationale !== `${constraint.rationale} The ${axis} floor is ${floor}.`
                    || !sameStringSet(applied[0].guidelineReferences, constraint.guidelineReferences)) {
                    errors.push(`hard-rule-record-${category.categoryId}-${axis}`);
                }
            }
            else if (applied.length !== 0)
                errors.push(`hard-rule-unexpected-${category.categoryId}-${axis}`);
        }
    }
    return errors;
}
function validateAppliedHardRules(category, baselineLikelihood = category.proposedLikelihood, baselineSeverity = category.proposedSeverity) {
    if (!Array.isArray(category.appliedHardRules))
        return ['hard-rules'];
    const errors = [];
    for (const axis of ['likelihood', 'severity']) {
        const proposed = axis === 'likelihood' ? baselineLikelihood : baselineSeverity;
        const validated = axis === 'likelihood' ? category.validatedLikelihood : category.validatedSeverity;
        const rules = category.appliedHardRules.filter((rule) => rule?.axis === axis);
        if ((validated > proposed && rules.length !== 1) || (validated === proposed && rules.length !== 0))
            errors.push(axis);
        for (const rule of rules) {
            if (typeof rule.ruleId !== 'string' || !rule.ruleId.trim()
                || rule.categoryId !== category.categoryId
                || rule.proposedValue !== proposed
                || rule.constrainedValue !== validated
                || typeof rule.rationale !== 'string' || !rule.rationale.trim()
                || !stringArray(rule.guidelineReferences) || rule.guidelineReferences.length === 0)
                errors.push(axis);
        }
    }
    if (category.appliedHardRules.some((rule) => !isRuntimeRecord(rule)))
        errors.push('shape');
    const validRules = category.appliedHardRules.filter(isRuntimeRecord);
    if (validRules.some((rule, index, rules) => rules.findIndex((candidate) => candidate.ruleId === rule.ruleId) !== index))
        errors.push('duplicate');
    return errors;
}
function isRuntimeRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringArray(value) {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
function sameStringSet(value, expected) {
    return Array.isArray(value)
        && value.length === expected.length
        && new Set(value).size === value.length
        && new Set(expected).size === expected.length
        && value.every((entry) => typeof entry === 'string' && expected.includes(entry))
        && expected.every((entry) => value.includes(entry));
}
function rule(ruleId, description, inputReferenceIds, sourceId, contribution) {
    return { ruleId, description, inputReferenceIds, sourceIds: [sourceId], contribution };
}
function validateCompleteItems(items) {
    const keys = Object.keys(items);
    if (keys.length !== types_1.RESOURCE_KEYS.length || types_1.RESOURCE_KEYS.some((key) => !items[key])) {
        throw new ResourceCalculationFault('incomplete_provenance', 'Exactly seven resource items are required.');
    }
    for (const resource of types_1.RESOURCE_KEYS) {
        const item = items[resource];
        if (item.resource !== resource
            || !nonNegativeSafeInteger(item.baseline)
            || !nonNegativeSafeInteger(item.planningRange.min)
            || !nonNegativeSafeInteger(item.planningRange.max)
            || item.planningRange.min !== item.baseline
            || item.planningRange.max < item.planningRange.min) {
            throw new ResourceCalculationFault('unsafe_calculation', `Unsafe result for ${resource}.`);
        }
        if (item.appliedRules.length === 0
            || item.inputReferences.length === 0
            || item.assumptions.length === 0
            || item.sourceSnapshots.length === 0
            || item.authoritySource.status !== 'not_supplied') {
            throw new ResourceCalculationFault('incomplete_provenance', `Incomplete provenance for ${resource}.`);
        }
    }
}
function resourceInputHash(input, config) {
    const payload = {
        schemaVersion: types_1.RESOURCE_SCHEMA_VERSION,
        formulaVersion: config.formulaVersion,
        configVersion: config.configVersion,
        sourceRegistryVersion: config.sourceRegistryVersion,
        config,
        numericSource: resourceRecommendationConfig_1.RESOURCE_SOURCE_REGISTRY[config.numericSourceId],
        eventId: input.eventId,
        versionId: input.versionId,
        assessmentId: input.assessmentId,
        eventDetails: input.eventDetails,
        assessmentResult: input.assessmentResult,
    };
    return (0, node_crypto_1.createHash)('sha256').update(stableStringify(payload)).digest('hex');
}
function stableStringify(value) {
    if (Array.isArray(value))
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        return `{${Object.entries(value)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}
/**
 * Official resource records may add authority-owned validation metadata, but
 * the numeric recommendation and every calculator-owned provenance field must
 * remain identical to the deterministic calculation.
 */
function matchesDeterministicResourceItems(actual, expected) {
    return types_1.RESOURCE_KEYS.every((resource) => {
        const actualItem = actual[resource];
        const expectedItem = expected[resource];
        if (!actualItem || !expectedItem)
            return false;
        const expectedAssumptionIds = new Set(expectedItem.assumptions.map((assumption) => assumption.assumptionId));
        const expectedRuleIds = new Set(expectedItem.appliedRules.map((rule) => rule.ruleId));
        const expectedSourceIds = new Set(expectedItem.sourceSnapshots.map((source) => source.sourceId));
        const extraAssumptions = actualItem.assumptions.filter((assumption) => !expectedAssumptionIds.has(assumption.assumptionId));
        const extraRules = actualItem.appliedRules.filter((rule) => !expectedRuleIds.has(rule.ruleId));
        const extraSources = actualItem.sourceSnapshots.filter((source) => !expectedSourceIds.has(source.sourceId));
        const authoritySourceId = actualItem.authoritySource.status === 'supplied'
            ? actualItem.authoritySource.source.sourceId
            : undefined;
        const validAuthorityExtras = authoritySourceId
            ? extraSources.length === 1
                && extraSources[0].sourceId === authoritySourceId
                && stableStringify(extraSources[0]) === stableStringify(actualItem.authoritySource.status === 'supplied'
                    ? actualItem.authoritySource.source : undefined)
                && [...extraAssumptions, ...extraRules].length > 0
                && extraAssumptions.every((assumption) => assumption.sourceIds.length === 1 && assumption.sourceIds[0] === authoritySourceId)
                && extraRules.every((rule) => rule.contribution === 0
                    && rule.sourceIds.length === 1 && rule.sourceIds[0] === authoritySourceId)
            : extraSources.length === 0 && extraAssumptions.length === 0 && extraRules.length === 0;
        return validAuthorityExtras && stableStringify({
            resource: actualItem.resource,
            status: actualItem.status,
            baseline: actualItem.baseline,
            planningRange: actualItem.planningRange,
            inputReferences: actualItem.inputReferences,
            reviewingAuthority: actualItem.reviewingAuthority,
        }) === stableStringify({
            resource: expectedItem.resource,
            status: expectedItem.status,
            baseline: expectedItem.baseline,
            planningRange: expectedItem.planningRange,
            inputReferences: expectedItem.inputReferences,
            reviewingAuthority: expectedItem.reviewingAuthority,
        })
            && containsStableEntries(actualItem.assumptions, expectedItem.assumptions)
            && containsStableEntries(actualItem.sourceSnapshots, expectedItem.sourceSnapshots)
            && containsStableEntries(actualItem.appliedRules, expectedItem.appliedRules)
            && extraRules.every((rule) => rule.contribution === 0);
    });
}
function containsStableEntries(actual, expected) {
    return expected.every((entry) => actual.some((candidate) => stableStringify(candidate) === stableStringify(entry)));
}
function safeCeil(value, label) {
    const result = Math.ceil(value);
    if (!nonNegativeSafeInteger(result)) {
        throw new ResourceCalculationFault('unsafe_calculation', `${label} produced an unsafe quantity.`);
    }
    return result;
}
function safeAdd(left, right, label) {
    const result = left + right;
    if (!nonNegativeSafeInteger(result)) {
        throw new ResourceCalculationFault('unsafe_calculation', `${label} produced an unsafe quantity.`);
    }
    return result;
}
function positiveFinite(value) {
    return Number.isFinite(value) && value > 0;
}
function nonNegativeSafeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function isRiskLevel(value) {
    return value === 'Low' || value === 'Medium' || value === 'High';
}
function isScore(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}
function round(value) {
    return Math.round(value * 100) / 100;
}
function higherRisk(left, right) {
    const order = { Low: 0, Medium: 1, High: 2 };
    return order[left] >= order[right] ? left : right;
}
//# sourceMappingURL=resourceCalculator.js.map