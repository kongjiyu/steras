import { createHash } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  AssessmentContextSnapshot,
  AuthorityType,
  COLLECTIONS,
  EventRecord,
  EventType,
  EventVersion,
  HistoricalEventOutcome,
  Incident,
  RESOURCE_FORMULA_VERSION,
  RESOURCE_GUIDELINE_VERSION,
  ResourceRecommendation,
  RiskAssessment,
  UserProfile,
  Venue,
} from '@shared/types';
import { computeResources } from '../engines/resourceCalculator';
import { computeCategoryBasedAssessment } from '../engines/ruleBased';
import { VENUES, stableVenueId } from './seedVenues';

const DATASET_VERSION = 'steras-demo-2026-07-24-v1';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? 'steras-demo';
const DEMO_PASSWORD = 'Demo123!';
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 24, 0, 0, 0);

assertLocalEmulators();

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, 'steras-demo-seed');
const db = getFirestore(app);
const auth = getAuth(app);

const accounts: Array<{
  email: string;
  name: string;
  role: UserProfile['role'];
  authorityType?: AuthorityType;
}> = [
  { email: 'organizer.demo@steras.local', name: 'Demo Organizer', role: 'organizer' },
  { email: 'pdrm.demo@steras.local', name: 'PDRM Demo Reviewer', role: 'authority', authorityType: 'PDRM' },
  { email: 'bomba.demo@steras.local', name: 'BOMBA Demo Reviewer', role: 'authority', authorityType: 'BOMBA' },
  { email: 'kkm.demo@steras.local', name: 'KKM Demo Reviewer', role: 'authority', authorityType: 'KKM' },
  { email: 'dbkl.demo@steras.local', name: 'DBKL Demo Reviewer', role: 'authority', authorityType: 'DBKL' },
  { email: 'motac.demo@steras.local', name: 'MOTAC Demo Reviewer', role: 'authority', authorityType: 'MOTAC' },
];

async function seedDemo(): Promise<void> {
  const profiles = await provisionAccounts();
  const organizer = profiles.find((profile) => profile.role === 'organizer');
  if (!organizer) throw new Error('Demo organizer was not provisioned.');

  const batch = db.batch();
  const venues = buildVenues();
  const historicalEvents = buildHistoricalEvents(venues);
  const incidents = buildIncidents(historicalEvents);
  const applications = buildApplications(venues, organizer.uid);

  for (const venue of venues) {
    batch.set(db.collection(COLLECTIONS.VENUES).doc(venue.venueId), venue);
  }
  for (const historical of historicalEvents) {
    batch.set(db.collection(COLLECTIONS.HISTORICAL_EVENTS).doc(historical.historicalEventId), historical);
  }
  for (const incident of incidents) {
    batch.set(db.collection(COLLECTIONS.INCIDENTS).doc(incident.incidentId), incident);
  }
  for (const application of applications) {
    const eventReference = db.collection(COLLECTIONS.EVENTS).doc(application.event.eventId);
    batch.set(eventReference, application.event);
    batch.set(eventReference.collection(COLLECTIONS.VERSIONS).doc(application.version.versionId), application.version);
    batch.set(eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(application.assessment.assessmentId), application.assessment);
    batch.set(eventReference.collection(COLLECTIONS.RESOURCES).doc(application.resources.resourceId), application.resources);
  }
  batch.set(db.collection(COLLECTIONS.DATASET_MANIFESTS).doc(DATASET_VERSION), {
    datasetVersion: DATASET_VERSION,
    generatedAt: NOW,
    synthetic: true,
    intendedUse: 'Local emulator demonstration, retrieval testing, and UI walkthroughs only.',
    prohibitedUse: 'Do not use for real permits, model training claims, or accuracy validation.',
    counts: {
      accounts: profiles.length,
      venues: venues.length,
      historicalEvents: historicalEvents.length,
      incidents: incidents.length,
      applications: applications.length,
    },
    generationMethod: 'Deterministic fixtures with stable IDs; no real persons or real incident claims.',
  });
  await batch.commit();

  console.info(`[seed:demo] ${DATASET_VERSION} written to ${PROJECT_ID}.`);
  console.info(`[seed:demo] ${venues.length} venues, ${historicalEvents.length} historical outcomes, ${incidents.length} incidents, ${applications.length} applications, ${profiles.length} accounts.`);
  console.info(`[seed:demo] Login: organizer.demo@steras.local / ${DEMO_PASSWORD} (emulator only).`);
}

