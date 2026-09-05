import { describe, expect, it } from 'vitest';
import {
  AnalyticsRecord,
  analyticsCsv,
  analyticsSummary,
  buildMonthlyAnalytics,
  buildReportModel,
  filterAnalyticsRecords,
  parseAnalyticsPortfolioResponse,
  reportCsv,
} from './analyticsData';
import { ANALYTICS_METRIC_DEFINITION_VERSION, ANALYTICS_SCHEMA_VERSION } from '@shared/analytics';

const records: AnalyticsRecord[] = [
  record({ eventId: 'one', eventName: '=Unsafe name', eventType: 'conference', status: 'Approved', createdAt: Date.UTC(2026, 0, 2), submittedAt: Date.UTC(2026, 0, 3), terminalDecisionAt: Date.UTC(2026, 1, 3), updatedAt: Date.UTC(2026, 1, 3) }),
  record({ eventId: 'two', eventName: 'Second', eventType: 'festival', status: 'Pending', createdAt: Date.UTC(2026, 1, 2), updatedAt: Date.UTC(2026, 1, 2) }),
];

function record(value: Partial<AnalyticsRecord> & Pick<AnalyticsRecord, 'eventId' | 'eventName' | 'eventType' | 'status' | 'createdAt' | 'updatedAt'>): AnalyticsRecord {
  return {
    venueName: 'Test venue',
    requiredAuthorities: ['PDRM'],
    currentVersionNumber: 1,
    lifecycle: {},
    sourceCoverage: { overrides: 'complete', incidents: 'complete', controls: 'complete', decisionHistory: 'unavailable', assignments: 'unavailable', reviewDecisions: 'complete', currentVersion: 'complete', stage1Documents: 'unavailable' },
    synthetic: false,
    reapplication: false,
    revisionOutcome: 'initial_submission',
    rejectionTaxonomyAvailable: true,
    rejections: [],
    incidents: { available: false, total: 0, verified: 0, severityAvailable: false, bySeverity: { low: 0, medium: 0, high: 0 }, byStatus: { verified: 0, under_review: 0, rejected: 0, unknown: 0 }, immediateActionRequired: { available: false }, externalEscalations: { available: false } },
    controls: { available: false, total: 0, approved: 0, pending: 0, reportedUnderReview: 0, resubmitRequired: 0, usePrevious: 0, stage1: { available: false, total: 0, pendingSubmission: 0, pendingVerification: 0, verified: 0, rejected: 0, usePrevious: 0 } },
    ...value,
  };
}

