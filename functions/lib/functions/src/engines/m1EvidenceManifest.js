"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateM1EvidenceManifest = validateM1EvidenceManifest;
const m1EvidenceContract_1 = require("../../../shared/m1EvidenceContract");
const RESPONSE_KEYS = new Set(['requirementId', 'applicability', 'documentPath', 'notApplicableReason']);
function validateM1EvidenceManifest(details, selection, documents, value) {
    const definitions = (0, m1EvidenceContract_1.m1EvidenceRequirementsFor)(selection.scenarioTemplateId);
    const errors = [];
    if (definitions.length === 0)
        return { manifest: [], errors: ['The selected scenario has no canonical evidence requirements.'] };
    if (!Array.isArray(value))
        return { manifest: [], errors: ['Complete the supporting-evidence checklist before submission.'] };
    const responses = value;
    const responseMap = new Map();
    for (const response of responses) {
        if (!response || typeof response !== 'object'
            || Object.keys(response).some((key) => !RESPONSE_KEYS.has(key))
            || typeof response.requirementId !== 'string'
            || responseMap.has(response.requirementId)) {
            errors.push('The supporting-evidence checklist contains invalid or duplicate entries.');
            continue;
        }
        responseMap.set(response.requirementId, response);
    }
    const definitionIds = new Set(definitions.map((definition) => definition.id));
    if (responses.length !== definitions.length
        || responses.some((response) => !definitionIds.has(response?.requirementId))) {
        errors.push('The supporting-evidence checklist is missing requirements or contains unknown requirements.');
    }
    const supportingPaths = new Set(documents
        .filter((document) => document.role === 'supporting_evidence')
        .map((document) => document.path));
    const referencedPaths = new Set();
    const canonical = [];
    for (const definition of definitions) {
        const response = responseMap.get(definition.id);
        if (!response)
            continue;
        const forcedRequired = (0, m1EvidenceContract_1.isM1EvidenceForcedRequired)(definition, details.riskProfile);
        if (response.applicability === 'required') {
            if (typeof response.documentPath !== 'string' || !supportingPaths.has(response.documentPath)) {
                errors.push(`${definition.id} requires a current supporting-evidence file.`);
                continue;
            }
            if (response.notApplicableReason !== undefined)
                errors.push(`${definition.id} cannot include a not-applicable reason when evidence is required.`);
            referencedPaths.add(response.documentPath);
            canonical.push({ requirementId: definition.id, applicability: 'required', documentPath: response.documentPath });
            continue;
        }
        if (response.applicability !== 'not_applicable') {
            errors.push(`${definition.id} must be marked required or not applicable.`);
            continue;
        }
        if (forcedRequired) {
            errors.push(`${definition.id} is required for the current event declarations.`);
            continue;
        }
        const reason = typeof response.notApplicableReason === 'string' ? response.notApplicableReason.trim() : '';
        if (reason.length < 10 || reason.length > 500 || response.notApplicableReason !== reason) {
            errors.push(`${definition.id} needs a 10–500 character not-applicable reason.`);
            continue;
        }
        if (response.documentPath !== undefined)
            errors.push(`${definition.id} cannot reference a file when marked not applicable.`);
        canonical.push({ requirementId: definition.id, applicability: 'not_applicable', notApplicableReason: reason });
    }
    for (const path of supportingPaths) {
        if (!referencedPaths.has(path))
            errors.push('Every uploaded supporting-evidence file must be linked to at least one checklist requirement.');
    }
    return { manifest: canonical, errors: [...new Set(errors)] };
}
//# sourceMappingURL=m1EvidenceManifest.js.map