async function provisionAccounts(): Promise<UserProfile[]> {
  const profiles: UserProfile[] = [];
  for (const account of accounts) {
    const existing = await auth.getUserByEmail(account.email).catch(() => undefined);
    const user = existing ?? await auth.createUser({
      email: account.email,
      password: DEMO_PASSWORD,
      displayName: account.name,
    });
    const profile: UserProfile = {
      uid: user.uid,
      name: account.name,
      email: account.email,
      role: account.role,
      ...(account.authorityType ? { authorityType: account.authorityType } : {}),
      createdAt: NOW,
      updatedAt: NOW,
    };
    await db.collection(COLLECTIONS.USERS).doc(user.uid).set(profile, { merge: true });
    profiles.push(profile);
  }
  return profiles;
}

function buildVenues(): Venue[] {
  return VENUES.map((fixture, index) => {
    const venueId = stableVenueId(fixture.name);
    const fireRequired = fixture.capacity >= 5_000;
    return {
      ...fixture,
      venueId,
      jurisdiction: fixture.address.includes('Kuala Lumpur') ? 'DBKL' : 'Relevant State PBT',
      verifiedSafeCapacity: fixture.capacity,
      ...(index % 3 === 0 ? { fixedSeats: Math.floor(fixture.capacity * 0.7) } : {}),
      exitCount: Math.max(2, Math.ceil(fixture.capacity / 2_500)),
      totalExitWidthMm: Math.max(2_400, Math.ceil(fixture.capacity / 100) * 55),
      fireCertificateStatus: fireRequired ? (index === 7 ? 'expired' : 'valid') : 'not_required',
      ...(fireRequired ? { fireCertificateExpiresAt: NOW + (index === 7 ? -30 : 365) * DAY } : {}),
      nearestHospitalTravelMinutes: 8 + (index * 7) % 43,
      emergencyAccessVerified: index % 6 !== 0,
      incidentCount: 2,
      synthetic: true,
      datasetVersion: DATASET_VERSION,
    };
  });
}

function buildHistoricalEvents(venues: Venue[]): HistoricalEventOutcome[] {
  const eventTypes: EventType[] = ['concert', 'festival', 'sports', 'cultural', 'religious', 'exhibition', 'fair', 'conference'];
  return venues.flatMap((venue, venueIndex) => Array.from({ length: 8 }, (_, eventIndex) => {
    const historicalEventId = `demo-history-${String(venueIndex + 1).padStart(2, '0')}-${String(eventIndex + 1).padStart(2, '0')}`;
    const startDatetime = NOW - (120 + venueIndex * 9 + eventIndex * 73) * DAY;
    const durationHours = 4 + eventIndex % 5;
    const attendance = Math.max(200, Math.floor(venue.capacity * (0.35 + (eventIndex % 5) * 0.12)));
    const severityFactor = (venueIndex + eventIndex) % 10;
    const incidentId = eventIndex < 2
      ? `demo-incident-${String(venueIndex * 2 + eventIndex + 1).padStart(3, '0')}`
      : undefined;
    return {
      historicalEventId,
      venueId: venue.venueId,
      eventType: eventTypes[(venueIndex + eventIndex) % eventTypes.length],
      startDatetime,
      endDatetime: startDatetime + durationHours * 3_600_000,
      attendance,
      registeredCapacity: venue.verifiedSafeCapacity ?? venue.capacity,
      environment: eventIndex % 3 === 0 ? 'indoor' : eventIndex % 3 === 1 ? 'outdoor' : 'mixed',
      coverage: eventIndex % 3 === 0 ? 'covered' : eventIndex % 3 === 1 ? 'uncovered' : 'partially_covered',
      seating: eventIndex % 3 === 0 ? 'seated' : eventIndex % 3 === 1 ? 'standing' : 'mixed',
      controlsVerified: eventIndex % 2 === 0 ? ['crowd-management-plan', 'medical-plan'] : ['traffic-management-plan'],
      resourcesPlanned: { police: Math.ceil(attendance / 250), medicalTeams: Math.ceil(attendance / 1_000) },
      resourcesActuallyUsed: { police: Math.ceil(attendance / 240), medicalTeams: Math.ceil(attendance / 900) },
      outcomes: {
        patientPresentations: Math.floor(attendance / (severityFactor >= 8 ? 450 : 1_500)),
        hospitalTransfers: severityFactor >= 8 ? 2 : severityFactor >= 5 ? 1 : 0,
        ambulanceActivations: severityFactor >= 6 ? 1 : 0,
        crowdIncidents: severityFactor >= 7 ? 1 : 0,
        securityIncidents: severityFactor === 9 ? 1 : 0,
        weatherInterruptions: eventIndex === 6 ? 1 : 0,
        nearMisses: severityFactor >= 5 ? 1 : 0,
        fatalities: 0,
      },
      incidentIds: incidentId ? [incidentId] : [],
      completed: true,
      assessmentEligible: true,
      afterActionFindings: ['Synthetic after-action finding for retrieval and UI demonstration.'],
      synthetic: true,
      datasetVersion: DATASET_VERSION,
    };
  }));
}

