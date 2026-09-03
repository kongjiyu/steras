import { describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  ASSESSMENT_SCHEMA_VERSION,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  type EventControl,
  type EventRecord,
  type Incident,
  type ResourceOverrideRecord,
  type ResourceRecommendation,
  type RiskAssessment,
  type UserProfile,
} from '@shared/types';
import {
  assertAnalyticsAdmin,
  buildAnalyticsPortfolioRecord,
  isAnalyticsAssessment,
  isAnalyticsEvent,
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
    expect(output.assessment).toMatchObject({ officialScore: 62, officialRiskLevel: 'Medium', aiStatus: 'success', aiAgreement: true });
    expect(output.resources?.items.police).toMatchObject({ baseline: 10, effective: 12, overrideCount: 1 });
    expect(output.incidents).toMatchObject({ available: true, total: 1, verified: 1 });
    expect(output.controls).toMatchObject({ available: true, total: 1, approved: 1 });
    expect(output.controls.stage1).toMatchObject({ available: true, total: 1, verified: 1 });
    expect(output.incidents.immediateActionRequired).toEqual({ available: false });
    expect(output.resources?.overrideReasonCategoriesAvailable).toBe(false);
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
    expect(isAnalyticsAssessment({ ...valid, contextEvidence: {} })).toBe(false);
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
    expect(JSON.stringify(output)).not.toContain('PRIVATE OVERRIDE RATIONALE');
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
  const categoryIds = ['crowd', 'venue_fire', 'weather_environment', 'public_health', 'food_water_sanitation', 'medical_capacity', 'security_cbrn', 'transport_accessibility'];
  return {
    assessmentId: 'assessment-1', eventId: 'event-1', versionId: 'v2', schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    status: 'official_ready', assessmentReadiness: 'complete', complianceStatus: 'pass', dataConfidenceScore: 0.9,
    dataConfidenceLevel: 'high', contextEvidence: [{ synthetic: false }], aiProposal: { status: 'success' },
    officialResult: {
      overallScore: 62, overallRiskLevel: 'Medium', categorySchemaVersion: 'categories-v1', formulaVersion: 'formula-v1',
      weightedRiskLevel: 'Medium', highestCategoryRiskLevel: 'Medium', officialInputHash: 'official-input-hash',
      finalizedAt: 4, finalizedBy: 'admin-1', reviewIds: ['review-1'],
      hardRuleVersion: 'hard-v1', categories: categoryIds.map((categoryId) => ({ categoryId, normalizedScore: 62, proposedLikelihood: 3,
        proposedSeverity: 3, validatedLikelihood: 3, validatedSeverity: 3, riskLevel: 'Medium', weightedContribution: 7.75,
        appliedHardRules: [] })),
    },
  } as unknown as RiskAssessment;
}

function completeCoverage() {
  return { overrides: 'complete', incidents: 'complete', controls: 'complete', decisionHistory: 'complete', stage1Documents: 'complete' } as const;
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
    rationale: 'PRIVATE OVERRIDE RATIONALE', previousQuantities: previous, quantities: { ...previous, police: 12 },
    idempotencyKey: 'override-key', overriddenAt: 4,
  };
}
