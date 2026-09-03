import {
  EVENT_TYPES,
  EventType,
  RiskLevel,
  RESOURCE_KEYS,
} from '@shared/types';
import type { AnalyticsPortfolioRecord } from '@shared/analytics';
import {
  ANALYTICS_METRIC_DEFINITION_VERSION,
  ANALYTICS_SCHEMA_VERSION,
  AnalyticsPortfolioResponse,
} from '@shared/analytics';

export type ReportType =
  | 'risk-incident'
  | 'application-outcome'
  | 'risk-assessment'
  | 'resource-override'
  | 'control-compliance';

export type AnalysisScope = 'overall' | 'eventType';

export interface ReportCatalogItem {
  id: ReportType;
  eyebrow: string;
  title: string;
  shortTitle: string;
  description: string;
  source: string;
}

export const REPORT_CATALOG: ReportCatalogItem[] = [
  {
    id: 'risk-incident',
    eyebrow: 'Report 01',
    title: 'Event risk & incident analysis',
    shortTitle: 'Risk & incidents',
    description: 'Official risk patterns alongside privacy-safe incident signals.',
    source: 'M1, M2, M4',
  },
  {
    id: 'application-outcome',
    eyebrow: 'Report 02',
    title: 'Application outcome & rejection analysis',
    shortTitle: 'Outcomes & rejection',
    description: 'Submission outcomes, rejection patterns, and review durations.',
    source: 'M1, M2, M3',
  },
  {
    id: 'risk-assessment',
    eyebrow: 'Report 03',
    title: 'Risk assessment analysis',
    shortTitle: 'Assessment quality',
    description: 'Readiness, compliance, confidence, hazards, and review signals.',
    source: 'M2',
  },
  {
    id: 'resource-override',
    eyebrow: 'Report 04',
    title: 'Safety resource & override analysis',
    shortTitle: 'Resources & overrides',
    description: 'Planning baselines, ranges, authority overrides, and reasons.',
    source: 'M2, M3',
  },
  {
    id: 'control-compliance',
    eyebrow: 'Report 05',
    title: 'Event control compliance analysis',
    shortTitle: 'Control compliance',
    description: 'Current control states and verification progress across the portfolio.',
    source: 'M3',
  },
];

export type AnalyticsRecord = AnalyticsPortfolioRecord;

export interface MonthlyAnalytics {
  month: string;
  applications: number;
  approvals: number;
  rejections: number;
  assessmentScores: number[];
}

export interface BreakdownRow {
  label: string;
  value: number;
  percentage?: number;
  color?: string;
  detail?: string;
}

export interface ReportMetric {
  label: string;
  value: string | number;
  detail: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'muted';
}

export interface DurationMetric {
  label: string;
  average: string;
  min: string;
  max: string;
  sample: number;
}

export interface IncidentReportData {
  total: number;
  eventsWithIncidents: number;
  eventsWithIncidentRate: number | null;
  averageIncidentsPerEvent: number | null;
  averageIncidentsPerAffectedEvent: number | null;
  severity: BreakdownRow[];
  immediateAction: BreakdownRow[];
  escalation: BreakdownRow[];
  resolution: BreakdownRow[];
}

export interface OutcomeReportData {
  statuses: BreakdownRow[];
  riskCrossSection: BreakdownRow[];
  revisions: BreakdownRow[];
  rejections: BreakdownRow[];
  durations: DurationMetric[];
}

export interface AssessmentReportData {
  riskDistribution: BreakdownRow[];
  hazards: BreakdownRow[];
  dominantHazards: BreakdownRow[];
  readiness: BreakdownRow[];
  compliance: BreakdownRow[];
  confidence: BreakdownRow[];
  hardRuleAdjustments: number;
  manualReviews: number;
}

export interface ResourceReportItem {
  label: string;
  baseline: number;
  recommendationSample: number;
  comparableBaseline: number | null;
  effective: number | null;
  overrideSample: number;
  range: string;
  overrides: number | null;
  overrideRate: number | null;
  reason: string;
}

export interface ControlReportData {
  statuses: BreakdownRow[];
  totalItems: number;
  verifiedRate: number;
}

export interface MetricDefinition {
  metric: string;
  formula: string;
  denominator: string;
  unavailable: string;
}

export interface ReportModel {
  reportType: ReportType;
  title: string;
  scope: AnalysisScope;
  scopeLabel: string;
  eventType?: EventType;
  eventTypeLabel?: string;
  generatedAt: number;
  coverage: { from: string; to: string; label: string };
  dataSource: 'demo' | 'live';
  dataStatus: 'complete' | 'partial' | 'unavailable';
  population: number;
  eligibleRecords: number;
  syntheticExcluded: number | null;
  totalMatched: number;
  totalMatchedExact: boolean;
  truncated: boolean;
  coverageLimitations: string[];
  summary: ReportMetric[];
  monthlyTrend: MonthlyAnalytics[];
  riskDistribution: BreakdownRow[];
  incidents: IncidentReportData;
  outcomes: OutcomeReportData;
  assessment: AssessmentReportData;
  resources: ResourceReportItem[];
  resourceOverrideRecords: number | null;
  controls: ControlReportData;
  unavailableSections: string[];
  definitions: MetricDefinition[];
}

export function filterAnalyticsRecords(records: AnalyticsRecord[], from?: string, to?: string): AnalyticsRecord[] {
  const fromTimestamp = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const toTimestamp = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
  if (Number.isNaN(fromTimestamp) || Number.isNaN(toTimestamp) || fromTimestamp > toTimestamp) return [];
  return records.filter((record) => Number.isFinite(record.createdAt)
    && record.createdAt >= fromTimestamp
    && record.createdAt <= toTimestamp);
}