function buildIncidents(historicalEvents: HistoricalEventOutcome[]): Incident[] {
  return Array.from({ length: 50 }, (_, index) => {
    const historical = historicalEvents[Math.floor(index / 2) * 8 + (index % 2)];
    const severity: Incident['severity'] = index < 32 ? 'low' : index < 46 ? 'medium' : 'high';
    const status: Incident['status'] = index < 40 ? 'verified' : index < 44 ? 'under_review' : 'rejected';
    return {
      incidentId: `demo-incident-${String(index + 1).padStart(3, '0')}`,
      eventId: historical.historicalEventId,
      venueId: historical.venueId,
      eventType: historical.eventType,
      incidentType: severity === 'high' ? 'crowd_surge' : severity === 'medium' ? 'medical_emergency' : 'first_aid',
      severity,
      date: historical.startDatetime + 2 * 3_600_000,
      status,
      assessmentEligible: status === 'verified',
      outcome: {
        injured: severity === 'high' ? 6 : severity === 'medium' ? 2 : 1,
        hospitalized: severity === 'high' ? 2 : 0,
        fatalities: 0,
        evacuated: severity === 'high' ? 50 : 0,
      },
      ...(status === 'verified'
        ? { verifiedBy: 'demo-data-generator', verifiedAt: NOW }
        : {}),
      synthetic: true,
      datasetVersion: DATASET_VERSION,
      description: 'Synthetic incident for emulator demonstration; not a claim about the named venue.',
    };
  });
}

function buildApplications(venues: Venue[], organizerId: string) {
  const types: EventType[] = ['concert', 'festival', 'sports', 'cultural', 'religious', 'exhibition'];
  return Array.from({ length: 12 }, (_, index) => {
    const venue = venues[index];
    const eventId = `demo-application-${String(index + 1).padStart(2, '0')}`;
    const versionId = `${eventId}-v1`;
    const startDatetime = NOW + (30 + index * 4) * DAY;
    const event: EventRecord = {
      eventId,
      organizerId,
      eventDetails: {
        name: `Demo ${types[index % types.length]} ${index + 1}`,
        type: types[index % types.length],
        venueId: venue.venueId,
        venueName: venue.name,
        venueAddress: venue.address,
        venueLocation: venue.location,
        venueCapacity: venue.capacity,
        expectedAttendance: Math.floor(venue.capacity * (index === 7 ? 1.05 : 0.55 + (index % 4) * 0.1)),
        environment: index % 3 === 0 ? 'indoor' : index % 3 === 1 ? 'outdoor' : 'mixed',
        coverage: index % 3 === 0 ? 'covered' : index % 3 === 1 ? 'uncovered' : 'partially_covered',
        seating: index % 3 === 0 ? 'seated' : index % 3 === 1 ? 'standing' : 'mixed',
        startDatetime,
        endDatetime: startDatetime + (5 + index % 4) * 3_600_000,
        emergencyPlanSummary: 'Synthetic demo emergency plan; requires authority review.',
        riskProfile: {
          internationalAttendees: index % 3 === 0,
          alcoholServed: index % 4 === 0,
          foodServed: true,
          freeDrinkingWater: index % 2 === 0,
          pyrotechnics: index === 2,
          temporaryStructures: index % 3 === 1,
          crowdManagementPlan: true,
          trafficManagementPlan: index % 2 === 0,
          severeWeatherPlan: index % 2 === 0,
          medicalPlan: true,
          evacuationPlanTested: index % 3 === 0,
        },
        organizerName: 'Demo Organizer',
        organizerEmail: 'organizer.demo@steras.local',
        organizerPhone: '+601100000000',
      },
      status: 'Pending',
      currentVersionId: versionId,
      currentVersionNumber: 1,
      currentAssessmentId: versionId,
      currentResourceId: versionId,
      draftDocumentPaths: [],
      requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL'],
      createdAt: NOW,
      updatedAt: NOW,
      submittedAt: NOW,
    };
    const inputHash = hash(event.eventDetails);
    const version: EventVersion = {
      versionId,
      eventId,
      versionNumber: 1,
      eventDetails: event.eventDetails,
      documentPaths: [],
      submittedBy: organizerId,
      submittedAt: NOW,
      inputHash,
    };
    const context = demoContext(event, venue, index);
    const official = computeCategoryBasedAssessment(event, context, NOW);
    const assessment: RiskAssessment = {
      assessmentId: versionId,
      eventId,
      versionId,
      status: 'ready',
      ...official,
      aiAdvisory: {
        model: 'demo-fixture',
        promptVersion: 'demo-fixture-v1',
        responseSchemaVersion: 'demo-fixture-v1',
        status: 'unavailable',
        label: 'advisory',
        overallExplanation: 'Synthetic fixture: run the live pipeline to exercise MiniMax.',
        categories: [],
        keyConcerns: ['Synthetic history must not be treated as real-world validation.'],
        resourceConsiderations: ['Authority review is required for every prototype quantity.'],
        citedEvidenceKeys: ['history'],
        cacheStatus: 'not-applicable',
        generatedAt: NOW,
      },
      contextSnapshot: context,
      sourceTimestamps: { weather: NOW, holiday: NOW, venue: NOW, incidents: NOW },
      contextStatuses: { weather: 'fallback:not_assessable_yet', venue: 'matched', incidents: 'synthetic-demo-evidence', ai: 'not-applicable' },
      inputHash,
      createdAt: NOW,
    };
    const calculation = computeResources(event.eventDetails, official);
    const resources: ResourceRecommendation = {
      resourceId: versionId,
      eventId,
      versionId,
      assessmentId: versionId,
      ...calculation.quantities,
      rationales: calculation.rationales,
      items: calculation.items,
      formulaVersion: RESOURCE_FORMULA_VERSION,
      guidelineVersion: RESOURCE_GUIDELINE_VERSION,
      guidelineStatus: 'prototype',
      aiConsiderations: assessment.aiAdvisory.resourceConsiderations,
      confidenceLevel: 'prototype',
      notes: 'Synthetic demo recommendation; reviewing authorities must validate the range.',
      computedAt: NOW,
    };
    return { event, version, assessment, resources };
  });
}

