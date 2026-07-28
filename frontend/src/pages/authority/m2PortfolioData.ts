import {
  AssessmentStatus,
  EventRecord,
  ResourceQuantities,
  ResourceRecommendation,
  RiskAssessment,
  RiskLevel,
} from '@shared/types';
import { RESOURCE_FIELDS } from '../../components/m2/m2Presentation';
export { isCurrentResourceRecommendation, isCurrentRiskAssessment } from '../../components/m2/m2Contract';

export interface M2PortfolioRecord {
  event: EventRecord;
  assessment?: RiskAssessment;
  assessmentStatus?: AssessmentStatus;
  resources?: ResourceRecommendation;
  legacyAssessment?: boolean;
  legacyResources?: boolean;
}

export type RiskPortfolioFilter = RiskLevel | 'Unassessed' | 'all';
export type ResourcePortfolioFilter = 'all' | 'prototype' | 'authorityValidated' | 'missing';

export function filterRiskPortfolio(
  records: M2PortfolioRecord[],
  filter: RiskPortfolioFilter,
  search: string,
): M2PortfolioRecord[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const riskWeight: Record<RiskLevel | 'Unassessed', number> = { High: 4, Medium: 3, Low: 2, Unassessed: 1 };
  return records
    .filter((record) => {
      const level = record.assessment?.officialRiskLevel ?? 'Unassessed';
      return filter === 'all' || level === filter;
    })
    .filter((record) => !normalizedSearch || [
      record.event.eventDetails.name,
      record.event.eventDetails.venueName,
      record.event.eventDetails.type,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)))
    .sort((left, right) => {
      const leftRisk = left.assessment?.officialRiskLevel ?? 'Unassessed';
      const rightRisk = right.assessment?.officialRiskLevel ?? 'Unassessed';
      return riskWeight[rightRisk] - riskWeight[leftRisk] || right.event.updatedAt - left.event.updatedAt;
    });
}

export function filterResourcePortfolio(
  records: M2PortfolioRecord[],
  filter: ResourcePortfolioFilter,
  search: string,
): M2PortfolioRecord[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return records
    .filter((record) => {
      if (filter === 'all') return true;
      if (filter === 'missing') return !record.resources;
      return record.resources?.confidenceLevel === filter;
    })
    .filter((record) => !normalizedSearch || [
      record.event.eventDetails.name,
      record.event.eventDetails.venueName,
      record.event.eventDetails.type,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)))
    .sort((left, right) => right.event.updatedAt - left.event.updatedAt);
}

export function riskPortfolioSummary(records: M2PortfolioRecord[]) {
  return records.reduce((summary, record) => {
    const level = record.assessment?.officialRiskLevel ?? 'Unassessed';
    summary[level] += 1;
    if (record.assessment?.aiAdvisory.status !== 'success') summary.advisoryUnavailable += 1;
    if (record.legacyAssessment) summary.requiresRecompute += 1;
    return summary;
  }, { Low: 0, Medium: 0, High: 0, Unassessed: 0, advisoryUnavailable: 0, requiresRecompute: 0 });
}

export function resourcePortfolioSummary(records: M2PortfolioRecord[]) {
  const totals = Object.fromEntries(RESOURCE_FIELDS.map(({ key }) => [key, 0])) as unknown as ResourceQuantities;
  let recommended = 0;
  let authorityValidated = 0;
  let requiresRecompute = 0;
  records.forEach((record) => {
    if (record.legacyResources) requiresRecompute += 1;
    if (!record.resources) return;
    recommended += 1;
    if (record.resources.confidenceLevel === 'authorityValidated') authorityValidated += 1;
    RESOURCE_FIELDS.forEach(({ key }) => { totals[key] += record.resources?.[key] ?? 0; });
  });
  return { totals, recommended, authorityValidated, missing: records.length - recommended, requiresRecompute };
}

export function highestCategory(assessment?: RiskAssessment) {
  return assessment?.categoryAssignments.reduce((highest, category) => (
    !highest || category.score > highest.score ? category : highest
  ), undefined as RiskAssessment['categoryAssignments'][number] | undefined);
}

export function assessmentFreshness(assessment?: RiskAssessment): 'fresh' | 'stale' | 'fallback' | 'unavailable' {
  if (!assessment) return 'unavailable';
  const freshness = assessment.contextSnapshot.weather.freshness;
  if (freshness === 'fallback') return 'fallback';
  if (freshness === 'stale') return 'stale';
  return 'fresh';
}