export function buildMonthlyAnalytics(records: AnalyticsRecord[]): MonthlyAnalytics[] {
  const months = new Map<string, MonthlyAnalytics>();
  const getMonth = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 7);
  const ensure = (month: string) => {
    const current = months.get(month) ?? { month, applications: 0, approvals: 0, rejections: 0, assessmentScores: [] };
    months.set(month, current);
    return current;
  };

  records.filter((record) => Number.isFinite(record.createdAt)).forEach((record) => {
    const applicationMonth = ensure(getMonth(record.createdAt));
    applicationMonth.applications += 1;
    if (record.assessment?.officialScore !== undefined) applicationMonth.assessmentScores.push(record.assessment.officialScore);
    if (['Approved', 'Rejected'].includes(record.status) && record.terminalDecisionAt !== undefined
      && Number.isFinite(record.terminalDecisionAt)) {
      const decisionMonth = ensure(getMonth(record.terminalDecisionAt));
      if (record.status === 'Approved') decisionMonth.approvals += 1;
      if (record.status === 'Rejected') decisionMonth.rejections += 1;
    }
  });
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function riskDistribution(records: AnalyticsRecord[]): Record<RiskLevel, number> {
  return records.reduce<Record<RiskLevel, number>>((counts, record) => {
    const level = record.assessment?.officialRiskLevel;
    if (level) counts[level] += 1;
    return counts;
  }, { Low: 0, Medium: 0, High: 0 });
}

export function analyticsSummary(records: AnalyticsRecord[]) {
  const assessed = records.filter((record) => record.assessment?.officialRiskLevel !== undefined);
  const approved = records.filter((record) => record.status === 'Approved');
  const fallbackCount = assessed.filter((record) => record.assessment?.aiStatus !== 'success').length;
  const comparable = assessed.filter((record) => record.assessment?.aiAgreement !== undefined);
  const agreements = comparable.filter((record) => record.assessment?.aiAgreement === true);
  const turnaround = approved
    .filter((record) => record.submittedAt !== undefined && record.terminalDecisionAt !== undefined
      && record.terminalDecisionAt >= record.submittedAt)
    .map((record) => (record.terminalDecisionAt as number) - (record.submittedAt as number));
  return {
    applications: records.length,
    approved: approved.length,
    aiCategoryAgreementRate: comparable.length === 0 ? 0 : agreements.length / comparable.length,
    fallbackRate: assessed.length === 0 ? 0 : fallbackCount / assessed.length,
    averageTurnaroundHours: turnaround.length === 0 ? null : average(turnaround) / 3_600_000,
  };
}

export function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function analyticsCsv(records: AnalyticsRecord[]): string {
  const rows = records.map((record) => [
    record.eventId,
    record.eventName,
    record.eventType,
    record.status,
    safeIso(record.createdAt),
    record.submittedAt ? safeIso(record.submittedAt) : '',
    record.assessment?.officialScore ?? '',
    record.assessment?.officialRiskLevel ?? '',
    record.assessment?.categorySchemaVersion ?? '',
    '',
    record.assessment?.aiStatus ?? '',
    record.assessment?.aiAgreement ?? '',
  ]);
  return [
    ['event_id', 'event_name', 'event_type', 'status', 'created_at', 'submitted_at', 'assessment_score', 'assessment_risk_level', 'category_schema_version', 'm3_advisory_band', 'm3_status', 'ai_validation_agreement'],
    ...rows,
  ].map((row) => row.map(csvCell).join(',')).join('\n');
}

export function reportCsv(model: ReportModel, records: AnalyticsRecord[] = []): string {
  const metadata = [
    ['report_title', model.title],
    ['analysis_scope', model.scopeLabel],
    ['event_type', model.eventTypeLabel ?? 'All event types'],
    ['generation_date', new Date(model.generatedAt).toISOString()],
    ['data_coverage_period', model.coverage.label],
    ['data_source', model.dataSource === 'demo' ? 'Synthetic design-preview data' : 'Live Firestore records'],
    ['data_status', model.dataStatus],
    ['eligible_records_returned', model.eligibleRecords],
    ['total_records_matched', model.totalMatched],
    ['total_records_matched_exact', model.totalMatchedExact],
    ['synthetic_records_excluded', model.syntheticExcluded ?? 'Data Not Available'],
    ['truncated', model.truncated],
    ...model.coverageLimitations.map((limitation) => ['coverage_limitation', limitation]),
    ['privacy_note', 'Organiser personal information, private evidence paths, detailed incident descriptions, and internal authority notes excluded'],
    [],
  ];
  const summary = [['summary_metric', 'value', 'detail'], ...model.summary.map((metric) => [metric.label, metric.value, metric.detail])];
  const eventRows = records.map((record) => [
    record.eventId,
    record.eventName,
    record.eventType,
    record.status,
    safeIso(record.createdAt),
    record.assessment?.officialRiskLevel ?? 'Data Not Available',
    record.assessment?.officialScore ?? 'Data Not Available',
  ]);
  const sections = reportSections(model);
  return [...metadata, [], ...summary, [], ...sections, [], ['event_id', 'event_name', 'event_type', 'status', 'created_at', 'official_risk', 'official_score'], ...eventRows]
    .map((row) => row.map((value) => csvCell(value as string | number | boolean)).join(','))
    .join('\n');
}

export function buildReportModel(
  reportType: ReportType,
  scope: AnalysisScope,
  eventType: EventType | undefined,
  options: { preview?: boolean; records?: AnalyticsRecord[]; from?: string; to?: string; syntheticExcluded?: number; unavailableSections?: string[]; totalMatched?: number; totalMatchedExact?: boolean; truncated?: boolean; coverageLimitations?: string[] } = {},
): ReportModel {
  if (options.preview) return buildDemoReport(reportType, scope, eventType);
  return buildLiveReport(reportType, scope, eventType, options.records ?? [], options.from, options.to, options.syntheticExcluded, options.unavailableSections, options.totalMatched, options.totalMatchedExact, options.truncated, options.coverageLimitations);
}

