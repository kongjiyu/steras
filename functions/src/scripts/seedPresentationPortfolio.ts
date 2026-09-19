import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  ASSESSMENT_SCHEMA_VERSION,
  COLLECTIONS,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  SCORE_REVIEW_SCHEMA_VERSION,
  type AuthorityScoreReview,
  type AuthorityType,
  type ControlListProposal,
  type EventDetails,
  type EventControl,
  type EventRecord,
  type EventStatus,
  type EventType,
  type OrganizerAssessmentSummary,
  type OrganizerResourceRecommendation,
  type PublicEvent,
  type ProvisionalRiskAssessment,
  type ResourceRecommendation,
  type ProposedControlItem,
  type RiskAssessment,
  type Stage1Doc,
  type UserProfile,
  type Venue,
} from '@shared/types';
import { M4_AI_PROMPT_VERSION, M4_SCHEMA_VERSION, type M4IncidentCategory, type M4IncidentRecord } from '@shared/m4';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { buildAuthorityReviewState, buildOfficialAssessmentResult } from '../engines/authorityFinalisation';
import { validateAndCalculateProvisional } from '../engines/assessmentValidator';
import { computeCategoryBasedAssessment } from '../engines/ruleBased';
import { computeResources } from '../engines/resourceCalculator';
import { validateResourceRecommendation } from '../engines/resourceContract';
import { isAnalyticsAssessment, isAnalyticsEvent, selectValidAnalyticsIncidents } from '../http/getAnalyticsPortfolio';
import { isReviewableProvisionalAssessment } from '../http/initialReview';
import { resourceDocumentId } from '../triggers/onEventCreated';
import { stage2DocumentId } from '@shared/stage2';
import { stage1DocumentId, stage1RevisionId } from '@shared/stage1';

const EXPECTED_PROJECT = 'linkos-496505';
const DATASET_ID = 'steras-presentation-portfolio-2026-09-v1';
const MANAGED_BY = 'seed:presentation-portfolio';
const VERSION_ID = 'v1';
const PARTICIPANT_DEMO_EMAIL = 'participant.showcase@steras.test';
const ADMIN_DEMO_EMAIL = 'admin.showcase@steras.test';
const ORGANIZER_DEMO_EMAIL = 'organizer1@steras.test';
const SHOWCASE_AUTHORITY_EMAILS: Record<AuthorityType, string> = {
  PDRM: 'pdrm.showcase@steras.test',
  BOMBA: 'bomba.showcase@steras.test',
  KKM: 'kkm.showcase@steras.test',
  DBKL: 'dbkl.showcase@steras.test',
  MOTAC: 'motac.showcase@steras.test',
};
const DAY = 86_400_000;
const HOUR = 3_600_000;

type Action = 'dry-run' | 'apply' | 'verify' | 'cleanup';
type RiskBand = 'low' | 'medium' | 'high';
type PostFinalStage = 'controls' | 'stage1_submitted' | 'stage2_submitted';

interface Scenario {
  slug: string;
  name: string;
  type: EventType;
  status: EventStatus;
  risk: RiskBand;
  createdAt: number;
  startAt: number;
  attendance: number;
  incidentSeverities: Array<'low' | 'medium' | 'high'>;
  incidentCategories?: M4IncidentCategory[];
  postFinalStage?: PostFinalStage;
}

interface SeedIdentity {
  adminUid: string;
  organizerUid: string;
  participantUid: string;
  authorityUids: Partial<Record<AuthorityType, string>>;
}

const SCENARIOS: Scenario[] = [
  scenario('heritage-night', 'Kuala Lumpur Heritage Night', 'cultural', 'Approved', 'medium', '2026-01-12', '2026-04-18', 4200, ['low']),
  scenario('wellness-run', 'Putrajaya Family Wellness Run', 'sports', 'Approved', 'low', '2026-02-04', '2026-05-24', 2800, []),
  scenario('travel-expo', 'Nusantara Travel Expo', 'exhibition', 'Approved', 'low', '2026-02-19', '2026-06-13', 3600, ['low']),
  scenario('arts-festival', 'Lake Gardens Arts Festival', 'festival', 'Approved', 'medium', '2026-03-08', '2026-07-11', 6100, ['medium']),
  scenario('flavours-carnival', 'Malaysian Flavours Carnival', 'fair', 'Approved', 'high', '2026-03-26', '2026-08-08', 9800, ['low', 'medium', 'high']),
  scenario('tourism-forum', 'Sustainable Tourism Forum', 'conference', 'Approved', 'low', '2026-04-14', '2026-08-22', 1200, ['low']),
  scenario('merdeka-music', 'Merdeka Music Evening', 'concert', 'Rejected', 'high', '2026-05-02', '2026-09-12', 12500, []),
  scenario('river-lanterns', 'River of Life Lantern Festival', 'festival', 'UnderReview', 'medium', '2026-05-21', '2026-09-19', 7200, []),
  scenario('urban-parade', 'Kuala Lumpur Urban Culture Parade', 'cultural', 'UnderReview', 'high', '2026-06-09', '2026-09-26', 15000, []),
  scenario('putrajaya-community-run', 'Putrajaya Community Wellness Run', 'cultural', 'UnderReview', 'medium', '2026-06-18', '2026-10-03', 8200, [], 'none'),
  scenario('penang-heritage-weekend', 'Penang Heritage Weekend', 'cultural', 'Approved', 'medium', '2026-06-24', '2026-10-17', 6800, [], 'controls'),
  scenario('selangor-food-festival', 'Selangor Food & Culture Festival', 'festival', 'Approved', 'high', '2026-07-02', '2026-10-24', 11800, ['low'], 'stage1_submitted'),
  scenario('johor-waterfront-fair', 'Johor Waterfront Tourism Fair', 'fair', 'Approved', 'medium', '2026-07-09', '2026-11-07', 7600, ['medium'], 'stage2_submitted'),
  scenario('craft-market', 'Malaysia Craft & Design Market', 'fair', 'Approved', 'medium', '2026-06-28', '2026-10-03', 4800, [], 'stage1_submitted'),
  scenario('community-harmony', 'Community Harmony Gathering', 'religious', 'Approved', 'medium', '2026-07-17', '2026-10-10', 5400, []),
  scenario('innovation-summit', 'Tourism Innovation Summit', 'conference', 'Rejected', 'low', '2026-08-06', '2026-10-17', 1600, []),
  reportableScenario('participant-live-cultural', 'Participant Demo · KL Cultural Day', 'cultural', 'medium', -2 * HOUR, 5200, ['high', 'medium'], ['crowd', 'missing_person']),
  reportableScenario('participant-live-sports', 'Participant Demo · Putrajaya Sports Fiesta', 'sports', 'medium', -5 * HOUR, 3400, ['low', 'medium'], ['lost_found', 'medical_safety']),
  reportableScenario('participant-recent-expo', 'Participant Demo · Tourism Product Expo', 'exhibition', 'low', -1 * DAY, 2600, ['medium', 'low'], ['security', 'property_damage']),
  reportableScenario('participant-recent-concert', 'Participant Demo · Malaysia Music Showcase', 'concert', 'high', -4 * DAY, 7600, ['high', 'medium'], ['suspicious_activity', 'access_traffic']),
  reportableScenario('participant-recent-festival', 'Participant Demo · Community Festival', 'festival', 'medium', -7 * DAY, 4800, ['medium', 'low'], ['event_control_discrepancy', 'other']),
];

const PRESENTATION_IMAGES = [
  'stage2-dbkl-venue-setup.jpg',
  'stage2-pdrm-crowd-entry.jpg',
  'stage2-bomba-fire-egress.jpg',
  'stage2-kkm-medical-point.jpg',
  'm4-crowd-arrival-surge.jpg',
];

// Keep the evidence mapping stable across reruns so a reviewer sees the same
// authority-appropriate photograph for a given control. These are the
// photorealistic JPEGs committed under docs/presentation/assets/e2e-2026-09-30.
const PRESENTATION_IMAGE_BY_AUTHORITY: Record<AuthorityType, string> = {
  PDRM: 'stage2-pdrm-crowd-entry.jpg',
  BOMBA: 'stage2-bomba-fire-egress.jpg',
  KKM: 'stage2-kkm-medical-point.jpg',
  DBKL: 'stage2-dbkl-venue-setup.jpg',
  MOTAC: 'm4-crowd-arrival-surge.jpg',
};

function scenario(slug: string, name: string, type: EventType, status: EventStatus, risk: RiskBand, createdDate: string, eventDate: string, attendance: number, incidentSeverities: Scenario['incidentSeverities'], postFinalStage?: PostFinalStage | 'none'): Scenario {
  return {
    slug,
    name,
    type,
    status,
    risk,
    createdAt: Date.parse(`${createdDate}T02:00:00.000Z`),
    startAt: Date.parse(`${eventDate}T02:00:00.000Z`),
    attendance,
    incidentSeverities,
    ...(postFinalStage && postFinalStage !== 'none' ? { postFinalStage } : {}),
  };
}