describe('analyticsData', () => {
  it('groups applications and approvals by their respective months', () => {
    const recordsWithLaterDecisions = records.map((item) => item.eventId === 'one'
      ? { ...item, updatedAt: Date.UTC(2026, 2, 3) }
      : { ...item, status: 'Rejected' as const, terminalDecisionAt: Date.UTC(2026, 3, 4), updatedAt: Date.UTC(2026, 4, 4) });
    expect(buildMonthlyAnalytics(recordsWithLaterDecisions)).toEqual([
      { month: '2026-01', applications: 1, approvals: 0, rejections: 0, assessmentScores: [] },
      { month: '2026-02', applications: 1, approvals: 1, rejections: 0, assessmentScores: [] },
      { month: '2026-04', applications: 0, approvals: 0, rejections: 1, assessmentScores: [] },
    ]);
  });

  it('filters inclusively by local calendar dates', () => {
    expect(filterAnalyticsRecords(records, '2026-02-01', '2026-02-28').map((record) => record.eventId)).toEqual(['two']);
  });

  it('keeps exports PII-free and neutralizes spreadsheet formulas', () => {
    const csv = analyticsCsv(records);
    expect(csv).toContain("'=Unsafe name");
    expect(csv).not.toContain('organizer_email');
    expect(csv).not.toContain('phone');
  });

  it('summarizes approval counts without dividing by zero', () => {
    expect(analyticsSummary(records)).toMatchObject({ applications: 2, approved: 1, aiCategoryAgreementRate: 0, fallbackRate: 0 });
  });

  it('preserves a valid zero-hour turnaround instead of treating it as unavailable', () => {
    const instant = record({
      ...records[0],
      submittedAt: Date.UTC(2026, 0, 3),
      terminalDecisionAt: Date.UTC(2026, 0, 3),
    });
    expect(analyticsSummary([instant]).averageTurnaroundHours).toBe(0);
    const model = buildReportModel('application-outcome', 'overall', undefined, { records: [instant] });
    expect(model.summary.find((item) => item.label === 'Avg turnaround')?.value).toBe('0.0h');
  });

  it('handles malformed timestamps without crashing CSV or monthly analytics', () => {
    const malformed = { ...records[0], eventId: 'broken', createdAt: Number.NaN, updatedAt: Number.NaN };
    expect(() => analyticsCsv([malformed])).not.toThrow();
    expect(buildMonthlyAnalytics([malformed])).toEqual([]);
  });

  it('rejects invalid and reversed date ranges predictably', () => {
    expect(filterAnalyticsRecords(records, 'not-a-date', '2026-02-28')).toEqual([]);
    expect(filterAnalyticsRecords(records, '2026-03-01', '2026-02-01')).toEqual([]);
  });

  it('keeps a count of one distinct from a 100 percent share', () => {
    const model = buildReportModel('risk-assessment', 'overall', undefined, {
      records: [record({ ...records[0], assessment: {
        status: 'official_ready', officialScore: 70, officialRiskLevel: 'High', readiness: 'complete', compliance: 'pass', confidence: 'high', schemaVersion: 'v', aiStatus: 'success', hardRuleAdjustments: 1, manualReview: false, identifiedHazardCategories: [],
      } })],
    });
    expect(model.assessment.riskDistribution.find((item) => item.label === 'High')?.percentage).toBeUndefined();
    const csv = reportCsv(model);
    expect(csv).toContain('"High","1","Data Not Available"');
  });

  it('reports all identified hazard categories separately from the dominant category', () => {
    const assessed = record({ ...records[0], assessment: {
      status: 'official_ready', officialScore: 70, officialRiskLevel: 'High', readiness: 'complete', compliance: 'pass',
      confidence: 'high', schemaVersion: 'v', aiStatus: 'success', hardRuleAdjustments: 0, manualReview: false,
      identifiedHazardCategories: ['crowd', 'crowd', 'medical_capacity'], dominantHazard: 'medical_capacity',
    } });
    const model = buildReportModel('risk-assessment', 'overall', undefined, { records: [assessed] });
    expect(model.assessment.hazards.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Crowd safety', value: 2 }, { label: 'Medical and health-system capacity', value: 1 },
    ]);
    expect(model.assessment.dominantHazards.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Medical and health-system capacity', value: 1 },
    ]);
  });

  it('separates affected-event rate, all-event average and affected-event average', () => {
    const withIncidents = record({ ...records[0], incidents: { available: true, total: 4, verified: 4, severityAvailable: true, bySeverity: { low: 1, medium: 2, high: 1 }, byStatus: { verified: 4, under_review: 0, rejected: 0, unknown: 0 }, immediateActionRequired: { available: false }, externalEscalations: { available: false } } });
    const withoutIncidents = record({ ...records[1], incidents: { available: true, total: 0, verified: 0, severityAvailable: true, bySeverity: { low: 0, medium: 0, high: 0 }, byStatus: { verified: 0, under_review: 0, rejected: 0, unknown: 0 }, immediateActionRequired: { available: false }, externalEscalations: { available: false } } });
    const model = buildReportModel('risk-incident', 'overall', undefined, { records: [withIncidents, withoutIncidents] });
    expect(model.incidents.eventsWithIncidentRate).toBe(0.5);
    expect(model.incidents.averageIncidentsPerEvent).toBe(2);
    expect(model.incidents.averageIncidentsPerAffectedEvent).toBe(4);
    expect(model.incidents.immediateAction).toEqual([]);
    const csv = reportCsv(model);
    expect(csv).toContain('"events_with_incident_rate","0.5"');
    expect(csv).toContain('"average_incidents_per_event","2"');
    expect(csv).toContain('"average_incidents_per_affected_event","4"');
  });

  it('excludes unavailable incident records from counts and denominators', () => {
    const authoritativeZero = record({
      ...records[0],
      incidents: { ...records[0].incidents, available: true },
    });
    const unavailableMalformedSource = record({
      ...records[1],
      sourceCoverage: { ...records[1].sourceCoverage, incidents: 'unavailable' },
      incidents: {
        available: false, total: 99, verified: 99, severityAvailable: true,
        bySeverity: { low: 99, medium: 0, high: 0 },
        byStatus: { verified: 99, under_review: 0, rejected: 0, unknown: 0 },
        immediateActionRequired: { available: false }, externalEscalations: { available: false },
      },
    });
    const model = buildReportModel('risk-incident', 'overall', undefined, { records: [authoritativeZero, unavailableMalformedSource] });
    expect(model.incidents.total).toBe(0);
    expect(model.incidents.eventsWithIncidentRate).toBe(0);
    expect(model.incidents.averageIncidentsPerEvent).toBe(0);
    expect(model.incidents.averageIncidentsPerAffectedEvent).toBeNull();
  });

  it('marks truncated source coverage as partial and exports the limitation', () => {
    const model = buildReportModel('application-outcome', 'overall', undefined, {
      records,
      totalMatched: 1_250,
      totalMatchedExact: false,
      truncated: true,
      coverageLimitations: ['Child collection scan limit reached'],
    });
    expect(model.dataStatus).toBe('partial');
    expect(model.totalMatched).toBe(1_250);
    expect(model.totalMatchedExact).toBe(false);
    expect(model.unavailableSections).toContain('Portfolio results truncated');
    const csv = reportCsv(model);
    expect(csv).toContain('"total_records_matched","1250"');
    expect(csv).toContain('"total_records_matched_exact","false"');
    expect(csv).toContain('"coverage_limitation","Child collection scan limit reached"');
    expect(csv).toContain('"truncated","true"');
    expect(csv).toContain('"section","application_status"');
    expect(csv).not.toContain('"section","incident_summary"');
  });

  it('uses returned-scope counts and observed coverage for client-side report filters', () => {
    const model = buildReportModel('risk-assessment', 'eventType', 'conference', {
      records,
      totalMatched: 999,
      syntheticExcluded: 15,
    });
    expect(model.population).toBe(1);
    expect(model.totalMatched).toBe(1);
    expect(model.syntheticExcluded).toBeNull();
    expect(model.coverage.label).toContain('02 Jan 2026');
    expect(model.coverage.label).not.toBe('Source coverage not specified');
  });

  it('includes presentation records only when explicitly requested', () => {
    const presentationRecord = { ...records[0], eventId: 'presentation-event', synthetic: true };
    const excluded = buildReportModel('risk-incident', 'overall', undefined, {
      records: [...records, presentationRecord],
    });
    const included = buildReportModel('risk-incident', 'overall', undefined, {
      records: [...records, presentationRecord],
      includeSynthetic: true,
    });
    expect(excluded.population).toBe(records.length);
    expect(included.population).toBe(records.length + 1);
    expect(excluded.syntheticExcluded).toBe(1);
    expect(included.syntheticExcluded).toBe(0);
  });

  it('marks a client-scoped matched count as a lower bound when the backend response was truncated', () => {
    const model = buildReportModel('risk-assessment', 'eventType', 'conference', {
      records,
      totalMatched: 600,
      totalMatchedExact: true,
      truncated: true,
      coverageLimitations: ['The server response limit was reached.'],
    });
    expect(model.totalMatched).toBe(1);
    expect(model.totalMatchedExact).toBe(false);
    expect(reportCsv(model)).toContain('"total_records_matched_exact","false"');
  });

  it('caps override rates to overridden items rather than counting every historical action', () => {
    const resourceRecord = record({ ...records[0], resources: {
      schemaVersion: 'v', formulaVersion: 'v', overrideCount: 7, overrideReasonCategoriesAvailable: false,
      overrideReasonCategories: {},
      items: { police: { baseline: 1, minimum: 1, maximum: 2, effective: 2, overrideCount: 7, overrideReasonCategories: {} } },
    } });
    const model = buildReportModel('resource-override', 'overall', undefined, { records: [resourceRecord] });
    expect(model.resources[0]).toMatchObject({ baseline: 1, effective: 2, overrides: 7, overrideRate: 1, reason: 'Data Not Available' });
    expect(model.resourceOverrideRecords).toBe(7);
    expect(model.unavailableSections).toContain('Resource override reasons');
    expect(reportCsv(model)).toContain('"average_effective_quantity"');
  });

  it('counts a multi-category override once at the resource-record level', () => {
    const resourceRecord = record({ ...records[0], resources: {
      schemaVersion: 'v', formulaVersion: 'v', overrideCount: 1, overrideReasonCategoriesAvailable: false,
      overrideReasonCategories: {},
      items: {
        police: { baseline: 1, minimum: 1, maximum: 2, effective: 2, overrideCount: 1, overrideReasonCategories: {} },
        security: { baseline: 4, minimum: 4, maximum: 6, effective: 5, overrideCount: 1, overrideReasonCategories: {} },
      },
    } });
    const model = buildReportModel('resource-override', 'overall', undefined, { records: [resourceRecord] });
    expect(model.resources.reduce((sum, item) => sum + (item.overrides ?? 0), 0)).toBe(2);
    expect(model.resourceOverrideRecords).toBe(1);
    expect(reportCsv(model)).toContain('"unique_override_records","1"');
  });

  it('keeps resource recommendations visible while override history is unavailable', () => {
    const resourceRecord = record({
      ...records[0],
      sourceCoverage: { ...records[0].sourceCoverage, overrides: 'unavailable' },
      resources: {
        schemaVersion: 'v', formulaVersion: 'v', overrideCount: 0, overrideReasonCategoriesAvailable: false,
        overrideReasonCategories: {},
        items: { police: { baseline: 2, minimum: 1, maximum: 3, effective: 2, overrideCount: 0, overrideReasonCategories: {} } },
      },
    });
    const model = buildReportModel('resource-override', 'overall', undefined, { records: [resourceRecord] });
    expect(model.resources[0]).toMatchObject({ baseline: 2, effective: null, range: '1–3', overrides: null, overrideRate: null });
    expect(model.unavailableSections).toContain('Resource overrides');
    expect(model.unavailableSections).not.toContain('Resource recommendations');
  });

  it('reports exact Stage 1 document states instead of legacy aggregate controls', () => {
    const stage1Record = record({ ...records[0], controls: {
      available: true, total: 99, approved: 99, pending: 0, reportedUnderReview: 0, resubmitRequired: 0, usePrevious: 0,
      stage1: { available: true, total: 5, pendingSubmission: 1, pendingVerification: 1, verified: 1, rejected: 1, usePrevious: 1 },
    } });
    const model = buildReportModel('control-compliance', 'overall', undefined, { records: [stage1Record] });
    expect(model.controls.totalItems).toBe(5);
    expect(model.controls.verifiedRate).toBe(0.2);
    expect(model.controls.statuses.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Verified', value: 1 },
      { label: 'Pending verification', value: 1 },
      { label: 'Pending submission', value: 1 },
      { label: 'Rejected / resubmit', value: 1 },
      { label: 'Use Previous', value: 1 },
    ]);
  });

  it('does not substitute control rows when there are zero Stage 1 document requirements', () => {
    const noStage1Requirements = record({ ...records[0], controls: {
      available: true, total: 3, approved: 2, pending: 1, reportedUnderReview: 0, resubmitRequired: 0, usePrevious: 0,
      stage1: { available: true, total: 0, pendingSubmission: 0, pendingVerification: 0, verified: 0, rejected: 0, usePrevious: 0 },
    } });
    const model = buildReportModel('control-compliance', 'overall', undefined, { records: [noStage1Requirements] });
    expect(model.controls.totalItems).toBe(0);
    expect(model.controls.statuses.every((item) => item.value === 0)).toBe(true);
  });

  it('uses exact lifecycle durations and a privacy-safe rejection taxonomy', () => {
    const lifecycleRecord = record({ ...records[0], lifecycle: {
      submissionToInitialReviewMs: 3_600_000,
      initialToAuthorityReviewMs: 7_200_000,
      authorityToSecondReviewMs: 10_800_000,
      submissionToTerminalDecisionMs: 21_600_000,
    }, rejections: [{ reviewStage: 'initial', reasonCategory: 'insufficient_evidence' }] });
    const model = buildReportModel('application-outcome', 'overall', undefined, { records: [lifecycleRecord] });
    expect(model.outcomes.durations.map((item) => item.average)).toEqual(['1.0h', '2.0h', '3.0h', '6.0h']);
    expect(model.outcomes.rejections).toMatchObject([{ label: 'Initial review · Insufficient evidence', value: 1 }]);
    expect(model.unavailableSections).not.toContain('Rejection taxonomy');
  });

  it('keeps rejection taxonomy unavailable when a rejected legacy record lacks a safe category', () => {
    const completeDecisionHistory = record({
      ...records[0],
      sourceCoverage: { ...records[0].sourceCoverage, decisionHistory: 'complete' },
      rejectionTaxonomyAvailable: false,
    });
    const model = buildReportModel('application-outcome', 'overall', undefined, { records: [completeDecisionHistory] });
    expect(model.outcomes.rejections).toEqual([]);
    expect(model.unavailableSections).toContain('Rejection taxonomy');
    expect(model.dataStatus).toBe('partial');
  });

  it('reports revision outcomes without treating every version two record as a rejected re-application', () => {
    const revised = record({ ...records[0], currentVersionNumber: 2, revisionOutcome: 'revised_without_recorded_rejection' });
    const rejected = record({ ...records[1], currentVersionNumber: 2, revisionOutcome: 'resubmitted_after_rejection', reapplication: true });
    const model = buildReportModel('application-outcome', 'overall', undefined, { records: [revised, rejected] });
    expect(model.outcomes.revisions.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Initial submission', value: 0 },
      { label: 'Resubmitted after rejection', value: 1 },
      { label: 'Revised without recorded rejection', value: 1 },
    ]);
  });

  it('renders only predefined resource override reason categories', () => {
    const resourceRecord = record({ ...records[0], resources: {
      schemaVersion: 'v', formulaVersion: 'v', overrideCount: 1, overrideReasonCategoriesAvailable: true,
      overrideReasonCategories: { attendance_change: 1 },
      items: { police: { baseline: 1, minimum: 1, maximum: 2, effective: 2, overrideCount: 1, overrideReasonCategories: { attendance_change: 1 } } },
    } });
    const model = buildReportModel('resource-override', 'overall', undefined, { records: [resourceRecord] });
    expect(model.resources[0].reason).toBe('Attendance change (1)');
    expect(model.unavailableSections).not.toContain('Resource override reasons');
  });

  it('rejects malformed callable payloads before rendering nested report data', () => {
    const payload = {
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      metricDefinitionVersion: ANALYTICS_METRIC_DEFINITION_VERSION,
      generatedAt: Date.now(),
      sourceCutoff: Date.now(),
      records,
      totalMatched: records.length,
      syntheticExcluded: 0,
      truncated: false,
      unavailableSections: [],
      coverage: { eventScan: 'complete', childCollections: 'complete', totalMatchedExact: true, limitations: [] },
    };
    expect(parseAnalyticsPortfolioResponse(payload)).not.toBeNull();
    expect(parseAnalyticsPortfolioResponse({
      ...payload,
      coverage: { ...payload.coverage, childCollections: 'unavailable' },
    })).not.toBeNull();
    expect(parseAnalyticsPortfolioResponse({ ...payload, records: [{ eventId: 'broken' }] })).toBeNull();
    expect(parseAnalyticsPortfolioResponse({ ...payload, schemaVersion: 'legacy' })).toBeNull();
    expect(parseAnalyticsPortfolioResponse({ ...payload, records: [{ ...records[0], incidents: { ...records[0].incidents, total: -1 } }] })).toBeNull();
    expect(parseAnalyticsPortfolioResponse({
      ...payload,
      records: [{ ...records[0], assessment: { status: 'official_ready', officialScore: '70' } }],
    })).toBeNull();
  });
});
