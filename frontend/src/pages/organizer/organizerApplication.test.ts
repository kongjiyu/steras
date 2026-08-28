import { describe, expect, it } from 'vitest';
import { EventDetails } from '@shared/types';
import { applyM1ExtractedFields, createM1DraftRecord, extractionMatchesDraftDocuments, isEditableApplicationStatus, isSelectableRegistryVenue, organizerAdminDecisionLabel, organizerPublicationLabel, organizerPublicationStateFromProjection, reconcileM1EvidenceManifest, validateEventApplication, validateM1EvidenceChecklist, validateTemplateCompatibility } from './organizerApplication';
import { createTemplateSelection } from '../../features/m1/templateRegistry';

const future = Date.now() + 7 * 24 * 60 * 60 * 1000;
const templateSelection = createTemplateSelection('exhibition_convention_promotional', 'indoor', 1);

function validDetails(overrides: Partial<EventDetails> = {}): EventDetails {
  return {
    name: 'Tourism Forum',
    type: 'conference',
    venueName: 'PICC',
    venueAddress: 'Putrajaya, Malaysia',
    venueLocation: { lat: 2.9264, lng: 101.6964 },
    venueCapacity: 1000,
    expectedAttendance: 500,
    environment: 'indoor',
    coverage: 'covered',
    seating: 'seated',
    startDatetime: future,
    endDatetime: future + 4 * 60 * 60 * 1000,
    emergencyPlanSummary: 'Medical desk, evacuation exits, traffic marshals, and authority coordination.',
    riskProfile: {
      vulnerableAttendeesPercent: 0,
      standingAttendeesPercent: 0,
      internationalAttendees: false,
      alcoholServed: false,
      foodServed: false,
      freeDrinkingWater: true,
      ticketedEntry: true,
      overnightAccommodation: false,
      pyrotechnics: false,
      temporaryStructures: false,
      rivalryOrTensionExpected: false,
      crowdManagementPlan: true,
      trafficManagementPlan: true,
      severeWeatherPlan: true,
      medicalPlan: true,
      evacuationPlanTested: false,
      authorityCoordinationConfirmed: true,
    },
    organizerName: 'Test Organizer',
    organizerEmail: 'organizer@example.com',
    organizerPhone: '+60 12-345 6789',
    ...overrides,
  };
}