function buildDemoReport(reportType: ReportType, scope: AnalysisScope, eventType?: EventType): ReportModel {
  const selected = REPORT_CATALOG.find((item) => item.id === reportType) ?? REPORT_CATALOG[0];
  const factor = scope === 'eventType' ? eventTypeFactor(eventType) : 1;
  const population = Math.round(284 * factor);
  const eligibleRecords = Math.round(268 * factor);
  const syntheticExcluded = Math.round(24 * factor);
  const risk = scaleRows([
    row('Low', 118, '#5e9b70'),
    row('Medium', 92, '#d3a32e'),
    row('High', 58, '#cf6259'),
  ], factor);
  const statuses = scaleRows([
    row('Approved', 178, '#5e9b70'),
    row('Under review', 42, '#77925a'),
    row('Amendment requested', 28, '#d3a32e'),
    row('Rejected', 20, '#cf6259'),
  ], factor);
  const monthlyTrend = [
    [32, 21, 3], [44, 28, 4], [51, 34, 5],
    [48, 31, 3], [57, 39, 4], [52, 35, 3],
  ].map(([applications, approvals, rejections], index) => ({
    month: `2026-${String(index + 3).padStart(2, '0')}`,
    applications: Math.round(applications * factor),
    approvals: Math.round(approvals * factor),
    rejections: Math.round(rejections * factor),
    assessmentScores: [61, 64, 58, 67].map((value) => value + (scope === 'eventType' ? -2 : 0)),
  }));

  return {
    reportType,
    title: selected.title,
    scope,
    scopeLabel: scope === 'eventType' ? 'By Event Type' : 'Overall portfolio',
    eventType,
    eventTypeLabel: eventType ? EVENT_TYPES.find((item) => item.value === eventType)?.label : undefined,
    generatedAt: Date.now(),
    coverage: { from: '2026-01-01', to: '2026-08-22', label: '01 Jan 2026 – 22 Aug 2026' },
    dataSource: 'demo',
    dataStatus: 'complete',
    population,
    eligibleRecords,
    syntheticExcluded,
    totalMatched: eligibleRecords,
    totalMatchedExact: true,
    truncated: false,
    coverageLimitations: [],
    summary: demoSummary(reportType, factor, population, eligibleRecords),
    monthlyTrend,
    riskDistribution: risk,
    incidents: demoIncidents(factor),
    outcomes: {
      statuses,
      riskCrossSection: scaleRows([row('Low risk', 118), row('Medium risk', 92), row('High risk', 58)], factor),
      revisions: scaleRows([row('No revision', 188), row('Revision requested', 56), row('Resubmitted', 24)], factor),
      rejections: scaleRows([row('Incomplete evidence', 9), row('Safety plan gap', 6), row('Risk threshold', 3), row('Other / uncategorised', 2)], factor),
      durations: [
        { label: 'Initial review', average: '1.8 days', min: '0.4 days', max: '5.2 days', sample: population },
        { label: 'Authority review', average: '2.6 days', min: '0.8 days', max: '8.1 days', sample: Math.round(population * 0.84) },
        { label: 'Second review', average: '1.4 days', min: '0.3 days', max: '4.7 days', sample: Math.round(population * 0.2) },
        { label: 'Complete process', average: '5.1 days', min: '1.2 days', max: '14.9 days', sample: Math.round(population * 0.63) },
      ],
    },
    assessment: {
      riskDistribution: risk,
      hazards: scaleRows([row('Crowd & capacity', 76), row('Weather & environment', 61), row('Venue & fire safety', 45), row('Transport & access', 33), row('Medical capacity', 28)], factor),
      dominantHazards: scaleRows([row('Crowd & capacity', 42), row('Weather & environment', 31), row('Venue & fire safety', 27)], factor),
      readiness: scaleRows([row('Complete', 218, '#5e9b70'), row('Provisional', 36, '#d3a32e'), row('Insufficient data', 14, '#cf6259')], factor),
      compliance: scaleRows([row('Pass', 226, '#5e9b70'), row('Review required', 29, '#d3a32e'), row('Blocked', 13, '#cf6259')], factor),
      confidence: scaleRows([row('High', 144, '#5e9b70'), row('Medium', 96, '#d3a32e'), row('Low', 28, '#cf6259')], factor),
      hardRuleAdjustments: Math.round(31 * factor),
      manualReviews: Math.round(12 * factor),
    },
    resources: scaleResources(factor),
    resourceOverrideRecords: Math.round(21 * factor),
    controls: {
      statuses: scaleRows([
        row('Verified', 134, '#5e9b70'),
        row('Pending verification', 42, '#d3a32e'),
        row('Pending submission', 25, '#8a9a79'),
        row('Rejected / resubmit', 13, '#cf6259'),
        row('Use Previous', 8, '#8b83a9'),
      ], factor),
      totalItems: Math.round(222 * factor),
      verifiedRate: 0.604,
    },
    unavailableSections: [],
    definitions: definitionsFor(reportType),
  };
}

