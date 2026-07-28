import { ResourceRecommendation, RiskAssessment } from '@shared/types';
import { RESOURCE_FIELDS } from './m2Presentation';

export function isCurrentRiskAssessment(value: unknown): value is RiskAssessment {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RiskAssessment>;
  return record.status === 'ready'
    && typeof record.officialScore === 'number'
    && ['Low', 'Medium', 'High'].includes(record.officialRiskLevel ?? '')
    && Array.isArray(record.categoryAssignments)
    && record.categoryAssignments.length > 0
    && Boolean(record.contextSnapshot?.weather)
    && Boolean(record.contextSnapshot?.calendar)
    && Boolean(record.contextSnapshot?.venue)
    && Boolean(record.contextSnapshot?.incidentHistory)
    && Array.isArray(record.evidence)
    && Boolean(record.aiAdvisory)
    && Array.isArray(record.aiAdvisory?.categories)
    && Array.isArray(record.aiAdvisory?.keyConcerns)
    && Array.isArray(record.aiAdvisory?.resourceConsiderations);
}
export function isCurrentResourceRecommendation(value: unknown): value is ResourceRecommendation {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ResourceRecommendation>;
  return RESOURCE_FIELDS.every(({ key }) => Number.isInteger(record[key]) && Number(record[key]) >= 0)
    && typeof record.formulaVersion === 'string'
    && typeof record.guidelineVersion === 'string'
    && Boolean(record.rationales)
    && Array.isArray(record.aiConsiderations);
}