function reportableScenario(slug: string, name: string, type: EventType, risk: RiskBand, startOffset: number, attendance: number, incidentSeverities: Scenario['incidentSeverities'], incidentCategories: M4IncidentCategory[]): Scenario {
  return {
    slug, name, type, status: 'Approved', risk,
    createdAt: Date.now() - 30 * DAY,
    startAt: Date.now() + startOffset,
    attendance, incidentSeverities, incidentCategories,
  };
}

function marker(fixtureId: string) {
  return { datasetId: DATASET_ID, managedBy: MANAGED_BY, fixtureId };
}

function eventIdFor(scenarioValue: Pick<Scenario, 'slug'>) {
  return `presentation-${scenarioValue.slug}`;
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function parsePresentationArgs(argv: string[]) {
  const actionFlags = argv.filter((value) => ['--dry-run', '--apply', '--verify', '--cleanup'].includes(value));
  if (actionFlags.length !== 1) throw new Error('Choose exactly one action: --dry-run, --apply, --verify, or --cleanup.');
  const valueAfter = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const projectId = valueAfter('--project') ?? '';
  const confirm = valueAfter('--confirm') ?? '';
  const only = valueAfter('--only');
  if (projectId !== EXPECTED_PROJECT) throw new Error(`--project must be ${EXPECTED_PROJECT}.`);
  const action = actionFlags[0].slice(2) as Action;
  if (argv.includes('--only') && !only) throw new Error('--only requires a managed presentation event ID.');
  if ((action === 'apply' || action === 'cleanup') && confirm !== EXPECTED_PROJECT) {
    throw new Error(`--confirm must be ${EXPECTED_PROJECT} for writes.`);
  }
  if (only && !SCENARIOS.some((scenarioValue) => eventIdFor(scenarioValue) === only)) {
    throw new Error(`--only must identify a managed presentation event (received ${only}).`);
  }
  return { action, projectId, only };
}

async function loadIdentities(db: Firestore): Promise<SeedIdentity> {
  const [admins, organizers, participants, authorities] = await Promise.all([
    db.collection(COLLECTIONS.USERS).where('email', '==', ADMIN_DEMO_EMAIL).limit(2).get(),
    db.collection(COLLECTIONS.USERS).where('email', '==', ORGANIZER_DEMO_EMAIL).limit(1).get(),
    db.collection(COLLECTIONS.USERS).where('email', '==', PARTICIPANT_DEMO_EMAIL).limit(2).get(),
    Promise.all(Object.entries(SHOWCASE_AUTHORITY_EMAILS).map(async ([authorityType, email]) => ({
      authorityType: authorityType as AuthorityType,
      email,
      snapshot: await db.collection(COLLECTIONS.USERS).where('email', '==', email).limit(2).get(),
    }))),
  ]);
  const admin = admins.docs[0]?.data() as UserProfile | undefined;
  const organizer = organizers.docs.map((document) => document.data() as UserProfile)
    .find((profile) => profile.email === ORGANIZER_DEMO_EMAIL);
  const participant = participants.docs.map((document) => document.data() as UserProfile)
    .find((profile) => profile.email === PARTICIPANT_DEMO_EMAIL);
  if (!admin?.uid || admin.role !== 'admin' || admin.email !== ADMIN_DEMO_EMAIL || !organizer?.uid || organizer.role !== 'organizer' || !participant?.uid || participant.role !== 'public' || participant.email !== PARTICIPANT_DEMO_EMAIL) {
    throw new Error(`${ADMIN_DEMO_EMAIL}, ${ORGANIZER_DEMO_EMAIL} and ${PARTICIPANT_DEMO_EMAIL} must already exist with the expected roles.`);
  }
  const authorityUids: Partial<Record<AuthorityType, string>> = {};
  const missingAuthorities: string[] = [];
  authorities.forEach(({ authorityType, email, snapshot }) => {
    const matching = snapshot.docs.map((document) => ({ ...(document.data() as UserProfile), uid: (document.data() as UserProfile).uid || document.id }))
      .find((profile) => profile.role === 'authority' && profile.authorityType === authorityType && profile.email === email);
    if (!matching?.uid) missingAuthorities.push(`${authorityType} (${email})`);
    else authorityUids[authorityType] = matching.uid;
  });
  if (missingAuthorities.length > 0) {
    throw new Error(`Required showcase authority accounts are missing or have the wrong role/department: ${missingAuthorities.join(', ')}`);
  }
  return { adminUid: admin.uid, organizerUid: organizer.uid, participantUid: participant.uid, authorityUids };
}

function authoritiesFor(type: EventType): AuthorityType[] {
  const values: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM', 'DBKL'];
  if (['festival', 'cultural', 'religious', 'exhibition'].includes(type)) values.push('MOTAC');
  return values;
}

const PRESENTATION_AUTHORITIES: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'];
const PRESENTATION_EVENT_SLUGS = new Set([
  'putrajaya-community-run',
  'penang-heritage-weekend',
  'selangor-food-festival',
  'johor-waterfront-fair',
  'craft-market',
]);

function requiredAuthoritiesForScenario(scenarioValue: Scenario): AuthorityType[] {
  return PRESENTATION_EVENT_SLUGS.has(scenarioValue.slug)
    ? [...PRESENTATION_AUTHORITIES]
    : authoritiesFor(scenarioValue.type);
}

function buildEventDetails(scenarioValue: Scenario, venue: Venue, organizer: UserProfile): EventDetails {
  const high = scenarioValue.risk === 'high';
  return {
    name: scenarioValue.name,
    type: scenarioValue.type,
    venueId: venue.venueId,
    venueName: venue.name,
    venueAddress: venue.address,
    venueLocation: venue.location,
    venueState: venue.state,
    venueCapacity: venue.capacity,
    expectedAttendance: Math.min(scenarioValue.attendance, venue.capacity),
    environment: scenarioValue.type === 'conference' || scenarioValue.type === 'exhibition' ? 'indoor' : 'outdoor',
    coverage: scenarioValue.type === 'conference' || scenarioValue.type === 'exhibition' ? 'covered' : 'partially_covered',
    seating: scenarioValue.type === 'conference' ? 'seated' : 'mixed',
    startDatetime: scenarioValue.startAt,
    endDatetime: scenarioValue.startAt + 8 * HOUR,
    description: `${scenarioValue.name} brings visitors, local operators and public agencies together in a coordinated Malaysian tourism programme.`,
    emergencyPlanSummary: 'Site command, evacuation, medical response, severe-weather monitoring and authority escalation procedures are documented for the event period.',
    riskProfile: {
      vulnerableAttendeesPercent: scenarioValue.type === 'religious' ? 18 : 8,
      standingAttendeesPercent: scenarioValue.type === 'concert' || scenarioValue.type === 'festival' ? 75 : 25,
      internationalAttendees: ['conference', 'exhibition', 'festival'].includes(scenarioValue.type),
      alcoholServed: scenarioValue.type === 'concert',
      foodServed: ['festival', 'fair', 'cultural'].includes(scenarioValue.type),
      freeDrinkingWater: true,
      ticketedEntry: !['fair', 'religious'].includes(scenarioValue.type),
      overnightAccommodation: false,
      pyrotechnics: high && scenarioValue.type === 'concert',
      temporaryStructures: !['conference', 'exhibition'].includes(scenarioValue.type),
      rivalryOrTensionExpected: false,
      crowdManagementPlan: true,
      trafficManagementPlan: scenarioValue.status !== 'Rejected',
      severeWeatherPlan: true,
      medicalPlan: true,
      evacuationPlanTested: scenarioValue.risk !== 'high',
      authorityCoordinationConfirmed: scenarioValue.status === 'Approved',
      nearestHospitalTravelMinutes: venue.nearestHospitalTravelMinutes ?? 12,
    },
    organizerName: organizer.name,
    organizerEmail: organizer.email,
    organizerPhone: organizer.phone ?? '+60 3-8890 0000',
  };
}

function contextFor(event: EventRecord, venue: Venue, now: number, index: number) {
  return {
    weather: {
      data: { forecast: index % 3 === 0 ? 'Light showers' : 'Partly cloudy', temperature: 30 + index % 3, humidity: 70 + index % 9, windSpeed: 8 + index, precipitationProbability: index % 3 === 0 ? 55 : 20, severeAlert: false },
      measurementStatus: 'available' as const,
      source: 'openweather' as const,
      freshness: 'fresh' as const,
      fetchedAt: now,
      expiresAt: now + 6 * HOUR,
      forecastFor: event.eventDetails.startDatetime,
    },
    calendar: {
      localDate: new Date(event.eventDetails.startDatetime).toISOString().slice(0, 10),
      dayOfWeek: new Date(event.eventDetails.startDatetime).toLocaleDateString('en-MY', { weekday: 'long', timeZone: 'Asia/Kuala_Lumpur' }),
      isWeekend: [0, 6].includes(new Date(event.eventDetails.startDatetime).getUTCDay()),
      isHolidayOrAdjacent: index === 6,
      sourceVersion: 'presentation-calendar-2026-v1',
      sourceTimestamp: now,
      coverageStatus: 'verified' as const,
    },
    venue: {
      matched: true,
      venueId: venue.venueId,
      submittedCapacity: venue.capacity,
      registeredCapacity: venue.capacity,
      verifiedSafeCapacity: venue.verifiedSafeCapacity ?? venue.capacity,
      capacityDifference: 0,
      jurisdiction: venue.jurisdiction ?? 'DBKL',
      fireCertificateStatus: venue.fireCertificateStatus ?? 'valid' as const,
      fireCertificateExpiresAt: venue.fireCertificateExpiresAt ?? now + 365 * DAY,
      emergencyAccessVerified: venue.emergencyAccessVerified ?? true,
      nearestHospitalTravelMinutes: venue.nearestHospitalTravelMinutes ?? 12,
      fetchedAt: now,
    },
    incidentHistory: {
      matched: false,
      venueId: venue.venueId,
      incidentIds: [],
      total: 0,
      bySeverity: { low: 0, medium: 0, high: 0 },
      syntheticStatus: 'none' as const,
      fetchedAt: now,
    },
  };
}

function buildArtifacts(scenarioValue: Scenario, event: EventRecord, identities: SeedIdentity, venue: Venue, now: number, evidenceGeneration: string) {
  const eventId = event.eventId;
  const assessmentId = `assessment-${eventId}-${VERSION_ID}`;
  const context = contextFor(event, venue, now, SCENARIOS.indexOf(scenarioValue));
  const baseline = computeCategoryBasedAssessment(event, context, now);
  const rating = scenarioValue.risk === 'high' ? 4 : scenarioValue.risk === 'medium' ? 3 : 1;
  const evidenceByCategory: Record<string, string> = {
    crowd: 'crowd', venue_fire: 'venue', weather_environment: 'weather', public_health: 'crowd',
    food_water_sanitation: 'venue', medical_capacity: 'venue', security_cbrn: 'crowd', transport_accessibility: 'venue',
  };
  const proposal = {
    status: 'success' as const,
    proposalId: `proposal-${eventId}-${VERSION_ID}`,
    model: 'presentation-fixture',
    promptVersion: 'presentation-portfolio-v1',
    responseSchemaVersion: 'presentation-portfolio-v1',
    hazards: [],
    categories: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
      categoryId: category.id,
      likelihood: rating as 1 | 3 | 4,
      severity: rating as 1 | 3 | 4,
      evidenceReferences: [evidenceByCategory[category.id] as never],
      rationale: `${category.name} rating reflects the event attendance, venue and operating controls.`,
      confidence: 'high' as const,
      concerns: [],
      missingInformation: [],
    })),
    cacheStatus: 'not-applicable' as const,
    generatedAt: now,
  };
  const provisional = validateAndCalculateProvisional(proposal, baseline, now);
  if (!provisional.ok) throw new Error(`${eventId}: ${provisional.reason}`);
  const requiredAuthorities = event.requiredAuthorities;
  const inputHash = hash({ datasetId: DATASET_ID, eventId, versionId: VERSION_ID, details: event.eventDetails });
  const common = {
    assessmentId,
    eventId,
    versionId: VERSION_ID,
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    contextSnapshot: context,
    evidence: baseline.evidence,
    contextEvidence: [{ evidenceId: `presentation-${eventId}-evidence`, evidenceKey: 'compliance' as const, sourceKind: 'submitted_document' as const, sourceLocator: `event_documents/${eventId}/${VERSION_ID}/application-evidence.pdf`, retrievedAt: now, sourceVersion: `storage-generation:${evidenceGeneration}`, eligibility: 'eligible' as const, synthetic: true, visibility: 'authority_only' as const }],
    sourceTimestamps: { weather: now, holiday: now, venue: now, incidents: now },
    contextStatuses: { weather: 'presentation:available', holiday: 'presentation:verified', venue: 'matched', incidents: 'unmatched' },
    assessmentReadiness: 'complete' as const,
    complianceStatus: scenarioValue.status === 'Rejected' ? 'review_required' as const : 'pass' as const,
    complianceChecks: baseline.complianceChecks ?? [],
    dataConfidenceScore: 92,
    dataConfidenceLevel: 'high' as const,
    inputHash,
    createdAt: now,
  };
  const pendingInitialReview = scenarioValue.status === 'Pending';
  const reviews = pendingInitialReview ? [] : requiredAuthorities.map((authority) => {
    const reviewerId = identities.authorityUids[authority]!;
    return {
      reviewId: `${assessmentId}-${authority.toLowerCase()}-review`,
      schemaVersion: SCORE_REVIEW_SCHEMA_VERSION,
      eventId,
      versionId: VERSION_ID,
      assessmentId,
      proposalId: provisional.result.proposalId,
      provisionalCalculatedAt: provisional.result.calculatedAt,
      assessmentInputHash: inputHash,
      categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
      authorityType: authority,
      reviewerId,
      categories: proposal.categories.map((category) => ({ categoryId: category.categoryId, likelihood: category.likelihood, severity: category.severity, decision: 'confirmed' as const })),
      rationale: `${authority} reviewed the submitted event evidence and confirmed the category ratings.`,
      idempotencyKey: `${eventId}-${authority.toLowerCase()}-review-v1`,
      createdAt: now,
    } satisfies AuthorityScoreReview;
  });
  const provisionalAssessment = {
    ...common,
    status: pendingInitialReview ? 'provisional_ready' as const : 'authority_review' as const,
    aiProposal: proposal,
    warnings: provisional.warnings,
    authorityReviewRequired: true as const,
    provisionalResult: provisional.result,
  } as ProvisionalRiskAssessment;
  if (pendingInitialReview) {
    const calculation = computeResources({ eventId, versionId: VERSION_ID, assessmentId, eventDetails: event.eventDetails, assessmentResult: provisional.result });
    if (!calculation.ok) throw new Error(`${eventId}: ${calculation.message}`);
    const resource: ResourceRecommendation = {
      resourceId: resourceDocumentId('provisional', VERSION_ID, calculation.resourceInputHash),
      eventId,
      versionId: VERSION_ID,
      assessmentId,
      schemaVersion: RESOURCE_SCHEMA_VERSION,
      stage: 'provisional',
      revision: 1,
      supersedesResourceId: null,
      assessmentReference: { stage: 'provisional', assessmentId, proposalId: proposal.proposalId },
      resourceInputHash: calculation.resourceInputHash,
      formulaVersion: calculation.formulaVersion,
      configVersion: calculation.configVersion,
      sourceRegistryVersion: calculation.sourceRegistryVersion,
      items: calculation.items,
      confidenceLevel: 'prototype',
      authorityReviewRequired: true,
      validationScope: 'provisional_risk_input',
      notes: 'Indicative planning ratios; operational suitability requires authority review.',
      computedAt: now,
    };
    return {
      assessment: { ...provisionalAssessment, presentationData: marker(eventId) },
      resource: { ...resource, presentationData: marker(eventId) },
      reviews,
      inputHash,
    };
  }
  const officialResult = buildOfficialAssessmentResult({
    assessment: provisionalAssessment,
    eventDetails: event.eventDetails,
    requiredAuthorities,
    reviews,
    finalizedAt: now,
    finalizedBy: identities.adminUid,
  });
  const assessment = {
    ...provisionalAssessment,
    status: 'official_ready' as const,
    authorityReviewRequired: false as const,
    authorityReviewState: buildAuthorityReviewState(requiredAuthorities, reviews, now),
    officialResult,
    presentationData: marker(eventId),
  } as RiskAssessment;
  const calculation = computeResources({ eventId, versionId: VERSION_ID, assessmentId, eventDetails: event.eventDetails, assessmentResult: officialResult });
  if (!calculation.ok) throw new Error(`${eventId}: ${calculation.message}`);
  const resource: ResourceRecommendation = {
    resourceId: resourceDocumentId('official', VERSION_ID, calculation.resourceInputHash),
    eventId,
    versionId: VERSION_ID,
    assessmentId,
    schemaVersion: RESOURCE_SCHEMA_VERSION,
    stage: 'official',
    revision: 1,
    supersedesResourceId: null,
    assessmentReference: { stage: 'official', assessmentId, proposalId: proposal.proposalId, finalizedAt: now, finalizedBy: identities.adminUid },
    resourceInputHash: calculation.resourceInputHash,
    formulaVersion: calculation.formulaVersion,
    configVersion: calculation.configVersion,
    sourceRegistryVersion: calculation.sourceRegistryVersion,
    items: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, { ...calculation.items[key], confidence: 'authority_validated' as const, authorityReviewRequired: false }])) as ResourceRecommendation['items'],
    confidenceLevel: 'authority_validated',
    authorityReviewRequired: false,
    validationScope: 'official_risk_input_only',
    notes: 'Indicative planning ratios; operational suitability requires authority review.',
    computedAt: now,
  };
  return { assessment, resource: { ...resource, presentationData: marker(eventId) }, reviews, inputHash };
}

