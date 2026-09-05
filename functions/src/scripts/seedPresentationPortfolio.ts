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
  type EventDetails,
  type EventRecord,
  type EventStatus,
  type EventType,
  type ProvisionalRiskAssessment,
  type ResourceRecommendation,
  type RiskAssessment,
  type UserProfile,
  type Venue,
} from '@shared/types';
import { M4_AI_PROMPT_VERSION, M4_SCHEMA_VERSION, type M4IncidentRecord } from '@shared/m4';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { buildAuthorityReviewState, buildOfficialAssessmentResult } from '../engines/authorityFinalisation';
import { validateAndCalculateProvisional } from '../engines/assessmentValidator';
import { computeCategoryBasedAssessment } from '../engines/ruleBased';
import { computeResources } from '../engines/resourceCalculator';
import { validateResourceRecommendation } from '../engines/resourceContract';
import { isAnalyticsAssessment, isAnalyticsEvent, selectValidAnalyticsIncidents } from '../http/getAnalyticsPortfolio';
import { resourceDocumentId } from '../triggers/onEventCreated';

const EXPECTED_PROJECT = 'linkos-496505';
const DATASET_ID = 'steras-presentation-portfolio-2026-09-v1';
const MANAGED_BY = 'seed:presentation-portfolio';
const VERSION_ID = 'v1';
const DAY = 86_400_000;
const HOUR = 3_600_000;

type Action = 'dry-run' | 'apply' | 'verify' | 'cleanup';
type RiskBand = 'low' | 'medium' | 'high';

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
}

interface SeedIdentity {
  adminUid: string;
  organizerUid: string;
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
  scenario('craft-market', 'Malaysia Craft & Design Market', 'fair', 'Pending', 'medium', '2026-06-28', '2026-10-03', 4800, []),
  scenario('community-harmony', 'Community Harmony Gathering', 'religious', 'Approved', 'medium', '2026-07-17', '2026-10-10', 5400, []),
  scenario('innovation-summit', 'Tourism Innovation Summit', 'conference', 'Rejected', 'low', '2026-08-06', '2026-10-17', 1600, []),
];

const PRESENTATION_IMAGES = [
  'stage2-dbkl-venue-setup.jpg',
  'stage2-pdrm-crowd-entry.jpg',
  'stage2-bomba-fire-egress.jpg',
  'stage2-kkm-medical-point.jpg',
  'm4-crowd-arrival-surge.jpg',
];

function scenario(slug: string, name: string, type: EventType, status: EventStatus, risk: RiskBand, createdDate: string, eventDate: string, attendance: number, incidentSeverities: Scenario['incidentSeverities']): Scenario {
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
  if (projectId !== EXPECTED_PROJECT) throw new Error(`--project must be ${EXPECTED_PROJECT}.`);
  const action = actionFlags[0].slice(2) as Action;
  if ((action === 'apply' || action === 'cleanup') && confirm !== EXPECTED_PROJECT) {
    throw new Error(`--confirm must be ${EXPECTED_PROJECT} for writes.`);
  }
  return { action, projectId };
}

async function loadIdentities(db: Firestore): Promise<SeedIdentity> {
  const [admins, organizers, authorities] = await Promise.all([
    db.collection(COLLECTIONS.USERS).where('role', '==', 'admin').limit(10).get(),
    db.collection(COLLECTIONS.USERS).where('role', '==', 'organizer').limit(10).get(),
    db.collection(COLLECTIONS.USERS).where('role', '==', 'authority').limit(50).get(),
  ]);
  const admin = admins.docs[0]?.data() as UserProfile | undefined;
  const organizer = organizers.docs[0]?.data() as UserProfile | undefined;
  if (!admin?.uid || !organizer?.uid) throw new Error('At least one Admin and Organizer profile must already exist.');
  const authorityUids: Partial<Record<AuthorityType, string>> = {};
  authorities.docs.forEach((document) => {
    const profile = document.data() as UserProfile;
    if (profile.authorityType && !authorityUids[profile.authorityType]) authorityUids[profile.authorityType] = profile.uid;
  });
  return { adminUid: admin.uid, organizerUid: organizer.uid, authorityUids };
}