function buildLiveReport(
  reportType: ReportType,
  scope: AnalysisScope,
  eventType: EventType | undefined,
  records: AnalyticsRecord[],
  from?: string,
  to?: string,
  backendSyntheticExcluded = 0,
  backendUnavailable: string[] = [],
  backendTotalMatched?: number,
  backendTotalMatchedExact = true,
  backendTruncated = false,
  coverageLimitations: string[] = [],
): ReportModel {
  const selected = REPORT_CATALOG.find((item) => item.id === reportType) ?? REPORT_CATALOG[0];
  const scoped = filterAnalyticsRecords(records, from, to).filter((record) => scope === 'overall' || record.eventType === eventType);
  const syntheticInScope = scoped.filter((record) => record.synthetic).length;
  const filtered = scoped.filter((record) => !record.synthetic);
  const summary = analyticsSummary(filtered);
  const risks = riskDistribution(filtered);
  const monthlyTrend = buildMonthlyAnalytics(filtered);
  const total = filtered.length;
  const assessed = risks.Low + risks.Medium + risks.High;
  const incidentRecords = filtered.filter((record) => record.incidents.available);
  const incidentTotal = incidentRecords.reduce((sum, record) => sum + record.incidents.total, 0);
  const incidentSeverity = countRows(['low', 'medium', 'high'], (key) => incidentRecords.reduce((sum, record) => sum + record.incidents.bySeverity[key as 'low' | 'medium' | 'high'], 0));
  const incidentResolution = countRows(['verified', 'under_review', 'rejected', 'unknown'], (key) => incidentRecords.reduce((sum, record) => sum + record.incidents.byStatus[key as keyof AnalyticsRecord['incidents']['byStatus']], 0));
  const immediateAction = availabilityBreakdown(incidentRecords.map((record) => ({ ...record.incidents.immediateActionRequired, total: record.incidents.total })), 'Action required', 'No immediate action');
  const escalation = availabilityBreakdown(incidentRecords.map((record) => ({ ...record.incidents.externalEscalations, total: record.incidents.total })), 'Escalated', 'No external escalation');
  const assessedRecords = filtered.filter((record) => record.assessment);
  const resourceRecords = filtered.filter((record) => record.resources);
  const overrideRecords = resourceRecords.filter((record) => record.sourceCoverage.overrides === 'complete');
  const resourceOverrideRecords = overrideRecords.length
    ? overrideRecords.reduce((sum, record) => sum + (record.resources?.overrideCount ?? 0), 0)
    : null;
  const controlRecords = filtered.filter((record) => record.controls.available);
  const resources = RESOURCE_KEYS.map((key) => {
    const values = resourceRecords.map((record) => record.resources?.items[key]).filter(Boolean) as NonNullable<NonNullable<AnalyticsRecord['resources']>['items'][typeof key]>[];
    const overrideValues = overrideRecords.map((record) => record.resources?.items[key]).filter(Boolean) as typeof values;
    const effectiveValues = overrideValues.map((item) => item.effective)
      .filter((value): value is number => value !== undefined);
    const overrideCount = overrideValues.reduce((sum, item) => sum + item.overrideCount, 0);
    const overriddenItems = overrideValues.filter((item) => item.overrideCount > 0).length;
    return {
      label: resourceLabel(key),
      baseline: values.length ? Math.round(average(values.map((item) => item.baseline))) : 0,
      recommendationSample: values.length,
      comparableBaseline: overrideValues.length ? Math.round(average(overrideValues.map((item) => item.baseline))) : null,
      effective: effectiveValues.length === overrideValues.length && effectiveValues.length > 0
        ? Math.round(average(effectiveValues)) : null,
      overrideSample: overrideValues.length,
      range: values.length ? `${Math.round(average(values.map((item) => item.minimum)))}–${Math.round(average(values.map((item) => item.maximum)))}` : 'Data Not Available',
      overrides: overrideValues.length ? overrideCount : null,
      overrideRate: overrideValues.length ? overriddenItems / overrideValues.length : null,
      reason: 'Data Not Available',
    };
  }).filter((item) => item.range !== 'Data Not Available');
  const stage1Records = filtered.filter((record) => record.controls.stage1.available);
  const stage1Total = stage1Records.reduce((sum, record) => sum + record.controls.stage1.total, 0);
  const durationMetrics = [
    durationMetric('Initial review', filtered.map((record) => record.lifecycle.submissionToInitialReviewMs)),
    durationMetric('Authority review', filtered.map((record) => record.lifecycle.initialToAuthorityReviewMs)),
    durationMetric('Second review', filtered.map((record) => record.lifecycle.authorityToSecondReviewMs)),
    durationMetric('Complete process', filtered.map((record) => record.lifecycle.submissionToTerminalDecisionMs)),
  ].filter((item): item is DurationMetric => item !== undefined);
  const unavailable = [...new Set([
    ...backendUnavailable,
    ...(backendTruncated ? ['Portfolio results truncated'] : []),
    ...coverageLimitations,
    ...(incidentRecords.length ? [] : ['Incident patterns']),
    ...(immediateAction.length ? [] : ['Immediate-action signals']),
    ...(escalation.length ? [] : ['External-escalation signals']),
    ...(resourceRecords.length ? [] : ['Resource recommendations']),
    ...(overrideRecords.length ? [] : ['Resource overrides']),
    ...(resourceRecords.some((record) => record.resources?.overrideReasonCategoriesAvailable === false) ? ['Resource override reasons'] : []),
    ...(controlRecords.length ? [] : ['Event-control verification']),
    ...(stage1Records.length ? [] : ['Stage 1 document verification']),
    // The source contract does not yet expose a privacy-safe predefined reason + review-stage taxonomy.
    // Keep this required section explicit rather than treating an empty array as a complete result.
    'Rejection taxonomy',
    ...(durationMetrics.length ? [] : ['Review durations']),
    ...(assessedRecords.length ? [] : ['Risk assessments']),
  ])];
  const relevantUnavailable = unavailable.filter((section) => isRelevantUnavailableSection(reportType, section));
  const clientScoped = scope === 'eventType' || Boolean(from) || Boolean(to);
  return {
    reportType,
    title: selected.title,
    scope,
    scopeLabel: scope === 'eventType' ? 'By Event Type' : 'Overall portfolio',
    eventType,
    eventTypeLabel: eventType ? EVENT_TYPES.find((item) => item.value === eventType)?.label : undefined,
    generatedAt: Date.now(),
    coverage: { from: from ?? '', to: to ?? '', label: formatCoverage(from, to, filtered) },
    dataSource: 'live',
    dataStatus: total === 0 ? 'unavailable' : relevantUnavailable.length ? 'partial' : 'complete',
    population: total,
    eligibleRecords: total,
    syntheticExcluded: clientScoped ? null : backendSyntheticExcluded + syntheticInScope,
    totalMatched: clientScoped ? total : backendTotalMatched ?? total,
    totalMatchedExact: clientScoped ? !backendTruncated && backendTotalMatchedExact : backendTotalMatchedExact,
    truncated: backendTruncated,
    coverageLimitations,
    summary: [
      metric('Eligible applications', total, 'Latest records in selected scope', total === 0 ? 'muted' : 'neutral'),
      metric('Approved', total === 0 ? 'Data Not Available' : `${Math.round((summary.approved / total) * 100)}%`, `${summary.approved} approved records`, total === 0 ? 'muted' : 'positive'),
      metric('Assessed', assessed, `${total === 0 ? 'Data Not Available' : Math.round((assessed / total) * 100) + '%'} of eligible records`, assessed === 0 ? 'muted' : 'neutral'),
      metric('Avg turnaround', summary.averageTurnaroundHours === null ? 'Data Not Available' : `${summary.averageTurnaroundHours.toFixed(1)}h`, 'Submitted to terminal decision', summary.averageTurnaroundHours === null ? 'muted' : 'neutral'),
    ],
    monthlyTrend,
    riskDistribution: [
      row('Low', risks.Low, '#5e9b70'),
      row('Medium', risks.Medium, '#d3a32e'),
      row('High', risks.High, '#cf6259'),
    ],
    incidents: {
      total: incidentTotal,
      eventsWithIncidents: incidentRecords.filter((record) => record.incidents.total > 0).length,
      eventsWithIncidentRate: incidentRecords.length
        ? incidentRecords.filter((record) => record.incidents.total > 0).length / incidentRecords.length
        : null,
      averageIncidentsPerEvent: incidentRecords.length ? incidentTotal / incidentRecords.length : null,
      averageIncidentsPerAffectedEvent: incidentRecords.some((record) => record.incidents.total > 0)
        ? incidentTotal / incidentRecords.filter((record) => record.incidents.total > 0).length
        : null,
      severity: incidentSeverity,
      immediateAction,
      escalation,
      resolution: incidentResolution,
    },
    outcomes: {
      statuses: statusRows(filtered),
      riskCrossSection: [row('Low', risks.Low), row('Medium', risks.Medium), row('High', risks.High)],
      revisions: [row('Re-application', filtered.filter((record) => record.reapplication).length), row('No recorded re-application', filtered.filter((record) => !record.reapplication).length)],
      rejections: [],
      durations: durationMetrics,
    },
    assessment: {
      riskDistribution: [row('Low', risks.Low, '#5e9b70'), row('Medium', risks.Medium, '#d3a32e'), row('High', risks.High, '#cf6259')],
      hazards: countValues(assessedRecords.flatMap((record) => record.assessment?.identifiedHazardCategories.map(hazardLabel) ?? [])),
      dominantHazards: countValues(assessedRecords.map((record) => record.assessment?.dominantHazard
        ? hazardLabel(record.assessment.dominantHazard) : undefined)),
      readiness: countValues(assessedRecords.map((record) => record.assessment?.readiness)),
      compliance: countValues(assessedRecords.map((record) => record.assessment?.compliance)),
      confidence: countValues(assessedRecords.map((record) => record.assessment?.confidence)),
      hardRuleAdjustments: assessedRecords.reduce((sum, record) => sum + (record.assessment?.hardRuleAdjustments ?? 0), 0),
      manualReviews: assessedRecords.filter((record) => record.assessment?.manualReview).length,
    },
    resources,
    resourceOverrideRecords,
    controls: {
      statuses: countRows(['Verified', 'Pending verification', 'Pending submission', 'Rejected / resubmit', 'Use Previous'], (key) => stage1Records.reduce((sum, record) => sum + ({
        'Verified': record.controls.stage1.verified,
        'Pending verification': record.controls.stage1.pendingVerification,
        'Pending submission': record.controls.stage1.pendingSubmission,
        'Rejected / resubmit': record.controls.stage1.rejected,
        'Use Previous': record.controls.stage1.usePrevious,
      }[key] ?? 0), 0)),
      totalItems: stage1Total,
      verifiedRate: stage1Total
        ? stage1Records.reduce((sum, record) => sum + record.controls.stage1.verified, 0) / stage1Total
        : 0,
    },
    unavailableSections: total === 0 ? ['All report sections'] : unavailable,
    definitions: definitionsFor(reportType),
  };
}

