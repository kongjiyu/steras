/**
 * No-auth preview route for the Authority Dashboard.
 * Same layout and content as `/authority`, but uses a mock user
 * so designers / stakeholders can see the dashboard without Firebase auth.
 */
import AuthorityDashboard from './authority/AuthorityDashboard';
import AuthorityLayout from '../components/layout/AuthorityLayout';
import { useSearchParams } from 'react-router-dom';
import {
  ASSESSMENT_SCHEMA_VERSION,
  EventRecord,
  EventStatus,
  HARD_RULE_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  ResourceQuantities,
  ResourceRecommendation,
  RiskAssessment,
  RiskLevel,
  hirarcRiskLevelFor,
  riskLevelFor,
} from '@shared/types';
import { DashboardRecord } from './authority/dashboardData';
import RiskAssessments from './authority/RiskAssessments';
import ResourceRecommendations from './authority/ResourceRecommendations';
import { M2PortfolioRecord } from './authority/m2PortfolioData';

const MOCK_USER = { name: 'Admin Officer', role: 'PDRM', initials: 'AO' };

const DAY = 86_400_000;
const now = Date.now();

function previewRecord(
  eventId: string,
  name: string,
  venueName: string,
  status: EventStatus,
  risk: RiskLevel | undefined,
  attendance: number,
  daysUntilEvent: number,
  updatedHoursAgo: number,
): M2PortfolioRecord {
  const versionId = 'v1';
  const event: EventRecord = {
    eventId,
    organizerId: `preview-${eventId}`,
    status,
    currentVersionId: versionId,
    currentVersionNumber: 1,
    currentAssessmentId: risk ? versionId : undefined,
    currentResourceId: risk ? versionId : undefined,
    draftDocumentPaths: [],
    requiredAuthorities: ['PDRM', 'BOMBA'],
    createdAt: now - (updatedHoursAgo + 24) * 3_600_000,
    updatedAt: now - updatedHoursAgo * 3_600_000,
    submittedAt: now - (updatedHoursAgo + 12) * 3_600_000,
    eventDetails: {
      name,
      type: name.includes('Run') ? 'sports' : name.includes('Festival') ? 'festival' : 'cultural',
      venueName,
      venueAddress: 'Kuala Lumpur, Malaysia',
      venueCapacity: Math.ceil(attendance * 1.25),
      expectedAttendance: attendance,
      environment: 'outdoor',
      coverage: 'partially_covered',
      seating: 'mixed',
      startDatetime: now + daysUntilEvent * DAY,
      endDatetime: now + daysUntilEvent * DAY + 6 * 3_600_000,
      emergencyPlanSummary: 'Multi-agency safety and emergency response plan submitted.',
      organizerName: 'Preview organizer',
      organizerEmail: 'preview@steras.test',
      organizerPhone: '+60 3 0000 0000',
    },
  };
  const assessment = risk ? previewAssessment(event, risk, versionId) : undefined;
  const resources = assessment ? previewResources(event, assessment, versionId) : undefined;
  if (resources) event.currentResourceId = resources.resourceId;
  return { event, assessment, assessmentStatus: risk ? 'provisional_ready' : 'processing', resources };
}

const PREVIEW_RECORDS = [
  previewRecord('merdeka-festival', 'Merdeka Cultural Festival', 'Dataran Merdeka', 'Pending', 'High', 18_000, 21, 2),
  previewRecord('river-lights', 'River of Life Night Market', 'Masjid Jamek Precinct', 'AmendmentRequested', 'Medium', 7_500, 12, 5),
  previewRecord('heritage-run', 'KL Heritage Run 2026', 'Padang Merbok', 'UnderReview', 'Medium', 10_000, 32, 9),
  previewRecord('craft-week', 'Malaysian Craft Week', 'Kompleks Kraf Kuala Lumpur', 'Pending', undefined, 3_200, 45, 12),
  previewRecord('food-festival', 'Flavours of Malaysia Festival', 'Titiwangsa Lake Gardens', 'UnderReview', 'Low', 5_500, 54, 26),
  previewRecord('batik-showcase', 'Batik Design Showcase', 'Kuala Lumpur Convention Centre', 'Approved', 'Low', 2_400, 68, 48),
  previewRecord('city-countdown', 'Kuala Lumpur City Countdown', 'Bukit Bintang', 'Approved', 'High', 24_000, 170, 72),
  previewRecord('community-carnival', 'Community Tourism Carnival', 'Perdana Botanical Gardens', 'Rejected', 'Medium', 6_000, 80, 96),
];