/** Build the same organizer-safe projection produced by the live finalisation
 * functions. Presentation fixtures must exercise the real organizer read
 * path, not only the private assessment/resource documents. */
function buildOrganizerAssessmentSummary(
  assessment: RiskAssessment,
  resource: ResourceRecommendation,
  requiredAuthorities: AuthorityType[],
  computedAt: number,
): OrganizerAssessmentSummary {
  const result = 'officialResult' in assessment && assessment.officialResult
    ? assessment.officialResult
    : 'provisionalResult' in assessment ? assessment.provisionalResult : undefined;
  if (!result) throw new Error(`${assessment.eventId}: assessment result unavailable for organizer summary.`);
  const reviewState = 'authorityReviewState' in assessment ? assessment.authorityReviewState : undefined;
  const completedAuthorities = Object.keys(reviewState?.activeReviewHeads ?? {}).filter(
    (authority) => Boolean(reviewState?.activeReviewHeads?.[authority as AuthorityType]?.reviewId),
  ).length;
  const projection: OrganizerResourceRecommendation = {
    resourceId: resource.resourceId,
    revision: resource.revision,
    stage: resource.stage,
    items: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, {
      baseline: resource.items[key].baseline,
      planningRange: { ...resource.items[key].planningRange },
    }])) as OrganizerResourceRecommendation['items'],
    disclaimer: resource.stage === 'official'
      ? 'Planning ranges derived from an official risk assessment; resource ratios remain indicative and are not statutory minimums.'
      : 'Planning ranges are provisional and remain subject to authority review.',
  };
  return {
    assessmentId: assessment.assessmentId,
    eventId: assessment.eventId,
    versionId: assessment.versionId,
    schemaVersion: assessment.schemaVersion,
    status: assessment.status,
    overallScore: result.overallScore,
    overallRiskLevel: result.overallRiskLevel,
    categories: result.categories.map((category) => ({
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      normalizedScore: category.normalizedScore,
      riskLevel: category.riskLevel,
    })),
    assessmentReadiness: assessment.assessmentReadiness,
    complianceStatus: assessment.complianceStatus,
    authorityReviewRequired: assessment.authorityReviewRequired,
    authorityReviewProgress: {
      completed: Math.min(completedAuthorities, requiredAuthorities.length),
      required: requiredAuthorities.length,
    },
    resourceQuantities: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, resource.items[key].baseline])) as unknown as OrganizerAssessmentSummary['resourceQuantities'],
    resourceRecommendation: projection,
    computedAt,
  };
}

