import { createHash } from 'node:crypto';
import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  STERAS_TEST_ACCOUNT_EMAILS,
  STERAS_TEST_ADMIN_EMAILS,
  STERAS_TEST_DATASET_ID,
  STERAS_TEST_EVENT_IDS,
  STERAS_TEST_RETIRED_EVENT_IDS,
  STERAS_TEST_EVENTS,
  STERAS_TEST_SHARED_PROJECT_ID,
  type SterasTestEventId,
} from '@shared/sterasTestFixtures';
import {
  ASSESSMENT_SCHEMA_VERSION,
  AuthorityScoreReview,
  AuthorityType,
  EventDetails,
  EventRecord,
  EventType,
  EventStatus,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  ResourceRecommendation,
  RiskAssessment,
  ProvisionalRiskAssessment,
  SCORE_REVIEW_SCHEMA_VERSION,
  M1_DOCUMENT_SCHEMA_VERSION,
  M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  M1_TEMPLATE_REGISTRY_VERSION,
} from '@shared/types';
import { createM1EvidenceManifestDraft } from '@shared/m1EvidenceContract';
import { m1CategoryForEventType, m1ScenarioTemplateIdFor } from '@shared/m1TemplateContract';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { buildAuthorityReviewState, buildOfficialAssessmentResult } from '../engines/authorityFinalisation';
import { computeResources } from '../engines/resourceCalculator';
import { validateAndCalculateProvisional } from '../engines/assessmentValidator';
import { computeCategoryBasedAssessment } from '../engines/ruleBased';
import { validateResourceRecommendation } from '../engines/resourceContract';
import { resourceDocumentId } from '../triggers/onEventCreated';
import { requiredAuthoritiesFor } from '../http/submitEvent';
import { STERAS_TEST_STATES, stateSlug, type SterasTestState } from '@shared/sterasTestFixtures';

export type SterasTestAction = 'dry-run' | 'apply' | 'verify' | 'cleanup';

const MANAGED_BY = 'seed:steras:test' as const;
const VERSION_ID = 'v1';
const STORAGE_BUCKET = process.env.STERAS_TEST_STORAGE_BUCKET
  ?? `${STERAS_TEST_SHARED_PROJECT_ID}.firebasestorage.app`;

const PLAYWRIGHT_AUTHORITIES: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM', 'DBKL'];

interface ManagedMarker {
  datasetId: typeof STERAS_TEST_DATASET_ID;
  managedBy: typeof MANAGED_BY;
  fixtureId?: string;
}

interface Identity {
  key: string;
  email: string;
  name: string;
  role: 'admin' | 'organizer' | 'public' | 'authority';
  authorityType?: AuthorityType;
  state?: SterasTestState;
}

interface IdentityUids {
  admin: string;
  organizer: string;
  public: string;
  authorities: Record<string, string>;
}

interface Scenario {
  id: SterasTestEventId;
  name: string;
  state: SterasTestState;
  eventType: EventType;
  recordKind: 'initial' | 'manual';
  status: EventStatus;
  requiredAuthorities: AuthorityType[];
  reviewStage?: 'initial' | 'authority' | 'second' | 'manual' | 'closed' | null;
  complianceStatus?: 'pass' | 'review_required' | 'blocked';
  assessmentReadiness?: 'complete' | 'provisional' | 'insufficient_data';
  assignments?: 'none' | 'pending' | 'partial' | 'complete';
  controls?: 'none' | 'stage1' | 'stage2';
  finalDecision?: 'Rejected';
}

const STATE_EVENT_TYPES: Array<[SterasTestState, EventType, EventType]> = [
  ['Johor', 'concert', 'festival'], ['Kedah', 'sports', 'cultural'], ['Kelantan', 'religious', 'exhibition'],
  ['Melaka', 'fair', 'conference'], ['Negeri Sembilan', 'other', 'concert'], ['Pahang', 'festival', 'sports'],
  ['Penang', 'cultural', 'religious'], ['Perak', 'exhibition', 'fair'], ['Perlis', 'conference', 'other'],
  ['Sabah', 'concert', 'festival'], ['Sarawak', 'sports', 'cultural'], ['Selangor', 'religious', 'exhibition'],
  ['Terengganu', 'fair', 'conference'], ['Kuala Lumpur', 'other', 'concert'], ['Labuan', 'festival', 'sports'],
  ['Putrajaya', 'cultural', 'religious'],
];

const workflowOverrides: Record<string, Partial<Scenario>> = {
  [STERAS_TEST_EVENTS.draftPrimary]: { status: 'Draft', requiredAuthorities: [], reviewStage: null, assignments: 'none' },
  [STERAS_TEST_EVENTS.draftSecondary]: { status: 'Draft', requiredAuthorities: [], reviewStage: null, assignments: 'none' },
  [STERAS_TEST_EVENTS.complianceBlocked]: { status: 'UnderReview', complianceStatus: 'blocked', reviewStage: 'authority', assignments: 'pending' },
  [STERAS_TEST_EVENTS.provisionalReview]: { requiredAuthorities: ['PDRM', 'BOMBA'], assessmentReadiness: 'provisional', reviewStage: 'manual' },
  [STERAS_TEST_EVENTS.awaitingAssignment]: { reviewStage: 'initial' },
  [STERAS_TEST_EVENTS.authorityPartial]: { reviewStage: 'authority', assignments: 'partial' },
  [STERAS_TEST_EVENTS.secondReview]: { reviewStage: 'second', assignments: 'complete' },
  [STERAS_TEST_EVENTS.rejected]: { reviewStage: 'closed', assignments: 'complete', finalDecision: 'Rejected' },
  [STERAS_TEST_EVENTS.secondReviewRejected]: { reviewStage: 'closed', assignments: 'complete', finalDecision: 'Rejected' },
  // These two fixtures are already approved so manual testers can open the
  // control and public Stage 2 workflows immediately after seeding.
  [STERAS_TEST_EVENTS.controlVerification]: { status: 'Approved', reviewStage: null, assignments: 'complete', controls: 'stage1' },
  [STERAS_TEST_EVENTS.controlVerificationSecondary]: { status: 'Approved', reviewStage: null, assignments: 'complete', controls: 'stage1' },
  [STERAS_TEST_EVENTS.publicStage2Secondary]: { status: 'Approved', reviewStage: null, assignments: 'complete', controls: 'stage2' },
  [STERAS_TEST_EVENTS.publicStage2]: { status: 'Approved', reviewStage: null, assignments: 'complete', controls: 'stage2' },
};

const SCENARIOS: Scenario[] = STATE_EVENT_TYPES.flatMap(([state, firstType, secondType]) => [firstType, secondType].map((eventType, index) => {
  const id = `steras-test-${stateSlug(state)}-${String(index + 1).padStart(2, '0')}` as SterasTestEventId;
  const recordKind = index === 0 ? 'initial' : 'manual';
  const base: Scenario = {
    id,
    state,
    eventType,
    recordKind,
    name: `${state} ${eventType} application ${index + 1}`,
    status: recordKind === 'initial' ? 'Pending' : 'Manual Review Required',
    requiredAuthorities: requiredAuthoritiesFor({
      name: 'STERAS test event', type: eventType, venueName: `STERAS ${state} venue`, venueAddress: `${state}, Malaysia`,
      venueCapacity: 10_000, expectedAttendance: 3_000, environment: 'outdoor', coverage: 'partially_covered', seating: 'mixed',
      startDatetime: Date.now() + 86_400_000, endDatetime: Date.now() + 90_000_000, emergencyPlanSummary: 'Complete emergency plan.',
      organizerName: 'Organizer 1', organizerEmail: 'organizer1@steras.test', organizerPhone: '+60 12-000 0001',
    }),
    reviewStage: recordKind === 'initial' ? 'initial' : 'manual',
    assessmentReadiness: recordKind === 'initial' ? 'complete' : 'insufficient_data',
  };
  return { ...base, ...(workflowOverrides[id] ?? {}) };
}));

