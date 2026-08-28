import {
  EVENT_TYPES,
  EventRecord,
  EventStatus,
  EventType,
  RiskAssessment,
  RiskLevel,
} from '@shared/types';
import { assessmentResult, assessmentRiskLevel, assessmentScore } from '../../components/m2/m2Contract';

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

export interface AnalyticsRecord {
  eventId: string;
  eventName: string;
  eventType: EventType;
  status: EventStatus;
  createdAt: number;
  submittedAt?: number;
  updatedAt: number;
  assessment?: RiskAssessment;
  synthetic?: boolean;
}

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
  percentage: number;
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
  incidentRate: number;
  averagePerEvent: number;
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
  readiness: BreakdownRow[];
  compliance: BreakdownRow[];
  confidence: BreakdownRow[];
  hardRuleAdjustments: number;
  manualReviews: number;
}

export interface ResourceReportItem {
  label: string;
  baseline: number;
  range: string;
  overrides: number;
  overrideRate: number;
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
  syntheticExcluded: number;
  summary: ReportMetric[];
  monthlyTrend: MonthlyAnalytics[];
  riskDistribution: BreakdownRow[];
  incidents: IncidentReportData;
  outcomes: OutcomeReportData;
  assessment: AssessmentReportData;
  resources: ResourceReportItem[];
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
    if (record.status === 'Rejected') applicationMonth.rejections += 1;
    if (record.assessment) {
      const score = assessmentScore(record.assessment);
      if (score !== undefined) applicationMonth.assessmentScores.push(score);
    }
    if (record.status === 'Approved' && Number.isFinite(record.updatedAt)) {
      ensure(getMonth(record.updatedAt)).approvals += 1;
    }
  });
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function riskDistribution(records: AnalyticsRecord[]): Record<RiskLevel, number> {
  return records.reduce<Record<RiskLevel, number>>((counts, record) => {
    const level = assessmentRiskLevel(record.assessment);
    if (level) counts[level] += 1;
    return counts;
  }, { Low: 0, Medium: 0, High: 0 });
}

export function analyticsSummary(records: AnalyticsRecord[]) {
  const assessed = records.filter((record) => record.assessment);
  const approved = records.filter((record) => record.status === 'Approved');
  const fallbackCount = assessed.filter((record) => record.assessment?.aiProposal?.status !== 'success').length;
  const comparable = assessed.filter((record) => record.assessment && assessmentResult(record.assessment)
    && !(record.assessment.status === 'official_ready' && 'sourceKind' in record.assessment && record.assessment.sourceKind === 'admin_manual'));
  const agreements = comparable.filter((record) => {
    const result = record.assessment ? assessmentResult(record.assessment) : undefined;
    return result?.categories.every((category) => !('manualLikelihood' in category)
      && category.proposedLikelihood === category.validatedLikelihood
      && category.proposedSeverity === category.validatedSeverity);
  });
  const turnaround = approved
    .filter((record) => record.submittedAt && record.updatedAt >= record.submittedAt)
    .map((record) => record.updatedAt - (record.submittedAt as number));
  return {
    applications: records.length,
    approved: approved.length,
    aiCategoryAgreementRate: comparable.length === 0 ? 0 : agreements.length / comparable.length,
    fallbackRate: assessed.length === 0 ? 0 : fallbackCount / assessed.length,
    averageTurnaroundHours: turnaround.length === 0 ? 0 : average(turnaround) / 3_600_000,
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
    assessmentScore(record.assessment) ?? '',
    assessmentRiskLevel(record.assessment) ?? '',
    record.assessment ? assessmentResult(record.assessment)?.categorySchemaVersion ?? '' : '',
    '',
    record.assessment?.aiProposal?.status ?? '',
    '',
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
    ['privacy_note', 'Organiser personal information, private evidence paths, detailed incident descriptions, and internal authority notes excluded'],
    [],
  ];
  const summary = [['summary_metric', 'value', 'detail'], ...model.summary.map((metric) => [metric.label, metric.value, metric.detail])];
  const rows = records.map((record) => [
    record.eventId,
    record.eventName,
    record.eventType,
    record.status,
    safeIso(record.createdAt),
    assessmentRiskLevel(record.assessment) ?? 'Data Not Available',
    assessmentScore(record.assessment) ?? 'Data Not Available',
  ]);
  return [...metadata, [], ...summary, [], ['event_id', 'event_name', 'event_type', 'status', 'created_at', 'official_risk', 'official_score'], ...rows]
    .map((row) => row.map((value) => csvCell(value as string | number | boolean)).join(','))
    .join('\n');
}

export function buildReportModel(
  reportType: ReportType,
  scope: AnalysisScope,
  eventType: EventType | undefined,
  options: { preview?: boolean; records?: AnalyticsRecord[]; from?: string; to?: string } = {},
): ReportModel {
  if (options.preview) return buildDemoReport(reportType, scope, eventType);
  return buildLiveReport(reportType, scope, eventType, options.records ?? [], options.from, options.to);
}

