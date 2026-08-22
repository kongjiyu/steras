import {
  ASSESSMENT_SCHEMA_VERSION,
  AICategoryProposal,
  AssessmentContextSnapshot,
  EvidenceKey,
  HARD_RULE_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  RiskAssessment,
  RiskLevel,
} from '@shared/types';
import { hoursAgo } from './ids';
import { mockEvents } from './events';

const categories: Array<{ id: AICategoryProposal['categoryId']; name: string; evidence: EvidenceKey }> = [
  { id: 'crowd', name: 'Crowd safety', evidence: 'crowd' },
  { id: 'venue_fire', name: 'Venue, fire and structural safety', evidence: 'venue' },
  { id: 'weather_environment', name: 'Weather and environmental exposure', evidence: 'weather' },
  { id: 'public_health', name: 'Public health and epidemiology', evidence: 'public_health' },
  { id: 'food_water_sanitation', name: 'Food, water and sanitation', evidence: 'sanitation' },
  { id: 'medical_capacity', name: 'Medical and health-system capacity', evidence: 'medical' },
  { id: 'security_cbrn', name: 'Security, behaviour and CBRN', evidence: 'security' },
  { id: 'transport_accessibility', name: 'Transport and accessibility', evidence: 'transport' },
];

function levelFor(attendance: number): RiskLevel {
  if (attendance >= 10_000) return 'High';
  if (attendance >= 2_000) return 'Medium';
  return 'Low';
}

function ratings(level: RiskLevel): [1 | 2 | 3 | 4 | 5, 1 | 2 | 3 | 4 | 5] {
  return level === 'High' ? [4, 4] : level === 'Medium' ? [3, 3] : [2, 2];
}

function context(eventId: string): AssessmentContextSnapshot {
  return {
    weather: { data: { forecast: 'Demo forecast', temperature: 30, humidity: 70, windSpeed: 4, precipitationProbability: 25, severeAlert: false }, measurementStatus: 'available', source: 'fallback', freshness: 'fallback', fetchedAt: hoursAgo(2), expiresAt: hoursAgo(1), forecastFor: hoursAgo(-24) },
    calendar: { localDate: '2026-08-18', dayOfWeek: 'Tuesday', isWeekend: false, isHolidayOrAdjacent: false, sourceVersion: 'demo-calendar-v1', sourceTimestamp: hoursAgo(2), coverageStatus: 'verified' },
    venue: { matched: true, venueId: `${eventId}-venue`, submittedCapacity: 10_000, registeredCapacity: 10_000, fetchedAt: hoursAgo(2) },
    incidentHistory: { matched: true, incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, syntheticEvidence: true, syntheticStatus: 'all', fetchedAt: hoursAgo(2) },
  };
}