async function uploadFile(path: string, bytes: Buffer, contentType: string, fixtureId: string) {
  const bucket = getStorage().bucket();
  const token = hash(`${DATASET_ID}:${path}`).slice(0, 32);
  const file = bucket.file(path);
  await file.save(bytes, {
    resumable: false,
    metadata: { contentType, metadata: { datasetId: DATASET_ID, managedBy: MANAGED_BY, fixtureId, firebaseStorageDownloadTokens: token } },
  });
  const [metadata] = await file.getMetadata();
  return {
    generation: String(metadata.generation ?? ''),
    url: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
  };
}

async function writeScenario(db: Firestore, scenarioValue: Scenario, venue: Venue, organizer: UserProfile, identities: SeedIdentity, index: number) {
  const eventId = eventIdFor(scenarioValue);
  const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  const existing = await eventRef.get();
  if (existing.exists && existing.data()?.presentationData?.datasetId !== DATASET_ID) throw new Error(`Refusing to overwrite unowned events/${eventId}.`);
  if (existing.exists) await db.recursiveDelete(eventRef);
  const details = buildEventDetails(scenarioValue, venue, organizer);
  const submittedAt = scenarioValue.createdAt + 2 * DAY;
  const initialReviewAt = submittedAt + (1 + index % 3) * DAY;
  const authorityReviewAt = initialReviewAt + (2 + index % 4) * DAY;
  const terminalAt = authorityReviewAt + (1 + index % 2) * DAY;
  const requiredAuthorities = requiredAuthoritiesForScenario(scenarioValue);
  const terminal = scenarioValue.status === 'Approved' || scenarioValue.status === 'Rejected';
  const initialReviewed = scenarioValue.status !== 'Pending';
  const secondReviewReady = ['urban-parade', 'putrajaya-community-run'].includes(scenarioValue.slug);
  const authorityCompleted = terminal || secondReviewReady;
  const eventBase = {
    eventId,
    organizerId: organizer.uid,
    eventDetails: details,
    status: scenarioValue.status,
    currentVersionId: VERSION_ID,
    currentVersionNumber: 1,
    editableVersionId: null,
    draftDocumentPaths: [],
    requiredAuthorities,
    assignedOfficerUids: initialReviewed ? requiredAuthorities.map((authority) => identities.authorityUids[authority]!) : [],
    assignedOfficerByAuthority: initialReviewed ? Object.fromEntries(requiredAuthorities.map((authority) => [authority, identities.authorityUids[authority]!])) : {},
    reviewStage: terminal ? null : secondReviewReady ? 'second' : scenarioValue.status === 'UnderReview' ? 'authority' : 'initial',
    controlListGenerated: scenarioValue.status === 'Approved',
    createdAt: scenarioValue.createdAt,
    submittedAt,
    updatedAt: terminal ? terminalAt : secondReviewReady ? authorityReviewAt : initialReviewed ? initialReviewAt : submittedAt,
    ...(initialReviewed ? { initialReview: { decision: 'Approved', reason: 'Application completeness and evidence package reviewed.', reviewerUid: identities.adminUid, reviewedAt: initialReviewAt } } : {}),
    ...(authorityCompleted ? { authorityReviewCompletedAt: authorityReviewAt, authorityReviewCompletedVersionId: VERSION_ID } : {}),
    ...(terminal ? { secondReview: { confirmedDecision: scenarioValue.status, reviewerUid: identities.adminUid, decidedAt: terminalAt, adminNote: scenarioValue.status === 'Approved' ? 'All required reviews completed.' : 'Application requires material revision before resubmission.' } } : {}),
    synthetic: true,
    presentationData: marker(eventId),
  } as unknown as EventRecord & Record<string, unknown>;
  const evidenceBytes = await readFile(resolve(
    process.cwd(),
    '..',
    'output',
    'm1-presentation-test-case',
    '03_Core_Supporting_Evidence_Pack.pdf',
  ));
  const evidence = await uploadFile(`event_documents/${eventId}/${VERSION_ID}/application-evidence.pdf`, evidenceBytes, 'application/pdf', eventId);
  if (!/^\d+$/.test(evidence.generation)) throw new Error(`${eventId}: Storage generation unavailable.`);
  const artifacts = buildArtifacts(scenarioValue, eventBase as EventRecord, identities, venue, terminalAt, evidence.generation);
  const event = { ...eventBase, currentAssessmentId: artifacts.assessment.assessmentId, currentResourceId: artifacts.resource.resourceId };
  const batch = db.batch();
  batch.set(eventRef, event);
  batch.set(eventRef.collection(COLLECTIONS.VERSIONS).doc(VERSION_ID), { versionId: VERSION_ID, eventId, versionNumber: 1, eventDetails: details, documentPaths: [`event_documents/${eventId}/${VERSION_ID}/application-evidence.pdf`], submittedBy: organizer.uid, submittedAt, inputHash: artifacts.inputHash, presentationData: marker(eventId) });
  batch.set(eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(artifacts.assessment.assessmentId), artifacts.assessment);
  batch.set(eventRef.collection(COLLECTIONS.RESOURCES).doc(artifacts.resource.resourceId), artifacts.resource);
  batch.set(eventRef.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(VERSION_ID), buildOrganizerAssessmentSummary(artifacts.assessment, artifacts.resource, requiredAuthorities, terminalAt));
  for (const review of artifacts.reviews) batch.set(eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(artifacts.assessment.assessmentId).collection(COLLECTIONS.SCORE_REVIEWS).doc(review.reviewId), { ...review, presentationData: marker(eventId) });
  for (const authority of initialReviewed ? requiredAuthorities : []) {
    const rejected = scenarioValue.status === 'Rejected' && authority === requiredAuthorities[0];
    const assignmentId = `${VERSION_ID}_${authority}`;
    batch.set(eventRef.collection(COLLECTIONS.ASSIGNMENTS).doc(assignmentId), {
      assignmentId, eventId, versionId: VERSION_ID, authorityType: authority,
      officerUid: identities.authorityUids[authority]!,
      assignedBy: identities.adminUid, assignedAt: initialReviewAt,
      status: authorityCompleted ? 'completed' : scenarioValue.status === 'UnderReview' ? 'in_progress' : 'pending',
      ...(authorityCompleted ? { decision: rejected ? 'Rejected' : 'Approved', reason: rejected ? 'Risk controls require revision.' : 'Required materials and controls reviewed.', suggestion: rejected ? 'Revise crowd, traffic and evacuation controls.' : 'Proceed with the approved controls.', ...(rejected ? { rejectionReasonCategory: 'risk_controls_inadequate' } : {}), decidedAt: authorityReviewAt } : {}),
      presentationData: marker(eventId),
    });
    if (authorityCompleted) batch.set(eventRef.collection(COLLECTIONS.DECISION_HISTORY).doc(`${assignmentId}-decision`), { decisionId: `${assignmentId}-decision`, eventId, versionId: VERSION_ID, authorityType: authority, decision: rejected ? 'Rejected' : 'Approved', rationale: rejected ? 'Risk controls require revision.' : 'Required materials and controls reviewed.', suggestion: rejected ? 'Revise crowd, traffic and evacuation controls.' : 'Proceed with the approved controls.', reviewStage: 'authority', ...(rejected ? { rejectionReasonCategory: 'risk_controls_inadequate' } : {}), materialsReviewed: true, reviewerId: identities.authorityUids[authority]!, decidedAt: authorityReviewAt, current: true, presentationData: marker(eventId) });
  }
  if (initialReviewed) batch.set(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc('presentation-initial-review'), { id: 'presentation-initial-review', eventId, versionId: VERSION_ID, action: 'decision_made', actorId: identities.adminUid, actorRole: 'admin', timestamp: initialReviewAt, metadata: { reviewStage: 'initial', decision: 'Approved' }, presentationData: marker(eventId) });
  if (terminal) batch.set(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc('presentation-second-review'), { id: 'presentation-second-review', eventId, versionId: VERSION_ID, action: 'decision_made', actorId: identities.adminUid, actorRole: 'admin', timestamp: terminalAt, metadata: { reviewStage: 'second', finalDecision: scenarioValue.status, ...(scenarioValue.status === 'Rejected' ? { rejectionReasonCategory: 'risk_controls_inadequate' } : {}) }, presentationData: marker(eventId) });
  await batch.commit();
  if (scenarioValue.status === 'Approved') {
    await writeControl(db, scenarioValue, event as EventRecord, identities, organizer, index, terminalAt);
    const details = (event as EventRecord).eventDetails;
    const publicEvent: PublicEvent = {
      eventId,
      versionId: VERSION_ID,
      eventName: details.name,
      venueName: details.venueName,
      ...(details.venueAddress ? { venueAddress: details.venueAddress } : {}),
      ...(details.venueState ? { venueState: details.venueState } : {}),
      ...(details.venueLocation ? { venueLocation: details.venueLocation } : {}),
      eventType: details.type,
      ...(details.description ? { description: details.description } : {}),
      ...(details.expectedAttendance ? { expectedAttendance: details.expectedAttendance } : {}),
      ...(details.environment ? { environment: details.environment } : {}),
      startDatetime: details.startDatetime,
      endDatetime: details.endDatetime,
      approvedBy: (event as EventRecord).requiredAuthorities,
      publicStatus: 'approved',
      lastUpdatedAt: terminalAt,
    };
    await db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId).set({ ...publicEvent, presentationData: marker(eventId) });
  }
  await writeIncidents(db, scenarioValue, event, identities, organizer, index);
}

