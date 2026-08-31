import { describe, expect, it } from 'vitest';
import { EventDetails, M1_DOCUMENT_SCHEMA_VERSION, M1DraftDocument, M1TemplateSelection } from '@shared/types';
import { m1EvidenceRequirementsFor } from '@shared/m1EvidenceContract';
import { validateM1EvidenceManifest } from './m1EvidenceManifest';

const selection: M1TemplateSelection = {
  eventCategory: 'sports_recreational', venueSetting: 'outdoor_route_based', coreTemplateId: 'STERAS-CORE',
  scenarioTemplateId: 'STERAS-T06-SPT-OR-v1.0', templateRegistryVersion: '2026-08-28-v1', selectedAt: 1,
};
const details = { riskProfile: { temporaryStructures: false } } as EventDetails;

function evidence(path: string): M1DraftDocument {
  return { path, role: 'supporting_evidence', originalName: `${path}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, uploadedAt: 1, schemaVersion: M1_DOCUMENT_SCHEMA_VERSION };
}

function completeManifest(path: string) {
  return m1EvidenceRequirementsFor(selection.scenarioTemplateId).map((definition) => definition.requirement === 'always'
    ? { requirementId: definition.id, applicability: 'required' as const, documentPath: path }
    : { requirementId: definition.id, applicability: 'not_applicable' as const, notApplicableReason: 'This activity is not included in the planned event.' });
}

describe('M1 supporting-evidence manifest', () => {
  it('accepts an exact checklist and permits one immutable file to support multiple requirements', () => {
    const path = 'event_documents/event-1/v1/plan.pdf';
    const result = validateM1EvidenceManifest(details, selection, [evidence(path)], completeManifest(path));
    expect(result.errors).toEqual([]);
    expect(result.manifest).toHaveLength(13);
  });

  it('rejects missing, duplicate, unknown, unlinked, and extra-key entries', () => {
    const path = 'event_documents/event-1/v1/plan.pdf';
    const base = completeManifest(path);
    expect(validateM1EvidenceManifest(details, selection, [evidence(path)], base.slice(1)).errors).toContain(
      'The supporting-evidence checklist is missing requirements or contains unknown requirements.',
    );
    expect(validateM1EvidenceManifest(details, selection, [evidence(path)], [...base, base[0]]).errors).toContain(
      'The supporting-evidence checklist contains invalid or duplicate entries.',
    );
    expect(validateM1EvidenceManifest(details, selection, [evidence(path)], base.map((item, index) => index === 0 ? { ...item, unexpected: true } : item)).errors)
      .toContain('The supporting-evidence checklist contains invalid or duplicate entries.');
    expect(validateM1EvidenceManifest(details, selection, [evidence('unlinked.pdf')], base).errors)
      .toContain('Every uploaded supporting-evidence file must be linked to at least one checklist requirement.');
  });

  it('forces risk-triggered and always requirements and validates not-applicable reasons', () => {
    const path = 'event_documents/event-1/v1/plan.pdf';
    const manifest = completeManifest(path);
    const temporary = manifest.find((item) => item.requirementId === 'T06-DOC-03')!;
    expect(validateM1EvidenceManifest({ ...details, riskProfile: { temporaryStructures: true } }, selection, [evidence(path)], manifest).errors)
      .toContain('T06-DOC-03 is required for the current event declarations.');
    temporary.notApplicableReason = 'short';
    expect(validateM1EvidenceManifest(details, selection, [evidence(path)], manifest).errors)
      .toContain('T06-DOC-03 needs a 10–500 character not-applicable reason.');
  });

  it('rejects forged applicability, template-role files, and contradictory not-applicable entries', () => {
    const path = 'event_documents/event-1/v1/plan.pdf';
    const manifest = completeManifest(path);
    const conditionalIndex = manifest.findIndex((item) => item.requirementId === 'T06-DOC-03');

    const forgedApplicability = manifest.map((item, index) => index === conditionalIndex
      ? { requirementId: item.requirementId, applicability: 'optional' }
      : item);
    expect(validateM1EvidenceManifest(details, selection, [evidence(path)], forgedApplicability).errors)
      .toContain('T06-DOC-03 must be marked required or not applicable.');

    const templateRoleDocument = { ...evidence(path), role: 'core_template' as const };
    expect(validateM1EvidenceManifest(details, selection, [templateRoleDocument], manifest).errors)
      .toContain('DOC-A01 requires a current supporting-evidence file.');

    const contradictory = manifest.map((item, index) => index === conditionalIndex
      ? { ...item, documentPath: path }
      : item);
    expect(validateM1EvidenceManifest(details, selection, [evidence(path)], contradictory).errors)
      .toContain('T06-DOC-03 cannot reference a file when marked not applicable.');

    const paddedReason = manifest.map((item, index) => index === conditionalIndex
      ? { ...item, notApplicableReason: '  This activity is not included.  ' }
      : item);
    expect(validateM1EvidenceManifest(details, selection, [evidence(path)], paddedReason).errors)
      .toContain('T06-DOC-03 needs a 10–500 character not-applicable reason.');
  });
});