function authoritiesFor(type: EventType): AuthorityType[] {
  const values: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM', 'DBKL'];
  if (['festival', 'cultural', 'religious', 'exhibition'].includes(type)) values.push('MOTAC');
  return values;
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
      rationale: `${category.name} rating reflects the presentation scenario attendance, venue and operating controls.`,
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
  const reviews = requiredAuthorities.map((authority) => {
    const reviewerId = identities.authorityUids[authority] ?? identities.adminUid;
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
      rationale: `${authority} reviewed the presentation scenario and confirmed the category ratings.`,
      idempotencyKey: `${eventId}-${authority.toLowerCase()}-review-v1`,
      createdAt: now,
    } satisfies AuthorityScoreReview;
  });
  const provisionalAssessment = {
    ...common,
    status: 'authority_review' as const,
    aiProposal: proposal,
    warnings: provisional.warnings,
    authorityReviewRequired: true as const,
    provisionalResult: provisional.result,
  } as ProvisionalRiskAssessment;
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
    notes: 'Presentation dataset using internal prototype resource ratios.',
    computedAt: now,
  };
  return { assessment, resource: { ...resource, presentationData: marker(eventId) }, reviews, inputHash };
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
  const requiredAuthorities = authoritiesFor(scenarioValue.type);
  const terminal = scenarioValue.status === 'Approved' || scenarioValue.status === 'Rejected';
  const initialReviewed = scenarioValue.status !== 'Pending';
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
    assignedOfficerUids: requiredAuthorities.map((authority) => identities.authorityUids[authority] ?? identities.adminUid),
    assignedOfficerByAuthority: Object.fromEntries(requiredAuthorities.map((authority) => [authority, identities.authorityUids[authority] ?? identities.adminUid])),
    reviewStage: terminal ? null : scenarioValue.status === 'UnderReview' ? 'authority' : 'initial',
    controlListGenerated: true,
    createdAt: scenarioValue.createdAt,
    submittedAt,
    updatedAt: terminal ? terminalAt : initialReviewed ? initialReviewAt : submittedAt,
    ...(initialReviewed ? { initialReview: { decision: 'Approved', reason: 'Application completeness and evidence package reviewed.', reviewerUid: identities.adminUid, reviewedAt: initialReviewAt } } : {}),
    ...(terminal ? { authorityReviewCompletedAt: authorityReviewAt, authorityReviewCompletedVersionId: VERSION_ID } : {}),
    ...(terminal ? { secondReview: { confirmedDecision: scenarioValue.status, reviewerUid: identities.adminUid, decidedAt: terminalAt, adminNote: scenarioValue.status === 'Approved' ? 'All required reviews completed.' : 'Application requires material revision before resubmission.' } } : {}),
    synthetic: true,
    presentationData: marker(eventId),
  } as unknown as EventRecord & Record<string, unknown>;
  const evidenceBytes = await readFile(resolve(
    process.cwd(),
    '..',
    'output',
    'pdf',
    'm1-presentation-test-case',
    'STERAS_DEMO_T01_Completed_Combined_Application.pdf',
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
  for (const review of artifacts.reviews) batch.set(eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(artifacts.assessment.assessmentId).collection(COLLECTIONS.SCORE_REVIEWS).doc(review.reviewId), { ...review, presentationData: marker(eventId) });
  for (const authority of requiredAuthorities) {
    const rejected = scenarioValue.status === 'Rejected' && authority === requiredAuthorities[0];
    const assignmentId = `${VERSION_ID}_${authority}`;
    batch.set(eventRef.collection(COLLECTIONS.ASSIGNMENTS).doc(assignmentId), {
      assignmentId, eventId, versionId: VERSION_ID, authorityType: authority,
      officerUid: identities.authorityUids[authority] ?? identities.adminUid,
      assignedBy: identities.adminUid, assignedAt: initialReviewAt,
      status: terminal ? 'completed' : scenarioValue.status === 'UnderReview' ? 'in_progress' : 'pending',
      ...(terminal ? { decision: rejected ? 'Rejected' : 'Approved', reason: rejected ? 'Risk controls require revision.' : 'Required materials and controls reviewed.', suggestion: rejected ? 'Revise crowd, traffic and evacuation controls.' : 'Proceed with the approved controls.', ...(rejected ? { rejectionReasonCategory: 'risk_controls_inadequate' } : {}), decidedAt: authorityReviewAt } : {}),
      presentationData: marker(eventId),
    });
    if (terminal) batch.set(eventRef.collection(COLLECTIONS.DECISION_HISTORY).doc(`${assignmentId}-decision`), { decisionId: `${assignmentId}-decision`, eventId, versionId: VERSION_ID, authorityType: authority, decision: rejected ? 'Rejected' : 'Approved', rationale: rejected ? 'Risk controls require revision.' : 'Required materials and controls reviewed.', suggestion: rejected ? 'Revise crowd, traffic and evacuation controls.' : 'Proceed with the approved controls.', reviewStage: 'authority', ...(rejected ? { rejectionReasonCategory: 'risk_controls_inadequate' } : {}), materialsReviewed: true, reviewerId: identities.authorityUids[authority] ?? identities.adminUid, decidedAt: authorityReviewAt, current: true, presentationData: marker(eventId) });
  }
  if (initialReviewed) batch.set(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc('presentation-initial-review'), { id: 'presentation-initial-review', eventId, versionId: VERSION_ID, action: 'decision_made', actorId: identities.adminUid, actorRole: 'admin', timestamp: initialReviewAt, metadata: { reviewStage: 'initial', decision: 'Approved' }, presentationData: marker(eventId) });
  if (terminal) batch.set(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc('presentation-second-review'), { id: 'presentation-second-review', eventId, versionId: VERSION_ID, action: 'decision_made', actorId: identities.adminUid, actorRole: 'admin', timestamp: terminalAt, metadata: { reviewStage: 'second', finalDecision: scenarioValue.status, ...(scenarioValue.status === 'Rejected' ? { rejectionReasonCategory: 'risk_controls_inadequate' } : {}) }, presentationData: marker(eventId) });
  await batch.commit();
  await writeControl(db, scenarioValue, event, identities, organizer, index, terminalAt);
  if (scenarioValue.status === 'Approved') {
    await db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId).set({ eventId, versionId: VERSION_ID, eventName: details.name, venueName: details.venueName, eventType: details.type, startDatetime: details.startDatetime, endDatetime: details.endDatetime, approvedBy: requiredAuthorities, publicStatus: 'approved', presentationData: marker(eventId) });
  }
  await writeIncidents(db, scenarioValue, event, identities, organizer, index);
}

