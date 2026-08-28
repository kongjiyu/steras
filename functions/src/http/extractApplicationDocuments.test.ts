import { describe, expect, it } from 'vitest';
import { M1_DOCUMENT_SCHEMA_VERSION, M1DraftDocument } from '@shared/types';
import { validateDraftDocuments } from './extractApplicationDocuments';

const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function document(role: M1DraftDocument['role'], name: string): M1DraftDocument {
  return {
    path: `event_documents/event-1/v1/${name}`,
    role,
    originalName: name,
    mimeType: role === 'supporting_evidence' ? 'application/pdf' : mime,
    sizeBytes: 1_024,
    uploadedAt: 1,
    schemaVersion: M1_DOCUMENT_SCHEMA_VERSION,
  };
}

describe('M1 structured Draft document validation', () => {
  it('accepts exactly one Core and one scenario DOCX with supporting evidence', () => {
    const documents = [document('core_template', 'core.docx'), document('scenario_template', 'scenario.docx'), document('supporting_evidence', 'plan.pdf')];
    expect(validateDraftDocuments('event-1', 'v1', documents)).toEqual(documents);
  });

  it('rejects missing, duplicate, swapped-format, cross-version, and duplicate-path documents', () => {
    const core = document('core_template', 'core.docx');
    const scenario = document('scenario_template', 'scenario.docx');
    expect(() => validateDraftDocuments('event-1', 'v1', [core])).toThrow('exactly one completed Core DOCX and one completed scenario DOCX');
    expect(() => validateDraftDocuments('event-1', 'v1', [core, { ...core, originalName: 'copy.docx' }, scenario])).toThrow('exactly one completed Core DOCX');
    expect(() => validateDraftDocuments('event-1', 'v1', [core, { ...scenario, mimeType: 'application/pdf' }])).toThrow('must be DOCX');
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
    ])).toThrow('exactly one completed Core DOCX');
  });

  it('rejects a supporting document with an executable MIME type', () => {
    expect(() => validateDraftDocuments('event-1', 'v1', [
      document('core_template', 'core.docx'),
      document('scenario_template', 'scenario.docx'),
      { ...document('supporting_evidence', 'payload.bin'), mimeType: 'application/octet-stream' },
    ])).toThrow('Supporting evidence metadata');
  });
});