const IDENTITIES: Identity[] = [
  { key: 'admin', email: STERAS_TEST_ACCOUNT_EMAILS.admin, name: 'Admin 1', role: 'admin' },
  { key: 'admin2', email: STERAS_TEST_ADMIN_EMAILS.admin2, name: 'Admin 2', role: 'admin' },
  { key: 'admin3', email: STERAS_TEST_ADMIN_EMAILS.admin3, name: 'Admin 3', role: 'admin' },
  { key: 'organizer', email: STERAS_TEST_ACCOUNT_EMAILS.organizer, name: 'Organizer 1', role: 'organizer' },
  { key: 'public', email: STERAS_TEST_ACCOUNT_EMAILS.public, name: 'Public User 1', role: 'public' },
  ...STERAS_TEST_STATES.flatMap((state) => (['PDRM', 'BOMBA', 'KKM'] as AuthorityType[]).map((authorityType) => ({
    key: `${authorityType}:${state}`,
    email: `${authorityType.toLowerCase()}.${stateSlug(state)}@steras.test`,
    name: `${authorityType} Officer (${state})`,
    role: 'authority' as const,
    authorityType,
    state,
  }))),
  { key: 'DBKL:Kuala Lumpur', email: STERAS_TEST_ACCOUNT_EMAILS.DBKL, name: 'DBKL Officer (Kuala Lumpur)', role: 'authority', authorityType: 'DBKL', state: 'Kuala Lumpur' },
  ...STERAS_TEST_STATES.filter((state) => STATE_EVENT_TYPES.find(([candidate]) => candidate === state)?.slice(1).some((type) => ['festival', 'cultural', 'religious'].includes(type))).map((state) => ({
    key: `MOTAC:${state}`,
    email: `motac.${stateSlug(state)}@steras.test`,
    name: `MOTAC Officer (${state})`,
    role: 'authority' as const,
    authorityType: 'MOTAC' as const,
    state,
  })),
];

export interface SterasTestContext {
  projectId: string;
  db: Firestore;
  auth: Auth;
  app: App;
  password: string;
}

export function parseSterasTestAction(argv: string[]): SterasTestAction {
  const flags = argv.filter((value) => ['--dry-run', '--apply', '--verify', '--cleanup'].includes(value));
  if (flags.length !== 1) {
    throw new Error('Choose exactly one action: --dry-run, --apply, --verify, or --cleanup.');
  }
  return flags[0].slice(2) as SterasTestAction;
}

export function assertSharedProjectAuthorization(projectId: string, action: SterasTestAction): void {
  if (projectId !== STERAS_TEST_SHARED_PROJECT_ID) {
    throw new Error(`Refusing target ${projectId}. This dataset is locked to ${STERAS_TEST_SHARED_PROJECT_ID}.`);
  }
  if (['apply', 'cleanup'].includes(action) && process.env.STERAS_TEST_ALLOW_SHARED_PROJECT !== 'true') {
    throw new Error('Set STERAS_TEST_ALLOW_SHARED_PROJECT=true to authorize writes to the shared linkos project.');
  }
  if (action === 'cleanup' && process.env.STERAS_TEST_CONFIRM_DATASET !== STERAS_TEST_DATASET_ID) {
    throw new Error(`Set STERAS_TEST_CONFIRM_DATASET=${STERAS_TEST_DATASET_ID} before cleanup.`);
  }
}

export function initializeSterasTestContext(): SterasTestContext {
  const projectId = (process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? '').trim();
  if (!projectId) throw new Error('Set FIREBASE_PROJECT_ID explicitly.');
  const app = getApps()[0] ?? initializeApp({
    credential: applicationDefault(),
    projectId,
    storageBucket: STORAGE_BUCKET,
  });
  return {
    projectId,
    app,
    db: getFirestore(app),
    auth: getAuth(app),
    password: process.env.STERAS_TEST_PASSWORD?.trim() ?? process.env.STERAS_E2E_PASSWORD?.trim() ?? '',
  };
}

function marker(fixtureId?: string): ManagedMarker {
  return { datasetId: STERAS_TEST_DATASET_ID, managedBy: MANAGED_BY, ...(fixtureId ? { fixtureId } : {}) };
}

function isManaged(data: FirebaseFirestore.DocumentData | undefined, fixtureId?: string): boolean {
  const value = data?.sterasTest as Partial<ManagedMarker> | undefined;
  return value?.datasetId === STERAS_TEST_DATASET_ID
    && value?.managedBy === MANAGED_BY
    && (!fixtureId || value.fixtureId === fixtureId);
}

async function findAuthUser(auth: Auth, email: string) {
  try {
    return await withTransientAuthRetry(() => auth.getUserByEmail(email));
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') return null;
    throw error;
  }
}

async function withTransientAuthRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const delayMs of [0, 500, 1_500]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string }).code ?? '';
      const message = error instanceof Error ? error.message : String(error);
      const transient = code === 'app/unable-to-parse-response'
        || code === 'auth/internal-error'
        || /status code:\s*"?5\d\d|\b50[234]\b/i.test(message);
      if (!transient) throw error;
    }
  }
  throw lastError;
}

async function assertNoCollisions(ctx: SterasTestContext): Promise<void> {
  for (const eventId of [...STERAS_TEST_EVENT_IDS, ...STERAS_TEST_RETIRED_EVENT_IDS]) {
    const snap = await ctx.db.collection('events').doc(eventId).get();
    if (snap.exists && !isManaged(snap.data(), eventId)) {
      throw new Error(`Collision at events/${eventId}: existing document is not owned by ${STERAS_TEST_DATASET_ID}.`);
    }
    const evidenceFile = getStorage(ctx.app).bucket().file(`event_documents/${eventId}/${VERSION_ID}/evidence.pdf`);
    const [evidenceExists] = await evidenceFile.exists();
    if (evidenceExists) {
      const [metadata] = await evidenceFile.getMetadata();
      if (metadata.metadata?.datasetId !== STERAS_TEST_DATASET_ID
        || metadata.metadata?.managedBy !== MANAGED_BY
        || metadata.metadata?.fixtureId !== eventId) {
        throw new Error(`Collision at ${evidenceFile.name}: existing file is not owned by ${STERAS_TEST_DATASET_ID}.`);
      }
    }
  }
  for (const identity of IDENTITIES) {
    const authUser = await findAuthUser(ctx.auth, identity.email);
    if (!authUser) continue;
    const profile = await ctx.db.collection('users').doc(authUser.uid).get();
    if (!profile.exists || !isManaged(profile.data(), identity.email)) {
      throw new Error(`Collision for Auth identity ${identity.email}: its profile is not owned by ${STERAS_TEST_DATASET_ID}.`);
    }
  }
}