async function writeControl(db: Firestore, scenarioValue: Scenario, event: Record<string, unknown>, identities: SeedIdentity, organizer: UserProfile, index: number, now: number) {
  const eventId = String(event.eventId);
  const controlId = `${eventId}-crowd-control`;
  const controlRef = db.collection(COLLECTIONS.EVENTS).doc(eventId).collection(COLLECTIONS.EVENT_CONTROLS).doc(controlId);
  const label = scenarioValue.status === 'Approved' ? 'approved' : scenarioValue.status === 'Rejected' ? 'resubmit_required' : 'pending';
  const stage1Requirements = [
    { docType: 'application' as const, label: 'Authority acknowledgement', required: true },
    { docType: 'insurance' as const, label: 'Public liability insurance', required: true },
  ];
  const imageName = PRESENTATION_IMAGES[index % (PRESENTATION_IMAGES.length - 1)];
  const bytes = await readFile(resolve(process.cwd(), '..', 'docs', 'presentation', 'assets', 'e2e-2026-09-30', imageName));
  const uploaded = await uploadFile(`events/${eventId}/controls/${controlId}/stage2/${imageName}`, bytes, 'image/jpeg', eventId);
  const batch = db.batch();
  batch.set(controlRef, { controlId, eventId, versionId: VERSION_ID, controlName: 'Crowd entry and venue readiness', authority: 'PDRM', stageRequirement: 'stage1_and_stage2', stage1Requirements, stage2Requirement: { kind: 'image', label: 'Photo of the prepared entry and safety-control area' }, controlItemVersion: 1, label, createdAt: now, updatedAt: now, presentationData: marker(eventId) });
  for (const requirement of stage1Requirements) {
    const docId = `${controlId}-${requirement.docType}`;
    batch.set(controlRef.collection(COLLECTIONS.STAGE1_DOCS).doc(docId), { docId, docType: requirement.docType, label: requirement.label, status: label === 'approved' ? 'verified' : label === 'resubmit_required' ? 'rejected' : 'pending_verification', uploadedAt: now - DAY, uploadedBy: organizer.uid, filePath: `events/${eventId}/controls/${controlId}/stage1/${docId}.pdf`, ...(label === 'approved' ? { verifiedBy: identities.authorityUids.PDRM ?? identities.adminUid, verifiedAt: now } : {}), ...(label === 'resubmit_required' ? { rejectionReason: 'The submitted document requires an updated validity date.', rejectionSuggestion: 'Upload the current endorsed document.' } : {}), presentationData: marker(eventId) });
  }
  const stage2Id = `${controlId}-stage2`;
  batch.set(controlRef.collection(COLLECTIONS.STAGE2_DOCS).doc(stage2Id), { docId: stage2Id, imageUrl: uploaded.url, uploadedAt: now, uploadedBy: organizer.uid, publicConfirmCount: 0, published: scenarioValue.status === 'Approved', ...(scenarioValue.status === 'Approved' ? { publishedAt: now, publishedBy: identities.adminUid } : {}), presentationData: marker(eventId) });
  await batch.commit();
  if (scenarioValue.status === 'Approved') {
    const publicRoot = db.collection(COLLECTIONS.PUBLIC_EVENT_CONTROLS).doc(eventId);
    await publicRoot.set({ eventId, versionId: VERSION_ID, updatedAt: now, presentationData: marker(eventId) });
    await publicRoot.collection(COLLECTIONS.PUBLIC_EVENT_CONTROL_ITEMS).doc(stage2Id).set({ publicControlId: stage2Id, eventId, versionId: VERSION_ID, controlId, docId: stage2Id, authority: 'PDRM', controlName: 'Crowd entry and venue readiness', stage2Label: 'Photo of the prepared entry and safety-control area', imageUrl: uploaded.url, publicConfirmCount: 0, reported: false, publishedAt: now, sanitized: true, sanitizedAt: now, sanitizedBy: identities.adminUid, presentationData: marker(eventId) });
  }
}

