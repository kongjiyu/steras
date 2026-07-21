import { EventStatus, EventType, RiskAssessment, RiskLevel } from '@shared/types';

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
  baselines: number[];
  finals: number[];
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
    const current = months.get(month) ?? { month, applications: 0, approvals: 0, baselines: [], finals: [] };
    months.set(month, current);
    return current;
  };

  records.filter((record) => Number.isFinite(record.createdAt)).forEach((record) => {
    const applicationMonth = ensure(getMonth(record.createdAt));
    applicationMonth.applications += 1;
    if (record.assessment) {
      applicationMonth.baselines.push(record.assessment.baselineScore);
      applicationMonth.finals.push(record.assessment.finalScore);
    }
    if (record.status === 'Approved' && Number.isFinite(record.updatedAt)) ensure(getMonth(record.updatedAt)).approvals += 1;
  });
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function riskDistribution(records: AnalyticsRecord[]): Record<RiskLevel, number> {
  return records.reduce<Record<RiskLevel, number>>((counts, record) => {
    if (record.assessment) counts[record.assessment.finalRiskLevel] += 1;
    return counts;
  }, { Low: 0, Medium: 0, High: 0 });
}

export function analyticsSummary(records: AnalyticsRecord[]) {
  const assessed = records.filter((record) => record.assessment);
  const approved = records.filter((record) => record.status === 'Approved');
  const fallbackCount = assessed.filter((record) => record.assessment?.ai.status !== 'success').length;
  const turnaround = approved
    .filter((record) => record.submittedAt && record.updatedAt >= record.submittedAt)
    .map((record) => record.updatedAt - (record.submittedAt as number));
  return {
    applications: records.length,
    approved: approved.length,
    averageAdjustment: average(assessed.map((record) => record.assessment?.ai.validatedAdjustment ?? 0)),
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
    record.assessment?.baselineScore ?? '',
    record.assessment?.ai.validatedAdjustment ?? '',
    record.assessment?.finalScore ?? '',
    record.assessment?.finalRiskLevel ?? '',
    record.assessment?.ai.status ?? '',
  ]);
  return [
    ['event_id', 'event_name', 'event_type', 'status', 'created_at', 'submitted_at', 'baseline_score', 'm3_adjustment', 'final_score', 'risk_level', 'm3_status'],
    ...rows,
  ].map((row) => row.map(csvCell).join(',')).join('\n');
}

function safeIso(timestamp: number): string {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

export function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function csvCell(value: string | number): string {
  const text = String(value);
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}