async function writeControl(db: Firestore, scenarioValue: Scenario, event: EventRecord, identities: SeedIdentity, organizer: UserProfile, index: number, now: number) {
  const eventId = event.eventId;
  const isManagedPostFinal = Boolean(scenarioValue.postFinalStage);
  const stage1Submitted = scenarioValue.postFinalStage === 'stage1_submitted';
  const stage2Submitted = scenarioValue.postFinalStage === 'stage2_submitted';
  const stage1Requirements = [
    { docType: 'application' as const, label: 'Authority acknowledgement', required: true },
    { docType: 'insurance' as const, label: 'Public liability insurance', required: true },
  ];
  const batch = db.batch();
  const stage1Bytes = await readFile(resolve(
    process.cwd(),
    '..',
    'output',
    'm1-presentation-test-case',
    '03_Core_Supporting_Evidence_Pack.pdf',
  ));
  const stage1Hash = createHash('sha256').update(stage1Bytes).digest('hex');
  const items: ProposedControlItem[] = event.requiredAuthorities.map((authority) => ({
    controlName: `${authority} event safety and venue readiness`,
    authority,
    stageRequirement: 'stage1_and_stage2',
    stage1Requirements,
    stage2Requirement: { kind: 'image', label: `Photo of the ${authority} safety-control area at the venue` },
  }));
  const snapshot = items.map((item) => ({
    controlId: `${eventId}-ctrl-${item.authority.toLowerCase()}-v1`,
    controlName: item.controlName,
    authority: item.authority,
    stageRequirement: item.stageRequirement,
    stage1RequirementsCount: item.stage1Requirements.length,
    stage2Label: item.stage2Requirement?.label,
    controlItemVersion: 1,
    label: (stage1Submitted || stage2Submitted ? 'pending' : 'approved') as EventControl['label'],
  }));
  for (const [authorityIndex, item] of items.entries()) {
    const controlId = snapshot[authorityIndex].controlId;
    const controlRef = db.collection(COLLECTIONS.EVENTS).doc(eventId).collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
    const stage1ReviewerUid = identities.authorityUids[item.authority];
    if (!stage1ReviewerUid) throw new Error(`${eventId}: missing named Stage 1 reviewer for ${item.authority}.`);
    batch.set(controlRef, { controlId, eventId, versionId: VERSION_ID, controlName: item.controlName, authority: item.authority, stageRequirement: item.stageRequirement, stage1Requirements: item.stage1Requirements, stage2Requirement: item.stage2Requirement, controlItemVersion: 1, label: snapshot[authorityIndex].label, createdAt: now, updatedAt: now, stage1ReviewerUid, stage1ReviewerAssignedAt: now, presentationData: marker(eventId) });
    const seedStage1 = !isManagedPostFinal || stage1Submitted || stage2Submitted;
    const seedStage2 = !isManagedPostFinal || stage2Submitted;
    const imageName = PRESENTATION_IMAGE_BY_AUTHORITY[item.authority]
      ?? PRESENTATION_IMAGES[(index + authorityIndex) % (PRESENTATION_IMAGES.length - 1)];
    const bytes = seedStage2 ? await readFile(resolve(process.cwd(), '..', 'docs', 'presentation', 'assets', 'e2e-2026-09-30', imageName)) : null;
    const uploaded = bytes ? await uploadFile(`events/${eventId}/controls/${controlId}/stage2/${imageName}`, bytes, 'image/jpeg', eventId) : null;
    if (uploaded && (!uploaded.url.startsWith('https://firebasestorage.googleapis.com/') || uploaded.url.includes('placehold'))) {
      throw new Error(`${eventId}: refusing to seed a placeholder or non-Firebase Stage 2 image URL.`);
    }
    if (seedStage1) for (const requirement of stage1Requirements) {
      const docId = stage1DocumentId(controlId, requirement.docType);
      const revision = 1;
      const revisionId = stage1RevisionId(docId, revision);
      const verified = !stage1Submitted;
      const stage1Path = `events/${eventId}/controls/${controlId}/stage1/${docId}.pdf`;
      const uploadedStage1 = await uploadFile(stage1Path, stage1Bytes, 'application/pdf', eventId);
      const stage1Status: Stage1Doc['status'] = verified ? 'verified' : 'pending_verification';
      const stage1Doc = {
        docId,
        docType: requirement.docType,
        label: requirement.label,
        status: stage1Status,
        revision,
        revisionId,
        uploadedAt: now - DAY,
        uploadedBy: organizer.uid,
        filePath: uploadedStage1.url,
        ...(verified ? { verifiedBy: stage1ReviewerUid, verifiedAt: now } : {}),
        presentationData: marker(eventId),
      };
      const docRef = controlRef.collection(COLLECTIONS.STAGE1_DOCS).doc(docId);
      batch.set(docRef, stage1Doc);
      batch.set(docRef.collection(COLLECTIONS.STAGE1_REVISIONS).doc(revisionId), {
        revisionId,
        eventId,
        versionId: VERSION_ID,
        controlId,
        docId,
        revision,
        docType: requirement.docType,
        label: requirement.label,
        filePath: uploadedStage1.url,
        fileName: `${docId}.pdf`,
        mimeType: 'application/pdf',
        fileSizeBytes: stage1Bytes.length,
        sha256: stage1Hash,
        submittedBy: organizer.uid,
        submittedAt: now - DAY,
        status: stage1Doc.status,
        ...(verified ? { verifiedBy: stage1ReviewerUid, verifiedAt: now } : {}),
        presentationData: marker(eventId),
      });
    }
    if (seedStage2) {
      const docId = stage2DocumentId(controlId);
      if (!uploaded) throw new Error(`${eventId}: Stage 2 upload artifact was not created.`);
      batch.set(controlRef.collection(COLLECTIONS.STAGE2_DOCS).doc(docId), { docId, imageUrl: uploaded.url, uploadedAt: now, uploadedBy: organizer.uid, publicConfirmCount: 0, published: !isManagedPostFinal && scenarioValue.status === 'Approved', ...(!isManagedPostFinal && scenarioValue.status === 'Approved' ? { publishedAt: now, publishedBy: identities.adminUid } : {}), presentationData: marker(eventId) });
    }
  }
  const proposal: ControlListProposal = {
    proposalId: `${eventId}_${VERSION_ID}`,
    eventId,
    versionId: VERSION_ID,
    revision: 1,
    status: 'confirmed',
    items,
    source: 'deterministic_fallback',
    model: 'presentation-fixture',
    promptVersion: 'presentation-portfolio-v2',
    generatedAt: now,
    generatedBy: identities.adminUid,
    updatedAt: now,
    confirmedAt: now,
    confirmedBy: identities.adminUid,
  };
  batch.set(db.collection(COLLECTIONS.EVENTS).doc(eventId).collection(COLLECTIONS.CONTROL_LIST_PROPOSALS).doc(VERSION_ID), proposal);
  batch.update(db.collection(COLLECTIONS.EVENTS).doc(eventId), { controlListGenerated: true, controlListSnapshot: snapshot, updatedAt: now });
  await batch.commit();
}