export default function DashboardPreview() {
  const [searchParams] = useSearchParams();
  const view = searchParams.get('view');
  const records = PREVIEW_RECORDS as M2PortfolioRecord[];
  return (
    <AuthorityLayout mockUser={MOCK_USER}>
      {view === 'risk'
        ? <RiskAssessments previewRecords={records} previewAgency="PDRM" />
        : view === 'resources'
          ? <ResourceRecommendations previewRecords={records} previewAgency="PDRM" />
          : <AuthorityDashboard previewRecords={records as DashboardRecord[]} />}
    </AuthorityLayout>
  );
}

function previewAssessment(event: EventRecord, risk: RiskLevel, versionId: string): RiskAssessment {
  const categories = [
    { categoryId: 'crowd', categoryName: 'Crowd and capacity pressure', weight: 0.125, evidenceKeys: ['crowd'] as const },
    { categoryId: 'venue_fire', categoryName: 'Venue and fire safety', weight: 0.125, evidenceKeys: ['venue'] as const },
    { categoryId: 'weather_environment', categoryName: 'Weather and environment', weight: 0.125, evidenceKeys: ['weather'] as const },
    { categoryId: 'public_health', categoryName: 'Public health', weight: 0.125, evidenceKeys: ['public_health'] as const },
    { categoryId: 'food_water_sanitation', categoryName: 'Food, water, and sanitation', weight: 0.125, evidenceKeys: ['sanitation'] as const },
    { categoryId: 'medical_capacity', categoryName: 'Medical capacity', weight: 0.125, evidenceKeys: ['medical'] as const },
    { categoryId: 'security_cbrn', categoryName: 'Security and CBRN', weight: 0.125, evidenceKeys: ['security'] as const },
    { categoryId: 'transport_accessibility', categoryName: 'Transport and accessibility', weight: 0.125, evidenceKeys: ['transport'] as const },
  ];
  const rating = risk === 'High' ? 4 : risk === 'Medium' ? 3 : 2;
  const matrixScore = rating * rating;
  const normalizedScore = matrixScore * 4;
  const categoryRiskLevel = hirarcRiskLevelFor(matrixScore);
  const weightedRiskLevel = riskLevelFor(normalizedScore);
  return {
    assessmentId: versionId,
    eventId: event.eventId,
    versionId,
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    status: 'provisional_ready',
    evidence: categories.map((category) => ({
      key: category.evidenceKeys[0],
      description: `${category.categoryName} input captured for preview.`,
      sourceTimestamp: now,
      source: category.categoryId === 'weather_environment' ? 'openweather' : 'versioned-input',
      status: 'matched',
      quality: 'verified' as const,
      confidenceScore: 85,
      eligibility: 'eligible',
      syntheticStatus: 'none',
    })),
    contextEvidence: categories.map((category) => ({ evidenceId: `preview-${category.evidenceKeys[0]}`, evidenceKey: category.evidenceKeys[0], sourceKind: 'derived' as const, sourceLocator: 'dashboard-preview', retrievedAt: now, sourceVersion: 'preview-v1', eligibility: 'eligible' as const, synthetic: true, visibility: 'authority_only' as const })),
    aiProposal: {
      proposalId: `preview-${event.eventId}`,
      model: 'MiniMax-M3',
      promptVersion: '2026-08-18-proposal-v3',
      responseSchemaVersion: '2026-08-18-proposal-v3',
      status: 'success',
      hazards: [],
      categories: categories.map((category) => ({ categoryId: category.categoryId, likelihood: rating, severity: rating, evidenceReferences: [...category.evidenceKeys], rationale: category.categoryName, confidence: 'medium', concerns: [], missingInformation: [] })),
      cacheStatus: 'miss',
      generatedAt: now,
    },
    contextSnapshot: {
      weather: {
        data: { forecast: 'Scattered showers', temperature: 30, humidity: 76, windSpeed: 2.8, precipitationProbability: 55, severeAlert: false },
        measurementStatus: 'available',
        source: 'openweather', freshness: 'fresh', fetchedAt: now, expiresAt: now + 3_600_000, forecastFor: event.eventDetails.startDatetime,
      },
      calendar: { localDate: '2026-08-31', dayOfWeek: 'Monday', isWeekend: false, isHolidayOrAdjacent: true, holidayName: 'National Day', holidayDistanceDays: 0, sourceVersion: 'my-holidays-v1', sourceTimestamp: now, coverageStatus: 'verified' },
      venue: { matched: true, venueId: `venue-${event.eventId}`, submittedCapacity: event.eventDetails.venueCapacity, registeredCapacity: event.eventDetails.venueCapacity, capacityDifference: 0, fetchedAt: now },
      incidentHistory: { matched: true, venueId: `venue-${event.eventId}`, incidentIds: ['incident-preview'], total: 1, bySeverity: { low: 0, medium: 1, high: 0 }, syntheticStatus: 'none', fetchedAt: now },
    },
    sourceTimestamps: { event: event.updatedAt, weather: now, calendar: now, venue: now, history: now },
    contextStatuses: { weather: 'fresh', calendar: 'matched', venue: 'matched', history: 'matched' },
    assessmentReadiness: 'complete',
    complianceStatus: 'pass',
    complianceChecks: [],
    dataConfidenceScore: 80,
    dataConfidenceLevel: 'high',
    warnings: [],
    authorityReviewRequired: true,
    provisionalResult: {
      proposalId: `preview-${event.eventId}`,
      validatedHazards: [],
      categories: categories.map((category) => ({ categoryId: category.categoryId, categoryName: category.categoryName, proposedLikelihood: rating, proposedSeverity: rating, validatedLikelihood: rating, validatedSeverity: rating, matrixScore, normalizedScore, riskLevel: categoryRiskLevel, weight: category.weight, weightedContribution: normalizedScore * category.weight, evidenceReferences: [...category.evidenceKeys], rationale: category.categoryName, confidence: 'medium', concerns: [], missingInformation: [], appliedHardRules: [], guidelineChecks: [`prototype.${category.categoryId}.v1`] })),
      overallScore: normalizedScore,
      weightedRiskLevel,
      highestCategoryRiskLevel: categoryRiskLevel,
      overallRiskLevel: risk,
      formulaVersion: PROVISIONAL_FORMULA_VERSION,
      categorySchemaVersion: '2026-07-24-all-hazards-v2',
      hardRuleVersion: HARD_RULE_VERSION,
      calculatedAt: now,
    },
    inputHash: `preview-${event.eventId}`,
    createdAt: now,
  };
}

