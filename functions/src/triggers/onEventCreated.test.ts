import { describe, expect, it } from 'vitest';
import { latestValidHistoricalResource, nextResourceRevision, resourceDocumentId, invalidAiProposalForManualRecovery, __testOnlyCurrentAssessmentPointerMatches, __testOnlyManualLockState, isPipelineEventVersion, riskScoreAuditId } from './onEventCreated';
import { isManualAssessmentSourceEligible } from '../engines/manualFinalisation';
import { AISuccessfulProposal, EventVersion, M1_TEMPLATE_REGISTRY_VERSION, M1TemplateSelection, RESOURCE_KEYS, RESOURCE_SCHEMA_VERSION, ResourceRecommendation } from '@shared/types';
import { buildSubmittedEventVersion } from '../utils/eventVersionHash';
import { isM1EvidenceForcedRequired, m1EvidenceRequirementsFor } from '@shared/m1EvidenceContract';

describe('M1-submitted assessment input integrity', () => {
  it('binds the exact template selection into the immutable version hash', () => {
    const templateSelection: M1TemplateSelection = {
      eventCategory: 'cultural_heritage_festival' as const,
      venueSetting: 'outdoor_fixed_site' as const,
      coreTemplateId: 'STERAS-CORE' as const,
      scenarioTemplateId: 'STERAS-T08-CUL-OF-v1.0',
      templateRegistryVersion: M1_TEMPLATE_REGISTRY_VERSION,
      selectedAt: 1,
    };
    const eventDetails = {
      name: 'KL Cultural Festival', type: 'cultural' as const,
      venueName: 'Central Venue', venueAddress: 'Kuala Lumpur', venueLocation: { lat: 3.139, lng: 101.687 },
      venueState: 'Kuala Lumpur',
      venueCapacity: 2_000, expectedAttendance: 1_500, environment: 'outdoor' as const,
      coverage: 'partially_covered' as const, seating: 'mixed' as const,
      startDatetime: 2_000, endDatetime: 3_000,
      emergencyPlanSummary: 'Emergency exits and first-aid posts are documented.',
      organizerName: 'Organizer', organizerEmail: 'organizer@example.com', organizerPhone: '+60123456789',
      riskProfile: {
        internationalAttendees: false, alcoholServed: false, foodServed: true, freeDrinkingWater: true,
        ticketedEntry: true, overnightAccommodation: false, pyrotechnics: false, temporaryStructures: false,
        rivalryOrTensionExpected: false, crowdManagementPlan: true, trafficManagementPlan: true,
        severeWeatherPlan: true, medicalPlan: true, evacuationPlanTested: true, authorityCoordinationConfirmed: true,
        vulnerableAttendeesPercent: 10, standingAttendeesPercent: 20, nearestHospitalTravelMinutes: 15,
      },
    };
    const documentPaths = ['event_documents/event-1/v1/combined.pdf', 'event_documents/event-1/v1/evidence.pdf'];
    const evidenceManifest = m1EvidenceRequirementsFor(templateSelection.scenarioTemplateId).map((requirement) => (
      isM1EvidenceForcedRequired(requirement, eventDetails.riskProfile)
        ? { requirementId: requirement.id, applicability: 'required' as const, documentPath: documentPaths[1] }
        : { requirementId: requirement.id, applicability: 'not_applicable' as const, notApplicableReason: 'Not applicable to this test event scenario.' }
    ));
    const version = buildSubmittedEventVersion({
      eventId: 'event-1', versionId: 'v1', versionNumber: 1, eventDetails, templateSelection,
      documentPaths,
      documentUploads: [{
        path: documentPaths[0], role: 'combined_application' as const, originalName: 'combined.pdf',
        mimeType: 'application/pdf', sizeBytes: 100, uploadedAt: 900,
        schemaVersion: '2026-08-28-document-v1' as const,
      }, {
        path: documentPaths[1], role: 'supporting_evidence' as const, originalName: 'evidence.pdf',
        mimeType: 'application/pdf', sizeBytes: 100, uploadedAt: 900,
        schemaVersion: '2026-08-28-document-v1' as const,
      }],
      extractionId: 'extract-1',
      evidenceManifest,
      evidenceManifestSchemaVersion: '2026-08-28-evidence-v1' as const,
      submittedBy: 'organizer-1', submittedAt: 1_000,
    } satisfies Omit<EventVersion, 'inputHash'>);

    expect(isPipelineEventVersion(version, 'event-1', 'v1')).toBe(true);
    expect(isPipelineEventVersion({
      ...version,
      eventDetails: Object.fromEntries(Object.entries(eventDetails).reverse()),
      templateSelection: Object.fromEntries(Object.entries(templateSelection).reverse()),
    }, 'event-1', 'v1')).toBe(true);
    expect(isPipelineEventVersion({ ...version, templateSelection: undefined }, 'event-1', 'v1')).toBe(false);
    const { inputHash, ...versionInput } = version;
    expect(inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(isPipelineEventVersion(buildSubmittedEventVersion({
      ...versionInput,
      evidenceManifest: evidenceManifest.slice(1),
    }), 'event-1', 'v1')).toBe(false);
    expect(isPipelineEventVersion({
      ...version,
      templateSelection: { ...templateSelection, scenarioTemplateId: 'STERAS-T01-ENT-IN-v2.0' },
    }, 'event-1', 'v1')).toBe(false);
    expect(isPipelineEventVersion({
      ...version,
      templateSelection: { ...templateSelection, selectedAt: 2 },
    }, 'event-1', 'v1')).toBe(false);
  });
});

describe('resource pipeline identity and revision helpers', () => {
  it('accepts both initial and same-generation retry pointers while a fenced claim is active', () => {
    expect(__testOnlyCurrentAssessmentPointerMatches(undefined, 'assessment-1', true)).toBe(true);
    expect(__testOnlyCurrentAssessmentPointerMatches('assessment-1', 'assessment-1', true)).toBe(true);
    expect(__testOnlyCurrentAssessmentPointerMatches('other-assessment', 'assessment-1', true)).toBe(false);
    expect(__testOnlyCurrentAssessmentPointerMatches('previous-assessment', 'assessment-2', true, 'previous-assessment')).toBe(true);
    expect(__testOnlyCurrentAssessmentPointerMatches('stale-assessment', 'assessment-2', true, 'previous-assessment')).toBe(false);
  });

  it('preserves the first audit record and assigns every retry claim an append-only audit ID', () => {
    expect(riskScoreAuditId('assessment-1', 'claim-1', false)).toBe('assessment-1-risk-score-computed');
    expect(riskScoreAuditId('assessment-1', 'claim-2', true)).toBe('assessment-1-risk-score-computed-retry-claim-2');
    expect(riskScoreAuditId('assessment-1', 'claim-3', true)).not.toBe(riskScoreAuditId('assessment-1', 'claim-2', true));
  });

  it('uses stage, version and the complete input hash in deterministic IDs', () => {
    const hash = 'a'.repeat(64);
    expect(resourceDocumentId('provisional', 'v1', hash)).toBe(`provisional-v1-${hash}`);
    expect(resourceDocumentId('provisional', 'v1', hash)).toBe(resourceDocumentId('provisional', 'v1', hash));
    expect(resourceDocumentId('official', 'v1', hash)).not.toBe(resourceDocumentId('provisional', 'v1', hash));
  });

  it('creates an append-only revision link without mutating the predecessor', () => {
    const previous = { resourceId: 'provisional-v1-old', revision: 3 };
    const snapshot = structuredClone(previous);
    expect(nextResourceRevision(previous)).toEqual({ revision: 4, supersedesResourceId: previous.resourceId });
    expect(previous).toEqual(snapshot);
    expect(nextResourceRevision()).toEqual({ revision: 1, supersedesResourceId: null });
    expect(() => nextResourceRevision({ resourceId: 'exhausted', revision: Number.MAX_SAFE_INTEGER })).toThrow();
  });

  it('recovers the latest valid predecessor when a failed run cleared the pointer', () => {
    const older = recommendation('old', 1, 10);
    const latest = recommendation('latest', 2, 20);
    expect(latestValidHistoricalResource([older, { ...latest, schemaVersion: 'legacy' }, latest])?.resourceId).toBe(latest.resourceId);
    expect(latestValidHistoricalResource(undefined)).toBeUndefined();
  });
});

describe('AI validation failure recovery', () => {
  it('downgrades a validated-but-unusable success without retaining scores', () => {
    const proposal: AISuccessfulProposal = {
      status: 'success',
      proposalId: 'proposal-1',
      model: 'MiniMax-test',
      promptVersion: 'prompt-v1',
      responseSchemaVersion: 'response-v1',
      hazards: [],
      categories: [],
      cacheStatus: 'miss',
      generatedAt: 123,
    };
    const failed = invalidAiProposalForManualRecovery(proposal, 'category crowd has no eligible evidence');

    expect(failed).toEqual(expect.objectContaining({
      status: 'invalid',
      model: 'MiniMax-test',
      promptVersion: 'prompt-v1',
      responseSchemaVersion: 'response-v1',
      retryable: true,
      cacheStatus: 'not-applicable',
      generatedAt: 123,
    }));
    expect(failed.errorSummary).toContain('no eligible evidence');
    expect('categories' in failed).toBe(false);
    expect('hazards' in failed).toBe(false);
    expect(isManualAssessmentSourceEligible({ aiProposal: failed, assessmentReadiness: 'complete' })).toBe(true);
  });
});

describe('manual assessment lock guard', () => {
  it('distinguishes absent, valid, and malformed lock fields', () => {
    expect(__testOnlyManualLockState({ status: 'manual_review_required' })).toBe('absent');
    expect(__testOnlyManualLockState({ activeManualAssessmentId: 'manual-1' })).toBe('valid');
    expect(__testOnlyManualLockState({ activeManualAssessmentId: null })).toBe('invalid');
    expect(__testOnlyManualLockState({ activeManualAssessmentId: 42 })).toBe('invalid');
    expect(__testOnlyManualLockState({ activeManualAssessmentId: 'manual/child' })).toBe('invalid');
  });
});

function recommendation(_label: string, revision: number, computedAt: number): ResourceRecommendation {
  const resourceInputHash = (revision === 1 ? 'a' : 'b').repeat(64);
  const resourceId = `provisional-v1-${resourceInputHash}`;
  const source = {
    sourceId: 'internal.test', title: 'Test', issuer: 'STERAS', kind: 'internal_prototype' as const,
    locator: 'test', version: 'v1', retrievedAt: 1, verificationStatus: 'prototype_unverified' as const,
  };
  const items = Object.fromEntries(RESOURCE_KEYS.map((resource) => [resource, {
    status: 'ready' as const, resource, baseline: 1, planningRange: { min: 1, max: 2 },
    inputReferences: [{ inputId: 'attendance', kind: 'event_field' as const, path: 'attendance', value: 100 }],
    assumptions: [{ assumptionId: `${resource}.assumption`, statement: 'Test', sourceIds: [source.sourceId] }],
    appliedRules: [{ ruleId: `${resource}.rule`, description: 'Test', inputReferenceIds: ['attendance'], sourceIds: [source.sourceId], contribution: 1 }],
    sourceSnapshots: [source], authoritySource: { status: 'not_supplied' as const, reason: 'Prototype.' },
    confidence: 'prototype' as const, reviewingAuthority: 'PDRM' as const, authorityReviewRequired: true,
  }])) as ResourceRecommendation['items'];
  return {
    resourceId, eventId: 'event-1', versionId: 'v1', assessmentId: 'v1', schemaVersion: RESOURCE_SCHEMA_VERSION,
    stage: 'provisional', revision, supersedesResourceId: revision === 1 ? null : `provisional-v1-${'a'.repeat(64)}`,
    assessmentReference: { stage: 'provisional', assessmentId: 'v1', proposalId: 'proposal-1' },
    resourceInputHash, formulaVersion: 'formula', configVersion: 'config', sourceRegistryVersion: 'sources',
    items, confidenceLevel: 'prototype', authorityReviewRequired: true, validationScope: 'provisional_risk_input', computedAt,
  };
}