async function writeIncidents(db: Firestore, scenarioValue: Scenario, event: Record<string, unknown>, identities: SeedIdentity, organizer: UserProfile, scenarioIndex: number) {
  const eventId = String(event.eventId);
  const details = event.eventDetails as EventDetails;
  for (const [incidentIndex, severity] of scenarioValue.incidentSeverities.entries()) {
    const incidentId = `${eventId}-incident-${incidentIndex + 1}`;
    const incidentPath = `incident_evidence/${identities.participantUid}/${incidentId}.jpg`;
    const bytes = await readFile(resolve(process.cwd(), '..', 'docs', 'presentation', 'assets', 'e2e-2026-09-30', PRESENTATION_IMAGES.at(-1)!));
    await uploadFile(incidentPath, bytes, 'image/jpeg', incidentId);
    const occurredAt = details.startDatetime + (2 + incidentIndex) * HOUR;
    const resolved = scenarioIndex % 3 === 0;
    const status: M4IncidentRecord['status'] = resolved ? 'resolved' : severity === 'high' ? 'authority_investigation' : 'responding';
    const category = scenarioValue.incidentCategories?.[incidentIndex]
      ?? (severity === 'high' ? 'crowd' : severity === 'medium' ? 'medical_safety' : 'lost_found');
    const narrative = incidentNarrative(category);
    const record: M4IncidentRecord & { presentationData: ReturnType<typeof marker> } = {
      schemaVersion: M4_SCHEMA_VERSION,
      incidentId,
      eventId,
      eventVersionId: VERSION_ID,
      venueId: details.venueId ?? `custom:${eventId}`,
      eventType: details.type,
      eventName: details.name,
      organizerId: organizer.uid,
      reporterUid: identities.participantUid,
      reporterRole: 'public',
      category,
      incidentType: category,
      description: narrative.description,
      location: narrative.location,
      occurredAt,
      evidence: [{ path: incidentPath, name: 'incident-observation.jpg', mimeType: 'image/jpeg', size: bytes.length, uploadedBy: identities.participantUid, uploadedAt: occurredAt + 5 * 60_000 }],
      aiAssessment: { status: 'success', model: 'presentation-fixture', promptVersion: M4_AI_PROMPT_VERSION, severity, immediateActionRequired: severity === 'high', rationale: 'Presentation incident triage based on the recorded category, location and evidence.', assessedAt: occurredAt + 60_000 },
      severity,
      immediateActionRequired: severity === 'high',
      status,
      recommendedAuthorityIds: [],
      ...(status === 'authority_investigation' ? {
        referredAuthorityId: 'pdrm-kuala-lumpur-demo',
        referredAuthorityType: 'PDRM' as const,
        assignedAuthorityOfficerUid: identities.authorityUids.PDRM!,
      } : {}),
      ...(resolved ? { finalResolution: 'The response team completed the documented action and closed the incident without further escalation.', resolvedAt: occurredAt + 45 * 60_000 } : {}),
      assessmentEligible: resolved,
      synthetic: true,
      date: occurredAt,
      createdAt: occurredAt + 6 * 60_000,
      updatedAt: resolved ? occurredAt + 45 * 60_000 : occurredAt + 15 * 60_000,
      presentationData: marker(incidentId),
    };
    const incidentRef = db.collection(COLLECTIONS.INCIDENTS).doc(incidentId);
    await incidentRef.set(record);
    await incidentRef.collection('history').doc('incident-submitted').set({ historyId: 'incident-submitted', incidentId, action: 'incident_submitted', actorUid: identities.participantUid, actorRole: 'public', timestamp: record.createdAt, summary: 'Participant incident report submitted with photographic evidence.', evidence: record.evidence, presentationData: marker(incidentId) });
    if (resolved) await incidentRef.collection('history').doc('incident-resolved').set({ historyId: 'incident-resolved', incidentId, action: 'resolve', actorUid: organizer.uid, actorRole: 'organizer', timestamp: record.resolvedAt, summary: record.finalResolution, evidence: [], presentationData: marker(incidentId) });
  }
}

function incidentNarrative(category: M4IncidentCategory) {
  const values: Record<M4IncidentCategory, { description: string; location: string }> = {
    crowd: { description: 'A dense crowd formed near the main entry and movement slowed while staff opened another lane.', location: 'Main public entrance' },
    missing_person: { description: 'A participant reported that a family member could not be located after leaving the activity area.', location: 'Family meeting point' },
    lost_found: { description: 'A participant handed a found personal item to the event information team for secure recording.', location: 'Information counter' },
    medical_safety: { description: 'A participant felt unwell and received an assessment from the event medical response team.', location: 'Medical assistance point' },
    security: { description: 'A participant reported an aggressive confrontation and requested support from event security staff.', location: 'North concourse' },
    property_damage: { description: 'A temporary barrier and nearby facility fitting were damaged during event operations.', location: 'Exhibition hall entrance' },
    suspicious_activity: { description: 'An unattended item and unusual activity were reported to the event security team for checking.', location: 'Stage access corridor' },
    access_traffic: { description: 'Vehicle congestion temporarily blocked the marked participant drop-off and accessible entrance route.', location: 'South vehicle entrance' },
    event_control_discrepancy: { description: 'The published crowd-control setup did not match the arrangement visible at the event entrance.', location: 'Published control location' },
    other: { description: 'A participant reported an operational issue that did not fit another available incident category.', location: 'Participant services desk' },
  };
  return values[category];
}

async function clearDataset(db: Firestore, selectedScenarios: Scenario[]) {
  const manifestSnapshot = await db.collection(COLLECTIONS.DATASET_MANIFESTS).doc(DATASET_ID).get();
  const manifest = manifestSnapshot.data();
  const manifestEventIds = Array.isArray(manifest?.eventIds) ? manifest.eventIds : [];
  const ownedManifest = manifestSnapshot.exists
    && manifest?.datasetId === DATASET_ID
    && manifest?.managedBy === MANAGED_BY;
  for (const scenarioValue of selectedScenarios) {
    const eventId = eventIdFor(scenarioValue);
    const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
    const event = await eventRef.get();
    if (event.exists && event.data()?.presentationData?.datasetId !== DATASET_ID) throw new Error(`Refusing to delete unowned events/${eventId}.`);
    const ownedEvent = (event.exists && event.data()?.presentationData?.datasetId === DATASET_ID)
      || (!event.exists && ownedManifest && manifestEventIds.includes(eventId));
    if (event.exists) await db.recursiveDelete(eventRef);
    for (const collectionName of [COLLECTIONS.PUBLIC_EVENTS, COLLECTIONS.PUBLIC_EVENT_CONTROLS]) {
      const reference = db.collection(collectionName).doc(eventId);
      const snapshot = await reference.get();
      const derivedFromOwnedEvent = ownedEvent && snapshot.data()?.eventId === eventId;
      if (snapshot.exists && snapshot.data()?.presentationData?.datasetId !== DATASET_ID && !derivedFromOwnedEvent) throw new Error(`Refusing to delete unowned ${collectionName}/${eventId}.`);
      if (snapshot.exists) await db.recursiveDelete(reference);
    }
    for (const incident of await db.collection(COLLECTIONS.INCIDENTS).where('eventId', '==', eventId).get().then((snapshot) => snapshot.docs)) {
      if (incident.data()?.presentationData?.datasetId !== DATASET_ID) {
        console.warn(`[presentation-portfolio] Preserving unowned incidents/${incident.id} linked to ${eventId}.`);
        continue;
      }
      await db.recursiveDelete(incident.ref);
    }
    if (ownedEvent) {
      for (const notification of await db.collection(COLLECTIONS.NOTIFICATIONS).where('eventId', '==', eventId).get().then((snapshot) => snapshot.docs)) {
        await notification.ref.delete();
      }
    }
  }
  for (const scenarioValue of selectedScenarios) {
    const eventId = eventIdFor(scenarioValue);
    await getStorage().bucket().deleteFiles({ prefix: `event_documents/${eventId}/`, force: true });
    await getStorage().bucket().deleteFiles({ prefix: `events/${eventId}/`, force: true });
  }
  if (selectedScenarios.length === SCENARIOS.length) {
    const reporterProfiles = await db.collection(COLLECTIONS.USERS).where('role', 'in', ['organizer', 'public']).limit(20).get();
    for (const profile of reporterProfiles.docs) await getStorage().bucket().deleteFiles({ prefix: `incident_evidence/${profile.id}/presentation-`, force: true });
    await db.collection(COLLECTIONS.DATASET_MANIFESTS).doc(DATASET_ID).delete();
  }
}