export function analyticsRecordsFromEvents(events: Array<{ event: EventRecord; assessment?: RiskAssessment }>): AnalyticsRecord[] {
  return events.map(({ event, assessment }) => ({
    eventId: event.eventId,
    eventName: event.eventDetails.name,
    eventType: event.eventDetails.type,
    status: event.status,
    createdAt: event.createdAt,
    submittedAt: event.submittedAt,
    updatedAt: event.updatedAt,
    assessment,
  }));
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
      readiness: scaleRows([row('Complete', 218, '#5e9b70'), row('Provisional', 36, '#d3a32e'), row('Insufficient data', 14, '#cf6259')], factor),
      compliance: scaleRows([row('Pass', 226, '#5e9b70'), row('Review required', 29, '#d3a32e'), row('Blocked', 13, '#cf6259')], factor),
      confidence: scaleRows([row('High', 144, '#5e9b70'), row('Medium', 96, '#d3a32e'), row('Low', 28, '#cf6259')], factor),
      hardRuleAdjustments: Math.round(31 * factor),
      manualReviews: Math.round(12 * factor),
    },
    resources: scaleResources(factor),
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

function buildLiveReport(reportType: ReportType, scope: AnalysisScope, eventType: EventType | undefined, records: AnalyticsRecord[], from?: string, to?: string): ReportModel {
  const selected = REPORT_CATALOG.find((item) => item.id === reportType) ?? REPORT_CATALOG[0];
  const filtered = filterAnalyticsRecords(records, from, to).filter((record) => scope === 'overall' || record.eventType === eventType);
  const summary = analyticsSummary(filtered);
  const risks = riskDistribution(filtered);
  const monthlyTrend = buildMonthlyAnalytics(filtered);
  const total = filtered.length;
  const assessed = risks.Low + risks.Medium + risks.High;
  const unavailable = ['Incident patterns', 'Resource overrides', 'Event-control verification', 'Rejection taxonomy'];
  return {
    reportType,
    title: selected.title,
    scope,
    scopeLabel: scope === 'eventType' ? 'By Event Type' : 'Overall portfolio',
    eventType,
    eventTypeLabel: eventType ? EVENT_TYPES.find((item) => item.value === eventType)?.label : undefined,
    generatedAt: Date.now(),
    coverage: { from: from ?? '', to: to ?? '', label: formatCoverage(from, to) },
    dataSource: 'live',
    dataStatus: total === 0 ? 'unavailable' : 'partial',
    population: total,
    eligibleRecords: total,
    syntheticExcluded: filtered.filter((record) => record.synthetic).length,
    summary: [
      metric('Eligible applications', total, 'Latest records in selected scope', total === 0 ? 'muted' : 'neutral'),
      metric('Approved', total === 0 ? 'Data Not Available' : `${Math.round((summary.approved / total) * 100)}%`, `${summary.approved} approved records`, total === 0 ? 'muted' : 'positive'),
      metric('Assessed', assessed, `${total === 0 ? 'Data Not Available' : Math.round((assessed / total) * 100) + '%'} of eligible records`, assessed === 0 ? 'muted' : 'neutral'),
      metric('Avg turnaround', summary.averageTurnaroundHours ? `${summary.averageTurnaroundHours.toFixed(1)}h` : 'Data Not Available', 'Submitted to terminal decision', summary.averageTurnaroundHours ? 'neutral' : 'muted'),
    ],
    monthlyTrend,
    riskDistribution: [
      row('Low', risks.Low, '#5e9b70'),
      row('Medium', risks.Medium, '#d3a32e'),
      row('High', risks.High, '#cf6259'),
    ],
    incidents: emptyIncidents(),
    outcomes: { statuses: statusRows(filtered), riskCrossSection: [], revisions: [], rejections: [], durations: [] },
    assessment: {
      riskDistribution: [row('Low', risks.Low, '#5e9b70'), row('Medium', risks.Medium, '#d3a32e'), row('High', risks.High, '#cf6259')],
      hazards: [], readiness: [], compliance: [], confidence: [], hardRuleAdjustments: 0, manualReviews: 0,
    },
    resources: [],
    controls: { statuses: [], totalItems: 0, verifiedRate: 0 },
    unavailableSections: total === 0 ? ['All report sections'] : unavailable,
    definitions: definitionsFor(reportType),
  };
}

