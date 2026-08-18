import { EventStatus, EventType, RiskAssessment, RiskLevel } from '@shared/types';
import { assessmentResult, assessmentRiskLevel, assessmentScore } from '../../components/m2/m2Contract';

export interface AnalyticsRecord {
  eventId: string;
  eventName: string;
  eventType: EventType;
  status: EventStatus;
  createdAt: number;
  submittedAt?: number;
  updatedAt: number;
  assessment?: RiskAssessment;
}

export interface MonthlyAnalytics {
  month: string;
  applications: number;
  approvals: number;
  assessmentScores: number[];
}

export function filterAnalyticsRecords(records: AnalyticsRecord[], from?: string, to?: string): AnalyticsRecord[] {
  const fromTimestamp = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const toTimestamp = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
  if (Number.isNaN(fromTimestamp) || Number.isNaN(toTimestamp) || fromTimestamp > toTimestamp) return [];
  return records.filter((record) => Number.isFinite(record.createdAt) && record.createdAt >= fromTimestamp && record.createdAt <= toTimestamp);
}

export function buildMonthlyAnalytics(records: AnalyticsRecord[]): MonthlyAnalytics[] {
  const months = new Map<string, MonthlyAnalytics>();
  const getMonth = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 7);
  const ensure = (month: string) => {
    const current = months.get(month) ?? { month, applications: 0, approvals: 0, assessmentScores: [] };
    months.set(month, current);
    return current;
  };

  records.filter((record) => Number.isFinite(record.createdAt)).forEach((record) => {
    const applicationMonth = ensure(getMonth(record.createdAt));
    applicationMonth.applications += 1;
    if (record.assessment) {
      const score = assessmentScore(record.assessment);
      if (score !== undefined) applicationMonth.assessmentScores.push(score);
    }
    if (record.status === 'Approved' && Number.isFinite(record.updatedAt)) ensure(getMonth(record.updatedAt)).approvals += 1;
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
  const comparable = assessed.filter((record) => record.assessment && assessmentResult(record.assessment));
  const agreements = comparable.filter((record) => {
    const result = record.assessment ? assessmentResult(record.assessment) : undefined;
    return result?.categories.every((category) => category.proposedLikelihood === category.validatedLikelihood && category.proposedSeverity === category.validatedSeverity);
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

function safeIso(timestamp: number): string {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

export function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}
