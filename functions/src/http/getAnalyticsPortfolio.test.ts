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
    const output = buildAnalyticsPortfolioRecord({
      event,
      assessment,
      resource,
      overrides: [override],
      incidents: [incident],
      controls: [control],
      decisionHistory: [{ decision: 'Rejected', versionId: 'v1' } as never],
      incidentCoverageAvailable: true,
      includeSynthetic: false,
    });

    expect(output.reapplication).toBe(true);
    expect(output.assessment).toMatchObject({ officialScore: 62, officialRiskLevel: 'Medium', aiStatus: 'success', aiAgreement: true });
    expect(output.resources?.items.police).toMatchObject({ baseline: 10, effective: 12, overrideCount: 1 });
    expect(output.incidents).toMatchObject({ available: true, total: 1, verified: 1 });
    expect(output.controls).toMatchObject({ available: true, total: 1, approved: 1 });
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
      overrides: [], incidents: [], controls: [], decisionHistory: [],
      incidentCoverageAvailable: false, includeSynthetic: false,
    });
    expect(output.synthetic).toBe(true);
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
  return {
    assessmentId: 'assessment-1', eventId: 'event-1', versionId: 'v2', schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    status: 'provisional_ready', assessmentReadiness: 'complete', complianceStatus: 'pass', dataConfidenceScore: 0.9,
    dataConfidenceLevel: 'high', contextEvidence: [{ synthetic: false }], aiProposal: { status: 'success' },
    provisionalResult: {
      overallScore: 62, overallRiskLevel: 'Medium', categorySchemaVersion: 'categories-v1', formulaVersion: 'formula-v1',
      hardRuleVersion: 'hard-v1', categories: [{ categoryId: 'crowd', normalizedScore: 62, proposedLikelihood: 3,
        proposedSeverity: 3, validatedLikelihood: 3, validatedSeverity: 3, appliedHardRules: [] }],
    },
  } as unknown as RiskAssessment;
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