function isRelevantUnavailableSection(reportType: ReportType, section: string): boolean {
  if (section === 'Portfolio results truncated' || ![
    'Incident patterns', 'Immediate-action signals', 'External-escalation signals',
    'Resource recommendations', 'Resource overrides', 'Resource override reasons',
    'Event-control verification', 'Stage 1 document verification',
    'Rejection taxonomy', 'Review durations', 'Risk assessments',
  ].includes(section)) return true;
  const relevant: Record<ReportType, string[]> = {
    'risk-incident': ['Incident patterns', 'Immediate-action signals', 'External-escalation signals'],
    'application-outcome': ['Rejection taxonomy', 'Review durations'],
    'risk-assessment': ['Risk assessments'],
    'resource-override': ['Resource recommendations', 'Resource overrides', 'Resource override reasons'],
    'control-compliance': ['Event-control verification', 'Stage 1 document verification'],
  };
  return relevant[reportType].includes(section);
}

function countValues(values: Array<string | undefined>): BreakdownRow[] {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(String(value), (counts.get(String(value)) ?? 0) + 1));
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0) || 1;
  return [...counts.entries()].map(([label, value]) => row(label, value, undefined, value / total));
}

function countRows(labels: string[], valueFor: (label: string) => number): BreakdownRow[] {
  const values = labels.map((label) => ({ label, value: valueFor(label) }));
  const total = values.reduce((sum, item) => sum + item.value, 0) || 1;
  return values.map((item) => row(item.label, item.value, undefined, item.value / total));
}

function availabilityBreakdown(
  values: Array<{ available: boolean; count?: number; total: number }>,
  positiveLabel: string,
  negativeLabel: string,
): BreakdownRow[] {
  const available = values.filter((value) => value.available && value.count !== undefined);
  if (available.length === 0) return [];
  const positive = available.reduce((sum, value) => sum + (value.count ?? 0), 0);
  const total = available.reduce((sum, value) => sum + value.total, 0);
  return countRows([positiveLabel, negativeLabel], (label) => label === positiveLabel ? positive : Math.max(0, total - positive));
}

function durationMetric(label: string, rawValues: Array<number | undefined>): DurationMetric | undefined {
  const values = rawValues.filter((value): value is number => value !== undefined && Number.isFinite(value) && value >= 0);
  if (values.length === 0) return undefined;
  const format = (value: number) => `${(value / 3_600_000).toFixed(1)}h`;
  return {
    label,
    average: format(average(values)),
    min: format(Math.min(...values)),
    max: format(Math.max(...values)),
    sample: values.length,
  };
}

export function parseAnalyticsPortfolioResponse(value: unknown): AnalyticsPortfolioResponse | null {
  if (!isObject(value)
    || value.schemaVersion !== ANALYTICS_SCHEMA_VERSION
    || value.metricDefinitionVersion !== ANALYTICS_METRIC_DEFINITION_VERSION
    || !Array.isArray(value.records)
    || !Number.isFinite(value.generatedAt)
    || !Number.isFinite(value.sourceCutoff)
    || !isNonNegativeInteger(value.totalMatched)
    || !isNonNegativeInteger(value.syntheticExcluded)
    || typeof value.truncated !== 'boolean'
    || !Array.isArray(value.unavailableSections)
    || !value.unavailableSections.every((item) => typeof item === 'string')
    || !isObject(value.coverage)
    || !['complete', 'truncated'].includes(String(value.coverage.eventScan))
    || !['complete', 'truncated', 'unavailable'].includes(String(value.coverage.childCollections))
    || typeof value.coverage.totalMatchedExact !== 'boolean'
    || !Array.isArray(value.coverage.limitations)
    || !value.coverage.limitations.every((item) => typeof item === 'string')
    || !value.records.every(isAnalyticsRecord)) return null;
  return value as unknown as AnalyticsPortfolioResponse;
}