function demoSummary(reportType: ReportType, factor: number, population: number, eligibleRecords: number): ReportMetric[] {
  const common = [
    metric('Eligible records', eligibleRecords, 'Latest valid source records', 'neutral'),
    metric('Approved outcome', `${Math.round(178 / Math.max(1, population) * 100)}%`, `${Math.round(178 * factor)} approved applications`, 'positive'),
    metric('Official risk', 'Medium', 'Most common final band', 'warning'),
    metric('Coverage', '94%', 'Records with required fields', 'positive'),
  ];
  if (reportType === 'risk-incident') return [metric('Events in scope', population, 'After synthetic-data exclusion', 'neutral'), metric('Incidents', Math.round(73 * factor), 'Privacy-safe incident attributes', 'warning'), metric('Incident rate', '27.2%', 'Incidents per eligible event', 'neutral'), metric('Action required', '18.4%', 'Of recorded incidents', 'danger')];
  if (reportType === 'application-outcome') return [common[0], common[1], metric('Revisions', `${Math.round(56 * factor)}`, 'Requests for amendment', 'warning'), metric('Median process', '4.2 days', 'Submission to terminal decision', 'neutral')];
  if (reportType === 'risk-assessment') return [metric('Assessments', Math.round(254 * factor), 'Latest valid assessment records', 'neutral'), metric('Complete', '81.3%', 'Assessment-readiness gate', 'positive'), metric('AI agreement', '74.8%', 'Successful M3 comparisons only', 'neutral'), metric('Manual review', Math.round(12 * factor), 'Monitoring signal only', 'warning')];
  if (reportType === 'resource-override') return [metric('Resource plans', Math.round(254 * factor), 'M2 recommendations', 'neutral'), metric('Override rate', '13.6%', 'Baseline recommendation items', 'warning'), metric('Highest override', 'Medical', 'Resource category', 'neutral'), metric('Rationale coverage', '100%', 'Overrides with rationale', 'positive')];
  return [metric('Control items', Math.round(222 * factor), 'Current event-control records', 'neutral'), metric('Verified', '60.4%', 'Eligible control items', 'positive'), metric('Resubmission', Math.round(13 * factor), 'Rejected control items', 'warning'), metric('Use Previous', Math.round(8 * factor), 'Explicit exemptions', 'muted')];
}

function demoIncidents(factor: number): IncidentReportData {
  return {
    total: Math.round(73 * factor),
    eventsWithIncidents: Math.round(48 * factor),
    incidentRate: 0.272,
    averagePerEvent: 1.52,
    severity: scaleRows([row('Low', 38, '#7caa83'), row('Medium', 26, '#d3a32e'), row('High', 9, '#cf6259')], factor),
    immediateAction: scaleRows([row('No immediate action', 59, '#7caa83'), row('Action required', 14, '#cf6259')], factor),
    escalation: scaleRows([row('No external escalation', 62, '#7caa83'), row('Escalated', 11, '#d3a32e')], factor),
    resolution: scaleRows([row('Resolved', 51, '#7caa83'), row('Under review', 17, '#d3a32e'), row('Rejected', 5, '#8b83a9')], factor),
  };
}

function scaleResources(factor: number): ResourceReportItem[] {
  return [
    ['Police officers', 18, '18–24', 12, 0.118, 'Attendance threshold adjustment'],
    ['Security personnel', 42, '42–56', 21, 0.164, 'Venue access plan'],
    ['Medical teams', 5, '5–7', 17, 0.133, 'Medical capacity review'],
    ['Ambulances', 3, '3–4', 9, 0.071, 'Travel-time consideration'],
    ['Sanitation units', 26, '26–34', 7, 0.055, 'Venue operator request'],
    ['Waste-management bins', 38, '38–50', 10, 0.079, 'Expected attendance update'],
    ['Fire-safety officers', 8, '8–10', 14, 0.11, 'Temporary structure review'],
  ].map(([label, baseline, range, overrides, overrideRate, reason]) => ({
    label: String(label), baseline: Math.round(Number(baseline) * factor), range: String(range), overrides: Math.round(Number(overrides) * factor), overrideRate: Number(overrideRate), reason: String(reason),
  }));
}

function definitionsFor(reportType: ReportType): MetricDefinition[] {
  const definitions: Record<ReportType, MetricDefinition[]> = {
    'risk-incident': [
      { metric: 'Incident rate', formula: 'Total incidents ÷ eligible events', denominator: 'Eligible latest-valid events with incident coverage', unavailable: 'Data Not Available when incident coverage is absent' },
      { metric: 'AI agreement', formula: 'Matching advisory band ÷ successful comparisons', denominator: 'M3-successful records only', unavailable: 'Fallback and invalid records are excluded and reported separately' },
    ],
    'application-outcome': [
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

function emptyIncidents(): IncidentReportData {
  return { total: 0, eventsWithIncidents: 0, incidentRate: 0, averagePerEvent: 0, severity: [], immediateAction: [], escalation: [], resolution: [] };
}

function row(label: string, value: number, color?: string, percentage?: number): BreakdownRow {
  return { label, value, percentage: percentage ?? value, color };
}

function scaleRows(rows: BreakdownRow[], factor: number): BreakdownRow[] {
  const scaled = rows.map((item) => ({ ...item, value: Math.round(item.value * factor) }));
  const total = scaled.reduce((sum, item) => sum + item.value, 0) || 1;
  return scaled.map((item) => ({ ...item, percentage: item.percentage <= 1 ? item.percentage : item.value / total }));
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

function formatCoverage(from?: string, to?: string): string {
  if (!from && !to) return 'Source coverage not specified';
  const start = from ? new Date(`${from}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Start not specified';
  const end = to ? new Date(`${to}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'End not specified';
  return `${start} – ${end}`;
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}