function demoContext(event: EventRecord, venue: Venue, index: number): AssessmentContextSnapshot {
  return {
    weather: {
      data: { forecast: 'Forecast not assessable yet', temperature: 30, humidity: 75, windSpeed: 0, precipitationProbability: 0, severeAlert: false },
      source: 'fallback',
      freshness: 'not_assessable_yet',
      fetchedAt: NOW,
      expiresAt: NOW,
      forecastFor: event.eventDetails.startDatetime,
    },
    calendar: {
      localDate: new Date(event.eventDetails.startDatetime).toISOString().slice(0, 10),
      dayOfWeek: new Date(event.eventDetails.startDatetime).toLocaleDateString('en-MY', { weekday: 'long', timeZone: 'Asia/Kuala_Lumpur' }),
      isWeekend: index % 2 === 0,
      isHolidayOrAdjacent: index === 4,
      sourceVersion: 'demo-calendar-v1',
      sourceTimestamp: NOW,
    },
    venue: {
      matched: true,
      venueId: venue.venueId,
      submittedCapacity: event.eventDetails.venueCapacity,
      registeredCapacity: venue.capacity,
      verifiedSafeCapacity: venue.verifiedSafeCapacity,
      capacityDifference: event.eventDetails.venueCapacity - (venue.verifiedSafeCapacity ?? venue.capacity),
      jurisdiction: venue.jurisdiction,
      fireCertificateStatus: venue.fireCertificateStatus,
      fireCertificateExpiresAt: venue.fireCertificateExpiresAt,
      emergencyAccessVerified: venue.emergencyAccessVerified,
      nearestHospitalTravelMinutes: venue.nearestHospitalTravelMinutes,
      fetchedAt: NOW,
    },
    incidentHistory: {
      matched: true,
      venueId: venue.venueId,
      incidentIds: [`demo-incident-${String(index * 2 + 1).padStart(3, '0')}`],
      total: 2,
      bySeverity: { low: 2, medium: 0, high: 0 },
      historicalEventIds: Array.from({ length: 8 }, (_, eventIndex) => `demo-history-${String(index + 1).padStart(2, '0')}-${String(eventIndex + 1).padStart(2, '0')}`),
      historicalEventCount: 8,
      totalAttendance: Math.floor(venue.capacity * 5),
      totalAttendeeHours: Math.floor(venue.capacity * 28),
      patientPresentationRatePerThousand: 1.8,
      hospitalTransferRatePerThousand: 0.2,
      incidentRatePerThousandAttendeeHours: 0.08,
      comparableEvents: [],
      lookbackStart: NOW - 3 * 365 * DAY,
      syntheticEvidence: true,
      fetchedAt: NOW,
    },
  };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertLocalEmulators(): void {
  const required = [
    ['FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST],
    ['FIREBASE_AUTH_EMULATOR_HOST', process.env.FIREBASE_AUTH_EMULATOR_HOST],
  ] as const;
  for (const [name, value] of required) {
    if (!value || !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(value)) {
      throw new Error(`${name} must point to a loopback Firebase Emulator host. Refusing to seed.`);
    }
  }
}

seedDemo().catch((error) => {
  console.error('[seed:demo] failed:', error);
  process.exitCode = 1;
});