async function applyDataset(db: Firestore, only?: string) {
  const identities = await loadIdentities(db);
  const organizerSnapshot = await db.collection(COLLECTIONS.USERS).doc(identities.organizerUid).get();
  const organizer = organizerSnapshot.data() as UserProfile;
  const venues = (await db.collection(COLLECTIONS.VENUES).where('active', '==', true).limit(20).get()).docs.map((document) => ({ ...document.data(), venueId: document.id } as Venue));
  if (venues.length === 0) throw new Error('At least one active venue is required.');
  const initialReviewVenue = venues.find((venue) => venue.state === 'Kuala Lumpur' && venue.jurisdiction === 'DBKL');
  if (!initialReviewVenue) throw new Error('An active Kuala Lumpur DBKL venue is required for the initial-review demonstration.');
  // Prefer a venue that matches each prepared workflow. If a deployment has
  // not yet loaded the named registry record, fall back to a same-state
  // verified venue rather than mixing a Penang/Johor application with an
  // unrelated Kuala Lumpur address.
  const venueHints: Record<string, { names: string[]; state: string }> = {
    'putrajaya-community-run': { names: ['Putrajaya'], state: 'Putrajaya' },
    'penang-heritage-weekend': { names: ['George Town', 'Penang'], state: 'Penang' },
    'selangor-food-festival': { names: ['Shah Alam', 'Selangor'], state: 'Selangor' },
    'johor-waterfront-fair': { names: ['Johor', 'Persada', 'Danga'], state: 'Johor' },
    'craft-market': { names: ['Kuala Lumpur', 'Shah Alam', 'Putrajaya'], state: 'Kuala Lumpur' },
  };
  const venueFor = (scenarioValue: Scenario, index: number): Venue => {
    if (scenarioValue.status === 'Pending') return initialReviewVenue;
    const hint = venueHints[scenarioValue.slug];
    if (hint) {
      const named = venues.find((venue) => hint.names.some((name) => venue.name.toLowerCase().includes(name.toLowerCase())));
      if (named) return named;
      const sameState = venues.find((venue) => venue.state === hint.state);
      if (sameState) return sameState;
    }
    return venues[index % venues.length];
  };
  const selectedScenarios = only ? SCENARIOS.filter((scenarioValue) => eventIdFor(scenarioValue) === only) : SCENARIOS;
  await clearDataset(db, selectedScenarios);
  for (const [index, scenarioValue] of selectedScenarios.entries()) {
    const venue = venueFor(scenarioValue, index);
    await writeScenario(db, scenarioValue, venue, organizer, identities, index);
  }
  const manifestRef = db.collection(COLLECTIONS.DATASET_MANIFESTS).doc(DATASET_ID);
  const existingManifest = (await manifestRef.get()).data() ?? {};
  const eventIds = only
    ? [...new Set([...(Array.isArray(existingManifest.eventIds) ? existingManifest.eventIds : []), ...selectedScenarios.map(eventIdFor)])]
    : SCENARIOS.map(eventIdFor);
  const manifestUpdate = {
    datasetId: DATASET_ID,
    managedBy: MANAGED_BY,
    synthetic: true,
    intendedUse: 'STERAS classroom presentation, participant incident-flow testing and analytics demonstration only.',
    generatedAt: Date.now(),
    eventIds,
    participantUid: identities.participantUid,
    ...(!only ? {
      counts: {
        events: SCENARIOS.length,
        reportableEvents: SCENARIOS.filter((item) => item.slug.startsWith('participant-')).length,
        incidents: SCENARIOS.reduce((sum, item) => sum + item.incidentSeverities.length, 0),
      },
    } : {}),
  };
  await manifestRef.set(manifestUpdate, { merge: true });
}