async function writeIncidents(db: Firestore, scenarioValue: Scenario, event: Record<string, unknown>, identities: SeedIdentity, organizer: UserProfile, scenarioIndex: number) {
  const eventId = String(event.eventId);
  const details = event.eventDetails as EventDetails;
  for (const [incidentIndex, severity] of scenarioValue.incidentSeverities.entries()) {
    const incidentId = `${eventId}-incident-${incidentIndex + 1}`;
    const incidentPath = `incident_evidence/${organizer.uid}/${incidentId}.jpg`;
    const bytes = await readFile(resolve(process.cwd(), '..', 'docs', 'presentation', 'assets', 'e2e-2026-09-30', PRESENTATION_IMAGES.at(-1)!));
    await uploadFile(incidentPath, bytes, 'image/jpeg', incidentId);
    const occurredAt = details.startDatetime + (2 + incidentIndex) * HOUR;
    const resolved = scenarioIndex % 3 === 0;
    const status: M4IncidentRecord['status'] = resolved ? 'resolved' : severity === 'high' ? 'authority_investigation' : 'responding';
    const record: M4IncidentRecord & { presentationData: ReturnType<typeof marker> } = {
      schemaVersion: M4_SCHEMA_VERSION,
      incidentId,
      eventId,
      eventVersionId: VERSION_ID,
      venueId: details.venueId ?? `custom:${eventId}`,
      eventType: details.type,
      eventName: details.name,
      organizerId: organizer.uid,
      reporterUid: organizer.uid,
      reporterRole: 'organizer',
      category: severity === 'high' ? 'crowd' : severity === 'medium' ? 'medical_safety' : 'lost_found',
      incidentType: severity === 'high' ? 'crowd_pressure_at_entry' : severity === 'medium' ? 'heat_exhaustion' : 'lost_property',
      description: severity === 'high' ? 'A temporary crowd build-up formed near the primary entry while an additional lane was opened.' : severity === 'medium' ? 'A visitor reported heat exhaustion and received assessment at the medical point.' : 'A visitor reported a misplaced personal item to the event help desk.',
      location: severity === 'high' ? 'Main public entrance' : severity === 'medium' ? 'Visitor concourse' : 'Information counter',
      occurredAt,
      evidence: [{ path: incidentPath, name: 'incident-observation.jpg', mimeType: 'image/jpeg', size: bytes.length, uploadedBy: organizer.uid, uploadedAt: occurredAt + 5 * 60_000 }],
      aiAssessment: { status: 'success', model: 'presentation-fixture', promptVersion: M4_AI_PROMPT_VERSION, severity, immediateActionRequired: severity === 'high', rationale: 'Presentation incident triage based on the recorded category, location and evidence.', assessedAt: occurredAt + 60_000 },
      severity,
      immediateActionRequired: severity === 'high',
      status,
      recommendedAuthorityIds: [],
      ...(status === 'authority_investigation' ? { assignedAuthorityOfficerUid: identities.authorityUids.PDRM ?? identities.adminUid } : {}),
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
    await incidentRef.collection('history').doc('incident-submitted').set({ historyId: 'incident-submitted', incidentId, action: 'incident_submitted', actorUid: organizer.uid, actorRole: 'organizer', timestamp: record.createdAt, summary: 'Incident report submitted with photographic evidence.', evidence: record.evidence, presentationData: marker(incidentId) });
    if (resolved) await incidentRef.collection('history').doc('incident-resolved').set({ historyId: 'incident-resolved', incidentId, action: 'resolve', actorUid: organizer.uid, actorRole: 'organizer', timestamp: record.resolvedAt, summary: record.finalResolution, evidence: [], presentationData: marker(incidentId) });
  }
}

async function clearDataset(db: Firestore) {
  for (const scenarioValue of SCENARIOS) {
    const eventId = eventIdFor(scenarioValue);
    const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
    const event = await eventRef.get();
    if (event.exists && event.data()?.presentationData?.datasetId !== DATASET_ID) throw new Error(`Refusing to delete unowned events/${eventId}.`);
    if (event.exists) await db.recursiveDelete(eventRef);
    for (const collectionName of [COLLECTIONS.PUBLIC_EVENTS, COLLECTIONS.PUBLIC_EVENT_CONTROLS]) {
      const reference = db.collection(collectionName).doc(eventId);
      const snapshot = await reference.get();
      if (snapshot.exists && snapshot.data()?.presentationData?.datasetId !== DATASET_ID) throw new Error(`Refusing to delete unowned ${collectionName}/${eventId}.`);
      if (snapshot.exists) await db.recursiveDelete(reference);
    }
    for (const incident of await db.collection(COLLECTIONS.INCIDENTS).where('eventId', '==', eventId).get().then((snapshot) => snapshot.docs)) {
      if (incident.data()?.presentationData?.datasetId !== DATASET_ID) throw new Error(`Refusing to delete unowned incidents/${incident.id}.`);
      await db.recursiveDelete(incident.ref);
    }
  }
  await getStorage().bucket().deleteFiles({ prefix: `event_documents/presentation-`, force: true });
  await getStorage().bucket().deleteFiles({ prefix: `events/presentation-`, force: true });
  const organizerProfiles = await db.collection(COLLECTIONS.USERS).where('role', '==', 'organizer').limit(10).get();
  for (const profile of organizerProfiles.docs) await getStorage().bucket().deleteFiles({ prefix: `incident_evidence/${profile.id}/presentation-`, force: true });
  await db.collection(COLLECTIONS.DATASET_MANIFESTS).doc(DATASET_ID).delete();
}

async function applyDataset(db: Firestore) {
  const identities = await loadIdentities(db);
  const organizerSnapshot = await db.collection(COLLECTIONS.USERS).doc(identities.organizerUid).get();
  const organizer = organizerSnapshot.data() as UserProfile;
  const venues = (await db.collection(COLLECTIONS.VENUES).where('active', '==', true).limit(20).get()).docs.map((document) => ({ ...document.data(), venueId: document.id } as Venue));
  if (venues.length === 0) throw new Error('At least one active venue is required.');
  await clearDataset(db);
  for (const [index, scenarioValue] of SCENARIOS.entries()) await writeScenario(db, scenarioValue, venues[index % venues.length], organizer, identities, index);
  await db.collection(COLLECTIONS.DATASET_MANIFESTS).doc(DATASET_ID).set({ datasetId: DATASET_ID, managedBy: MANAGED_BY, synthetic: true, intendedUse: 'STERAS classroom presentation and analytics demonstration only.', generatedAt: Date.now(), eventIds: SCENARIOS.map(eventIdFor), counts: { events: SCENARIOS.length, incidents: SCENARIOS.reduce((sum, item) => sum + item.incidentSeverities.length, 0) } });
}

async function verifyDataset(db: Firestore) {
  const failures: string[] = [];
  let incidentCount = 0;
  for (const scenarioValue of SCENARIOS) {
    const eventId = eventIdFor(scenarioValue);
    const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
    const eventSnapshot = await eventRef.get();
    const event = eventSnapshot.data() as EventRecord | undefined;
    if (!eventSnapshot.exists || !event || eventSnapshot.data()?.presentationData?.datasetId !== DATASET_ID || !isAnalyticsEvent(event)) {
      failures.push(`${eventId}: invalid event`);
      continue;
    }
    const [assessment, resource, incidents] = await Promise.all([
      eventRef.collection(COLLECTIONS.ASSESSMENTS).doc(event.currentAssessmentId ?? '').get(),
      eventRef.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId ?? '').get(),
      db.collection(COLLECTIONS.INCIDENTS).where('eventId', '==', eventId).get(),
    ]);
    if (!assessment.exists || !isAnalyticsAssessment(assessment.data())) failures.push(`${eventId}: invalid assessment`);
    if (!resource.exists || !validateResourceRecommendation(resource.data()).ok) failures.push(`${eventId}: invalid resource`);
    if (selectValidAnalyticsIncidents(incidents.docs.map((document) => ({ ...document.data(), incidentId: document.id }))).length !== incidents.size) failures.push(`${eventId}: invalid incident`);
    incidentCount += incidents.size;
  }
  const expectedIncidents = SCENARIOS.reduce((sum, item) => sum + item.incidentSeverities.length, 0);
  if (incidentCount !== expectedIncidents) failures.push(`incident count ${incidentCount}, expected ${expectedIncidents}`);
  if (failures.length > 0) throw new Error(`Presentation dataset verification failed:\n- ${failures.join('\n- ')}`);
  console.info(JSON.stringify({ datasetId: DATASET_ID, events: SCENARIOS.length, incidents: incidentCount, verified: true }, null, 2));
}

async function main() {
  const { action, projectId } = parsePresentationArgs(process.argv.slice(2));
  if (action === 'dry-run') {
    console.info(JSON.stringify({ projectId, action, datasetId: DATASET_ID, events: SCENARIOS.map(({ slug, name, status, risk, incidentSeverities }) => ({ eventId: eventIdFor({ slug }), name, status, risk, incidents: incidentSeverities.length })) }, null, 2));
    return;
  }
  initializeApp({ credential: applicationDefault(), projectId, storageBucket: `${projectId}.firebasestorage.app` });
  const db = getFirestore();
  if (action === 'apply') await applyDataset(db);
  if (action === 'verify') await verifyDataset(db);
  if (action === 'cleanup') await clearDataset(db);
  console.info(`[presentation-portfolio] ${action} complete for ${DATASET_ID}.`);
}

if (require.main === module) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
