import {
  AIAdvisoryAnalysis,
  AIStatus,
  AssessmentReadiness,
  ComplianceCheck,
  ComplianceStatus,
  DeterministicCategoryResult,
  EvidenceKey,
  HazardAssessment,
  HazardDomain,
  HazardDomainSummary,
  RiskAssessment,
  RiskLevel,
  ScoreEvidence,
  VenueContextSnapshot,
  WeatherSnapshot,
  CalendarContextSnapshot,
  HistoricalIncidentContextSnapshot,
  AssessmentContextSnapshot,
} from '@shared/types';
import { EVENT_IDS, daysAgo, daysAhead, hoursAgo } from './ids';
import { mockEventsById } from './events';
import { mockVenuesById } from './venues';

// ---------------------------------------------------------------------------
// Shared M2 config - locked versions
// ---------------------------------------------------------------------------
const CATEGORY_SCHEMA_VERSION = '2026-07-24-all-hazards-v2';
const SCORING_LOGIC_VERSION = '2026-07-24-hirarc-residual-v2';
const PROMPT_VERSION = 'minimax-m3-advisory-v1';
const AI_RESPONSE_SCHEMA_VERSION = 'minimax-m3-advisory-schema-v1';

// ---------------------------------------------------------------------------
// Default evidence items (consistent across events)
// ---------------------------------------------------------------------------
const defaultScoreEvidence: ScoreEvidence[] = [
  {
    key: 'weather',
    description: 'OpenWeather 5-day forecast snapshot.',
    sourceTimestamp: hoursAgo(2),
    source: 'openweather',
    status: 'matched',
    quality: 'official',
    confidenceScore: 0.85,
  },
  {
    key: 'holiday',
    description: 'Malaysian public holiday dataset v2026.07.24.',
    sourceTimestamp: daysAgo(7),
    source: 'malaysia-holidays-dataset',
    status: 'matched',
    quality: 'verified',
    confidenceScore: 0.95,
  },
  {
    key: 'venue',
    description: 'Verified venue capacity, fire cert status, and access profile.',
    sourceTimestamp: daysAgo(14),
    source: 'steras-venues',
    status: 'matched',
    quality: 'verified',
    confidenceScore: 0.9,
  },
  {
    key: 'history',
    description: 'Completed eligible historical events at the same venue (36-month lookback).',
    sourceTimestamp: daysAgo(3),
    source: 'steras-historical-events',
    status: 'matched',
    quality: 'verified',
    confidenceScore: 0.7,
  },
  {
    key: 'compliance',
    description: 'Compliance checks for fire safety, capacity and medical capacity.',
    sourceTimestamp: hoursAgo(2),
    source: 'm2-compliance-engine',
    status: 'matched',
    quality: 'verified',
    confidenceScore: 0.8,
  },
];

const defaultWeather: WeatherSnapshot = {
  data: {
    forecast: 'Partly cloudy with isolated thunderstorms in the evening.',
    temperature: 31,
    humidity: 78,
    windSpeed: 12,
    precipitationProbability: 45,
    severeAlert: false,
  },
  source: 'openweather',
  freshness: 'fresh',
  fetchedAt: hoursAgo(2),
  expiresAt: hoursAgo(-4),
  forecastFor: daysAhead(7),
};

const defaultCalendar: CalendarContextSnapshot = {
  localDate: '2026-08-16',
  dayOfWeek: 'Sunday',
  isWeekend: true,
  isHolidayOrAdjacent: false,
  sourceVersion: '2026.07.24',
  sourceTimestamp: daysAgo(7),
};

const defaultIncidentHistory: HistoricalIncidentContextSnapshot = {
  matched: true,
  total: 2,
  bySeverity: { low: 1, medium: 1, high: 0 },
  incidentIds: ['hist-inc-001', 'hist-inc-002'],
  historicalEventIds: ['hist-evt-001', 'hist-evt-002'],
  historicalEventCount: 2,
  totalAttendance: 12000,
  totalAttendeeHours: 36000,
  patientPresentationRatePerThousand: 2.5,
  hospitalTransferRatePerThousand: 0.3,
  incidentRatePerThousandAttendeeHours: 0.8,
  comparableEvents: [],
  lookbackStart: daysAgo(1080),
  syntheticEvidence: true,
  fetchedAt: daysAgo(3),
};

