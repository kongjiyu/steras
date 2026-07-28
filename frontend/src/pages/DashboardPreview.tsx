/**
 * No-auth preview route for the Authority Dashboard.
 * Same layout and content as `/authority`, but uses a mock user
 * so designers / stakeholders can see the dashboard without Firebase auth.
 */
import AuthorityDashboard from './authority/AuthorityDashboard';
import AuthorityLayout from '../components/layout/AuthorityLayout';
import { useSearchParams } from 'react-router-dom';
import {
  EventRecord,
  EventStatus,
  ResourceQuantities,
  ResourceRecommendation,
  RiskAssessment,
  RiskLevel,
  riskLevelFor,
} from '@shared/types';
import { DashboardRecord } from './authority/dashboardData';
import RiskAssessments from './authority/RiskAssessments';
import ResourceRecommendations from './authority/ResourceRecommendations';
import { M2PortfolioRecord } from './authority/m2PortfolioData';
import { RESOURCE_FIELDS } from '../components/m2/m2Presentation';

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
  const officialScore = risk === 'High' ? 82 : risk === 'Medium' ? 58 : 27;
  const assessment = risk ? previewAssessment(event, officialScore, risk, versionId) : undefined;
  const resources = assessment ? previewResources(event, assessment, versionId) : undefined;
  return { event, assessment, assessmentStatus: risk ? 'ready' : 'processing', resources };
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

function previewAssessment(event: EventRecord, officialScore: number, risk: RiskLevel, versionId: string): RiskAssessment {
  const categories = [
    { categoryId: 'weather', categoryName: 'Weather exposure', weight: 0.3, evidenceKeys: ['weather'] as const },
    { categoryId: 'crowd', categoryName: 'Crowd and capacity pressure', weight: 0.25, evidenceKeys: ['crowd'] as const },
    { categoryId: 'venue', categoryName: 'Venue and event profile', weight: 0.2, evidenceKeys: ['venue'] as const },
    { categoryId: 'history', categoryName: 'Historical incident context', weight: 0.15, evidenceKeys: ['history'] as const },
    { categoryId: 'holiday', categoryName: 'Calendar and holiday context', weight: 0.1, evidenceKeys: ['holiday'] as const },
  ];
  return {
    assessmentId: versionId,
    eventId: event.eventId,
    versionId,
    status: 'ready',
    officialScore,
    officialRiskLevel: risk,
    categoryAssignments: categories.map((category, index) => {
      const score = Math.max(0, Math.min(100, officialScore + [5, 4, -5, -4, -9][index]));
      return {
        ...category,
        score,
        riskLevel: riskLevelFor(score),
        weightedContribution: Number((score * category.weight).toFixed(2)),
        rationale: `${category.categoryName} was calculated from the submitted event version and its captured context.`,
        evidenceKeys: [...category.evidenceKeys],
        guidelineChecks: [`prototype.${category.categoryId}.v1`],
      };
    }),
    evidence: categories.map((category) => ({
      key: category.evidenceKeys[0],
      description: `${category.categoryName} input captured for preview.`,
      sourceTimestamp: now,
      source: category.categoryId === 'weather' ? 'openweather' : 'versioned-input',
      status: 'matched',
    })),
    categorySchemaVersion: '2026-07-21-prototype-category-v1',
    scoringLogicVersion: '2026-07-21-deterministic-v1',
    categorySchemaStatus: 'prototype',
    computedAt: now,
    aiAdvisory: {
      model: 'MiniMax-M3',
      promptVersion: '2026-07-21-advisory-v1',
      responseSchemaVersion: '2026-07-21-advisory-v1',
      status: 'success',
      label: 'advisory',
      overallBand: risk,
      overallExplanation: 'The advisory highlights ingress congestion and weather monitoring without changing the official deterministic result.',
      categories: [],
      keyConcerns: ['Maintain clear emergency access during peak arrival.'],
      resourceConsiderations: ['Stage personnel before the highest arrival window.'],
      citedEvidenceKeys: ['crowd', 'weather'],
      cacheStatus: 'miss',
      generatedAt: now,
    },
    contextSnapshot: {
      weather: {
        data: { forecast: 'Scattered showers', temperature: 30, humidity: 76, windSpeed: 2.8, precipitationProbability: 55, severeAlert: false },
        source: 'openweather', freshness: 'fresh', fetchedAt: now, expiresAt: now + 3_600_000, forecastFor: event.eventDetails.startDatetime,
      },
      calendar: { localDate: '2026-08-31', dayOfWeek: 'Monday', isWeekend: false, isHolidayOrAdjacent: true, holidayName: 'National Day', holidayDistanceDays: 0, sourceVersion: 'my-holidays-v1', sourceTimestamp: now },
      venue: { matched: true, venueId: `venue-${event.eventId}`, submittedCapacity: event.eventDetails.venueCapacity, registeredCapacity: event.eventDetails.venueCapacity, capacityDifference: 0, fetchedAt: now },
      incidentHistory: { matched: true, venueId: `venue-${event.eventId}`, incidentIds: ['incident-preview'], total: 1, bySeverity: { low: 0, medium: 1, high: 0 }, fetchedAt: now },
    },
    sourceTimestamps: { event: event.updatedAt, weather: now, calendar: now, venue: now, history: now },
    contextStatuses: { weather: 'fresh', calendar: 'matched', venue: 'matched', history: 'matched' },
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
  return {
    resourceId: versionId,
    eventId: event.eventId,
    versionId,
    assessmentId: assessment.assessmentId,
    ...quantities,
    formulaVersion: '2026-07-21-prototype-v2',
    guidelineVersion: '2026-07-21-unverified-guidance-v1',
    guidelineStatus: 'prototype',
    rationales: Object.fromEntries(RESOURCE_FIELDS.map(({ key }) => [key, {
      resource: key,
      baselineQuantity: quantities[key],
      factors: [`${attendance.toLocaleString()} expected attendees`, `${assessment.officialRiskLevel} official risk`],
      guidelineReferences: [`prototype.${key}.v1`],
    }])) as ResourceRecommendation['rationales'],
    aiConsiderations: ['Plan staggered deployment around the highest arrival period.'],
    confidenceLevel: event.status === 'Approved' ? 'authorityValidated' : 'prototype',
    notes: 'Indicative academic prototype guidance; not an operational deployment authorisation.',
    computedAt: now,
  };
}
