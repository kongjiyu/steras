import { EventRecord, EventStatus, RiskAssessment, RiskLevel } from '@shared/types';

export interface DashboardRecord {
  event: EventRecord;
  assessment?: RiskAssessment;
}

const ACTIVE_STATUSES: EventStatus[] = ['Pending', 'UnderReview', 'AmendmentRequested'];

export function dashboardSummary(records: DashboardRecord[]) {
  const count = (status: EventStatus) => records.filter(({ event }) => event.status === status).length;
  return {
    total: records.length,
    active: records.filter(({ event }) => ACTIVE_STATUSES.includes(event.status)).length,
    pending: count('Pending'),
    underReview: count('UnderReview'),
    amendments: count('AmendmentRequested'),
    approved: count('Approved'),
    highRisk: records.filter(({ assessment }) => assessment?.finalRiskLevel === 'High').length,
    unassessed: records.filter(({ assessment }) => !assessment).length,
    resolved: records.filter(({ event }) => ['Approved', 'Rejected', 'Withdrawn'].includes(event.status)).length,
  };
}

export function sortReviewPriority(records: DashboardRecord[]): DashboardRecord[] {
  const riskWeight: Record<RiskLevel, number> = { High: 3, Medium: 2, Low: 1 };
  const statusWeight: Partial<Record<EventStatus, number>> = { AmendmentRequested: 3, Pending: 2, UnderReview: 1 };
  return records
    .filter(({ event }) => ACTIVE_STATUSES.includes(event.status))
    .sort((left, right) => {
      const riskDifference = (riskWeight[right.assessment?.finalRiskLevel ?? 'Low'] ?? 0) - (riskWeight[left.assessment?.finalRiskLevel ?? 'Low'] ?? 0);
      if (riskDifference !== 0) return riskDifference;
      const statusDifference = (statusWeight[right.event.status] ?? 0) - (statusWeight[left.event.status] ?? 0);
      return statusDifference || right.event.updatedAt - left.event.updatedAt;
    });
}

export function riskDistribution(records: DashboardRecord[]) {
  return records.reduce((counts, { assessment }) => {
    if (assessment) counts[assessment.finalRiskLevel] += 1;
    else counts.Unassessed += 1;
    return counts;
  }, { Low: 0, Medium: 0, High: 0, Unassessed: 0 });
}

export function statusDistribution(records: DashboardRecord[]) {
  return records.reduce<Record<EventStatus, number>>((counts, { event }) => {
    counts[event.status] += 1;
    return counts;
  }, { Draft: 0, Pending: 0, UnderReview: 0, AmendmentRequested: 0, Approved: 0, Rejected: 0, Withdrawn: 0 });
}
