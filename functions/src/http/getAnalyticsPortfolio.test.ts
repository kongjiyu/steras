import { describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  ASSESSMENT_SCHEMA_VERSION,
  CATEGORY_SCHEMA_VERSION,
  HARD_RULE_VERSION,
  OFFICIAL_FORMULA_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  type EventControl,
  type EventRecord,
  type EventVersion,
  type Assignment,
  type Incident,
  type ResourceOverrideRecord,
  type ResourceRecommendation,
  type RiskAssessment,
  type Stage1Doc,
  type UserProfile,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { M4_SCHEMA_VERSION } from '@shared/m4';
import {
  assertAnalyticsAdmin,
  assessmentMatchesCurrentEvent,
  buildAnalyticsPortfolioRecord,
  canonicalControlDocument,
  canonicalEventDocument,
  canonicalStage1Document,
  deriveMissingStage1Docs,
  isAnalyticsAssessment,
  isAnalyticsEvent,
  isAnalyticsOverride,
  resourceMatchesCurrentEvent,
  selectValidAnalyticsIncidents,
  validateAnalyticsPortfolioRequest,
} from './getAnalyticsPortfolio';

describe('Module 5 analytics backend', () => {
  it('allows only admin profiles', () => {
    const admin = { role: 'admin' } as UserProfile;
    expect(() => assertAnalyticsAdmin(admin)).not.toThrow();
    expect(() => assertAnalyticsAdmin({ role: 'authority' } as UserProfile)).toThrow(HttpsError);
    expect(() => assertAnalyticsAdmin(undefined)).toThrow(HttpsError);
  });

  it('validates bounded filters and rejects unsafe input', () => {
    expect(validateAnalyticsPortfolioRequest({ eventTypes: ['festival'], includeSynthetic: true, limit: 25 }))
      .toMatchObject({ eventTypes: ['festival'], includeSynthetic: true, limit: 25 });
    expect(() => validateAnalyticsPortfolioRequest({ from: 20, to: 10 })).toThrow(HttpsError);
    expect(() => validateAnalyticsPortfolioRequest({ limit: 501 })).toThrow(HttpsError);
    expect(() => validateAnalyticsPortfolioRequest({ venueIds: ['../../private'] })).toThrow(HttpsError);
  });

  it('uses canonical Firestore document IDs instead of mutable stored identity fields', () => {
    expect(canonicalEventDocument('event-a', { eventId: 'event-b' }).eventId).toBe('event-a');
    expect(canonicalControlDocument('control-a', { controlId: 'control-b' }).controlId).toBe('control-a');
    expect(canonicalStage1Document('stage1-a', { docId: 'stage1-b' }).docId).toBe('stage1-a');
  });

  it('returns an aggregated PII-safe record with no private notes', () => {
    const event = sampleEvent();
    const assessment = sampleAssessment();
    const resource = sampleResource();
    const override = sampleOverride();
    const incident: Incident = {
      incidentId: 'incident-1', eventId: event.eventId, venueId: 'venue-1', eventType: 'festival',
      incidentType: 'medical', severity: 'medium', date: 10, status: 'verified', assessmentEligible: true,
      description: 'PRIVATE INCIDENT DESCRIPTION', synthetic: false,
    };
    const control: EventControl = {
      controlId: 'control-1', eventId: event.eventId, versionId: 'v2', controlName: 'Medical post', authority: 'KKM',
      stageRequirement: 'stage1_only', stage1Requirements: [], stage2Requirement: null, controlItemVersion: 1,
      label: 'approved', createdAt: 1, updatedAt: 2,
    };
    const sourceCoverage = completeCoverage();
    const output = buildAnalyticsPortfolioRecord({
      event,
      assessment,
      resource,
      overrides: [override],
      incidents: [incident],
      controls: [control],
      stage1Docs: [{ docId: 'doc-1', docType: 'license', label: 'Licence', status: 'verified' }],
      decisionHistory: [{ decision: 'Rejected', versionId: 'v1' } as never],
      incidentCoverageAvailable: true,
      includeSynthetic: false,
      sourceCoverage,
    });

    expect(output.reapplication).toBe(true);
    expect(output.assessment).toMatchObject({ officialScore: 36, officialRiskLevel: 'Medium', aiStatus: 'success', aiAgreement: true });
    expect(output.assessment?.identifiedHazardCategories).toEqual(['crowd']);
    expect(output.resources?.items.police).toMatchObject({ baseline: 10, effective: 12, overrideCount: 1 });
    expect(output.incidents).toMatchObject({ available: true, total: 1, verified: 1 });
    expect(output.controls).toMatchObject({ available: true, total: 1, approved: 1 });
    expect(output.controls.stage1).toMatchObject({ available: true, total: 1, verified: 1 });
    expect(output.incidents.immediateActionRequired).toEqual({ available: false });
    expect(output.resources?.overrideReasonCategoriesAvailable).toBe(true);
    expect(output.resources?.overrideReasonCategories).toEqual({ attendance_change: 1 });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain('organizer@example.com');
    expect(serialized).not.toContain('+60123456789');
    expect(serialized).not.toContain('PRIVATE OVERRIDE RATIONALE');
    expect(serialized).not.toContain('PRIVATE INCIDENT DESCRIPTION');
  });

  it('marks explicit test fixtures as synthetic', () => {
    const event = Object.assign(sampleEvent(), { m3Uat: { datasetId: 'test' } });
    const output = buildAnalyticsPortfolioRecord({
      event,
      overrides: [], incidents: [], controls: [], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: false, includeSynthetic: false,
      sourceCoverage: completeCoverage(),
    });
    expect(output.synthetic).toBe(true);
  });

  it('derives revision outcome from immutable current-version lineage', () => {
    const baseVersion = {
      versionId: 'v2', eventId: 'event-1', versionNumber: 2, eventDetails: sampleEvent().eventDetails,
      documentPaths: [], submittedBy: 'organizer-1', submittedAt: 2, inputHash: 'a'.repeat(64),
    } satisfies EventVersion;
    const rejected = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), currentVersion: { ...baseVersion, revisionSource: {
        kind: 'rejected_revision', sourceVersionId: 'v1', startedAt: 1,
        rejectionReason: 'Not exposed', rejectionSuggestion: 'Not exposed',
      } }, overrides: [], incidents: [], controls: [], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: false, includeSynthetic: false, sourceCoverage: completeCoverage(),
    });
    expect(rejected.revisionOutcome).toBe('resubmitted_after_rejection');
    const edited = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), currentVersion: { ...baseVersion, revisionSource: {
        kind: 'pending_edit', sourceVersionId: 'v1', startedAt: 1,
      } }, overrides: [], incidents: [], controls: [], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: false, includeSynthetic: false, sourceCoverage: completeCoverage(),
    });
    expect(edited.revisionOutcome).toBe('revised_without_recorded_rejection');
    const unavailable = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), overrides: [], incidents: [], controls: [], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: false, includeSynthetic: false,
      sourceCoverage: { ...completeCoverage(), currentVersion: 'unavailable' },
    });
    expect(unavailable.revisionOutcome).toBe('unavailable');
  });

  it('distinguishes an authoritative zero-incident result from unavailable incident data', () => {
    const available = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), overrides: [], incidents: [], controls: [], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: true, includeSynthetic: false, sourceCoverage: completeCoverage(),
    });
    expect(available.incidents).toMatchObject({ available: true, total: 0 });

    const unavailable = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), overrides: [], incidents: [], controls: [], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: false, includeSynthetic: false,
      sourceCoverage: { ...completeCoverage(), incidents: 'unavailable' },
    });
    expect(unavailable.incidents).toMatchObject({ available: false, total: 0 });
  });

  it('retains valid incident history across application versions of the same event', () => {
    const incidents = selectValidAnalyticsIncidents([
      { incidentId: 'incident-v1', eventId: 'event-1', eventVersionId: 'v1', severity: 'low', status: 'verified' },
      { incidentId: 'incident-v2', eventId: 'event-1', eventVersionId: 'v2', severity: 'medium', status: 'under_review' },
      { incidentId: 'broken', eventId: 'event-1', severity: 'critical' },
    ]);
    expect(incidents.map((incident) => incident.incidentId)).toEqual(['incident-v1', 'incident-v2']);
  });

  it('aggregates M4 immediate-action, escalation and resolution signals without inventing missing severity', () => {
    const incidents = selectValidAnalyticsIncidents([
      {
        schemaVersion: M4_SCHEMA_VERSION, incidentId: 'incident-m4-one', eventId: 'event-1', eventVersionId: 'v2',
        status: 'resolved', severity: 'high', immediateActionRequired: true, referredAuthorityId: 'pdrm-kl-1',
        discrepancyOutcome: 'confirmed_true', synthetic: false,
      },
      {
        schemaVersion: M4_SCHEMA_VERSION, incidentId: 'incident-m4-two', eventId: 'event-1', eventVersionId: 'v2',
        status: 'manual_review_required', synthetic: false,
      },
    ]);
    const output = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), overrides: [], incidents, controls: [], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: true, includeSynthetic: false, sourceCoverage: completeCoverage(),
    });
    expect(output.incidents).toMatchObject({
      available: true, total: 2, verified: 1, severityAvailable: false,
      bySeverity: { low: 0, medium: 0, high: 1 },
      byStatus: { verified: 1, under_review: 1, rejected: 0, unknown: 0 },
      immediateActionRequired: { available: false },
      externalEscalations: { available: true, count: 1 },
    });
  });

  it('accepts honestly labelled presentation incidents while preserving their synthetic marker', () => {
    const incidents = selectValidAnalyticsIncidents([{
      schemaVersion: M4_SCHEMA_VERSION,
      incidentId: 'presentation-incident-1',
      eventId: 'presentation-event-1',
      eventVersionId: 'v1',
      status: 'responding',
      severity: 'medium',
      synthetic: true,
    }]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.synthetic).toBe(true);
  });

  it('never labels a provisional result as official analytics', () => {
    const provisional = sampleAssessment() as RiskAssessment & { status: 'provisional_ready'; officialResult?: never };
    delete (provisional as unknown as Record<string, unknown>).officialResult;
    provisional.status = 'provisional_ready';
    const output = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), assessment: provisional, overrides: [], incidents: [], controls: [], stage1Docs: [],
      decisionHistory: [], incidentCoverageAvailable: false, includeSynthetic: false, sourceCoverage: completeCoverage(),
    });
    expect(output.assessment).not.toHaveProperty('officialScore');
    expect(output.assessment).not.toHaveProperty('officialRiskLevel');
  });

  it('rejects malformed and incomplete official results instead of crashing the report', () => {
    const valid = sampleAssessment();
    expect(isAnalyticsAssessment(valid)).toBe(true);
    expect(isAnalyticsAssessment({ ...valid, officialResult: { overallScore: Number.NaN, categories: [] } })).toBe(false);
    expect(isAnalyticsAssessment({ ...valid, officialResult: { ...(valid as never as { officialResult: object }).officialResult, categories: [] } })).toBe(false);
    expect(isAnalyticsAssessment({ ...valid, sourceKind: 'admin_manual' })).toBe(false);
    expect(isAnalyticsAssessment({
      ...valid,
      officialResult: { ...(valid as never as { officialResult: object }).officialResult, sourceKind: 'unexpected' },
    })).toBe(false);
    expect(isAnalyticsAssessment({ ...valid, contextEvidence: {} })).toBe(false);
    const badOverall = structuredClone(valid) as unknown as { officialResult: { overallScore: number } };
    badOverall.officialResult.overallScore = 99;
    expect(isAnalyticsAssessment(badOverall)).toBe(false);
    const proposalMismatch = structuredClone(valid) as unknown as { aiProposal: { categories: Array<{ likelihood: number }> } };
    proposalMismatch.aiProposal.categories[0].likelihood = 4;
    expect(isAnalyticsAssessment(proposalMismatch)).toBe(false);
  });

  it('rejects quantities-shaped overrides that omit current binding identity', () => {
    expect(isAnalyticsOverride(sampleOverride())).toBe(true);
    const missingEventBinding = { ...sampleOverride() } as Partial<ResourceOverrideRecord>;
    delete missingEventBinding.eventId;
    expect(isAnalyticsOverride(missingEventBinding)).toBe(false);
    expect(isAnalyticsOverride({ ...sampleOverride(), resourceId: 'different-resource' })).toBe(false);
  });

  it('accepts assessment and resource documents only from the current event generation', () => {
    const event = sampleEvent();
    const assessment = sampleAssessment();
    const resource = sampleResource();
    expect(assessmentMatchesCurrentEvent(assessment, event)).toBe(true);
    expect(resourceMatchesCurrentEvent(resource, event)).toBe(true);
    expect(assessmentMatchesCurrentEvent({ ...assessment, assessmentId: 'stale' }, event)).toBe(false);
    expect(assessmentMatchesCurrentEvent({ ...assessment, eventId: 'other-event' }, event)).toBe(false);
    expect(assessmentMatchesCurrentEvent({ ...assessment, versionId: 'v1' }, event)).toBe(false);
    expect(resourceMatchesCurrentEvent({ ...resource, resourceId: 'stale' }, event)).toBe(false);
    expect(resourceMatchesCurrentEvent({ ...resource, eventId: 'other-event' }, event)).toBe(false);
    expect(resourceMatchesCurrentEvent({ ...resource, versionId: 'v1' }, event)).toBe(false);
    expect(resourceMatchesCurrentEvent({ ...resource, assessmentId: 'stale' }, event)).toBe(false);
  });

  it('uses immutable review timestamps and refuses negative lifecycle durations', () => {
    const event = Object.assign(sampleEvent(), {
      initialReview: { decision: 'Approved', reason: 'ok', reviewerUid: 'admin', reviewedAt: 3 },
      authorityReviewCompletedAt: 7,
      authorityReviewCompletedVersionId: 'v2',
      secondReview: { decidedAt: 9, confirmedDecision: 'Approved' },
      updatedAt: 999,
    });
    const output = buildAnalyticsPortfolioRecord({ event, overrides: [], incidents: [], controls: [], stage1Docs: [],
      decisionHistory: [], incidentCoverageAvailable: false, includeSynthetic: false, sourceCoverage: completeCoverage() });
    expect(output.terminalDecisionAt).toBe(9);
    expect(output.lifecycle).toMatchObject({ submissionToInitialReviewMs: 1, initialToAuthorityReviewMs: 4,
      authorityToSecondReviewMs: 2, submissionToTerminalDecisionMs: 7 });

    event.initialReview.reviewedAt = 1;
    const invalid = buildAnalyticsPortfolioRecord({ event, overrides: [], incidents: [], controls: [], stage1Docs: [],
      decisionHistory: [], incidentCoverageAvailable: false, includeSynthetic: false, sourceCoverage: completeCoverage() });
    expect(invalid.lifecycle).not.toHaveProperty('submissionToInitialReviewMs');
  });

  it('binds overrides to the current resource generation and does not expose private reasons', () => {
    const resource = sampleResource();
    const valid = sampleOverride();
    const stale = { ...sampleOverride(), overrideId: 'stale', versionId: 'v1', quantities: { ...sampleOverride().quantities, police: 99 } };
    const output = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), resource, overrides: [valid, stale], incidents: [], controls: [], stage1Docs: [],
      decisionHistory: [], incidentCoverageAvailable: false, includeSynthetic: false, sourceCoverage: completeCoverage(),
    });
    expect(output.resources?.items.police).toMatchObject({ baseline: 10, effective: 12, overrideCount: 1 });
    expect(output.resources?.overrideCount).toBe(1);
    expect(output.resources?.overrideReasonCategories).toEqual({ attendance_change: 1 });
    expect(JSON.stringify(output)).not.toContain('PRIVATE OVERRIDE RATIONALE');
  });

  it('exposes only predefined rejection categories and their review stages', () => {
    const event = Object.assign(sampleEvent(), {
      initialReview: {
        decision: 'Rejected', reason: 'PRIVATE INITIAL REASON', suggestion: 'PRIVATE SUGGESTION',
        rejectionReasonCategory: 'insufficient_evidence', reviewerUid: 'admin-1', reviewedAt: 3,
      },
      secondReview: {
        confirmedDecision: 'Rejected', reason: 'PRIVATE SECOND REASON', suggestion: 'PRIVATE SECOND SUGGESTION',
        rejectionReasonCategory: 'regulatory_non_compliance', reviewerUid: 'admin-1', decidedAt: 8,
      },
    });
    const assignment: Assignment = {
      assignmentId: 'v2_PDRM', eventId: 'event-1', versionId: 'v2', authorityType: 'PDRM',
      officerUid: 'officer-1', assignedBy: 'admin-1', assignedAt: 4, status: 'completed',
      decision: 'Rejected', reason: 'PRIVATE OFFICER REASON', rejectionReasonCategory: 'risk_controls_inadequate',
      reviewStage: 'authority', decidedAt: 5,
    };
    const output = buildAnalyticsPortfolioRecord({
      event, assignments: [assignment], overrides: [], incidents: [], controls: [], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: false, includeSynthetic: false, sourceCoverage: completeCoverage(),
    });
    expect(output.rejectionTaxonomyAvailable).toBe(true);
    expect(output.rejections).toEqual([
      { reasonCategory: 'insufficient_evidence', reviewStage: 'initial' },
      { reasonCategory: 'risk_controls_inadequate', reviewStage: 'authority' },
      { reasonCategory: 'regulatory_non_compliance', reviewStage: 'second' },
    ]);
    expect(JSON.stringify(output)).not.toContain('PRIVATE');
  });

  it('marks legacy rejection taxonomy unavailable without leaking its free-text reason', () => {
    const event = Object.assign(sampleEvent(), {
      initialReview: { decision: 'Rejected', reason: 'PRIVATE LEGACY REASON', reviewerUid: 'admin-1', reviewedAt: 3 },
    });
    const output = buildAnalyticsPortfolioRecord({
      event, overrides: [], incidents: [], controls: [], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: false, includeSynthetic: false, sourceCoverage: completeCoverage(),
    });
    expect(output.rejectionTaxonomyAvailable).toBe(false);
    expect(output.rejections).toEqual([]);
    expect(JSON.stringify(output)).not.toContain('PRIVATE LEGACY REASON');
  });

  it('retains privacy-safe rejection history after a rejected version is resubmitted', () => {
    const output = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), currentVersion: {
        versionId: 'v2', eventId: 'event-1', versionNumber: 2, eventDetails: sampleEvent().eventDetails,
        documentPaths: [], submittedBy: 'organizer-1', submittedAt: 2, inputHash: 'a'.repeat(64),
        revisionSource: { kind: 'rejected_revision', sourceVersionId: 'v1', startedAt: 2, rejectionReason: 'private', rejectionSuggestion: 'private' },
      },
      reviewDecisions: [{ versionId: 'v1', reviewStage: 'second', decision: 'Rejected', rejectionReasonCategory: 'venue_or_capacity_issue' }],
      overrides: [], incidents: [], controls: [], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: false, includeSynthetic: false, sourceCoverage: completeCoverage(),
    });
    expect(output.reapplication).toBe(true);
    expect(output.revisionOutcome).toBe('resubmitted_after_rejection');
    expect(output.rejections).toEqual([{ reasonCategory: 'venue_or_capacity_issue', reviewStage: 'second' }]);
    expect(JSON.stringify(output)).not.toContain('private');
  });

  it('does not fabricate an effective quantity when override history is unavailable', () => {
    const output = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), resource: sampleResource(), overrides: [], incidents: [], controls: [], stage1Docs: [],
      decisionHistory: [], incidentCoverageAvailable: true, includeSynthetic: false,
      sourceCoverage: { ...completeCoverage(), overrides: 'unavailable' },
    });
    expect(output.resources?.items.police).toMatchObject({ baseline: 10 });
    expect(output.resources?.items.police).not.toHaveProperty('effective');
  });

  it('represents missing required Stage 1 uploads only when authoritative coverage is supplied', () => {
    const control: EventControl = {
      controlId: 'control-1', eventId: 'event-1', versionId: 'v2', controlName: 'Licence check', authority: 'DBKL',
      stageRequirement: 'stage1_only', stage1Requirements: [{ docType: 'license', label: 'Current licence', required: true }],
      stage2Requirement: null, controlItemVersion: 1, label: 'pending', createdAt: 1, updatedAt: 2,
    };
    const complete = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), overrides: [], incidents: [], controls: [control],
      stage1Docs: [{ docId: 'pending-control-1-0', docType: 'license', label: 'Current licence', status: 'pending_submission' }],
      decisionHistory: [], incidentCoverageAvailable: false, includeSynthetic: false, sourceCoverage: completeCoverage(),
    });
    expect(complete.controls.stage1).toMatchObject({ available: true, total: 1, pendingSubmission: 1 });

    const unavailableCoverage = { ...completeCoverage(), stage1Documents: 'unavailable' as const };
    const unavailable = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), overrides: [], incidents: [], controls: [control], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: false, includeSynthetic: false, sourceCoverage: unavailableCoverage,
    });
    expect(unavailable.controls.stage1).toMatchObject({ available: false, total: 0 });
  });

  it('does not report an unsubmitted optional Stage 1 requirement as pending', () => {
    const control: EventControl = {
      controlId: 'control-1', eventId: 'event-1', versionId: 'v2', controlName: 'Licence check', authority: 'DBKL',
      stageRequirement: 'stage1_only',
      stage1Requirements: [
        { docType: 'license', label: 'Required licence', required: true },
        { docType: 'other', label: 'Optional note', required: false },
      ],
      stage2Requirement: null, controlItemVersion: 1, label: 'pending', createdAt: 1, updatedAt: 2,
    };
    expect(deriveMissingStage1Docs(control, [])).toEqual([{
      docId: 'pending-control-1-0',
      docType: 'license',
      label: 'Required licence',
      status: 'pending_submission',
    }]);
  });

  it('does not duplicate a submitted Stage 1 document whose embedded ID is stale', () => {
    const control: EventControl = {
      controlId: 'control-1', eventId: 'event-1', versionId: 'v2', controlName: 'Licence check', authority: 'DBKL',
      stageRequirement: 'stage1_only', stage1Requirements: [{ docType: 'license', label: 'Current licence', required: true }],
      stage2Requirement: null, controlItemVersion: 1, label: 'pending', createdAt: 1, updatedAt: 2,
    };
    const canonical = canonicalStage1Document('stage1-canonical', {
      docId: 'stale-id', docType: 'license', label: 'Current licence', status: 'verified',
    }) as Stage1Doc;
    expect(deriveMissingStage1Docs(control, [canonical])).toEqual([]);
  });

  it('does not present Stage 1 zeroes as authoritative when current controls are malformed', () => {
    const output = buildAnalyticsPortfolioRecord({
      event: sampleEvent(), overrides: [], incidents: [], controls: [], stage1Docs: [], decisionHistory: [],
      incidentCoverageAvailable: true, includeSynthetic: false,
      sourceCoverage: { ...completeCoverage(), controls: 'unavailable' },
    });
    expect(output.controls.available).toBe(false);
    expect(output.controls.stage1.available).toBe(false);
  });

  it('skips malformed source events without crashing a portfolio report', () => {
    expect(isAnalyticsEvent(sampleEvent())).toBe(true);
    expect(isAnalyticsEvent({ ...sampleEvent(), status: 'Draft', currentVersionNumber: 0, requiredAuthorities: [] })).toBe(true);
    expect(isAnalyticsEvent({ ...sampleEvent(), requiredAuthorities: undefined })).toBe(false);
    expect(isAnalyticsEvent({ ...sampleEvent(), requiredAuthorities: ['UNKNOWN'] })).toBe(false);
    expect(isAnalyticsEvent({ ...sampleEvent(), eventDetails: { ...sampleEvent().eventDetails, venueName: '' } })).toBe(false);
    expect(isAnalyticsEvent({ ...sampleEvent(), createdAt: Number.NaN })).toBe(false);
  });
});