function previewResources(event: EventRecord, assessment: RiskAssessment, versionId: string): ResourceRecommendation {
  const attendance = event.eventDetails.expectedAttendance;
  const quantities: ResourceQuantities = {
    police: Math.ceil(attendance / 700),
    security: Math.ceil(attendance / 250),
    medicalTeams: Math.max(1, Math.ceil(attendance / 5000)),
    ambulances: Math.max(1, Math.ceil(attendance / 10000)),
    fireOfficers: Math.max(2, Math.ceil(attendance / 6000)),
    toilets: Math.ceil(attendance / 300),
    wasteBins: Math.ceil(attendance / 180),
  };
  const source = {
    sourceId: 'internal.resource-baseline.v4', title: 'STERAS internal prototype resource baseline assumptions', issuer: 'STERAS',
    kind: 'internal_prototype' as const, locator: 'preview', version: '2026-08-19-prototype-v1', retrievedAt: now,
    verificationStatus: 'prototype_unverified' as const,
  };
  const items = Object.fromEntries(RESOURCE_KEYS.map((resource) => [resource, {
    status: 'ready' as const, resource, baseline: quantities[resource],
    planningRange: { min: quantities[resource], max: Math.ceil(quantities[resource] * 1.25) },
    inputReferences: [{ inputId: 'event.expectedAttendance', kind: 'event_field' as const, path: 'eventDetails.expectedAttendance', value: attendance }],
    assumptions: [{ assumptionId: `${resource}.preview`, statement: 'Internal academic prototype; not an authority minimum.', sourceIds: [source.sourceId] }],
    appliedRules: [{ ruleId: `${resource}.preview`, description: 'Preview-only resource rule.', inputReferenceIds: ['event.expectedAttendance'], sourceIds: [source.sourceId], contribution: quantities[resource] }],
    sourceSnapshots: [source], authoritySource: { status: 'not_supplied' as const, reason: 'Preview has no verified authority ratio.' },
    confidence: 'prototype' as const, reviewingAuthority: resource === 'fireOfficers' ? 'BOMBA' as const : resource === 'medicalTeams' || resource === 'ambulances' ? 'KKM' as const : 'PDRM' as const,
    authorityReviewRequired: true,
  }])) as ResourceRecommendation['items'];
  return {
    resourceId: `provisional-${versionId}-${event.eventId}`,
    eventId: event.eventId,
    versionId,
    assessmentId: assessment.assessmentId,
    schemaVersion: RESOURCE_SCHEMA_VERSION,
    stage: 'provisional', revision: 1, supersedesResourceId: null,
    assessmentReference: { stage: 'provisional', assessmentId: assessment.assessmentId, proposalId: assessment.aiProposal?.status === 'success' ? assessment.aiProposal.proposalId : `preview-${event.eventId}` },
    resourceInputHash: 'b'.repeat(64),
    formulaVersion: '2026-08-19-deterministic-v4', configVersion: '2026-08-19-prototype-v1', sourceRegistryVersion: '2026-08-19-v1',
    items,
    confidenceLevel: 'prototype', authorityReviewRequired: true,
    validationScope: 'provisional_risk_input',
    notes: 'Indicative academic prototype guidance; not an operational deployment authorisation.',
    computedAt: now,
  };
}
