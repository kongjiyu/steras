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
    sourceCoverage: { overrides: 'complete', incidents: 'complete', controls: 'complete', decisionHistory: 'unavailable', stage1Documents: 'unavailable' },
    synthetic: false,
    reapplication: false,
    incidents: { available: false, total: 0, verified: 0, bySeverity: { low: 0, medium: 0, high: 0 }, byStatus: { verified: 0, under_review: 0, rejected: 0, unknown: 0 }, immediateActionRequired: { available: false }, externalEscalations: { available: false } },
    controls: { available: false, total: 0, approved: 0, pending: 0, reportedUnderReview: 0, resubmitRequired: 0, usePrevious: 0, stage1: { available: false, total: 0, pendingSubmission: 0, pendingVerification: 0, verified: 0, rejected: 0, usePrevious: 0 } },
    ...value,
  };
}

describe('analyticsData', () => {
  it('groups applications and approvals by their respective months', () => {
    expect(buildMonthlyAnalytics(records)).toMatchObject([
      { month: '2026-01', applications: 1, approvals: 0 },
      { month: '2026-02', applications: 1, approvals: 1 },
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
        status: 'official_ready', officialScore: 70, officialRiskLevel: 'High', readiness: 'complete', compliance: 'pass', confidence: 'high', schemaVersion: 'v', aiStatus: 'success', hardRuleAdjustments: 1, manualReview: false,
      } })],
    });
    expect(model.assessment.riskDistribution.find((item) => item.label === 'High')?.percentage).toBeUndefined();
    const csv = reportCsv(model);
    expect(csv).toContain('"High","1","Data Not Available"');
  });

  it('calculates incident event rate separately from incidents per affected event', () => {
    const withIncidents = record({ ...records[0], incidents: { available: true, total: 4, verified: 4, bySeverity: { low: 1, medium: 2, high: 1 }, byStatus: { verified: 4, under_review: 0, rejected: 0, unknown: 0 }, immediateActionRequired: { available: false }, externalEscalations: { available: false } } });
    const withoutIncidents = record({ ...records[1], incidents: { available: true, total: 0, verified: 0, bySeverity: { low: 0, medium: 0, high: 0 }, byStatus: { verified: 0, under_review: 0, rejected: 0, unknown: 0 }, immediateActionRequired: { available: false }, externalEscalations: { available: false } } });
    const model = buildReportModel('risk-incident', 'overall', undefined, { records: [withIncidents, withoutIncidents] });
    expect(model.incidents.incidentRate).toBe(0.5);
    expect(model.incidents.averagePerEvent).toBe(4);
    expect(model.incidents.immediateAction).toEqual([]);
  });

  it('marks truncated source coverage as partial and exports the limitation', () => {
    const model = buildReportModel('application-outcome', 'overall', undefined, {
      records,
      totalMatched: 1_250,
      truncated: true,
      coverageLimitations: ['Child collection scan limit reached'],
    });
    expect(model.dataStatus).toBe('partial');
    expect(model.totalMatched).toBe(1_250);
    expect(model.unavailableSections).toContain('Portfolio results truncated');
    const csv = reportCsv(model);
    expect(csv).toContain('"total_records_matched","1250"');
    expect(csv).toContain('"truncated","true"');
    expect(csv).toContain('"section","application_status"');
    expect(csv).not.toContain('"section","incident_summary"');
  });

  it('caps override rates to overridden items rather than counting every historical action', () => {
    const resourceRecord = record({ ...records[0], resources: {
      schemaVersion: 'v', formulaVersion: 'v', overrideCount: 7, overrideReasonCategoriesAvailable: false,
      items: { police: { baseline: 1, minimum: 1, maximum: 2, effective: 2, overrideCount: 7 } },
    } });
    const model = buildReportModel('resource-override', 'overall', undefined, { records: [resourceRecord] });
    expect(model.resources[0]).toMatchObject({ overrides: 7, overrideRate: 1, reason: 'Data Not Available' });
    expect(model.unavailableSections).toContain('Resource override reasons');
  });

  it('keeps resource recommendations visible while override history is unavailable', () => {
    const resourceRecord = record({
      ...records[0],
      sourceCoverage: { ...records[0].sourceCoverage, overrides: 'unavailable' },
      resources: {
        schemaVersion: 'v', formulaVersion: 'v', overrideCount: 0, overrideReasonCategoriesAvailable: false,
        items: { police: { baseline: 2, minimum: 1, maximum: 3, effective: 2, overrideCount: 0 } },
      },
    });
    const model = buildReportModel('resource-override', 'overall', undefined, { records: [resourceRecord] });
    expect(model.resources[0]).toMatchObject({ baseline: 2, range: '1–3', overrides: null, overrideRate: null });
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

  it('uses exact lifecycle durations and does not invent a rejection taxonomy', () => {
    const lifecycleRecord = record({ ...records[0], lifecycle: {
      submissionToInitialReviewMs: 3_600_000,
      initialToAuthorityReviewMs: 7_200_000,
      authorityToSecondReviewMs: 10_800_000,
      submissionToTerminalDecisionMs: 21_600_000,
    } });
    const model = buildReportModel('application-outcome', 'overall', undefined, { records: [lifecycleRecord] });
    expect(model.outcomes.durations.map((item) => item.average)).toEqual(['1.0h', '2.0h', '3.0h', '6.0h']);
    expect(model.outcomes.rejections).toEqual([]);
    expect(model.unavailableSections).toContain('Rejection taxonomy');
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
    expect(parseAnalyticsPortfolioResponse({ ...payload, records: [{ eventId: 'broken' }] })).toBeNull();
    expect(parseAnalyticsPortfolioResponse({ ...payload, schemaVersion: 'legacy' })).toBeNull();
    expect(parseAnalyticsPortfolioResponse({ ...payload, records: [{ ...records[0], incidents: { ...records[0].incidents, total: -1 } }] })).toBeNull();
  });
});