function sampleEvent(): EventRecord & Record<string, unknown> {
  return {
    eventId: 'event-1', organizerId: 'organizer-1', status: 'Approved', currentVersionId: 'v2',
    currentVersionNumber: 2, currentAssessmentId: 'assessment-1', currentResourceId: 'resource-1',
    draftDocumentPaths: [], requiredAuthorities: ['PDRM', 'KKM'], controlListGenerated: true,
    eventDetails: {
      name: 'Festival One', type: 'festival', venueId: 'venue-1', venueName: 'Civic Hall', venueAddress: 'Kuala Lumpur',
      venueCapacity: 2_000, expectedAttendance: 1_500, environment: 'indoor', coverage: 'covered', seating: 'mixed',
      startDatetime: 100, endDatetime: 200, emergencyPlanSummary: 'Plan',
      organizerName: 'PRIVATE NAME', organizerEmail: 'organizer@example.com', organizerPhone: '+60123456789',
    },
    createdAt: 1, submittedAt: 2, authorityReviewCompletedAt: 5, updatedAt: 5,
  };
}

function sampleAssessment(): RiskAssessment {
  const hazard = { hazardId: 'hazard-1', hazardName: 'Crowd pressure', categoryId: 'crowd' as const, evidenceReferences: ['crowd' as const], rationale: 'Recorded crowd risk.' };
  const proposalCategories = ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
    categoryId: category.id, likelihood: 3 as const, severity: 3 as const, evidenceReferences: ['crowd' as const],
    rationale: `Assessment rationale for ${category.name}.`, confidence: 'high' as const, concerns: [], missingInformation: [],
  }));
  return {
    assessmentId: 'assessment-1', eventId: 'event-1', versionId: 'v2', schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    status: 'official_ready', assessmentReadiness: 'complete', complianceStatus: 'pass', dataConfidenceScore: 0.9,
    dataConfidenceLevel: 'high', contextEvidence: [{ synthetic: false }],
    aiProposal: {
      status: 'success', proposalId: 'proposal-1', model: 'test-model', promptVersion: 'test-prompt',
      responseSchemaVersion: 'test-schema', hazards: [hazard], categories: proposalCategories,
      cacheStatus: 'miss', generatedAt: 3,
    },
    officialResult: {
      proposalId: 'proposal-1', validatedHazards: [hazard], overallScore: 36, overallRiskLevel: 'Medium', categorySchemaVersion: CATEGORY_SCHEMA_VERSION, formulaVersion: PROVISIONAL_FORMULA_VERSION,
      weightedRiskLevel: 'Low', highestCategoryRiskLevel: 'Medium', officialInputHash: 'a'.repeat(64),
      officialFormulaVersion: OFFICIAL_FORMULA_VERSION, calculatedAt: 4,
      finalizedAt: 4, finalizedBy: 'admin-1', reviewIds: ['review-1'], hardRuleVersion: HARD_RULE_VERSION,
      categories: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
        categoryId: category.id, categoryName: category.name, normalizedScore: 36, matrixScore: 9, weight: category.weight,
        proposedLikelihood: 3, proposedSeverity: 3, authorityLikelihood: 3, authoritySeverity: 3, sourceReviewIds: ['review-1'],
        validatedLikelihood: 3, validatedSeverity: 3, riskLevel: 'Medium', weightedContribution: 4.5,
        evidenceReferences: ['crowd'], rationale: `Assessment rationale for ${category.name}.`, confidence: 'high',
        concerns: [], missingInformation: [], appliedHardRules: [], guidelineChecks: [...category.guidelineChecks],
      })),
    },
  } as unknown as RiskAssessment;
}