async function ensureIdentities(ctx: SterasTestContext): Promise<IdentityUids> {
  if (ctx.password.length < 12) throw new Error('Set STERAS_TEST_PASSWORD to at least 12 characters.');
  const now = Date.now();
  const uids: IdentityUids = { admin: '', organizer: '', public: '', authorities: {} };
  for (const identity of IDENTITIES) {
    let authUser = await findAuthUser(ctx.auth, identity.email);
    if (!authUser) {
      authUser = await withTransientAuthRetry(() => ctx.auth.createUser({ email: identity.email, password: ctx.password, displayName: identity.name }));
    } else {
      await withTransientAuthRetry(() => ctx.auth.updateUser(authUser!.uid, { password: ctx.password, displayName: identity.name, disabled: false }));
    }
    if (identity.key === 'admin') uids.admin = authUser.uid;
    else if (identity.key === 'organizer') uids.organizer = authUser.uid;
    else if (identity.key === 'public') uids.public = authUser.uid;
    else uids.authorities[identity.key] = authUser.uid;
    await ctx.db.collection('users').doc(authUser.uid).set({
      uid: authUser.uid,
      email: identity.email,
      name: identity.name,
      role: identity.role,
      ...(identity.authorityType ? { authorityType: identity.authorityType } : {}),
      sterasTest: marker(identity.email),
      createdAt: now,
      updatedAt: now,
    });
    if (identity.authorityType) {
      await ctx.db.collection('officers').doc(authUser.uid).set({
        uid: authUser.uid,
        authorityType: identity.authorityType,
        state: identity.state ?? 'Federal',
        scopeType: identity.state ? 'state' : 'federal',
        workloadCount: 0,
        workloadLimit: 20,
        active: true,
        sterasTest: marker(identity.email),
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return uids;
}

/**
 * Playwright reset helpers run between individual tests. They must not
 * rewrite all 64 state-scoped Auth profiles on every reset (that can exceed
 * Playwright's 60-second hook timeout). The global prepare step already
 * validated and created the full identity set, so these helpers only read the
 * seven canonical accounts used by the browser suite.
 */
async function loadPlaywrightIdentityUids(ctx: SterasTestContext): Promise<IdentityUids> {
  const entries = await Promise.all([
    ['admin', STERAS_TEST_ACCOUNT_EMAILS.admin],
    ['organizer', STERAS_TEST_ACCOUNT_EMAILS.organizer],
    ['public', STERAS_TEST_ACCOUNT_EMAILS.public],
    ...(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'] as const).map((authority) => [authority, STERAS_TEST_ACCOUNT_EMAILS[authority]] as const),
    ...(['PDRM', 'BOMBA', 'KKM'] as const).flatMap((authority) => [
      [`${authority}:Kuala Lumpur`, `${authority.toLowerCase()}.kuala-lumpur@steras.test`] as const,
      [`${authority}:Kedah`, `${authority.toLowerCase()}.kedah@steras.test`] as const,
    ]),
  ].map(async ([key, email]) => [key, (await ctx.auth.getUserByEmail(email)).uid] as const));
  const byKey = Object.fromEntries(entries) as Record<string, string>;
  const uids: IdentityUids = { admin: byKey.admin, organizer: byKey.organizer, public: byKey.public, authorities: {} };
  for (const authority of ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'] as const) {
    uids.authorities[authority] = byKey[authority];
    uids.authorities[`${authority}:Selangor`] = byKey[authority];
    if (authority === 'DBKL') uids.authorities[`${authority}:Kuala Lumpur`] = byKey[authority];
  }
  for (const authority of ['PDRM', 'BOMBA', 'KKM'] as const) {
    uids.authorities[`${authority}:Kuala Lumpur`] = byKey[`${authority}:Kuala Lumpur`];
    uids.authorities[`${authority}:Kedah`] = byKey[`${authority}:Kedah`];
  }
  return uids;
}

function authorityUid(uids: IdentityUids, authority: AuthorityType, state?: string): string {
  const stateKey = state ? `${authority}:${state}` : undefined;
  return (stateKey && uids.authorities[stateKey])
    || uids.authorities[authority]
    || uids.authorities[`${authority}:Selangor`]
    || uids.authorities[`${authority}:Kuala Lumpur`]
    || '';
}

function processingHash(versionInputHash: string): string {
  return createHash('sha256').update(JSON.stringify({
    versionInputHash,
    categorySchemaVersion: '2026-07-24-all-hazards-v2',
    scoringLogicVersion: '2026-07-24-hirarc-residual-v2',
    promptVersion: 'v4.0.0-all-hazards-evidence-advisory',
    aiResponseSchemaVersion: '2026-07-24-all-hazards-advisory-v2',
    formulaVersion: '2026-07-24-prototype-range-v3',
    guidelineVersion: '2026-07-24-malaysia-research-v2',
  })).digest('hex');
}

function venueForState(state: SterasTestState) {
  const index = STERAS_TEST_STATES.indexOf(state);
  return {
    venueId: `steras-test-venue-${stateSlug(state)}`,
    venueName: `STERAS Test Venue (${state})`,
    venueAddress: `STERAS Test Venue, ${state}, Malaysia`,
    venueLocation: { lat: 1.5 + index * 0.2, lng: 100.2 + index * 0.45 },
    venueCapacity: 12_000 + index * 500,
    jurisdiction: state === 'Kuala Lumpur' ? 'DBKL' : `${state} PBT`,
  };
}

function eventDetails(scenario: Scenario, now: number): EventDetails {
  const venue = venueForState(scenario.state);
  return {
    name: `STERAS Test · ${scenario.name}`,
    type: scenario.eventType,
    ...venue,
    expectedAttendance: Math.min(4_000 + STERAS_TEST_STATES.indexOf(scenario.state) * 100, venue.venueCapacity),
    environment: 'outdoor',
    coverage: 'partially_covered',
    seating: 'mixed',
    startDatetime: now + 30 * 24 * 60 * 60 * 1000,
    endDatetime: now + 30 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000,
    description: `Deterministic STERAS Module 3 test application for ${scenario.state}. Do not use as operational data.`,
    emergencyPlanSummary: 'Synthetic emergency, evacuation, medical, traffic and authority coordination plan.',
    riskProfile: {
      crowdManagementPlan: true,
      trafficManagementPlan: true,
      severeWeatherPlan: true,
      medicalPlan: true,
      evacuationPlanTested: true,
      authorityCoordinationConfirmed: true,
    },
    organizerName: 'Organizer 1',
    organizerEmail: STERAS_TEST_ACCOUNT_EMAILS.organizer,
    organizerPhone: '+60 12-000 0303',
  };
}

function assessmentContext(scenario: Scenario, now: number) {
  const venue = venueForState(scenario.state);
  return {
    weather: {
      data: { forecast: 'Partly cloudy', temperature: 31, humidity: 75, windSpeed: 12, precipitationProbability: 20, severeAlert: false },
      measurementStatus: 'available' as const,
      source: 'openweather' as const,
      freshness: 'fresh' as const,
      fetchedAt: now,
      expiresAt: now + 21_600_000,
      forecastFor: now + 3_600_000,
    },
    calendar: {
      localDate: new Date(now).toISOString().slice(0, 10),
      dayOfWeek: 'Saturday',
      isWeekend: true,
      isHolidayOrAdjacent: false,
      sourceVersion: 'steras-test-v1',
      sourceTimestamp: now,
      coverageStatus: 'verified' as const,
    },
    venue: {
      matched: true,
      venueId: venue.venueId,
      submittedCapacity: venue.venueCapacity,
      registeredCapacity: venue.venueCapacity,
      capacityDifference: 0,
      jurisdiction: venue.jurisdiction,
      fireCertificateStatus: 'valid' as const,
      fireCertificateExpiresAt: now + 31_536_000_000,
      emergencyAccessVerified: true,
      nearestHospitalTravelMinutes: 10,
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

function uatProposal(baseline: ReturnType<typeof computeCategoryBasedAssessment>, scenario: Scenario, now: number) {
  const evidenceByCategory: Record<string, string> = {
    crowd: 'crowd', venue_fire: 'venue', weather_environment: 'weather', public_health: 'crowd',
    food_water_sanitation: 'venue', medical_capacity: 'venue', security_cbrn: 'crowd', transport_accessibility: 'venue',
  };
  return {
    status: 'success' as const,
    proposalId: `steras-test-proposal-${scenario.id}`,
    model: 'steras-test-fixture',
    promptVersion: 'steras-test-v1',
    responseSchemaVersion: 'steras-test-v1',
    hazards: [],
    categories: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
      categoryId: category.id,
      likelihood: 2 as const,
      severity: 2 as const,
      evidenceReferences: [evidenceByCategory[category.id] as never],
      rationale: `Deterministic STERAS test evidence for ${category.name}.`,
      confidence: 'high' as const,
      concerns: [],
      missingInformation: [],
    })),
    cacheStatus: 'not-applicable' as const,
    generatedAt: now,
  };
}

function buildAssessmentArtifacts(
  scenario: Scenario,
  event: EventRecord,
  uids: IdentityUids,
  now: number,
  evidenceGeneration: string,
): { assessment: RiskAssessment; resource: ResourceRecommendation; reviews: AuthorityScoreReview[] } {
  const assessmentId = `assessment-${VERSION_ID}-${scenario.id}`;
  const context = assessmentContext(scenario, now);
  const baseline = computeCategoryBasedAssessment(event, context, now);
  const proposal = uatProposal(baseline, scenario, now);
  const validation = validateAndCalculateProvisional(proposal, baseline, now);
  if (!validation.ok) throw new Error(`Unable to create M2 STERAS test assessment: ${validation.reason}`);
  const common = {
    assessmentId,
    eventId: scenario.id,
    versionId: VERSION_ID,
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    contextSnapshot: context,
    evidence: baseline.evidence,
    contextEvidence: [{ evidenceId: `steras-test-${scenario.id}-context`, evidenceKey: 'compliance' as const, sourceKind: 'submitted_document' as const, sourceLocator: `event_documents/${scenario.id}/${VERSION_ID}/evidence.pdf`, retrievedAt: now, sourceVersion: `storage-generation:${evidenceGeneration}`, eligibility: 'eligible' as const, synthetic: true, visibility: 'authority_only' as const }],
    sourceTimestamps: { weather: now, holiday: now, venue: now, incidents: now },
    contextStatuses: { weather: 'steras-test:matched', holiday: 'steras-test:verified', venue: 'matched', incidents: 'unmatched' },
    assessmentReadiness: scenario.assessmentReadiness ?? 'complete',
    complianceStatus: scenario.complianceStatus ?? 'pass',
    complianceChecks: baseline.complianceChecks ?? [],
    dataConfidenceScore: baseline.dataConfidenceScore ?? 100,
    dataConfidenceLevel: baseline.dataConfidenceLevel ?? 'high',
    inputHash: processingHash(`${STERAS_TEST_DATASET_ID}:${scenario.id}:${VERSION_ID}`),
    createdAt: now,
  };
  if (scenario.recordKind === 'manual') {
    const manualAssessment = {
      ...common,
      status: 'manual_review_required' as const,
      aiProposal: null,
      warnings: [{ warningId: `steras-test-${scenario.id}-manual`, code: 'missing_evidence' as const, message: 'STERAS test manual-review fixture.', evidenceReferences: [] }],
      authorityReviewRequired: true as const,
      manualReviewReason: `STERAS test application requires Admin manual review (${scenario.state}).`,
      assessmentReadiness: 'insufficient_data' as const,
      sterasTest: marker(scenario.id),
    } as unknown as RiskAssessment;
    const calculation = computeResources({ eventId: scenario.id, versionId: VERSION_ID, assessmentId, eventDetails: event.eventDetails, assessmentResult: validation.result });
    if (!calculation.ok) throw new Error(calculation.message);
    return { assessment: manualAssessment, resource: provisionalResource(scenario, assessmentId, calculation, now), reviews: [] };
  }

  const reviews = scenario.requiredAuthorities.map((authority) => ({
    reviewId: `${assessmentId}-${authority}-review`,
    schemaVersion: SCORE_REVIEW_SCHEMA_VERSION,
    eventId: scenario.id,
    versionId: VERSION_ID,
    assessmentId,
    proposalId: validation.result.proposalId,
    provisionalCalculatedAt: now,
    assessmentInputHash: common.inputHash,
    categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    authorityType: authority,
    reviewerId: authorityUid(uids, authority, scenario.state),
    categories: proposal.categories.map((category) => ({ categoryId: category.categoryId, likelihood: category.likelihood, severity: category.severity, decision: 'confirmed' as const })),
    rationale: `STERAS test ${authority} review confirms the current assessment evidence.`,
    idempotencyKey: `${assessmentId}-${authority}-review-key`,
    createdAt: now,
  })) as AuthorityScoreReview[];
  const provisional = {
    ...common,
    status: 'authority_review' as const,
    aiProposal: proposal,
    warnings: validation.warnings,
    authorityReviewRequired: true as const,
    provisionalResult: validation.result,
  } as unknown as ProvisionalRiskAssessment;
  const officialResult = buildOfficialAssessmentResult({
    assessment: provisional,
    eventDetails: event.eventDetails,
    requiredAuthorities: scenario.requiredAuthorities,
    reviews,
    finalizedAt: now,
    finalizedBy: uids.admin,
  });
  const officialAssessment = {
    ...provisional,
    status: 'official_ready' as const,
    authorityReviewRequired: false as const,
    authorityReviewState: buildAuthorityReviewState(scenario.requiredAuthorities, reviews, now),
    officialResult,
    sterasTest: marker(scenario.id),
  } as unknown as RiskAssessment;
  const calculation = computeResources({ eventId: scenario.id, versionId: VERSION_ID, assessmentId, eventDetails: event.eventDetails, assessmentResult: officialResult });
  if (!calculation.ok) throw new Error(calculation.message);
  return { assessment: officialAssessment, resource: officialResource(scenario, assessmentId, calculation, uids.admin, now), reviews };
}

function provisionalResource(scenario: Scenario, assessmentId: string, calculation: Extract<ReturnType<typeof computeResources>, { ok: true }>, now: number): ResourceRecommendation {
  return {
    resourceId: resourceDocumentId('provisional', VERSION_ID, calculation.resourceInputHash),
    eventId: scenario.id,
    versionId: VERSION_ID,
    assessmentId,
    schemaVersion: RESOURCE_SCHEMA_VERSION,
    stage: 'provisional',
    revision: 1,
    supersedesResourceId: null,
    assessmentReference: { stage: 'provisional', assessmentId, proposalId: `steras-test-proposal-${scenario.id}` },
    resourceInputHash: calculation.resourceInputHash,
    formulaVersion: calculation.formulaVersion,
    configVersion: calculation.configVersion,
    sourceRegistryVersion: calculation.sourceRegistryVersion,
    items: calculation.items,
    confidenceLevel: 'prototype',
    authorityReviewRequired: true,
    validationScope: 'provisional_risk_input',
    notes: 'STERAS test fixture; not an operational deployment authorisation.',
    computedAt: now,
  };
}

function officialResource(scenario: Scenario, assessmentId: string, calculation: Extract<ReturnType<typeof computeResources>, { ok: true }>, finalizedBy: string, now: number): ResourceRecommendation {
  return {
    resourceId: resourceDocumentId('official', VERSION_ID, calculation.resourceInputHash),
    eventId: scenario.id,
    versionId: VERSION_ID,
    assessmentId,
    schemaVersion: RESOURCE_SCHEMA_VERSION,
    stage: 'official',
    revision: 1,
    supersedesResourceId: null,
    assessmentReference: { stage: 'official', assessmentId, proposalId: `steras-test-proposal-${scenario.id}`, finalizedAt: now, finalizedBy },
    resourceInputHash: calculation.resourceInputHash,
    formulaVersion: calculation.formulaVersion,
    configVersion: calculation.configVersion,
    sourceRegistryVersion: calculation.sourceRegistryVersion,
    items: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, { ...calculation.items[key], confidence: 'authority_validated' as const, authorityReviewRequired: false }])) as ResourceRecommendation['items'],
    confidenceLevel: 'authority_validated',
    authorityReviewRequired: false,
    validationScope: 'official_risk_input_only',
    notes: 'STERAS test fixture; not an operational deployment authorisation.',
    computedAt: now,
  };
}

function assignmentDecision(authority: AuthorityType, scenario: Scenario) {
  if (scenario.assignments === 'complete') {
    if (scenario.finalDecision === 'Rejected' && authority === 'PDRM') return 'Rejected';
    return 'Approved';
  }
  if (scenario.assignments === 'partial' && authority === 'PDRM') return 'Approved';
  return undefined;
}

async function writeScenario(ctx: SterasTestContext, scenario: Scenario, uids: IdentityUids): Promise<void> {
  const now = Date.now();
  const details = eventDetails(scenario, now);
  const eventRef = ctx.db.collection('events').doc(scenario.id);
  if (scenario.status === 'Draft') {
    const eventCategory = m1CategoryForEventType(scenario.eventType);
    const scenarioTemplateId = m1ScenarioTemplateIdFor(eventCategory, 'outdoor_fixed_site');
    const batch = ctx.db.batch();
    batch.set(eventRef, {
      eventId: scenario.id,
      organizerId: uids.organizer,
      eventDetails: details,
      templateSelection: {
        eventCategory,
        venueSetting: 'outdoor_fixed_site',
        coreTemplateId: 'STERAS-CORE',
        scenarioTemplateId,
        templateRegistryVersion: M1_TEMPLATE_REGISTRY_VERSION,
        selectedAt: now,
      },
      status: 'Draft',
      currentVersionNumber: 0,
      editableVersionId: VERSION_ID,
      draftDocumentPaths: [],
      draftDocuments: [],
      documentSchemaVersion: M1_DOCUMENT_SCHEMA_VERSION,
      draftEvidenceManifest: createM1EvidenceManifestDraft(scenarioTemplateId, details.riskProfile),
      evidenceManifestSchemaVersion: M1_EVIDENCE_MANIFEST_SCHEMA_VERSION,
      requiredAuthorities: [],
      assignedOfficerUids: [],
      assignedOfficerByAuthority: {},
      controlListGenerated: false,
      createdAt: now,
      updatedAt: now,
      sterasTest: marker(scenario.id),
    });
    batch.set(eventRef.collection('audit_logs').doc('steras-test-draft-seeded'), {
      id: 'steras-test-draft-seeded', eventId: scenario.id, action: 'steras_test_draft_seeded',
      actorId: 'system', actorRole: 'system', timestamp: now, sterasTest: marker(scenario.id),
    });
    await batch.commit();
    return;
  }
  const evidencePath = `event_documents/${scenario.id}/${VERSION_ID}/evidence.pdf`;
  const evidenceFile = getStorage(ctx.app).bucket().file(evidencePath);
  await evidenceFile.save(Buffer.from('%PDF-1.4\nSTERAS test evidence\n%%EOF\n'), {
    resumable: false,
    metadata: {
      contentType: 'application/pdf',
      metadata: { datasetId: STERAS_TEST_DATASET_ID, managedBy: MANAGED_BY, fixtureId: scenario.id },
    },
  });
  const [evidenceMetadata] = await evidenceFile.getMetadata();
  const evidenceGeneration = String(evidenceMetadata.generation ?? '');
  if (!/^\d+$/.test(evidenceGeneration)) throw new Error(`Storage generation missing for ${evidencePath}.`);
  const assigned = scenario.assignments && scenario.assignments !== 'none'
    ? scenario.requiredAuthorities
    : [];
  const assignedOfficerByAuthority = Object.fromEntries(assigned.map((authority) => [authority, authorityUid(uids, authority, scenario.state)]));
  const eventBase = {
    eventId: scenario.id,
    organizerId: uids.organizer,
    eventDetails: details,
    status: scenario.status,
    currentVersionId: VERSION_ID,
    currentVersionNumber: 1,
    editableVersionId: null,
    draftDocumentPaths: [],
    requiredAuthorities: scenario.requiredAuthorities,
    assignedOfficerUids: assigned.map((authority) => authorityUid(uids, authority, scenario.state)),
    assignedOfficerByAuthority,
    reviewStage: scenario.reviewStage ?? null,
    controlListGenerated: scenario.controls === 'stage1' || scenario.controls === 'stage2',
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
    sterasTest: marker(scenario.id),
  } as unknown as EventRecord;
  const artifacts = buildAssessmentArtifacts(scenario, eventBase, uids, now, evidenceGeneration);
  const event: Record<string, unknown> = {
    ...eventBase,
    currentAssessmentId: artifacts.assessment.assessmentId,
    currentResourceId: artifacts.resource.resourceId,
  };
  if (scenario.status === 'Approved' || (scenario.reviewStage && ['authority', 'second', 'closed'].includes(scenario.reviewStage))) {
    event.initialReview = { decision: 'Approved', reason: 'STERAS test initial review approved.', reviewerUid: uids.admin, reviewedAt: now, manualAssessmentRecorded: scenario.assessmentReadiness === 'provisional' };
  }
  if (scenario.finalDecision) {
    event.secondReview = { confirmedDecision: scenario.finalDecision, reviewerUid: uids.admin, reviewedAt: now, adminNote: `STERAS test ${scenario.finalDecision} outcome.` };
  }
  const batch = ctx.db.batch();
  batch.set(eventRef, event);
  batch.set(eventRef.collection('versions').doc(VERSION_ID), { versionId: VERSION_ID, eventId: scenario.id, versionNumber: 1, eventDetails: details, documentPaths: [evidencePath], submittedBy: uids.organizer, submittedAt: now, inputHash: processingHash(`${STERAS_TEST_DATASET_ID}:${scenario.id}:version`), sterasTest: marker(scenario.id) });
  batch.set(eventRef.collection('assessments').doc(artifacts.assessment.assessmentId), artifacts.assessment);
  batch.set(eventRef.collection('resources').doc(artifacts.resource.resourceId), { ...artifacts.resource, sterasTest: marker(scenario.id) });
  for (const review of artifacts.reviews) {
    batch.set(eventRef.collection('assessments').doc(artifacts.assessment.assessmentId).collection('score_reviews').doc(review.reviewId), { ...review, sterasTest: marker(scenario.id) });
  }
  batch.set(eventRef.collection('audit_logs').doc('steras-test-seeded'), { id: 'steras-test-seeded', eventId: scenario.id, versionId: VERSION_ID, action: 'steras_test_seeded', actorId: 'system', actorRole: 'system', timestamp: now, notes: `Seeded ${STERAS_TEST_DATASET_ID}`, sterasTest: marker(scenario.id) });
  for (const authority of assigned) {
    const decision = assignmentDecision(authority, scenario);
    const assignmentId = `${VERSION_ID}_${authority}`;
    batch.set(eventRef.collection('assignments').doc(assignmentId), {
      assignmentId,
      eventId: scenario.id,
      versionId: VERSION_ID,
      authorityType: authority,
      officerUid: authorityUid(uids, authority, scenario.state),
      assignedBy: uids.admin,
      assignedAt: now,
      status: decision ? 'completed' : 'pending',
      ...(decision ? { decision, reason: `${authority} fixture proposal for ${scenario.name}.`, suggestion: decision === 'Approved' ? 'No change required.' : 'Revise the identified safety controls.', decidedAt: now, confirmedReview: decision === 'Approved' } : {}),
      sterasTest: marker(scenario.id),
    });
  }
  await batch.commit();
  if (scenario.controls) await writeControls(ctx, scenario, uids, now);
  if (scenario.status === 'Approved') await writePublicEvent(ctx, scenario, uids, now);
}

async function writeControls(ctx: SterasTestContext, scenario: Scenario, uids: IdentityUids, now: number): Promise<void> {
  const eventRef = ctx.db.collection('events').doc(scenario.id);
  const reportId = `${scenario.id}-report-001`;
  const m4TicketId = `${scenario.id}-m4-ticket-001`;
  const snapshots: Record<string, unknown>[] = [];
  for (const authority of scenario.requiredAuthorities) {
    const controlId = `${scenario.id}-ctrl-${authority.toLowerCase()}-v1`;
    const controlRef = eventRef.collection('event_controls').doc(controlId);
    const stage1Requirements = [
      { docType: 'application', label: `${authority} acknowledgement`, required: true },
      { docType: 'license', label: `${authority} operating licence`, required: true },
      { docType: 'insurance', label: 'Public liability insurance', required: true },
    ];
    await controlRef.set({
      controlId,
      eventId: scenario.id,
      versionId: VERSION_ID,
      controlName: `${authority} operational compliance`,
      authority,
      stageRequirement: 'stage1_and_stage2',
      stage1Requirements,
      stage2Requirement: { kind: 'image', label: `Photo of ${authority} control at venue` },
      controlItemVersion: 1,
      label: scenario.controls === 'stage2' ? 'approved' : authority === 'PDRM' ? 'resubmit_required' : authority === 'BOMBA' ? 'approved' : 'pending',
      createdAt: now,
      updatedAt: now,
      sterasTest: marker(scenario.id),
    });
    snapshots.push({ controlId, controlName: `${authority} operational compliance`, authority, stageRequirement: 'stage1_and_stage2', stage1RequirementsCount: 3, stage2Label: `Photo of ${authority} control at venue`, controlItemVersion: 1, label: scenario.controls === 'stage2' ? 'approved' : 'pending' });
    const stageBatch = ctx.db.batch();
    for (const requirement of stage1Requirements) {
      const docId = `${controlId}-s1-${requirement.docType}`;
      const status = scenario.controls === 'stage2' || authority === 'BOMBA'
        ? 'verified'
        : authority === 'PDRM' && requirement.docType === 'application'
          ? 'rejected'
          : 'pending_verification';
      stageBatch.set(controlRef.collection('stage1_docs').doc(docId), {
        docId,
        docType: requirement.docType,
        label: requirement.label,
        status,
        evidencePath: `events/${scenario.id}/controls/${controlId}/stage1/${docId}.pdf`,
        uploadedAt: now,
        ...(status === 'verified' ? { verifiedBy: authorityUid(uids, authority, scenario.state), verifiedAt: now } : {}),
        ...(status === 'rejected' ? { rejectionReason: 'Fixture rejection: document expired.', rejectionSuggestion: 'Upload a current document.', rejectedBy: authorityUid(uids, authority, scenario.state), rejectedAt: now } : {}),
        sterasTest: marker(scenario.id),
      });
    }
    if (scenario.controls === 'stage2') {
      const docId = `${controlId}-s2`;
      const imageUrl = `https://placehold.co/1200x800/png?text=${encodeURIComponent(`${authority}+STERAS+TEST`)}`;
      stageBatch.set(controlRef.collection('stage2_docs').doc(docId), { docId, imageUrl, uploadedAt: now, uploadedBy: uids.organizer, published: true, publishedAt: now, publishedBy: uids.admin, publicConfirmCount: authority === 'PDRM' ? 1 : 0, ...(authority === 'PDRM' ? { m4TicketId, reportedAt: now } : {}), sterasTest: marker(scenario.id) });
      stageBatch.set(ctx.db.collection('public_event_controls').doc(scenario.id).collection('items').doc(`${controlId}-stage2`), { publicControlId: `${controlId}-stage2`, eventId: scenario.id, versionId: VERSION_ID, controlId, docId, authority, controlName: `${authority} operational compliance`, stage2Label: `Photo of ${authority} control at venue`, imageUrl, publicConfirmCount: authority === 'PDRM' ? 1 : 0, reported: authority === 'PDRM', publishedAt: now, sanitized: true, sanitizedAt: now, sanitizedBy: uids.admin, sterasTest: marker(scenario.id) });
      if (authority === 'PDRM') {
        stageBatch.set(controlRef.collection('stage2_confirms').doc(uids.public), { uid: uids.public, confirmedAt: now, sterasTest: marker(scenario.id) });
        stageBatch.set(controlRef.collection('stage2_reports').doc(uids.public), { uid: uids.public, reportId, reportedAt: now, sterasTest: marker(scenario.id) });
      }
    }
    await stageBatch.commit();
  }
  await eventRef.set({ controlListGenerated: true, controlListSnapshot: snapshots, updatedAt: now }, { merge: true });
  if (scenario.controls === 'stage2') {
    await ctx.db.collection('public_event_controls').doc(scenario.id).set({ eventId: scenario.id, versionId: VERSION_ID, datasetId: STERAS_TEST_DATASET_ID, sterasTest: marker(scenario.id), updatedAt: now });
    await ctx.db.collection('public_reports').doc(reportId).set({ reportId, eventId: scenario.id, versionId: VERSION_ID, controlId: `${scenario.id}-ctrl-pdrm-v1`, docId: `${scenario.id}-ctrl-pdrm-v1-s2`, reporterUid: uids.public, reason: 'STERAS test report for M4 handoff testing.', status: 'open', outcome: 'under_review', m4TicketId, createdAt: now, sterasTest: marker(scenario.id) });
  }
}

async function writePublicEvent(ctx: SterasTestContext, scenario: Scenario, uids: IdentityUids, now: number): Promise<void> {
  const details = eventDetails(scenario, now);
  await ctx.db.collection('public_events').doc(scenario.id).set({ eventId: scenario.id, versionId: VERSION_ID, eventName: details.name, venueName: details.venueName, eventType: details.type, startDatetime: details.startDatetime, endDatetime: details.endDatetime, approvedBy: scenario.requiredAuthorities, publicStatus: 'approved', publishedBy: uids.admin, sterasTest: marker(scenario.id) });
}

async function deleteQuery(db: Firestore, query: FirebaseFirestore.Query): Promise<number> {
  const snap = await query.get();
  if (snap.empty) return 0;
  for (let offset = 0; offset < snap.docs.length; offset += 400) {
    const batch = db.batch();
    snap.docs.slice(offset, offset + 400).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  return snap.size;
}

async function clearManagedDataset(ctx: SterasTestContext, includeIdentities: boolean): Promise<void> {
  for (const eventId of [...STERAS_TEST_EVENT_IDS, ...STERAS_TEST_RETIRED_EVENT_IDS]) {
    const eventRef = ctx.db.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    const managedParent = eventSnap.exists && isManaged(eventSnap.data(), eventId);
    if (eventSnap.exists) {
      if (!managedParent) throw new Error(`Refusing to delete unowned events/${eventId}.`);
      await ctx.db.recursiveDelete(eventRef);
    }
    for (const collection of ['public_events', 'public_event_controls']) {
      const ref = ctx.db.collection(collection).doc(eventId);
      const snap = await ref.get();
      // Module 3 Functions can recreate these exact projections without the
      // fixture marker. They are safe to remove only when the exact parent
      // event was present and verified as dataset-owned above.
      if (snap.exists && !isManaged(snap.data(), eventId) && !managedParent) {
        throw new Error(`Refusing to delete unowned ${collection}/${eventId}.`);
      }
      if (snap.exists) await ctx.db.recursiveDelete(ref);
    }
    await deleteQuery(ctx.db, ctx.db.collection('notifications').where('eventId', '==', eventId));
    await deleteQuery(ctx.db, ctx.db.collection('public_reports').where('eventId', '==', eventId));
    await getStorage(ctx.app).bucket().deleteFiles({ prefix: `events/${eventId}/`, force: true }).catch((error: unknown) => {
      if ((error as { code?: number }).code !== 404) throw error;
    });
    const evidenceFile = getStorage(ctx.app).bucket().file(`event_documents/${eventId}/${VERSION_ID}/evidence.pdf`);
    const [evidenceExists] = await evidenceFile.exists();
    if (evidenceExists) {
      const [metadata] = await evidenceFile.getMetadata();
      if (metadata.metadata?.datasetId !== STERAS_TEST_DATASET_ID
        || metadata.metadata?.managedBy !== MANAGED_BY
        || metadata.metadata?.fixtureId !== eventId) {
        throw new Error(`Refusing to delete unowned ${evidenceFile.name}.`);
      }
      await evidenceFile.delete();
    }
  }
  if (!includeIdentities) return;
  for (const identity of IDENTITIES) {
    const authUser = await findAuthUser(ctx.auth, identity.email);
    if (!authUser) continue;
    const profileRef = ctx.db.collection('users').doc(authUser.uid);
    const profile = await profileRef.get();
    if (!profile.exists || !isManaged(profile.data(), identity.email)) throw new Error(`Refusing to delete unowned identity ${identity.email}.`);
    const officerRef = ctx.db.collection('officers').doc(authUser.uid);
    const officer = await officerRef.get();
    if (officer.exists) {
      if (!isManaged(officer.data(), identity.email)) throw new Error(`Refusing to delete unowned officer ${authUser.uid}.`);
      await officerRef.delete();
    }
    await profileRef.delete();
    await ctx.auth.deleteUser(authUser.uid);
  }
  for (const state of STERAS_TEST_STATES) {
    const venueId = venueForState(state).venueId;
    const venueRef = ctx.db.collection('venues').doc(venueId);
    const venue = await venueRef.get();
    if (venue.exists) {
      if (!isManaged(venue.data(), venueId)) throw new Error(`Refusing to delete unowned fixture venue ${venueId}.`);
      await venueRef.delete();
    }
  }
}

async function writeVenues(ctx: SterasTestContext): Promise<void> {
  const now = Date.now();
  const batch = ctx.db.batch();
  for (const state of STERAS_TEST_STATES) {
    const venue = venueForState(state);
    batch.set(ctx.db.collection('venues').doc(venue.venueId), {
      venueId: venue.venueId,
      name: venue.venueName,
      address: venue.venueAddress,
      state,
      location: venue.venueLocation,
      capacity: venue.venueCapacity,
      environment: 'outdoor',
      coverage: 'partially_covered',
      seating: 'mixed',
      jurisdiction: venue.jurisdiction,
      fireCertificateStatus: 'valid',
      fireCertificateExpiresAt: now + 31_536_000_000,
      emergencyAccessVerified: true,
      nearestHospitalTravelMinutes: 10 + STERAS_TEST_STATES.indexOf(state),
      active: true,
      createdAt: now,
      updatedAt: now,
      sterasTest: marker(venue.venueId),
    });
  }
  await batch.commit();
}

export async function applySterasTestDataset(ctx: SterasTestContext): Promise<void> {
  await assertNoCollisions(ctx);
  const uids = await ensureIdentities(ctx);
  // Resolve/update Auth before destructive fixture replacement. A transient
  // Identity Toolkit failure must leave the existing Firestore dataset intact.
  await clearManagedDataset(ctx, false);
  await writeVenues(ctx);
  for (const scenario of SCENARIOS) await writeScenario(ctx, scenario, uids);
}

export async function verifySterasTestDataset(ctx: SterasTestContext): Promise<void> {
  const failures: string[] = [];
  for (const scenario of SCENARIOS) {
    const eventRef = ctx.db.collection('events').doc(scenario.id);
    const event = await eventRef.get();
    const eventData = event.data() as Partial<EventRecord> | undefined;
    const assessmentId = eventData?.currentAssessmentId;
    const resourceId = eventData?.currentResourceId;
    const [version, assessmentSnap, resourceSnap, audits] = await Promise.all([
      eventRef.collection('versions').doc(VERSION_ID).get(),
      assessmentId ? eventRef.collection('assessments').doc(assessmentId).get() : Promise.resolve(undefined),
      resourceId ? eventRef.collection('resources').doc(resourceId).get() : Promise.resolve(undefined),
      eventRef.collection('audit_logs').limit(1).get(),
    ]);
    if (!event.exists || !isManaged(event.data(), scenario.id)) failures.push(`${scenario.id}: event missing or marker invalid`);
    const assessmentData = assessmentSnap?.data() as Partial<RiskAssessment> | undefined;
    const resourceData = resourceSnap?.data() as ResourceRecommendation | undefined;
    const evidencePath = `event_documents/${scenario.id}/${VERSION_ID}/evidence.pdf`;
    const evidenceFile = getStorage(ctx.app).bucket().file(evidencePath);
    const [evidenceExists] = await evidenceFile.exists();
    const evidenceMetadata = evidenceExists ? (await evidenceFile.getMetadata())[0] : undefined;
    const contextEvidence = assessmentData?.contextEvidence?.find((item) => item.sourceLocator === evidencePath);
    if (scenario.status === 'Draft') {
      if (eventData?.status !== 'Draft' || eventData.currentVersionNumber !== 0
        || eventData.editableVersionId !== VERSION_ID || eventData.currentVersionId !== undefined
        || eventData.currentAssessmentId !== undefined || eventData.currentResourceId !== undefined) {
        failures.push(`${scenario.id}: Draft event lifecycle fields are invalid`);
      }
      if (version.exists || assessmentSnap?.exists || resourceSnap?.exists || evidenceExists || audits.empty) {
        failures.push(`${scenario.id}: Draft fixture contains submitted or generated artifacts`);
      }
      continue;
    }
    if (!version.exists || !assessmentSnap?.exists || !resourceSnap?.exists || audits.empty) failures.push(`${scenario.id}: core subdocuments incomplete`);
    if (!evidenceExists
      || evidenceMetadata?.metadata?.datasetId !== STERAS_TEST_DATASET_ID
      || evidenceMetadata?.metadata?.managedBy !== MANAGED_BY
      || evidenceMetadata?.metadata?.fixtureId !== scenario.id
      || contextEvidence?.sourceVersion !== `storage-generation:${evidenceMetadata?.generation}`) {
      failures.push(`${scenario.id}: submitted evidence file or Storage generation provenance invalid`);
    }
    if (eventData?.organizerId === undefined || eventData?.currentVersionId !== VERSION_ID
      || !assessmentId || !resourceId || assessmentData?.assessmentId !== assessmentId
      || assessmentData?.eventId !== scenario.id || assessmentData?.versionId !== VERSION_ID
      || resourceData?.resourceId !== resourceId || resourceData?.eventId !== scenario.id
      || resourceData?.versionId !== VERSION_ID || resourceData?.assessmentId !== assessmentId
      || !resourceData || !validateResourceRecommendation(resourceData).ok) failures.push(`${scenario.id}: event references invalid current M2 pointers`);
    if (scenario.controls) {
      const controls = await eventRef.collection('event_controls').get();
      if (controls.size !== scenario.requiredAuthorities.length) failures.push(`${scenario.id}: expected ${scenario.requiredAuthorities.length} controls, found ${controls.size}`);
    }
    // Approved fixtures must expose the sanitized public event projection.
    // Playwright intentionally withdraws this projection while it resets the
    // control-verification event, so check the current status rather than the
    // baseline scenario status.
    if (eventData?.status === 'Approved') {
      const publicEvent = await ctx.db.collection('public_events').doc(scenario.id).get();
      if (!publicEvent.exists || !isManaged(publicEvent.data(), scenario.id)) failures.push(`${scenario.id}: approved public projection missing or marker invalid`);
    }
    if (eventData?.status === 'Approved' && scenario.controls === 'stage2') {
      const publicControls = ctx.db.collection('public_event_controls').doc(scenario.id);
      const [publicControl, items] = await Promise.all([publicControls.get(), publicControls.collection('items').get()]);
      if (!publicControl.exists || !isManaged(publicControl.data(), scenario.id) || items.size !== scenario.requiredAuthorities.length) {
        failures.push(`${scenario.id}: Stage 2 public projection incomplete`);
      }
    }
  }
  for (const identity of IDENTITIES) {
    const authUser = await findAuthUser(ctx.auth, identity.email);
    if (!authUser) failures.push(`Auth account missing: ${identity.email}`);
    else {
      const profile = await ctx.db.collection('users').doc(authUser.uid).get();
      if (!profile.exists || !isManaged(profile.data(), identity.email)) failures.push(`Profile missing or marker invalid: ${identity.email}`);
    }
  }
  for (const eventId of STERAS_TEST_RETIRED_EVENT_IDS) {
    if ((await ctx.db.collection('events').doc(eventId).get()).exists) failures.push(`${eventId}: retired fixture still exists`);
  }
  if (failures.length > 0) throw new Error(`STERAS test verification failed:\n- ${failures.join('\n- ')}`);
}

export async function prepareSterasTestForPlaywright(ctx: SterasTestContext): Promise<void> {
  await applySterasTestDataset(ctx);
  const now = Date.now();
  const adminUid = (await ctx.auth.getUserByEmail(STERAS_TEST_ACCOUNT_EMAILS.admin)).uid;
  const releaseForOfficerTests = async (eventId: SterasTestEventId, authorities: AuthorityType[]) => {
    const eventRef = ctx.db.collection('events').doc(eventId);
    const scenario = SCENARIOS.find((candidate) => candidate.id === eventId);
    if (!scenario) throw new Error(`Missing fixture scenario ${eventId}.`);
    const officerUids: Partial<Record<AuthorityType, string>> = {};
    for (const authority of authorities) {
      const email = authority === 'DBKL'
        ? STERAS_TEST_ACCOUNT_EMAILS.DBKL
        : `${authority.toLowerCase()}.${stateSlug(scenario.state)}@steras.test`;
      const user = await ctx.auth.getUserByEmail(email);
      officerUids[authority] = user.uid;
      const assignmentId = `${VERSION_ID}_${authority}`;
      await eventRef.collection('assignments').doc(assignmentId).set({ assignmentId, eventId, versionId: VERSION_ID, authorityType: authority, officerUid: user.uid, assignedBy: adminUid, assignedAt: now, status: 'pending', sterasTest: marker(eventId) });
    }
    await eventRef.set({ status: 'UnderReview', reviewStage: 'authority', initialReview: { decision: 'Approved', reason: 'Released for Playwright officer-gate coverage.', reviewerUid: adminUid, reviewedAt: now, manualAssessmentRecorded: eventId === STERAS_TEST_EVENTS.provisionalReview }, assignedOfficerUids: Object.values(officerUids), assignedOfficerByAuthority: officerUids, updatedAt: now }, { merge: true });
  };
  await releaseForOfficerTests(STERAS_TEST_EVENTS.provisionalReview, ['PDRM', 'BOMBA']);
  await releaseForOfficerTests(STERAS_TEST_EVENTS.controlVerification, PLAYWRIGHT_AUTHORITIES);
  const controls = await ctx.db.collection('events').doc(STERAS_TEST_EVENTS.controlVerification).collection('event_controls').get();
  for (const control of controls.docs) {
    const docs = await control.ref.collection('stage1_docs').get();
    const batch = ctx.db.batch();
    docs.docs.forEach((doc) => batch.set(doc.ref, { status: 'pending_verification', verifiedBy: null, verifiedAt: null, rejectionReason: '', updatedAt: now }, { merge: true }));
    if (!docs.empty) await batch.commit();
    await control.ref.set({ label: 'pending', updatedAt: now }, { merge: true });
  }
}

/** Rebuild only the Stage-1 verification fixture after another spec has
 * intentionally regenerated its control list. No other event is touched. */
export async function resetSterasTestControlVerificationForPlaywright(ctx: SterasTestContext): Promise<void> {
  const eventId = STERAS_TEST_EVENTS.controlVerification;
  const scenario = SCENARIOS.find((candidate) => candidate.id === eventId);
  if (!scenario) throw new Error(`Missing fixture scenario ${eventId}.`);
  const eventRef = ctx.db.collection('events').doc(eventId);
  const current = await eventRef.get();
  if (!current.exists || !isManaged(current.data(), eventId)) {
    throw new Error(`Refusing to reset unowned events/${eventId}.`);
  }

  await ctx.db.recursiveDelete(eventRef);
  const publicControlsRef = ctx.db.collection('public_event_controls').doc(eventId);
  if ((await publicControlsRef.get()).exists) await ctx.db.recursiveDelete(publicControlsRef);
  await ctx.db.collection('public_events').doc(eventId).delete().catch(() => undefined);
  await deleteQuery(ctx.db, ctx.db.collection('notifications').where('eventId', '==', eventId));
  await deleteQuery(ctx.db, ctx.db.collection('public_reports').where('eventId', '==', eventId));

  const identityUids = await loadPlaywrightIdentityUids(ctx);
  await writeScenario(ctx, scenario, identityUids);
  const now = Date.now();
  const assignedOfficerByAuthority: Partial<Record<AuthorityType, string>> = {};
  for (const authority of PLAYWRIGHT_AUTHORITIES) {
    const officerUid = authorityUid(identityUids, authority, scenario.state);
    assignedOfficerByAuthority[authority] = officerUid;
    const assignmentId = `${VERSION_ID}_${authority}`;
    await eventRef.collection('assignments').doc(assignmentId).set({
      assignmentId,
      eventId,
      versionId: VERSION_ID,
      authorityType: authority,
      officerUid,
      assignedBy: identityUids.admin,
      assignedAt: now,
      status: 'pending',
      sterasTest: marker(eventId),
    });
  }
  await eventRef.set({
    status: 'UnderReview',
    reviewStage: 'authority',
    initialReview: { decision: 'Approved', reason: 'Released for Playwright control-verification coverage.', reviewerUid: identityUids.admin, reviewedAt: now },
    assignedOfficerUids: Object.values(assignedOfficerByAuthority),
    assignedOfficerByAuthority,
    updatedAt: now,
  }, { merge: true });
  const controls = await eventRef.collection('event_controls').get();
  for (const control of controls.docs) {
    const docs = await control.ref.collection('stage1_docs').get();
    const batch = ctx.db.batch();
    docs.docs.forEach((stageDoc) => batch.set(stageDoc.ref, {
      status: 'pending_verification',
      verifiedBy: null,
      verifiedAt: null,
      rejectionReason: '',
      updatedAt: now,
    }, { merge: true }));
    if (!docs.empty) await batch.commit();
    await control.ref.set({ label: 'pending', updatedAt: now }, { merge: true });
  }
}

export async function runSterasTestAction(action: SterasTestAction, ctx = initializeSterasTestContext()): Promise<void> {
  assertSharedProjectAuthorization(ctx.projectId, action);
  if (action === 'dry-run') {
    await assertNoCollisions(ctx);
    console.info(JSON.stringify({ projectId: ctx.projectId, action, datasetId: STERAS_TEST_DATASET_ID, events: SCENARIOS.map(({ id, name, status }) => ({ id, name, status })), retiredEventIds: STERAS_TEST_RETIRED_EVENT_IDS, accounts: IDENTITIES.map(({ email, role, authorityType }) => ({ email, role, authorityType })), storagePrefixes: [...STERAS_TEST_EVENT_IDS, ...STERAS_TEST_RETIRED_EVENT_IDS].flatMap((id) => [`events/${id}/`, `event_documents/${id}/${VERSION_ID}/evidence.pdf`]) }, null, 2));
    return;
  }
  if (action === 'apply') await applySterasTestDataset(ctx);
  if (action === 'verify') await verifySterasTestDataset(ctx);
  if (action === 'cleanup') await clearManagedDataset(ctx, true);
  console.info(`[STERAS test] ${action} complete for ${STERAS_TEST_DATASET_ID} on ${ctx.projectId}.`);
}

if (require.main === module) {
  const action = parseSterasTestAction(process.argv.slice(2));
  runSterasTestAction(action).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