describe('organizer application lifecycle helpers', () => {
  it('treats only server-prepared Draft applications as editable', () => {
    expect(isEditableApplicationStatus('Draft')).toBe(true);
    expect(isEditableApplicationStatus('Revision Requested')).toBe(false);
    expect(isEditableApplicationStatus('Pending')).toBe(false);
  });

  it('offers only active, explicitly verified registry venues', () => {
    const venue = { venueId: 'venue-1', active: true, verificationStatus: 'verified' as const, name: 'Hall', address: 'Address', capacity: 100, location: { lat: 1, lng: 1 } };
    expect(isSelectableRegistryVenue(venue)).toBe(true);
    expect(isSelectableRegistryVenue({ ...venue, verificationStatus: 'unverified' })).toBe(false);
    expect(isSelectableRegistryVenue({ ...venue, active: false })).toBe(false);
    expect(isSelectableRegistryVenue({ ...venue, deactivatedAt: 1 })).toBe(false);
  });

  it('reports the actual Admin review stage without conflating authority progress', () => {
    const initialApproved = { decision: 'Approved' as const, reason: 'Complete', reviewerUid: 'admin-1', reviewedAt: 1 };
    expect(organizerAdminDecisionLabel({ status: 'Pending' })).toBe('No Admin decision recorded');
    expect(organizerAdminDecisionLabel({ status: 'UnderReview', initialReview: initialApproved })).toBe('Initial Admin review approved');
    expect(organizerAdminDecisionLabel({ status: 'Approved', initialReview: initialApproved })).toBe('Final Admin review approved');
    expect(organizerAdminDecisionLabel({ status: 'Rejected', initialReview: initialApproved })).toBe('Final Admin review rejected');
    expect(organizerAdminDecisionLabel({
      status: 'Rejected',
      initialReview: { decision: 'Rejected', reason: 'Incomplete', suggestion: 'Attach evidence', reviewerUid: 'admin-1', reviewedAt: 1 },
    })).toBe('Initial Admin review rejected');
  });

  it('reports projection-backed publication states without inferring from approval', () => {
    expect(organizerPublicationLabel('loading')).toBe('Checking public listing');
    expect(organizerPublicationLabel('published')).toBe('Published in public calendar');
    expect(organizerPublicationLabel('not_published')).toBe('Not published');
    expect(organizerPublicationLabel('stale')).toBe('Previous version remains published');
    expect(organizerPublicationLabel('unavailable')).toBe('Publication state unavailable');
    const projection = { eventId: 'event-1', versionId: 'v2', publicStatus: 'approved' };
    expect(organizerPublicationStateFromProjection(projection, 'event-1', 'v2')).toBe('published');
    expect(organizerPublicationStateFromProjection(projection, 'event-1', 'v3')).toBe('stale');
    expect(organizerPublicationStateFromProjection(undefined, 'event-1', 'v2')).toBe('not_published');
    expect(organizerPublicationStateFromProjection({ ...projection, publicStatus: 'draft' }, 'event-1', 'v2')).toBe('unavailable');
    expect(organizerPublicationStateFromProjection({ ...projection, eventId: 'other' }, 'event-1', 'v2')).toBe('unavailable');
  });

  it('accepts a complete application with version-scoped evidence', () => {
    expect(validateEventApplication(validDetails(), ['event_documents/event-1/v1/plan.pdf'], templateSelection)).toEqual([]);
  });

  it('creates new Drafts with the structured document contract required by Firestore rules', () => {
    expect(createM1DraftRecord('organizer-1', validDetails(), templateSelection, 123)).toMatchObject({
      organizerId: 'organizer-1', status: 'Draft', editableVersionId: 'v1', currentVersionNumber: 0,
      draftDocumentPaths: [], draftDocuments: [], documentSchemaVersion: '2026-08-28-document-v1',
      evidenceManifestSchemaVersion: '2026-08-28-evidence-v1',
      requiredAuthorities: [], createdAt: 123, updatedAt: 123,
    });
    expect(createM1DraftRecord('organizer-1', validDetails(), templateSelection, 123).draftEvidenceManifest).toHaveLength(16);
  });

  it('blocks attendance above capacity and missing evidence before submit', () => {
    expect(validateEventApplication(validDetails({ expectedAttendance: 1200 }), [], templateSelection)).toEqual(expect.arrayContaining([
      'Expected attendance cannot exceed venue capacity.',
      'Submit between 1 and 20 unique supporting evidence files.',
    ]));
  });

  it('requires a template recommendation before submission', () => {
    expect(validateEventApplication(validDetails(), ['event_documents/event-1/v1/plan.pdf'])).toContain(
      'Select the Core and scenario templates before submitting.',
    );
  });

  it('rejects tampered, stale, category-mismatched, and venue-mismatched selections', () => {
    const evidence = ['event_documents/event-1/v1/plan.pdf'];
    expect(validateEventApplication(validDetails(), evidence, {
      ...templateSelection,
      scenarioTemplateId: 'STERAS-T01-ENT-IN-v2.0',
    })).toContain('The selected template recommendation is invalid or out of date. Choose the templates again.');
    expect(validateEventApplication(validDetails({ type: 'sports' }), evidence, templateSelection)).toContain(
      'Event type does not match the selected scenario template. Change the template recommendation or event type.',
    );
    expect(validateEventApplication(validDetails({ environment: 'outdoor' }), evidence, templateSelection)).toContain(
      'Event environment does not match the selected venue-setting template.',
    );
    expect(validateTemplateCompatibility(validDetails({ type: 'sports' }), templateSelection)).toEqual([
      'Event type does not match the selected scenario template. Change the template recommendation or event type.',
    ]);
  });

  it('applies only type-compatible extracted fields and preserves unrelated values', () => {
    const details = validDetails({ name: 'Old name', venueName: 'Verified venue' });
    const next = applyM1ExtractedFields(details, [
      { target: 'name', value: 'Extracted name', sourceFieldIds: ['EVENT_NAME'], confidence: 'high' },
      { target: 'expectedAttendance', value: 800, sourceFieldIds: ['TOTAL_ATTENDANCE'], confidence: 'high' },
      { target: 'organizerEmail', value: 123, sourceFieldIds: ['RESPONSIBLE_CONTACT'], confidence: 'low' },
      { target: 'riskProfile.pyrotechnics', value: true, sourceFieldIds: ['SPECIAL_EFFECTS'], confidence: 'high' },
    ]);
    expect(next.name).toBe('Extracted name');
    expect(next.expectedAttendance).toBe(800);
    expect(next.organizerEmail).toBe(details.organizerEmail);
    expect(next.venueName).toBe('Verified venue');
    expect(next.riskProfile?.pyrotechnics).toBe(true);
  });

  it('requires both completed templates and a current extraction when structured intake is active', () => {
    const documents = [{
      path: 'event_documents/event-1/v1/core.docx', role: 'core_template' as const,
      originalName: 'core.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 100, uploadedAt: 1, schemaVersion: '2026-08-28-document-v1' as const,
    }];
    expect(validateEventApplication(validDetails(), documents.map((document) => document.path), templateSelection, documents, '')).toEqual(expect.arrayContaining([
      'Upload exactly one completed scenario DOCX.',
      'Extract and review the completed application documents before submission.',
    ]));
  });

  it('does not restore a stale extraction after either completed template is replaced', () => {
    const documents = ['core_template', 'scenario_template'].map((role) => ({
      path: `event_documents/event-1/v1/${role}.docx`, role: role as 'core_template' | 'scenario_template',
      originalName: `${role}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 100, uploadedAt: 1, schemaVersion: '2026-08-28-document-v1' as const,
    }));
    const extraction = {
      extractionId: 'extract-1', eventId: 'event-1', editableVersionId: 'v1', status: 'ready' as const,
      schemaVersion: '2026-08-28-docx-fields-v1' as const, templateRegistryVersion: templateSelection.templateRegistryVersion,
      coreTemplateId: templateSelection.coreTemplateId, scenarioTemplateId: templateSelection.scenarioTemplateId,
      sourceDocuments: documents.map((document) => ({ ...document, role: document.role, sha256: 'a'.repeat(64) })),
      extractedFields: [], rawFieldIds: [], warnings: [], completionPercent: 0, createdAt: 1, createdBy: 'organizer-1',
    };
    expect(extractionMatchesDraftDocuments(extraction, documents)).toBe(true);
    expect(extractionMatchesDraftDocuments(extraction, [documents[0], { ...documents[1], path: 'event_documents/event-1/v1/replacement.docx' }])).toBe(false);
  });

  it('forces declared evidence conditions and blocks incomplete checklist items', () => {
    const details = validDetails({ riskProfile: { ...validDetails().riskProfile, temporaryStructures: true } });
    const manifest = reconcileM1EvidenceManifest(templateSelection, details, []);
    expect(manifest.find((item) => item.requirementId === 'T10-DOC-01')).toEqual({ requirementId: 'T10-DOC-01', applicability: 'required' });
    expect(validateM1EvidenceChecklist(details, templateSelection, [], manifest)).toContain('Attach a supporting-evidence file to DOC-A01.');
  });
});