function isAnalyticsRecord(value: unknown): boolean {
  if (!isObject(value)
    || typeof value.eventId !== 'string'
    || typeof value.eventName !== 'string'
    || typeof value.eventType !== 'string'
    || typeof value.status !== 'string'
    || typeof value.venueName !== 'string'
    || !Array.isArray(value.requiredAuthorities)
    || !isNonNegativeInteger(value.currentVersionNumber)
    || !Number.isFinite(value.createdAt)
    || !Number.isFinite(value.updatedAt)
    || typeof value.synthetic !== 'boolean'
    || !isObject(value.incidents)
    || typeof value.incidents.available !== 'boolean'
    || !isNonNegativeInteger(value.incidents.total)
    || !isNonNegativeInteger(value.incidents.verified)
    || !isCountRecord(value.incidents.bySeverity, ['low', 'medium', 'high'])
    || !isCountRecord(value.incidents.byStatus, ['verified', 'under_review', 'rejected', 'unknown'])
    || !isObject(value.incidents.immediateActionRequired)
    || !isAvailabilityCount(value.incidents.immediateActionRequired)
    || !isObject(value.incidents.externalEscalations)
    || !isAvailabilityCount(value.incidents.externalEscalations)
    || !isControls(value.controls)
    || !isObject(value.lifecycle)
    || !Object.values(value.lifecycle).every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0)
    || !isSourceCoverage(value.sourceCoverage)
    || (value.assessment !== undefined && !isAssessmentSummary(value.assessment))
    || (value.resources !== undefined && !isResourceSummary(value.resources))) return false;
  return true;
}

function isAssessmentSummary(value: unknown): boolean {
  if (!isObject(value)
    || !['manual_review_required', 'provisional_ready', 'authority_review', 'official_ready'].includes(String(value.status))
    || !['complete', 'provisional', 'insufficient_data'].includes(String(value.readiness))
    || !['pass', 'review_required', 'blocked'].includes(String(value.compliance))
    || !['low', 'medium', 'high'].includes(String(value.confidence))
    || typeof value.schemaVersion !== 'string'
    || !Array.isArray(value.identifiedHazardCategories)
    || !value.identifiedHazardCategories.every((category) => [
      'crowd', 'venue_fire', 'weather_environment', 'public_health', 'food_water_sanitation',
      'medical_capacity', 'security_cbrn', 'transport_accessibility',
    ].includes(String(category)))
    || !['success', 'unavailable', 'timeout', 'invalid', 'not_attempted'].includes(String(value.aiStatus))
    || !isNonNegativeInteger(value.hardRuleAdjustments)
    || typeof value.manualReview !== 'boolean') return false;
  if (value.officialScore !== undefined
    && (!Number.isFinite(value.officialScore) || Number(value.officialScore) < 4 || Number(value.officialScore) > 100)) return false;
  if (value.officialRiskLevel !== undefined && !['Low', 'Medium', 'High'].includes(String(value.officialRiskLevel))) return false;
  if ((value.officialScore === undefined) !== (value.officialRiskLevel === undefined)) return false;
  if (value.aiAgreement !== undefined && typeof value.aiAgreement !== 'boolean') return false;
  return ['categorySchemaVersion', 'formulaVersion', 'hardRuleVersion']
    .every((key) => value[key] === undefined || typeof value[key] === 'string');
}

function isControls(value: unknown): boolean {
  if (!isObject(value)
    || typeof value.available !== 'boolean'
    || !['total', 'approved', 'pending', 'reportedUnderReview', 'resubmitRequired', 'usePrevious'].every((key) => isNonNegativeInteger(value[key]))
    || !isObject(value.stage1)) return false;
  const stage1 = value.stage1;
  return typeof stage1.available === 'boolean'
    && ['total', 'pendingSubmission', 'pendingVerification', 'verified', 'rejected', 'usePrevious'].every((key) => isNonNegativeInteger(stage1[key]));
}

function isSourceCoverage(value: unknown): boolean {
  return isObject(value)
    && ['overrides', 'incidents', 'controls', 'decisionHistory', 'stage1Documents']
      .every((key) => ['complete', 'truncated', 'unavailable'].includes(String(value[key])));
}

function isAvailabilityCount(value: Record<string, unknown>): boolean {
  return typeof value.available === 'boolean'
    && (value.available ? isNonNegativeInteger(value.count) : value.count === undefined);
}

function isCountRecord(value: unknown, keys: string[]): boolean {
  return isObject(value) && keys.every((key) => isNonNegativeInteger(value[key]));
}