async function verifyDataset(db: Firestore, only?: string) {
  const failures: string[] = [];
  let incidentCount = 0;
  const incidentCategories = new Set<M4IncidentCategory>();
  let reportableEventCount = 0;
  const now = Date.now();
  const selectedScenarios = only ? SCENARIOS.filter((scenarioValue) => eventIdFor(scenarioValue) === only) : SCENARIOS;
  for (const scenarioValue of selectedScenarios) {
    const eventId = eventIdFor(scenarioValue);
    const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
    const eventSnapshot = await eventRef.get();
    const event = eventSnapshot.data() as EventRecord | undefined;
    if (!eventSnapshot.exists || !event || eventSnapshot.data()?.presentationData?.datasetId !== DATASET_ID || !isAnalyticsEvent(event)) {
      failures.push(`${eventId}: invalid event`);
      continue;
    }
    const [publicEvent, publicControls] = await Promise.all([
      db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId).get(),
      db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId).get(),
    ]);
    if (event.status === 'Approved') {
      const value = publicEvent.data() as Partial<PublicEvent> | undefined;
      if (!publicEvent.exists || value?.eventId !== eventId || value.versionId !== VERSION_ID || value.publicStatus !== 'approved') {
        failures.push(`${eventId}: approved presentation fixture is missing its public event projection`);
      }
    } else if (publicEvent.exists || publicControls.exists) {
      failures.push(`${eventId}: non-approved managed presentation fixture has a public projection`);
    }
    if (event.eventDetails.organizerEmail !== ORGANIZER_DEMO_EMAIL) failures.push(`${eventId}: unexpected organiser ${event.eventDetails.organizerEmail}`);
    if (event.status === 'Pending') {
      const pendingAssignments = await eventRef.collection(COLLECTIONS.ASSIGNMENTS).get();
      const pendingControls = await eventRef.collection(COLLECTIONS.EVENT_CONTROLS).get();
      const pendingReviews = event.currentAssessmentId
        ? await eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId).collection(COLLECTIONS.SCORE_REVIEWS).get()
        : null;
      if (event.initialReview || event.assignedOfficerUids?.length || Object.keys(event.assignedOfficerByAuthority ?? {}).length
        || !pendingAssignments.empty || event.controlListGenerated || !pendingControls.empty || (pendingReviews && !pendingReviews.empty)) {
        failures.push(`${eventId}: pending workflow data is not clean`);
      }
      if (event.eventDetails.venueState !== 'Kuala Lumpur') failures.push(`${eventId}: pending venue is not assignment-ready`);
    }
    if (['urban-parade', 'putrajaya-community-run'].includes(scenarioValue.slug) && (event.status !== 'UnderReview' || event.reviewStage !== 'second' || !event.authorityReviewCompletedAt)) {
      failures.push(`${eventId}: second-review demonstration state is invalid`);
    }
    const [assessment, resource, summary, incidents] = await Promise.all([
      eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId ?? '').get(),
      eventRef.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId ?? '').get(),
      eventRef.collection(COLLECTIONS.ASSESSMENT_SUMMARIES).doc(VERSION_ID).get(),
      db.collection(COLLECTIONS.INCIDENTS).where('eventId', '==', eventId).get(),
    ]);
    const assessmentValue = assessment.data();
    const resourceValue = resource.data();
    if (!assessment.exists || !isAnalyticsAssessment(assessmentValue)) failures.push(`${eventId}: invalid assessment`);
    if (!resource.exists || !validateResourceRecommendation(resourceValue).ok) failures.push(`${eventId}: invalid resource`);
    const summaryValue = summary.data() as Partial<OrganizerAssessmentSummary> | undefined;
    if (!summary.exists || summaryValue?.eventId !== eventId || summaryValue.versionId !== VERSION_ID
      || !summaryValue.resourceRecommendation || !summaryValue.resourceQuantities
      || !summaryValue.overallRiskLevel) failures.push(`${eventId}: organizer-safe assessment summary is missing or incomplete`);
    if (event.status === 'Pending') {
      if (!isReviewableProvisionalAssessment(assessmentValue, eventId, VERSION_ID, event.currentAssessmentId ?? '')) {
        failures.push(`${eventId}: pending assessment is not ready for initial review`);
      }
      if (resourceValue?.stage !== 'provisional' || resourceValue.authorityReviewRequired !== true
        || resourceValue.assessmentReference?.stage !== 'provisional') {
        failures.push(`${eventId}: pending resource is not provisional`);
      }
    }
    if (scenarioValue.postFinalStage) {
      if (event.status !== 'Approved' || event.reviewStage !== null || !event.controlListGenerated) {
        failures.push(`${eventId}: post-final workflow state is invalid`);
      }
      const assignments = await eventRef.collection(COLLECTIONS.ASSIGNMENTS).where('versionId', '==', VERSION_ID).get();
      if (assignments.size !== event.requiredAuthorities.length
        || assignments.docs.some((snapshot) => snapshot.data()?.status !== 'completed' || !snapshot.data()?.decision)) {
        failures.push(`${eventId}: post-final fixture authority assignments are incomplete`);
      }
      const [controls, proposalSnapshot] = await Promise.all([
        eventRef.collection(COLLECTIONS.EVENT_CONTROLS).where('versionId', '==', VERSION_ID).get(),
        eventRef.collection(COLLECTIONS.CONTROL_LIST_PROPOSALS).doc(VERSION_ID).get(),
      ]);
      if (controls.size !== event.requiredAuthorities.length) failures.push(`${eventId}: confirmed control coverage is incomplete`);
      const proposal = proposalSnapshot.data() as ControlListProposal | undefined;
      if (!proposalSnapshot.exists || !proposal || proposal.status !== 'confirmed' || proposal.eventId !== eventId || proposal.versionId !== VERSION_ID
        || proposal.revision !== 1 || proposal.items.length !== event.requiredAuthorities.length) failures.push(`${eventId}: confirmed proposal identity is invalid`);
      if (!event.controlListSnapshot || event.controlListSnapshot.length !== controls.size) failures.push(`${eventId}: control-list snapshot is missing or incomplete`);
      const snapshotIds = new Set((event.controlListSnapshot ?? []).map((item) => item.controlId));
      if (snapshotIds.size !== controls.size || controls.docs.some((control) => !snapshotIds.has(control.id))) failures.push(`${eventId}: control-list snapshot identity is inconsistent`);
      for (const control of controls.docs) {
        const stage1 = await control.ref.collection(COLLECTIONS.STAGE1_DOCS).get();
        const stage2 = await control.ref.collection(COLLECTIONS.STAGE2_DOCS).get();
        const expectedStage1 = scenarioValue.postFinalStage === 'controls' ? 0 : 2;
        const expectedStage2 = scenarioValue.postFinalStage === 'stage2_submitted' ? 1 : 0;
        const controlValue = control.data() as EventControl;
        if (controlValue.stage1ReviewerUid !== event.assignedOfficerByAuthority?.[controlValue.authority]) failures.push(`${eventId}/${control.id}: Stage 1 reviewer does not match the current authority assignment`);
        if (stage1.size !== expectedStage1) failures.push(`${eventId}/${control.id}: unexpected Stage 1 evidence count`);
        if (stage2.size !== expectedStage2) failures.push(`${eventId}/${control.id}: unexpected Stage 2 evidence count`);
        if (stage2.docs.some((document) => document.id !== stage2DocumentId(control.id))) failures.push(`${eventId}/${control.id}: non-canonical Stage 2 document id`);
        if (stage1.docs.some((document) => document.id !== stage1DocumentId(control.id, (document.data() as { docType?: string }).docType ?? ''))) failures.push(`${eventId}/${control.id}: non-canonical Stage 1 document id`);
        if (stage1.docs.some((document) => {
          const value = document.data() as { revision?: number; revisionId?: string; status?: string };
          return value.revision !== 1 || value.revisionId !== stage1RevisionId(document.id, 1) || !['verified', 'pending_verification'].includes(value.status ?? '');
        })) failures.push(`${eventId}/${control.id}: Stage 1 revision projection is incomplete`);
        if (scenarioValue.postFinalStage === 'stage1_submitted' && stage1.docs.some((document) => document.data()?.status !== 'pending_verification')) failures.push(`${eventId}/${control.id}: Stage 1 evidence should await verification`);
        if (scenarioValue.postFinalStage === 'stage2_submitted' && stage2.docs.some((document) => document.data()?.published === true)) failures.push(`${eventId}/${control.id}: Stage 2 evidence must await Admin publication`);
      }
      const publicProjection = await db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId).get();
      const publicControls = await db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId).get();
      const publicValue = publicProjection.data() as Partial<PublicEvent> | undefined;
      if (!publicProjection.exists || publicValue?.versionId !== VERSION_ID || publicValue.publicStatus !== 'approved') {
        failures.push(`${eventId}: managed post-final fixture is missing its public event projection`);
      }
      if (publicControls.exists) failures.push(`${eventId}: managed post-final fixture exposed unpublished control evidence`);
    }
    if (scenarioValue.slug === 'putrajaya-community-run') {
      const [assignments, decisions, reviews] = await Promise.all([
        eventRef.collection(COLLECTIONS.ASSIGNMENTS).where('versionId', '==', VERSION_ID).get(),
        eventRef.collection(COLLECTIONS.DECISION_HISTORY).where('versionId', '==', VERSION_ID).get(),
        assessment.exists ? assessment.ref.collection(COLLECTIONS.SCORE_REVIEWS).where('versionId', '==', VERSION_ID).get() : null,
      ]);
      if (assignments.size !== event.requiredAuthorities.length
        || assignments.docs.some((snapshot) => snapshot.data()?.status !== 'completed' || !snapshot.data()?.decision)) {
        failures.push(`${eventId}: second-review assignments must contain five completed authority decisions`);
      }
      if (reviews && reviews.size !== event.requiredAuthorities.length) failures.push(`${eventId}: second-review score heads are incomplete`);
      if (decisions.size < event.requiredAuthorities.length) failures.push(`${eventId}: second-review decision history is incomplete`);
    }
    const ownedIncidents = incidents.docs.filter((document) => document.data()?.presentationData?.datasetId === DATASET_ID);
    const incidentValues = ownedIncidents.map((document) => ({ ...document.data(), incidentId: document.id }) as M4IncidentRecord);
    if (selectValidAnalyticsIncidents(incidentValues).length !== ownedIncidents.length) failures.push(`${eventId}: invalid incident`);
    incidentValues.forEach((incident) => incidentCategories.add(incident.category));
    if (event.status === 'Approved' && event.eventDetails.startDatetime <= now && event.eventDetails.endDatetime >= now - 7 * DAY) reportableEventCount += 1;
    incidentCount += ownedIncidents.length;
  }
  const expectedIncidents = selectedScenarios.reduce((sum, item) => sum + item.incidentSeverities.length, 0);
  if (incidentCount !== expectedIncidents) failures.push(`incident count ${incidentCount}, expected ${expectedIncidents}`);
  if (!only && reportableEventCount !== 5) failures.push(`reportable event count ${reportableEventCount}, expected 5`);
  if (!only && incidentCategories.size !== 10) failures.push(`incident category coverage ${incidentCategories.size}, expected 10`);
  if (failures.length > 0) throw new Error(`Presentation dataset verification failed:\n- ${failures.join('\n- ')}`);
  console.info(JSON.stringify({ datasetId: DATASET_ID, events: selectedScenarios.length, reportableEvents: reportableEventCount, incidents: incidentCount, incidentCategories: [...incidentCategories].sort(), verified: true }, null, 2));
}

async function main() {
  const { action, projectId, only } = parsePresentationArgs(process.argv.slice(2));
  if (action === 'dry-run') {
    const selectedScenarios = only ? SCENARIOS.filter((scenarioValue) => eventIdFor(scenarioValue) === only) : SCENARIOS;
    console.info(JSON.stringify({ projectId, action, datasetId: DATASET_ID, events: selectedScenarios.map(({ slug, name, status, risk, startAt, incidentSeverities, incidentCategories, postFinalStage }) => ({ eventId: eventIdFor({ slug }), name, status, risk, startAt: new Date(startAt).toISOString(), reportableDemo: slug.startsWith('participant-'), postFinalStage, incidents: incidentSeverities.length, incidentCategories })) }, null, 2));
    return;
  }
  const selectedScenario = only ? SCENARIOS.find((scenarioValue) => eventIdFor(scenarioValue) === only) : undefined;
  const explicitProductionRepair = process.env.STERAS_ALLOW_PRESENTATION_PRODUCTION_REPAIR === 'true';
  const productionRepairAllowed = explicitProductionRepair && Boolean(selectedScenario);
  if ((action === 'apply' || action === 'cleanup') && !process.env.FIRESTORE_EMULATOR_HOST
    && !productionRepairAllowed) {
    throw new Error('Production fixture apply/cleanup is disabled. Use FIRESTORE_EMULATOR_HOST, or explicitly set STERAS_ALLOW_PRESENTATION_PRODUCTION_REPAIR=true with --only one managed fixture.');
  }
  if (productionRepairAllowed && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.warn(`[presentation-portfolio] Explicitly repairing managed fixture ${only}; non-managed records remain protected.`);
  }
  initializeApp({ credential: applicationDefault(), projectId, storageBucket: `${projectId}.firebasestorage.app` });
  const db = getFirestore();
  if (action === 'apply') await applyDataset(db, only);
  if (action === 'verify') await verifyDataset(db, only);
  if (action === 'cleanup') await clearDataset(db, only ? SCENARIOS.filter((scenarioValue) => eventIdFor(scenarioValue) === only) : SCENARIOS);
  console.info(`[presentation-portfolio] ${action} complete for ${DATASET_ID}.`);
}

if (require.main === module) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