function completeCoverage() {
  return { overrides: 'complete', incidents: 'complete', controls: 'complete', decisionHistory: 'complete', assignments: 'complete', reviewDecisions: 'complete', currentVersion: 'complete', stage1Documents: 'complete' } as const;
}

function sampleResource(): ResourceRecommendation {
  const items = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, {
    status: 'ready', resource: key, baseline: key === 'police' ? 10 : 1, planningRange: { min: 1, max: 20 },
  }]));
  return {
    resourceId: 'resource-1', eventId: 'event-1', versionId: 'v2', assessmentId: 'assessment-1',
    schemaVersion: RESOURCE_SCHEMA_VERSION, formulaVersion: 'resource-formula-v1', items,
  } as unknown as ResourceRecommendation;
}

function sampleOverride(): ResourceOverrideRecord {
  const previous = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, key === 'police' ? 10 : 1])) as unknown as ResourceOverrideRecord['previousQuantities'];
  return {
    overrideId: 'override-1', eventId: 'event-1', versionId: 'v2', assessmentId: 'assessment-1',
    baseResourceId: 'resource-1', resourceId: 'resource-1', authorityType: 'PDRM', reviewerId: 'officer-1',
    overrideReasonCategory: 'attendance_change',
    rationale: 'PRIVATE OVERRIDE RATIONALE', previousQuantities: previous, quantities: { ...previous, police: 12 },
    idempotencyKey: 'override-key', overriddenAt: 4,
  };
}