function isResourceSummary(value: unknown): boolean {
  if (!isObject(value)
    || typeof value.schemaVersion !== 'string'
    || typeof value.formulaVersion !== 'string'
    || !isNonNegativeInteger(value.overrideCount)
    || value.overrideReasonCategoriesAvailable !== false
    || !isObject(value.items)) return false;
  return Object.entries(value.items).every(([key, item]) => RESOURCE_KEYS.includes(key as typeof RESOURCE_KEYS[number])
    && isObject(item)
    && ['baseline', 'minimum', 'maximum', 'overrideCount'].every((field) => isNonNegativeInteger(item[field]))
    && (item.effective === undefined || isNonNegativeInteger(item.effective))
    && Number(item.minimum) <= Number(item.baseline)
    && Number(item.baseline) <= Number(item.maximum));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function resourceLabel(key: typeof RESOURCE_KEYS[number]): string {
  return ({ police: 'Police officers', security: 'Security personnel', medicalTeams: 'Medical teams', ambulances: 'Ambulances', fireOfficers: 'Fire-safety officers', toilets: 'Portable toilets', wasteBins: 'Waste bins' })[key];
}

function hazardLabel(category: string): string {
  return ({
    crowd: 'Crowd safety', venue_fire: 'Venue, fire and structural safety',
    weather_environment: 'Weather and environmental exposure', public_health: 'Public health and epidemiology',
    food_water_sanitation: 'Food, water and sanitation', medical_capacity: 'Medical and health-system capacity',
    security_cbrn: 'Security, behaviour and CBRN', transport_accessibility: 'Transport and accessibility',
  } as Record<string, string>)[category] ?? category;
}

function demoSummary(reportType: ReportType, factor: number, population: number, eligibleRecords: number): ReportMetric[] {
  const common = [
    metric('Eligible records', eligibleRecords, 'Latest valid source records', 'neutral'),
    metric('Approved outcome', `${Math.round(178 / Math.max(1, population) * 100)}%`, `${Math.round(178 * factor)} approved applications`, 'positive'),
    metric('Official risk', 'Medium', 'Most common final band', 'warning'),
    metric('Coverage', '94%', 'Records with required fields', 'positive'),
  ];
  if (reportType === 'risk-incident') return [metric('Events in scope', population, 'After synthetic-data exclusion', 'neutral'), metric('Incidents', Math.round(73 * factor), 'Privacy-safe incident attributes', 'warning'), metric('Events with incidents', '27.2%', 'Share of events with incident coverage', 'neutral'), metric('Action required', '18.4%', 'Of recorded incidents', 'danger')];
  if (reportType === 'application-outcome') return [common[0], common[1], metric('Revisions', `${Math.round(56 * factor)}`, 'Requests for amendment', 'warning'), metric('Median process', '4.2 days', 'Submission to terminal decision', 'neutral')];
  if (reportType === 'risk-assessment') return [metric('Assessments', Math.round(254 * factor), 'Latest valid assessment records', 'neutral'), metric('Complete', '81.3%', 'Assessment-readiness gate', 'positive'), metric('AI agreement', '74.8%', 'Successful M3 comparisons only', 'neutral'), metric('Manual review', Math.round(12 * factor), 'Monitoring signal only', 'warning')];
  if (reportType === 'resource-override') return [metric('Resource plans', Math.round(254 * factor), 'M2 recommendations', 'neutral'), metric('Override rate', '13.6%', 'Baseline recommendation items', 'warning'), metric('Highest override', 'Medical', 'Resource category', 'neutral'), metric('Rationale coverage', '100%', 'Overrides with rationale', 'positive')];
  return [metric('Control items', Math.round(222 * factor), 'Current event-control records', 'neutral'), metric('Verified', '60.4%', 'Eligible control items', 'positive'), metric('Resubmission', Math.round(13 * factor), 'Rejected control items', 'warning'), metric('Use Previous', Math.round(8 * factor), 'Explicit exemptions', 'muted')];
}

function demoIncidents(factor: number): IncidentReportData {
  return {
    total: Math.round(73 * factor),
    eventsWithIncidents: Math.round(48 * factor),
    eventsWithIncidentRate: 0.272,
    averageIncidentsPerEvent: 0.414,
    averageIncidentsPerAffectedEvent: 1.52,
    severity: scaleRows([row('Low', 38, '#7caa83'), row('Medium', 26, '#d3a32e'), row('High', 9, '#cf6259')], factor),
    immediateAction: scaleRows([row('No immediate action', 59, '#7caa83'), row('Action required', 14, '#cf6259')], factor),
    escalation: scaleRows([row('No external escalation', 62, '#7caa83'), row('Escalated', 11, '#d3a32e')], factor),
    resolution: scaleRows([row('Resolved', 51, '#7caa83'), row('Under review', 17, '#d3a32e'), row('Rejected', 5, '#8b83a9')], factor),
  };
}

function scaleResources(factor: number): ResourceReportItem[] {
  return [
    ['Police officers', 18, 20, '18–24', 12, 0.118, 'Attendance threshold adjustment'],
    ['Security personnel', 42, 48, '42–56', 21, 0.164, 'Venue access plan'],
    ['Medical teams', 5, 6, '5–7', 17, 0.133, 'Medical capacity review'],
    ['Ambulances', 3, 3, '3–4', 9, 0.071, 'Travel-time consideration'],
    ['Sanitation units', 26, 28, '26–34', 7, 0.055, 'Venue operator request'],
    ['Waste-management bins', 38, 42, '38–50', 10, 0.079, 'Expected attendance update'],
    ['Fire-safety officers', 8, 9, '8–10', 14, 0.11, 'Temporary structure review'],
  ].map(([label, baseline, effective, range, overrides, overrideRate, reason]) => ({
    label: String(label), baseline: Math.round(Number(baseline) * factor), recommendationSample: Math.max(1, Math.round(32 * factor)),
    comparableBaseline: Math.round(Number(baseline) * factor), effective: Math.round(Number(effective) * factor), overrideSample: Math.max(1, Math.round(32 * factor)),
    range: String(range), overrides: Math.round(Number(overrides) * factor), overrideRate: Number(overrideRate), reason: String(reason),
  }));
}

function definitionsFor(reportType: ReportType): MetricDefinition[] {
  const definitions: Record<ReportType, MetricDefinition[]> = {
    'risk-incident': [
      { metric: 'Events with incident rate', formula: 'Events with one or more incidents ÷ covered events', denominator: 'Eligible latest-valid events with incident coverage', unavailable: 'Data Not Available when incident coverage is absent' },
      { metric: 'Average incidents per event', formula: 'Total incidents ÷ covered events', denominator: 'Eligible latest-valid events with incident coverage, including zero-incident events', unavailable: 'Data Not Available when incident coverage is absent' },
      { metric: 'AI agreement', formula: 'Matching advisory band ÷ successful comparisons', denominator: 'M3-successful records only', unavailable: 'Fallback and invalid records are excluded and reported separately' },
    ],
    'application-outcome': [
      { metric: 'Monthly trend', formula: 'Applications grouped by creation month; approvals and rejections grouped by terminal-decision month', denominator: 'Eligible latest-valid events for each timestamped series', unavailable: 'Records missing the relevant timestamp are excluded from that series' },
      { metric: 'Turnaround', formula: 'Terminal decision timestamp − submitted timestamp', denominator: 'Records with both timestamps', unavailable: 'Data Not Available when required timestamps are missing' },
      { metric: 'Re-application rate', formula: 'Events reaching version 2+ after rejection/revision ÷ eligible events', denominator: 'Eligible latest-valid event population', unavailable: 'Data Not Available until version lineage is supplied' },
    ],
    'risk-assessment': [
      { metric: 'Risk distribution', formula: 'Count by official Low / Medium / High band', denominator: 'Latest valid assessments with an official band', unavailable: 'Missing assessment is not classified as Low' },
      { metric: 'Coverage', formula: 'Records with required assessment fields ÷ eligible records', denominator: 'Eligible latest-valid assessment population', unavailable: 'Missing fields remain outside the denominator' },
    ],
    'resource-override': [
      { metric: 'Override rate', formula: 'Overridden recommendation items ÷ baseline recommendation items', denominator: 'Eligible resource recommendation items', unavailable: 'Data Not Available when override history is not supplied' },
      { metric: 'Planning range', formula: 'M2 baseline and source-owned planning range', denominator: 'Latest valid resource recommendations', unavailable: 'M5 never invents resource quantities' },
    ],
    'control-compliance': [
      { metric: 'Verified rate', formula: 'Verified control items ÷ eligible control items', denominator: 'Current control items in selected scope', unavailable: 'Missing control state is not treated as pending' },
      { metric: 'Use Previous', formula: 'Explicit exemptions through the source workflow', denominator: 'Eligible control items', unavailable: 'Data Not Available when M3 control records are absent' },
    ],
  };
  return definitions[reportType];
}

function statusRows(records: AnalyticsRecord[]): BreakdownRow[] {
  const counts = new Map<string, number>();
  records.forEach((record) => counts.set(record.status, (counts.get(record.status) ?? 0) + 1));
  const total = records.length || 1;
  return [...counts.entries()].map(([label, value]) => row(label, value, '#77925a', value / total));
}

function row(label: string, value: number, color?: string, percentage?: number): BreakdownRow {
  return { label, value, percentage, color };
}

function scaleRows(rows: BreakdownRow[], factor: number): BreakdownRow[] {
  const scaled = rows.map((item) => ({ ...item, value: Math.round(item.value * factor) }));
  const total = scaled.reduce((sum, item) => sum + item.value, 0) || 1;
  return scaled.map((item) => ({ ...item, percentage: item.percentage !== undefined ? item.percentage : item.value / total }));
}

function reportSections(model: ReportModel): Array<Array<string | number | boolean>> {
  const breakdown = (title: string, rows: BreakdownRow[]) => [
    ['section', title],
    ['label', 'count', 'share'],
    ...rows.map((item) => [item.label, item.value, item.percentage === undefined ? 'Data Not Available' : item.percentage]),
    [],
  ];
  if (model.reportType === 'risk-incident') return [
    ['section', 'incident_summary'],
    ['metric', 'value'],
    ['total_incidents', model.incidents.total],
    ['events_with_incidents', model.incidents.eventsWithIncidents],
    ['events_with_incident_rate', model.incidents.eventsWithIncidentRate ?? 'Data Not Available'],
    ['average_incidents_per_event', model.incidents.averageIncidentsPerEvent ?? 'Data Not Available'],
    ['average_incidents_per_affected_event', model.incidents.averageIncidentsPerAffectedEvent ?? 'Data Not Available'],
    [],
    ...breakdown('incident_severity', model.incidents.severity),
    ...breakdown('immediate_action', model.incidents.immediateAction),
    ...breakdown('external_escalation', model.incidents.escalation),
    ...breakdown('incident_resolution', model.incidents.resolution),
  ];
  if (model.reportType === 'application-outcome') return [
    ...breakdown('application_status', model.outcomes.statuses),
    ...breakdown('risk_cross_section', model.outcomes.riskCrossSection),
    ...breakdown('application_revision', model.outcomes.revisions),
    ...breakdown('rejection_reason', model.outcomes.rejections),
    ['section', 'review_duration'],
    ['stage', 'average', 'minimum', 'maximum', 'sample'],
    ...model.outcomes.durations.map((item) => [item.label, item.average, item.min, item.max, item.sample]),
  ];
  if (model.reportType === 'risk-assessment') return [
    ...breakdown('official_risk', model.assessment.riskDistribution),
    ...breakdown('hazard', model.assessment.hazards),
    ...breakdown('dominant_hazard', model.assessment.dominantHazards),
    ...breakdown('readiness', model.assessment.readiness),
    ...breakdown('compliance', model.assessment.compliance),
    ...breakdown('confidence', model.assessment.confidence),
    ['section', 'review_signals'],
    ['hard_rule_adjustments', model.assessment.hardRuleAdjustments],
    ['manual_reviews', model.assessment.manualReviews],
  ];
  if (model.reportType === 'resource-override') return [
    ['section', 'resource_recommendation_and_override'],
    ['unique_override_records', model.resourceOverrideRecords ?? 'Data Not Available'],
    ['resource', 'average_recommendation_baseline', 'recommendation_sample', 'average_comparable_baseline', 'average_effective_quantity', 'override_history_sample', 'average_planning_range', 'override_actions', 'overridden_item_rate', 'privacy_safe_reason_category'],
    ...model.resources.map((item) => [item.label, item.baseline, item.recommendationSample, item.comparableBaseline ?? 'Data Not Available', item.effective ?? 'Data Not Available', item.overrideSample, item.range, item.overrides ?? 'Data Not Available', item.overrideRate ?? 'Data Not Available', item.reason]),
  ];
  return [
    ...breakdown('control_status', model.controls.statuses),
    ['section', 'control_summary'],
    ['eligible_control_items', model.controls.totalItems],
    ['verified_rate', model.controls.totalItems ? model.controls.verifiedRate : 'Data Not Available'],
  ];
}

function metric(label: string, value: string | number, detail: string, tone: ReportMetric['tone'] = 'neutral'): ReportMetric {
  return { label, value, detail, tone };
}

function eventTypeFactor(eventType?: EventType): number {
  if (!eventType) return 1;
  const factors: Record<EventType, number> = { concert: 0.25, festival: 0.36, sports: 0.18, cultural: 0.09, religious: 0.05, exhibition: 0.04, fair: 0.02, conference: 0.04, other: 0.02 };
  return factors[eventType];
}

function safeIso(timestamp: number): string {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function formatCoverage(from: string | undefined, to: string | undefined, records: AnalyticsRecord[]): string {
  const timestamps = records.map((record) => record.createdAt).filter(Number.isFinite);
  const observedFrom = timestamps.length ? new Date(Math.min(...timestamps)).toISOString().slice(0, 10) : undefined;
  const observedTo = timestamps.length ? new Date(Math.max(...timestamps)).toISOString().slice(0, 10) : undefined;
  const startValue = from ?? observedFrom;
  const endValue = to ?? observedTo;
  if (!startValue && !endValue) return 'Data Not Available';
  const start = startValue ? new Date(`${startValue}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Start not specified';
  const end = endValue ? new Date(`${endValue}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'End not specified';
  return `${start} – ${end}`;
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}
