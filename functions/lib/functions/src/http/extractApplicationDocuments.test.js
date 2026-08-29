"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const types_1 = require("../../../shared/types");
const extractApplicationDocuments_1 = require("./extractApplicationDocuments");
const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function document(role, name) {
    return {
        path: `event_documents/event-1/v1/${name}`,
        role,
        originalName: name,
        mimeType: role === 'supporting_evidence' || role === 'combined_application' ? 'application/pdf' : mime,
        sizeBytes: 1_024,
        uploadedAt: 1,
        schemaVersion: types_1.M1_DOCUMENT_SCHEMA_VERSION,
    };
}
(0, vitest_1.describe)('M1 structured Draft document validation', () => {
    (0, vitest_1.it)('accepts exactly one Core and one scenario DOCX with supporting evidence', () => {
        const documents = [document('core_template', 'core.docx'), document('scenario_template', 'scenario.docx'), document('supporting_evidence', 'plan.pdf')];
        (0, vitest_1.expect)((0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', documents)).toEqual(documents);
    });
    (0, vitest_1.it)('accepts one combined PDF and rejects mixed combined and split application files', () => {
        const combined = document('combined_application', 'combined.pdf');
        const evidence = document('supporting_evidence', 'plan.pdf');
        (0, vitest_1.expect)((0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', [combined, evidence])).toEqual([combined, evidence]);
        (0, vitest_1.expect)(() => (0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', [
            combined,
            document('core_template', 'core.docx'),
            document('scenario_template', 'scenario.docx'),
        ])).toThrow('either one combined application PDF');
        (0, vitest_1.expect)(() => (0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', [{ ...combined, mimeType: mime }])).toThrow('must be a PDF');
    });
    (0, vitest_1.it)('rejects missing, duplicate, swapped-format, cross-version, and duplicate-path documents', () => {
        const core = document('core_template', 'core.docx');
        const scenario = document('scenario_template', 'scenario.docx');
        (0, vitest_1.expect)(() => (0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', [core])).toThrow('either one combined application PDF');
        (0, vitest_1.expect)(() => (0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', [core, { ...core, originalName: 'copy.docx' }, scenario])).toThrow('either one combined application PDF');
        (0, vitest_1.expect)(() => (0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', [core, { ...scenario, mimeType: 'application/pdf' }])).toThrow('must be DOCX');
        (0, vitest_1.expect)(() => (0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', [core, { ...scenario, path: 'event_documents/event-1/v2/scenario.docx' }])).toThrow('metadata is invalid');
        (0, vitest_1.expect)(() => (0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', [core, { ...scenario, path: core.path }])).toThrow('metadata is invalid');
    });
    (0, vitest_1.it)('rejects non-finite, unsafe, oversized, and unknown-schema metadata', () => {
        const core = document('core_template', 'core.docx');
        const scenario = document('scenario_template', 'scenario.docx');
        for (const invalid of [
            { ...core, sizeBytes: Number.NaN },
            { ...core, sizeBytes: Number.MAX_SAFE_INTEGER + 1 },
            { ...core, sizeBytes: 10 * 1024 * 1024 + 1 },
            { ...core, uploadedAt: Number.POSITIVE_INFINITY },
            { ...core, uploadedAt: -1 },
            { ...core, schemaVersion: 'legacy' },
            { ...core, unexpected: true },
            { ...core, path: 'event_documents/event-1/v1/nested/core.docx' },
            { ...core, originalName: ' core.docx' },
        ])
            (0, vitest_1.expect)(() => (0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', [invalid, scenario])).toThrow('metadata is invalid');
        (0, vitest_1.expect)(() => (0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', [
            { ...core, role: 'invented_role' },
            scenario,
        ])).toThrow('either one combined application PDF');
    });
    (0, vitest_1.it)('rejects a supporting document with an executable MIME type', () => {
        (0, vitest_1.expect)(() => (0, extractApplicationDocuments_1.validateDraftDocuments)('event-1', 'v1', [
            document('core_template', 'core.docx'),
            document('scenario_template', 'scenario.docx'),
            { ...document('supporting_evidence', 'payload.bin'), mimeType: 'application/octet-stream' },
        ])).toThrow('Supporting evidence metadata');
    });
});
//# sourceMappingURL=extractApplicationDocuments.test.js.map