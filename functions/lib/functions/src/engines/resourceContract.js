"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateResourceRecommendation = validateResourceRecommendation;
exports.asValidResourceRecommendation = asValidResourceRecommendation;
exports.validateResourceRevisionChain = validateResourceRevisionChain;
const types_1 = require("../../../shared/types");
const AUTHORITY_TYPES = new Set(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);
function validateResourceRecommendation(value) {
    const errors = [];
    if (!isRecord(value))
        return { ok: false, errors: ['record'] };
    for (const key of types_1.RESOURCE_KEYS)
        if (key in value)
            errors.push(`duplicate-flat-${key}`);
    if ('rationales' in value || Array.isArray(value.items))
        errors.push('legacy-shape');
    stringField(value, 'resourceId', errors);
    stringField(value, 'eventId', errors);
    stringField(value, 'versionId', errors);
    stringField(value, 'assessmentId', errors);
    if (value.schemaVersion !== types_1.RESOURCE_SCHEMA_VERSION)
        errors.push('schema-version');
    if (value.stage !== 'provisional' && value.stage !== 'official')
        errors.push('stage');
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1)
        errors.push('revision');
    if (!(value.supersedesResourceId === null || nonEmptyString(value.supersedesResourceId)))
        errors.push('supersedes');
    if ((value.revision === 1) !== (value.supersedesResourceId === null))
        errors.push('revision-predecessor');
    if (typeof value.resourceInputHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.resourceInputHash))
        errors.push('input-hash');
    if (typeof value.resourceInputHash === 'string'
        && value.resourceId !== `${String(value.stage)}-${String(value.versionId)}-${value.resourceInputHash}`) {
        errors.push('resource-identity');
    }
    if (!nonEmptyString(value.formulaVersion))
        errors.push('formula-version');
    if (!nonEmptyString(value.configVersion))
        errors.push('config-version');
    if (!nonEmptyString(value.sourceRegistryVersion))
        errors.push('source-registry-version');
    if (!Number.isFinite(value.computedAt))
        errors.push('computed-at');
    if (typeof value.authorityReviewRequired !== 'boolean')
        errors.push('review-required');
    if (value.validationScope !== (value.stage === 'official' ? 'official_risk_input_only' : 'provisional_risk_input'))
        errors.push('validation-scope');
    if (!['prototype', 'low', 'medium', 'authority_validated'].includes(String(value.confidenceLevel)))
        errors.push('confidence');
    validateAssessmentReference(value, errors);
    if (!isRecord(value.items))
        errors.push('items');
    else {
        const keys = Object.keys(value.items);
        if (keys.length !== types_1.RESOURCE_KEYS.length || keys.some((key) => !types_1.RESOURCE_KEYS.includes(key)))
            errors.push('item-keys');
        for (const key of types_1.RESOURCE_KEYS)
            validateItem(value.items[key], key, errors);
    }
    if (value.stage === 'official' && (value.confidenceLevel !== 'authority_validated' || value.authorityReviewRequired !== false)) {
        errors.push('official-readiness');
    }
    if (value.stage === 'official' && isRecord(value.items)) {
        const items = value.items;
        if (types_1.RESOURCE_KEYS.some((key) => {
            const item = items[key];
            return isRecord(item)
                && (item.confidence !== 'authority_validated' || item.authorityReviewRequired !== false);
        }))
            errors.push('official-item-readiness');
    }
    if (value.stage === 'provisional'
        && (value.authorityReviewRequired !== true || value.confidenceLevel === 'authority_validated')) {
        errors.push('provisional-review-required');
    }
    if (value.stage === 'provisional' && isRecord(value.items)) {
        const items = value.items;
        if (types_1.RESOURCE_KEYS.some((key) => {
            const item = items[key];
            return isRecord(item)
                && (item.confidence === 'authority_validated' || item.authorityReviewRequired !== true);
        }))
            errors.push('provisional-item-readiness');
    }
    return { ok: errors.length === 0, errors: [...new Set(errors)] };
}
function validateAssessmentReference(value, errors) {
    if (!isRecord(value.assessmentReference)
        || value.assessmentReference.stage !== value.stage
        || value.assessmentReference.assessmentId !== value.assessmentId) {
        errors.push('assessment-reference');
        return;
    }
    const manualOfficial = value.stage === 'official' && value.assessmentReference.sourceKind === 'admin_manual';
    if (value.assessmentReference.sourceKind !== undefined
        && value.assessmentReference.sourceKind !== 'ai_authority'
        && value.assessmentReference.sourceKind !== 'admin_manual')
        errors.push('assessment-source-kind');
    if (value.stage === 'provisional' && value.assessmentReference.sourceKind !== undefined)
        errors.push('assessment-source-kind');
    if (manualOfficial
        ? !safeDocumentId(value.assessmentReference.manualAssessmentId) || 'proposalId' in value.assessmentReference
        : !nonEmptyString(value.assessmentReference.proposalId) || 'manualAssessmentId' in value.assessmentReference)
        errors.push('assessment-reference');
    if (value.stage === 'official' && (!Number.isFinite(value.assessmentReference.finalizedAt)
        || !nonEmptyString(value.assessmentReference.finalizedBy)))
        errors.push('official-finalization-reference');
}
function validateItem(value, key, errors) {
    const prefix = `item-${key}`;
    if (!isRecord(value)) {
        errors.push(prefix);
        return;
    }
    if (value.status !== 'ready' || value.resource !== key)
        errors.push(`${prefix}-identity`);
    if (!nonNegativeSafeInteger(value.baseline) || !isRecord(value.planningRange)
        || value.planningRange.min !== value.baseline
        || !nonNegativeSafeInteger(value.planningRange.max)
        || Number(value.planningRange.max) < Number(value.baseline))
        errors.push(`${prefix}-range`);
    if (!Array.isArray(value.inputReferences) || value.inputReferences.length === 0) {
        errors.push(`${prefix}-inputs`);
        return;
    }
    if (!Array.isArray(value.assumptions) || value.assumptions.length === 0)
        errors.push(`${prefix}-assumptions`);
    if (!Array.isArray(value.appliedRules) || value.appliedRules.length === 0)
        errors.push(`${prefix}-rules`);
    if (!Array.isArray(value.sourceSnapshots) || value.sourceSnapshots.length === 0)
        errors.push(`${prefix}-sources`);
    if (!['prototype', 'low', 'medium', 'authority_validated'].includes(String(value.confidence)))
        errors.push(`${prefix}-confidence`);
    if (!AUTHORITY_TYPES.has(value.reviewingAuthority) || typeof value.authorityReviewRequired !== 'boolean')
        errors.push(`${prefix}-review`);
    const inputs = new Set();
    for (const input of value.inputReferences) {
        if (!isRecord(input) || !nonEmptyString(input.inputId) || !nonEmptyString(input.path)
            || !['event_field', 'assessment_overall', 'assessment_category'].includes(String(input.kind))
            || !primitiveFinite(input.value))
            errors.push(`${prefix}-input-shape`);
        else if (inputs.has(input.inputId))
            errors.push(`${prefix}-duplicate-input-id`);
        else
            inputs.add(input.inputId);
    }
    const sources = new Set();
    if (Array.isArray(value.sourceSnapshots)) {
        for (const source of value.sourceSnapshots) {
            if (!validSource(source))
                errors.push(`${prefix}-source-shape`);
            else if (sources.has(source.sourceId))
                errors.push(`${prefix}-duplicate-source-id`);
            else
                sources.add(source.sourceId);
        }
    }
    const assumptions = new Set();
    if (Array.isArray(value.assumptions))
        for (const assumption of value.assumptions) {
            if (!isRecord(assumption) || !nonEmptyString(assumption.assumptionId) || !nonEmptyString(assumption.statement)
                || !referencesKnown(assumption.sourceIds, sources))
                errors.push(`${prefix}-assumption-shape`);
            else if (assumptions.has(assumption.assumptionId))
                errors.push(`${prefix}-duplicate-assumption-id`);
            else
                assumptions.add(assumption.assumptionId);
        }
    const rules = new Set();
    if (Array.isArray(value.appliedRules))
        for (const rule of value.appliedRules) {
            if (!isRecord(rule) || !nonEmptyString(rule.ruleId) || !nonEmptyString(rule.description)
                || !referencesKnown(rule.inputReferenceIds, inputs) || !referencesKnown(rule.sourceIds, sources)
                || !nonNegativeSafeInteger(rule.contribution))
                errors.push(`${prefix}-rule-shape`);
            else if (rules.has(rule.ruleId))
                errors.push(`${prefix}-duplicate-rule-id`);
            else
                rules.add(rule.ruleId);
        }
    if (!isRecord(value.authoritySource)
        || !['not_supplied', 'supplied'].includes(String(value.authoritySource.status))
        || (value.authoritySource.status === 'not_supplied' && !nonEmptyString(value.authoritySource.reason))
        || (value.authoritySource.status === 'supplied' && !validAuthoritySource(value.authoritySource.source)))
        errors.push(`${prefix}-authority-source`);
    if (isRecord(value.authoritySource) && value.authoritySource.status === 'supplied'
        && isRecord(value.authoritySource.source)) {
        const sourceId = value.authoritySource.source.sourceId;
        const canonicalSnapshot = Array.isArray(value.sourceSnapshots)
            ? value.sourceSnapshots.find((source) => isRecord(source) && source.sourceId === sourceId)
            : undefined;
        const inSnapshots = typeof sourceId === 'string' && sources.has(sourceId)
            && stableValue(canonicalSnapshot) === stableValue(value.authoritySource.source);
        const citedByAssumption = Array.isArray(value.assumptions) && value.assumptions.some((assumption) => isRecord(assumption) && Array.isArray(assumption.sourceIds) && assumption.sourceIds.includes(sourceId));
        const citedByRule = Array.isArray(value.appliedRules) && value.appliedRules.some((rule) => isRecord(rule) && Array.isArray(rule.sourceIds) && rule.sourceIds.includes(sourceId));
        if (!inSnapshots || (!citedByAssumption && !citedByRule))
            errors.push(`${prefix}-authority-source-unlinked`);
    }
}
function stableValue(value) {
    if (Array.isArray(value))
        return `[${value.map(stableValue).join(',')}]`;
    if (isRecord(value))
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
function validAuthoritySource(value) {
    return validSource(value)
        && value.verificationStatus === 'verified'
        && (value.kind === 'law' || value.kind === 'official_guidance');
}
function validSource(value) {
    if (!isRecord(value) || !nonEmptyString(value.sourceId) || !nonEmptyString(value.title)
        || !nonEmptyString(value.issuer) || !nonEmptyString(value.locator) || !nonEmptyString(value.version)
        || !Number.isFinite(value.retrievedAt) || Number(value.retrievedAt) < 0
        || !['internal_prototype', 'law', 'official_guidance', 'voluntary_standard'].includes(String(value.kind))
        || !['prototype_unverified', 'verified'].includes(String(value.verificationStatus)))
        return false;
    return value.verificationStatus !== 'prototype_unverified' || value.kind === 'internal_prototype';
}
function referencesKnown(value, known) {
    return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && known.has(item));
}
function stringField(value, field, errors) {
    if (!nonEmptyString(value[field]))
        errors.push(field);
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function safeDocumentId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function nonNegativeSafeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function primitiveFinite(value) {
    return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asValidResourceRecommendation(value) {
    return validateResourceRecommendation(value).ok ? value : undefined;
}
function validateResourceRevisionChain(resources, currentResourceId) {
    const errors = [];
    if (!Array.isArray(resources) || resources.some((resource) => !isRecord(resource)))
        return ['invalid-resource'];
    const currentResource = resources.find((resource) => resource.resourceId === currentResourceId);
    if (!currentResource)
        return ['missing-current-resource'];
    const relevant = resources.filter((resource) => resource.versionId === currentResource.versionId && resource.stage === currentResource.stage);
    const byId = new Map(relevant.map((resource) => [resource.resourceId, resource]));
    if (byId.size !== relevant.length)
        errors.push('duplicate-resource-id');
    const revisions = relevant.map((resource) => resource.revision).sort((left, right) => left - right);
    if (new Set(revisions).size !== revisions.length)
        errors.push('duplicate-revision');
    if (revisions.some((revision, index) => revision !== index + 1))
        errors.push('noncontiguous-revisions');
    const children = new Map();
    for (const resource of relevant) {
        if (resource.revision === 1) {
            if (resource.supersedesResourceId !== null)
                errors.push('invalid-root');
            continue;
        }
        const predecessor = resource.supersedesResourceId ? byId.get(resource.supersedesResourceId) : undefined;
        if (!predecessor || predecessor.revision !== resource.revision - 1)
            errors.push('invalid-predecessor');
        if (resource.supersedesResourceId) {
            children.set(resource.supersedesResourceId, (children.get(resource.supersedesResourceId) ?? 0) + 1);
        }
    }
    if ([...children.values()].some((count) => count > 1))
        errors.push('branched-chain');
    if (currentResource.revision !== Math.max(...revisions))
        errors.push('current-resource-not-tip');
    return [...new Set(errors)];
}
//# sourceMappingURL=resourceContract.js.map