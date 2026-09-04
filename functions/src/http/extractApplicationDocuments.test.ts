import { describe, expect, it } from 'vitest';
import { M1_DOCUMENT_SCHEMA_VERSION, M1DraftDocument } from '@shared/types';
import { validateDraftDocuments } from './extractApplicationDocuments';

const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pdfMime = 'application/pdf';

function document(role: M1DraftDocument['role'], name: string, mimeType = name.endsWith('.pdf') ? pdfMime : docxMime): M1DraftDocument {
  return {
    path: `event_documents/event-1/v1/${name}`,
    role,
    originalName: name,
    mimeType,
    sizeBytes: 1_024,
    uploadedAt: 1,
    schemaVersion: M1_DOCUMENT_SCHEMA_VERSION,
  };
}

describe('M1 structured Draft document validation', () => {
  it('accepts PDF or DOCX independently for every application role', () => {
    for (const [coreName, scenarioName] of [
      ['core.docx', 'scenario.docx'],
      ['core.pdf', 'scenario.pdf'],
      ['core.pdf', 'scenario.docx'],
      ['core.docx', 'scenario.pdf'],
    ]) {
      const documents = [document('core_template', coreName), document('scenario_template', scenarioName), document('supporting_evidence', 'plan.docx')];
      expect(validateDraftDocuments('event-1', 'v1', documents)).toEqual(documents);
    }
    for (const combinedName of ['combined.pdf', 'combined.docx']) {
      const documents = [document('combined_application', combinedName), document('supporting_evidence', 'plan.pdf')];
      expect(validateDraftDocuments('event-1', 'v1', documents)).toEqual(documents);
    }
  });

  it('rejects mixed combined and split application files and mismatched extensions', () => {
    const combined = document('combined_application', 'combined.pdf');
    expect(() => validateDraftDocuments('event-1', 'v1', [
      combined,
      document('core_template', 'core.docx'),
      document('scenario_template', 'scenario.docx'),
    ])).toThrow('either one combined application PDF/DOCX');
    expect(() => validateDraftDocuments('event-1', 'v1', [{ ...combined, mimeType: docxMime }]))
      .toThrow('must be PDF or DOCX files with matching file extensions');
    expect(() => validateDraftDocuments('event-1', 'v1', [document('combined_application', 'combined.docx', pdfMime)]))
      .toThrow('must be PDF or DOCX files with matching file extensions');
  });

  it('rejects missing, duplicate, swapped-format, cross-version, and duplicate-path documents', () => {
    const core = document('core_template', 'core.docx');
    const scenario = document('scenario_template', 'scenario.docx');
    expect(() => validateDraftDocuments('event-1', 'v1', [core])).toThrow('either one combined application PDF/DOCX');
    expect(() => validateDraftDocuments('event-1', 'v1', [core, { ...core, originalName: 'copy.docx' }, scenario])).toThrow('either one combined application PDF/DOCX');
    expect(() => validateDraftDocuments('event-1', 'v1', [core, { ...scenario, mimeType: pdfMime }]))
      .toThrow('must be PDF or DOCX files with matching file extensions');
    expect(() => validateDraftDocuments('event-1', 'v1', [core, { ...scenario, path: 'event_documents/event-1/v2/scenario.docx' }])).toThrow('metadata is invalid');
    expect(() => validateDraftDocuments('event-1', 'v1', [core, { ...scenario, path: core.path }])).toThrow('metadata is invalid');
  });

  it('rejects non-finite, unsafe, oversized, and unknown-schema metadata', () => {
    const core = document('core_template', 'core.docx');
    const scenario = document('scenario_template', 'scenario.docx');
    for (const invalid of [
      { ...core, sizeBytes: Number.NaN },
      { ...core, sizeBytes: Number.MAX_SAFE_INTEGER + 1 },
      { ...core, sizeBytes: 10 * 1024 * 1024 + 1 },
      { ...core, uploadedAt: Number.POSITIVE_INFINITY },
      { ...core, uploadedAt: -1 },
      { ...core, schemaVersion: 'legacy' as never },
      { ...core, unexpected: true },
      { ...core, path: 'event_documents/event-1/v1/nested/core.docx' },
      { ...core, originalName: ' core.docx' },
    ]) expect(() => validateDraftDocuments('event-1', 'v1', [invalid, scenario])).toThrow('metadata is invalid');
    expect(() => validateDraftDocuments('event-1', 'v1', [
      { ...core, role: 'invented_role' as never },
      scenario,
    ])).toThrow('either one combined application PDF/DOCX');
  });

  it('rejects a supporting document with an executable MIME type', () => {
    expect(() => validateDraftDocuments('event-1', 'v1', [
      document('core_template', 'core.docx'),
      document('scenario_template', 'scenario.docx'),
      { ...document('supporting_evidence', 'payload.bin'), mimeType: 'application/octet-stream' },
    ])).toThrow('Supporting evidence metadata');
  });
});