function makeAssessment(eventId: string, versionId: string, attendance: number, index: number): RiskAssessment {
  const level = levelFor(attendance);
  const [likelihood, severity] = ratings(level);
  const assessmentContext = context(eventId);
  const evidence = categories.map((category) => ({ key: category.evidence, description: `${category.name} demo evidence`, sourceTimestamp: hoursAgo(2), source: 'synthetic demo fixture', status: 'synthetic', quality: 'declared' as const, confidenceScore: 60, eligibility: 'eligible' as const, syntheticStatus: 'all' as const }));
  const contextEvidence = categories.map((category) => ({ evidenceId: `demo-${category.evidence}`, evidenceKey: category.evidence, sourceKind: 'derived' as const, sourceLocator: 'synthetic-demo-fixture', retrievedAt: hoursAgo(2), sourceVersion: 'demo-v1', eligibility: 'eligible' as const, synthetic: true, visibility: 'authority_only' as const }));
  const common = {
    assessmentId: versionId,
    eventId,
    versionId,
    schemaVersion: ASSESSMENT_SCHEMA_VERSION as typeof ASSESSMENT_SCHEMA_VERSION,
    contextSnapshot: assessmentContext,
    evidence,
    contextEvidence,
    sourceTimestamps: { weather: hoursAgo(2), holiday: hoursAgo(2), venue: hoursAgo(2), incidents: hoursAgo(2) },
    contextStatuses: { weather: 'fallback', venue: 'matched', incidents: 'synthetic' },
    assessmentReadiness: index === 1 ? 'insufficient_data' as const : 'complete' as const,
    complianceStatus: index === 7 ? 'blocked' as const : 'pass' as const,
    complianceChecks: [],
    dataConfidenceScore: 60,
    dataConfidenceLevel: 'medium' as const,
    inputHash: `demo-input-${eventId}-${versionId}`,
    createdAt: hoursAgo(1),
  };
  if (index === 1) {
    return {
      ...common,
      status: 'manual_review_required',
      aiProposal: null,
      warnings: [{ warningId: 'missing_evidence.demo', code: 'missing_evidence', message: 'Required evidence is missing.', evidenceReferences: [] }],
      authorityReviewRequired: true,
      manualReviewReason: 'Required application evidence is incomplete.',
    };
  }
  const proposals = categories.map((category) => ({ categoryId: category.id, likelihood, severity, evidenceReferences: [category.evidence], rationale: `${category.name} synthetic proposal.`, confidence: 'medium' as const, concerns: [], missingInformation: [] }));
  const validated = categories.map((category) => ({
    categoryId: category.id,
    categoryName: category.name,
    proposedLikelihood: likelihood,
    proposedSeverity: severity,
    validatedLikelihood: likelihood,
    validatedSeverity: severity,
    matrixScore: likelihood * severity,
    normalizedScore: likelihood * severity * 4,
    riskLevel: level,
    weight: 1 / categories.length,
    weightedContribution: likelihood * severity * 4 / categories.length,
    evidenceReferences: [category.evidence],
    rationale: `${category.name} synthetic proposal.`,
    confidence: 'medium' as const,
    concerns: [],
    missingInformation: [],
    appliedHardRules: [],
    guidelineChecks: ['demo-guideline'],
  }));
  const provisionalResult = {
    proposalId: `demo-proposal-${eventId}-${versionId}`,
    validatedHazards: [],
    categories: validated,
    overallScore: likelihood * severity * 4,
    weightedRiskLevel: level,
    highestCategoryRiskLevel: level,
    overallRiskLevel: level,
    formulaVersion: PROVISIONAL_FORMULA_VERSION,
    categorySchemaVersion: '2026-07-24-all-hazards-v2',
    hardRuleVersion: HARD_RULE_VERSION,
    calculatedAt: hoursAgo(1),
  };
  return {
    ...common,
    status: 'provisional_ready',
    aiProposal: { status: 'success', proposalId: provisionalResult.proposalId, model: 'synthetic-demo', promptVersion: 'demo-v3', responseSchemaVersion: 'demo-v3', hazards: [], categories: proposals, cacheStatus: 'not-applicable', generatedAt: hoursAgo(1) },
    warnings: common.complianceStatus === 'blocked' ? [{ warningId: 'rubric_conflict.blocked', code: 'rubric_conflict', message: 'Compliance is blocked.', evidenceReferences: ['compliance'] }] : [],
    authorityReviewRequired: true,
    provisionalResult,
  };
}

export const mockAssessments: RiskAssessment[] = mockEvents.flatMap((event, index) => {
  const versionId = event.currentVersionId;
  return versionId ? [makeAssessment(event.eventId, versionId, event.eventDetails.expectedAttendance, index)] : [];
});

export const findAssessmentByEventVersion = (eventId: string, versionId: string): RiskAssessment | undefined =>
  mockAssessments.find((assessment) => assessment.eventId === eventId && assessment.versionId === versionId);

export const findAssessmentsForEvent = (eventId: string): RiskAssessment[] =>
  mockAssessments.filter((assessment) => assessment.eventId === eventId);