const defaultContext = (): AssessmentContextSnapshot => ({
  weather: defaultWeather,
  calendar: defaultCalendar,
  venue: {} as VenueContextSnapshot,  // overridden per event
  incidentHistory: defaultIncidentHistory,
});

// ---------------------------------------------------------------------------
// Default hazard set (the 8 all-hazards domains)
// ---------------------------------------------------------------------------
const mkHazard = (overrides: Partial<HazardAssessment> & {
  hazardId: string;
  hazardName: string;
  domain: HazardDomain;
  inherentLikelihood: 1 | 2 | 3 | 4 | 5;
  inherentSeverity: 1 | 2 | 3 | 4 | 5;
  residualLikelihood: 1 | 2 | 3 | 4 | 5;
  residualSeverity: 1 | 2 | 3 | 4 | 5;
  evidenceKeys: EvidenceKey[];
}): HazardAssessment => {
  const inherentMatrixScore = overrides.inherentLikelihood * overrides.inherentSeverity;
  const residualMatrixScore = overrides.residualLikelihood * overrides.residualSeverity;
  const riskLevel: RiskLevel = residualMatrixScore >= 15 ? 'High' : residualMatrixScore >= 5 ? 'Medium' : 'Low';
  return {
    hazardId: overrides.hazardId,
    hazardName: overrides.hazardName,
    domain: overrides.domain,
    inherentLikelihood: overrides.inherentLikelihood,
    inherentSeverity: overrides.inherentSeverity,
    inherentMatrixScore,
    controls: overrides.controls ?? [],
    residualLikelihood: overrides.residualLikelihood,
    residualSeverity: overrides.residualSeverity,
    residualMatrixScore,
    riskLevel,
    evidenceKeys: overrides.evidenceKeys,
    missingData: overrides.missingData ?? [],
    guidelineChecks: overrides.guidelineChecks ?? [],
  };
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
interface AssessmentOverrides {
  eventId: string;
  versionId: string;
  status?: 'ready' | 'processing' | 'failed';
  // Top-line result
  officialScore: number;
  officialRiskLevel: RiskLevel;
  officialMatrixScore: number;
  // Readiness / compliance
  assessmentReadiness: AssessmentReadiness;
  complianceStatus: ComplianceStatus;
  manualReviewRequired?: boolean;
  dataConfidenceScore?: number;
  dataConfidenceLevel?: 'low' | 'medium' | 'high';
  // Hazards - if not provided, a standard 8-domain low-profile set is used
  hazards?: HazardAssessment[];
  // Compliance
  complianceChecks?: ComplianceCheck[];
  // AI
  aiStatus?: AIStatus;
  aiCacheStatus?: 'hit' | 'miss' | 'not-applicable';
  aiOverallBand?: RiskLevel;
  aiOverallExplanation?: string;
  aiKeyConcerns?: string[];
  aiResourceConsiderations?: string[];
  aiCategories?: AIAdvisoryAnalysis['categories'];
  aiModel?: string;
  // Inputs
  inputHash?: string;
  createdAt: number;
  // Optional shape variant - if true, return a legacy v1 shape that fails isCurrentRiskAssessment
  legacyShape?: boolean;
  // Optional per-event evidence
  evidence?: ScoreEvidence[];
  // Per-event incident history override
  incidentHistory?: HistoricalIncidentContextSnapshot;
}

const mkComplianceCheck = (
  checkId: string,
  name: string,
  status: ComplianceStatus,
  authority: 'PDRM' | 'BOMBA' | 'KKM' | 'DBKL' | 'MOTAC',
  rationale: string,
  guidelineReference: string,
): ComplianceCheck => ({
  checkId,
  name,
  status,
  authority,
  jurisdiction: 'Wilayah Persekutuan / Selangor',
  rationale,
  evidenceKeys: ['venue', 'compliance'],
  guidelineReference,
});

const defaultComplianceChecks: ComplianceCheck[] = [
  mkComplianceCheck('chk-001-capacity', 'Verified safe capacity vs expected attendance', 'pass', 'DBKL',
    'Submitted capacity within verified safe capacity envelope.',
    'DBKL Venue Safety Guidelines 2024 §3.2'),
  mkComplianceCheck('chk-002-fire-cert', 'Fire certificate valid', 'pass', 'BOMBA',
    'Fire certificate on file and valid through event window.',
    'BOMBA Fire Safety Act 1988 §11'),
  mkComplianceCheck('chk-003-medical', 'Medical capacity and ambulance access', 'pass', 'KKM',
    'On-site medical team with hospital travel time within KKM 15-minute guideline.',
    'KKM Mass Gathering Medical Guidelines 2018'),
  mkComplianceCheck('chk-004-traffic', 'Traffic management plan submitted', 'pass', 'PDRM',
    'TMP approved by PDRM traffic division with road closure plan.',
    'PDRM Traffic Management SOP 2022'),
];

const standardHazards: HazardAssessment[] = [
  mkHazard({
    hazardId: 'hz-crowd-001', hazardName: 'Crowd density pressure at entry', domain: 'crowd',
    inherentLikelihood: 3, inherentSeverity: 4,
    residualLikelihood: 2, residualSeverity: 3,
    evidenceKeys: ['crowd', 'venue', 'history'],
    controls: [{ controlId: 'ctrl-crowd-mgmt', status: 'verified', affects: 'likelihood', source: 'Stage 1 verified' }],
  }),
  mkHazard({
    hazardId: 'hz-fire-001', hazardName: 'Fire ignition in temporary structures', domain: 'venue_fire',
    inherentLikelihood: 2, inherentSeverity: 5,
    residualLikelihood: 1, residualSeverity: 4,
    evidenceKeys: ['venue', 'compliance'],
    controls: [{ controlId: 'ctrl-fire-cert', status: 'verified', affects: 'likelihood', source: 'Venue fire cert valid' }],
  }),
  mkHazard({
    hazardId: 'hz-weather-001', hazardName: 'Thunderstorm during outdoor event', domain: 'weather_environment',
    inherentLikelihood: 3, inherentSeverity: 3,
    residualLikelihood: 2, residualSeverity: 2,
    evidenceKeys: ['weather'],
    controls: [{ controlId: 'ctrl-severe-weather-plan', status: 'verified', affects: 'severity' }],
  }),
  mkHazard({
    hazardId: 'hz-health-001', hazardName: 'Communicable disease transmission', domain: 'public_health',
    inherentLikelihood: 2, inherentSeverity: 3,
    residualLikelihood: 1, residualSeverity: 2,
    evidenceKeys: ['public_health'],
  }),
  mkHazard({
    hazardId: 'hz-fw-001', hazardName: 'Food and water contamination', domain: 'food_water_sanitation',
    inherentLikelihood: 2, inherentSeverity: 3,
    residualLikelihood: 1, residualSeverity: 2,
    evidenceKeys: ['sanitation'],
  }),
  mkHazard({
    hazardId: 'hz-med-001', hazardName: 'On-site medical capacity exceeded', domain: 'medical_capacity',
    inherentLikelihood: 2, inherentSeverity: 4,
    residualLikelihood: 1, residualSeverity: 3,
    evidenceKeys: ['medical', 'venue'],
    controls: [{ controlId: 'ctrl-medical-team', status: 'verified', affects: 'likelihood' }],
  }),
  mkHazard({
    hazardId: 'hz-sec-001', hazardName: 'Crowd disturbance or altercation', domain: 'security_cbrn',
    inherentLikelihood: 2, inherentSeverity: 3,
    residualLikelihood: 1, residualSeverity: 2,
    evidenceKeys: ['security'],
  }),
  mkHazard({
    hazardId: 'hz-trans-001', hazardName: 'Pedestrian/vehicle conflict at venue approach', domain: 'transport_accessibility',
    inherentLikelihood: 3, inherentSeverity: 3,
    residualLikelihood: 2, residualSeverity: 2,
    evidenceKeys: ['transport', 'venue'],
    controls: [{ controlId: 'ctrl-traffic-plan', status: 'verified', affects: 'likelihood' }],
  }),
];

const standardDomains: HazardDomainSummary[] = [
  { domain: 'crowd', name: 'Crowd safety', score: 60, matrixScore: 6, riskLevel: 'Medium', dominantHazardId: 'hz-crowd-001', confidenceScore: 0.85, confidenceLevel: 'high' },
  { domain: 'venue_fire', name: 'Venue fire / life safety', score: 40, matrixScore: 4, riskLevel: 'Low', dominantHazardId: 'hz-fire-001', confidenceScore: 0.9, confidenceLevel: 'high' },
  { domain: 'weather_environment', name: 'Weather and environment', score: 40, matrixScore: 4, riskLevel: 'Low', dominantHazardId: 'hz-weather-001', confidenceScore: 0.8, confidenceLevel: 'high' },
  { domain: 'public_health', name: 'Public health', score: 20, matrixScore: 2, riskLevel: 'Low', dominantHazardId: 'hz-health-001', confidenceScore: 0.7, confidenceLevel: 'medium' },
  { domain: 'food_water_sanitation', name: 'Food, water, sanitation', score: 20, matrixScore: 2, riskLevel: 'Low', dominantHazardId: 'hz-fw-001', confidenceScore: 0.75, confidenceLevel: 'medium' },
  { domain: 'medical_capacity', name: 'Medical capacity', score: 30, matrixScore: 3, riskLevel: 'Low', dominantHazardId: 'hz-med-001', confidenceScore: 0.85, confidenceLevel: 'high' },
  { domain: 'security_cbrn', name: 'Security and CBRN', score: 20, matrixScore: 2, riskLevel: 'Low', dominantHazardId: 'hz-sec-001', confidenceScore: 0.6, confidenceLevel: 'medium' },
  { domain: 'transport_accessibility', name: 'Transport and accessibility', score: 40, matrixScore: 4, riskLevel: 'Low', dominantHazardId: 'hz-trans-001', confidenceScore: 0.7, confidenceLevel: 'medium' },
];

const standardCategoryAssignments: DeterministicCategoryResult['categoryAssignments'] = standardDomains.map((d) => ({
  categoryId: d.domain,
  categoryName: d.name,
  score: d.score,
  riskLevel: d.riskLevel,
  weight: 0.125,
  weightedContribution: d.score * 0.125,
  rationale: `Dominant hazard: ${d.dominantHazardId}. ${d.confidenceLevel} confidence.`,
  evidenceKeys: d.domain === 'crowd' ? ['crowd', 'venue', 'history']
    : d.domain === 'venue_fire' ? ['venue', 'compliance']
    : d.domain === 'weather_environment' ? ['weather']
    : d.domain === 'public_health' ? ['public_health']
    : d.domain === 'food_water_sanitation' ? ['sanitation']
    : d.domain === 'medical_capacity' ? ['medical', 'venue']
    : d.domain === 'security_cbrn' ? ['security']
    : ['transport', 'venue'],
  guidelineChecks: [`chk-${d.domain}`],
}));

const mkAiAdvisory = (overrides: Partial<AIAdvisoryAnalysis> & {
  status: AIStatus;
  overallExplanation: string;
}): AIAdvisoryAnalysis => ({
  model: 'minimax-m3-advisory',
  promptVersion: PROMPT_VERSION,
  responseSchemaVersion: AI_RESPONSE_SCHEMA_VERSION,
  status: overrides.status,
  label: 'advisory',
  overallBand: overrides.overallBand ?? 'Medium',
  overallExplanation: overrides.overallExplanation,
  categories: overrides.categories ?? standardCategoryAssignments.map((c) => ({
    categoryId: c.categoryId,
    advisoryBand: c.riskLevel,
    explanation: `Advisory analysis for ${c.categoryName}. ${c.rationale}`,
    evidenceReferences: c.evidenceKeys,
    keyConcerns: [],
    resourceConsiderations: [],
  })),
  keyConcerns: overrides.keyConcerns ?? ['Outdoor venue; monitor weather forecast within 24h of event start.'],
  resourceConsiderations: overrides.resourceConsiderations ?? ['Consider +1 medical team for 15,000+ attendance.'],
  citedEvidenceKeys: overrides.citedEvidenceKeys ?? ['weather', 'crowd', 'venue', 'history', 'compliance'],
  cacheStatus: overrides.cacheStatus ?? 'miss',
  generatedAt: overrides.generatedAt ?? hoursAgo(1),
});

const mkAssessment = (o: AssessmentOverrides): RiskAssessment => {
  const event = mockEventsById[o.eventId];
  if (!event) throw new Error(`mkAssessment: unknown event ${o.eventId}`);
  const venue = mockVenuesById[event.eventDetails.venueId!];

  const venueContext: VenueContextSnapshot = {
    matched: true,
    venueId: venue.venueId,
    submittedCapacity: event.eventDetails.venueCapacity,
    registeredCapacity: venue.capacity,
    capacityDifference: venue.capacity - event.eventDetails.venueCapacity,
    verifiedSafeCapacity: venue.verifiedSafeCapacity,
    jurisdiction: venue.jurisdiction,
    fireCertificateStatus: venue.fireCertificateStatus,
    fireCertificateExpiresAt: venue.fireCertificateExpiresAt,
    emergencyAccessVerified: venue.emergencyAccessVerified,
    nearestHospitalTravelMinutes: venue.nearestHospitalTravelMinutes,
    fetchedAt: hoursAgo(2),
  };

  const hazards = o.hazards ?? standardHazards;
  const domains: HazardDomainSummary[] = standardDomains.map((d) => {
    const matchingHazards = hazards.filter((h) => h.domain === d.domain);
    const top = matchingHazards.reduce((max, h) => (h.residualMatrixScore > (max?.residualMatrixScore ?? 0) ? h : max), matchingHazards[0]);
    return {
      domain: d.domain,
      name: d.name,
      score: top ? top.residualMatrixScore * 4 : 0,
      matrixScore: top?.residualMatrixScore ?? 0,
      riskLevel: top?.riskLevel ?? 'Low',
      dominantHazardId: top?.hazardId ?? d.dominantHazardId,
      confidenceScore: d.confidenceScore,
      confidenceLevel: d.confidenceLevel,
    };
  });

  const aiAdvisory: AIAdvisoryAnalysis = mkAiAdvisory({
    status: o.aiStatus ?? 'success',
    overallBand: o.aiOverallBand ?? o.officialRiskLevel,
    overallExplanation: o.aiOverallExplanation ?? `Advisory analysis for ${event.eventDetails.name}. Deterministic residual hazards and evidence support the official risk level.`,
    keyConcerns: o.aiKeyConcerns,
    resourceConsiderations: o.aiResourceConsiderations,
    cacheStatus: o.aiCacheStatus,
    categories: o.aiCategories,
  });

  const base: RiskAssessment = {
    assessmentId: o.versionId,
    eventId: o.eventId,
    versionId: o.versionId,
    status: 'ready',
    // DeterministicCategoryResult fields
    categoryAssignments: standardCategoryAssignments,
    officialScore: o.officialScore,
    officialRiskLevel: o.officialRiskLevel,
    officialMatrixScore: o.officialMatrixScore,
    evidence: o.evidence ?? defaultScoreEvidence,
    categorySchemaVersion: CATEGORY_SCHEMA_VERSION,
    scoringLogicVersion: SCORING_LOGIC_VERSION,
    categorySchemaStatus: 'prototype',
    assessmentReadiness: o.assessmentReadiness,
    complianceStatus: o.complianceStatus,
    complianceChecks: o.complianceChecks ?? defaultComplianceChecks,
    hazards,
    domainSummaries: domains,
    dataConfidenceScore: o.dataConfidenceScore ?? 0.82,
    dataConfidenceLevel: o.dataConfidenceLevel ?? 'high',
    manualReviewRequired: o.manualReviewRequired ?? false,
    computedAt: o.createdAt,
    // M2-only fields
    aiAdvisory,
    contextSnapshot: {
      ...defaultContext(),
      venue: venueContext,
      incidentHistory: o.incidentHistory ?? defaultIncidentHistory,
    },
    sourceTimestamps: {
      weather: hoursAgo(2),
      holiday: daysAgo(7),
      venue: hoursAgo(2),
      incidents: daysAgo(3),
    },
    contextStatuses: {
      weather: 'openweather:fresh',
      holiday: '2026.07.24',
      venue: 'matched',
      incidents: 'matched',
      ai: aiAdvisory.cacheStatus,
    },
    inputHash: o.inputHash ?? `mock-${o.eventId}-${o.versionId}`,
    createdAt: o.createdAt,
  };

  if (o.legacyShape) {
    // Strip fields the current validator checks so isCurrentRiskAssessment returns false.
    // Specifically: remove categoryAssignments, evidence, aiAdvisory.
    return {
      ...base,
      categoryAssignments: undefined as never,
      evidence: undefined as never,
      aiAdvisory: undefined as never,
      // Add legacy marker field that the original v1 contract used
      v1Shape: true,
    } as unknown as RiskAssessment;
  }

  return base;
};

// ---------------------------------------------------------------------------
// Assessments for each event
// ---------------------------------------------------------------------------
export const mockAssessments: RiskAssessment[] = [
  // E001 - Approved, healthy
  mkAssessment({
    eventId: EVENT_IDS.E001, versionId: 'v1',
    officialScore: 55, officialRiskLevel: 'Medium', officialMatrixScore: 14,
    assessmentReadiness: 'complete', complianceStatus: 'pass',
    createdAt: daysAgo(28),
  }),

  // E002 - PROVISIONAL readiness (test: rationale required)
  mkAssessment({
    eventId: EVENT_IDS.E002, versionId: 'v1',
    officialScore: 38, officialRiskLevel: 'Low', officialMatrixScore: 8,
    assessmentReadiness: 'provisional', complianceStatus: 'pass',
    evidence: defaultScoreEvidence.map((e) =>
      e.key === 'weather' ? { ...e, status: 'fallback', quality: 'declared', confidenceScore: 0.4 } : e
    ),
    createdAt: daysAgo(12),
  }),

  // E003 - Just submitted, still processing (not in this list — M2 still computing)
  // (no assessment yet)

  // E004 v1 - complete, pass
  mkAssessment({
    eventId: EVENT_IDS.E004, versionId: 'v1',
    officialScore: 65, officialRiskLevel: 'Medium', officialMatrixScore: 18,
    assessmentReadiness: 'complete', complianceStatus: 'pass',
    createdAt: daysAgo(18),
  }),

  // E005 - Rejected event - complete
  mkAssessment({
    eventId: EVENT_IDS.E005, versionId: 'v1',
    officialScore: 72, officialRiskLevel: 'High', officialMatrixScore: 20,
    assessmentReadiness: 'complete', complianceStatus: 'review_required',
    complianceChecks: [
      ...defaultComplianceChecks,
      mkComplianceCheck('chk-fire-cert-e005', 'Fire certificate valid', 'review_required', 'BOMBA',
        'Outdoor venue with no fire cert; BOMBA requests in-person inspection.',
        'BOMBA Fire Safety Act 1988 §11'),
    ],
    createdAt: daysAgo(28),
  }),

  // E006 - Withdrawn event
  mkAssessment({
    eventId: EVENT_IDS.E006, versionId: 'v1',
    officialScore: 30, officialRiskLevel: 'Low', officialMatrixScore: 6,
    assessmentReadiness: 'complete', complianceStatus: 'pass',
    createdAt: daysAgo(55),
  }),

  // E007 - Manual review required (AI unavailable)
  mkAssessment({
    eventId: EVENT_IDS.E007, versionId: 'v1',
    officialScore: 32, officialRiskLevel: 'Low', officialMatrixScore: 7,
    assessmentReadiness: 'complete', complianceStatus: 'pass',
    manualReviewRequired: true,
    aiStatus: 'unavailable',
    aiCacheStatus: 'not-applicable',
    aiOverallExplanation: 'AI advisory explanation unavailable - M3 model endpoint timed out. Official deterministic result is retained; admin must complete manual assessment.',
    createdAt: daysAgo(6),
  }),

  // E008 - Blocked compliance (test: should not be approvable)
  mkAssessment({
    eventId: EVENT_IDS.E008, versionId: 'v1',
    officialScore: 50, officialRiskLevel: 'Medium', officialMatrixScore: 12,
    assessmentReadiness: 'complete', complianceStatus: 'blocked',
    complianceChecks: defaultComplianceChecks.map((c) =>
      c.checkId === 'chk-002-fire-cert' ? mkComplianceCheck('chk-002-fire-cert', 'Fire certificate valid', 'blocked', 'BOMBA',
        'Fire certificate expired 15 days before event date. Renewal required before any approval can proceed.',
        'BOMBA Fire Safety Act 1988 §11') : c
    ),
    createdAt: daysAgo(8),
  }),

  // E009 - Insufficient data readiness (test: rationale required)
  mkAssessment({
    eventId: EVENT_IDS.E009, versionId: 'v1',
    officialScore: 28, officialRiskLevel: 'Low', officialMatrixScore: 6,
    assessmentReadiness: 'insufficient_data', complianceStatus: 'pass',
    dataConfidenceScore: 0.35, dataConfidenceLevel: 'low',
    evidence: defaultScoreEvidence.map((e) =>
      e.key === 'weather' ? { ...e, status: 'unavailable', quality: 'missing', confidenceScore: 0.1 } : e
    ),
    aiOverallExplanation: 'Weather context unavailable - event date beyond OpenWeather forecast horizon (more than 5 days ahead). Decision requires reviewer rationale.',
    createdAt: daysAgo(4),
  }),

  // E010 v2 - current version under review
  mkAssessment({
    eventId: EVENT_IDS.E010, versionId: 'v2',
    officialScore: 45, officialRiskLevel: 'Medium', officialMatrixScore: 10,
    assessmentReadiness: 'complete', complianceStatus: 'pass',
    createdAt: daysAgo(2),
  }),
  // E010 v1 - superseded, but kept for history
  mkAssessment({
    eventId: EVENT_IDS.E010, versionId: 'v1',
    officialScore: 70, officialRiskLevel: 'High', officialMatrixScore: 20,
    assessmentReadiness: 'complete', complianceStatus: 'review_required',
    createdAt: daysAgo(22),
  }),

  // E011 - Approved with override
  mkAssessment({
    eventId: EVENT_IDS.E011, versionId: 'v1',
    officialScore: 50, officialRiskLevel: 'Medium', officialMatrixScore: 12,
    assessmentReadiness: 'complete', complianceStatus: 'pass',
    createdAt: daysAgo(28),
  }),

  // E012 - High risk, 20000 attendance, pyrotechnics
  mkAssessment({
    eventId: EVENT_IDS.E012, versionId: 'v1',
    officialScore: 85, officialRiskLevel: 'High', officialMatrixScore: 22,
    assessmentReadiness: 'complete', complianceStatus: 'pass',
    hazards: standardHazards.map((h) => {
      if (h.hazardId === 'hz-crowd-001') return { ...h, residualLikelihood: 4 as const, residualSeverity: 4 as const, residualMatrixScore: 16, riskLevel: 'High' as const };
      if (h.hazardId === 'hz-fire-001') return { ...h, inherentLikelihood: 4 as const, residualLikelihood: 3 as const, residualSeverity: 4 as const, residualMatrixScore: 12, riskLevel: 'High' as const };
      if (h.hazardId === 'hz-sec-001') return { ...h, residualLikelihood: 3 as const, residualSeverity: 3 as const, residualMatrixScore: 9, riskLevel: 'Medium' as const };
      return h;
    }),
    createdAt: daysAgo(12),
  }),

  // E013 - Approved
  mkAssessment({
    eventId: EVENT_IDS.E013, versionId: 'v1',
    officialScore: 22, officialRiskLevel: 'Low', officialMatrixScore: 4,
    assessmentReadiness: 'complete', complianceStatus: 'pass',
    createdAt: daysAgo(55),
  }),

  // E014 - Approved, M4 reported
  mkAssessment({
    eventId: EVENT_IDS.E014, versionId: 'v1',
    officialScore: 58, officialRiskLevel: 'Medium', officialMatrixScore: 14,
    assessmentReadiness: 'complete', complianceStatus: 'pass',
    createdAt: daysAgo(85),
  }),

  // E015 - Approved, M4 dismissed
  mkAssessment({
    eventId: EVENT_IDS.E015, versionId: 'v1',
    officialScore: 35, officialRiskLevel: 'Low', officialMatrixScore: 7,
    assessmentReadiness: 'complete', complianceStatus: 'pass',
    createdAt: daysAgo(85),
  }),

  // E016 - Legacy v1 shape (will fail isCurrentRiskAssessment)
  mkAssessment({
    eventId: EVENT_IDS.E016, versionId: 'v1',
    officialScore: 50, officialRiskLevel: 'Medium', officialMatrixScore: 12,
    assessmentReadiness: 'complete', complianceStatus: 'pass',
    legacyShape: true,
    createdAt: daysAgo(12),
  }),
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findAssessmentByEventVersion = (eventId: string, versionId: string): RiskAssessment | undefined =>
  mockAssessments.find((a) => a.eventId === eventId && a.versionId === versionId);

export const findAssessmentsForEvent = (eventId: string): RiskAssessment[] =>
  mockAssessments.filter((a) => a.eventId === eventId);
