"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const types_1 = require("../../../shared/types");
const m1EvidenceContract_1 = require("../../../shared/m1EvidenceContract");
const m1EvidenceManifest_1 = require("./m1EvidenceManifest");
const selection = {
    eventCategory: 'sports_recreational', venueSetting: 'outdoor_route_based', coreTemplateId: 'STERAS-CORE',
    scenarioTemplateId: 'STERAS-T06-SPT-OR-v1.0', templateRegistryVersion: '2026-08-28-v1', selectedAt: 1,
};
const details = { riskProfile: { temporaryStructures: false } };
function evidence(path) {
    return { path, role: 'supporting_evidence', originalName: `${path}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, uploadedAt: 1, schemaVersion: types_1.M1_DOCUMENT_SCHEMA_VERSION };
}
function completeManifest(path) {
    return (0, m1EvidenceContract_1.m1EvidenceRequirementsFor)(selection.scenarioTemplateId).map((definition) => definition.requirement === 'always'
        ? { requirementId: definition.id, applicability: 'required', documentPath: path }
        : { requirementId: definition.id, applicability: 'not_applicable', notApplicableReason: 'This activity is not included in the planned event.' });
}
(0, vitest_1.describe)('M1 supporting-evidence manifest', () => {
    (0, vitest_1.it)('accepts an exact checklist and permits one immutable file to support multiple requirements', () => {
        const path = 'event_documents/event-1/v1/plan.pdf';
        const result = (0, m1EvidenceManifest_1.validateM1EvidenceManifest)(details, selection, [evidence(path)], completeManifest(path));
        (0, vitest_1.expect)(result.errors).toEqual([]);
        (0, vitest_1.expect)(result.manifest).toHaveLength(13);
    });
    (0, vitest_1.it)('rejects missing, duplicate, unknown, unlinked, and extra-key entries', () => {
        const path = 'event_documents/event-1/v1/plan.pdf';
        const base = completeManifest(path);
        (0, vitest_1.expect)((0, m1EvidenceManifest_1.validateM1EvidenceManifest)(details, selection, [evidence(path)], base.slice(1)).errors).toContain('The supporting-evidence checklist is missing requirements or contains unknown requirements.');
        (0, vitest_1.expect)((0, m1EvidenceManifest_1.validateM1EvidenceManifest)(details, selection, [evidence(path)], [...base, base[0]]).errors).toContain('The supporting-evidence checklist contains invalid or duplicate entries.');
        (0, vitest_1.expect)((0, m1EvidenceManifest_1.validateM1EvidenceManifest)(details, selection, [evidence(path)], base.map((item, index) => index === 0 ? { ...item, unexpected: true } : item)).errors)
            .toContain('The supporting-evidence checklist contains invalid or duplicate entries.');
        (0, vitest_1.expect)((0, m1EvidenceManifest_1.validateM1EvidenceManifest)(details, selection, [evidence('unlinked.pdf')], base).errors)
            .toContain('Every uploaded supporting-evidence file must be linked to at least one checklist requirement.');
    });
    (0, vitest_1.it)('forces risk-triggered and always requirements and validates not-applicable reasons', () => {
        const path = 'event_documents/event-1/v1/plan.pdf';
        const manifest = completeManifest(path);
        const temporary = manifest.find((item) => item.requirementId === 'T06-DOC-03');
        (0, vitest_1.expect)((0, m1EvidenceManifest_1.validateM1EvidenceManifest)({ ...details, riskProfile: { temporaryStructures: true } }, selection, [evidence(path)], manifest).errors)
            .toContain('T06-DOC-03 is required for the current event declarations.');
        temporary.notApplicableReason = 'short';
        (0, vitest_1.expect)((0, m1EvidenceManifest_1.validateM1EvidenceManifest)(details, selection, [evidence(path)], manifest).errors)
            .toContain('T06-DOC-03 needs a 10–500 character not-applicable reason.');
    });
    (0, vitest_1.it)('rejects forged applicability, template-role files, and contradictory not-applicable entries', () => {
        const path = 'event_documents/event-1/v1/plan.pdf';
        const manifest = completeManifest(path);
        const conditionalIndex = manifest.findIndex((item) => item.requirementId === 'T06-DOC-03');
        const forgedApplicability = manifest.map((item, index) => index === conditionalIndex
            ? { requirementId: item.requirementId, applicability: 'optional' }
            : item);
        (0, vitest_1.expect)((0, m1EvidenceManifest_1.validateM1EvidenceManifest)(details, selection, [evidence(path)], forgedApplicability).errors)
            .toContain('T06-DOC-03 must be marked required or not applicable.');
        const templateRoleDocument = { ...evidence(path), role: 'core_template' };
        (0, vitest_1.expect)((0, m1EvidenceManifest_1.validateM1EvidenceManifest)(details, selection, [templateRoleDocument], manifest).errors)
            .toContain('DOC-A01 requires a current supporting-evidence file.');
        const contradictory = manifest.map((item, index) => index === conditionalIndex
            ? { ...item, documentPath: path }
            : item);
        (0, vitest_1.expect)((0, m1EvidenceManifest_1.validateM1EvidenceManifest)(details, selection, [evidence(path)], contradictory).errors)
            .toContain('T06-DOC-03 cannot reference a file when marked not applicable.');
        const paddedReason = manifest.map((item, index) => index === conditionalIndex
            ? { ...item, notApplicableReason: '  This activity is not included.  ' }
            : item);
        (0, vitest_1.expect)((0, m1EvidenceManifest_1.validateM1EvidenceManifest)(details, selection, [evidence(path)], paddedReason).errors)
            .toContain('T06-DOC-03 needs a 10–500 character not-applicable reason.');
    });
});
//# sourceMappingURL=m1EvidenceManifest.test.js.map