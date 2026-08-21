import { randomUUID } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  AuthorityType,
  COLLECTIONS,
  EventDetails,
  EventRecord,
  RESOURCE_SCHEMA_VERSION,
  RiskAssessment,
  UserProfile,
} from '@shared/types';

type ScenarioName = 'assessment' | 'withdrawal';

interface ProvisionedUser {
  profile: UserProfile;
}

interface ScenarioContext {
  eventId: string;
  organizer: ProvisionedUser;
  authorities: Map<AuthorityType, ProvisionedUser>;
  eventDetails: EventDetails;
}

interface ScenarioResult {
  scenario: ScenarioName;
  eventId: string;
  finalStatus: EventRecord['status'];
  versions: number;
  publicPublished: boolean;
  assessment?: { provisionalScore: number; provisionalRiskLevel: string; categories: number; aiStatus: string };
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? 'linkos-496505';
const apiKey = process.env.VITE_FIREBASE_API_KEY;
const password = process.env.UAT_PASSWORD;
const region = process.env.VITE_FIREBASE_FUNCTIONS_REGION ?? 'asia-southeast1';
const requestedScenarios = (process.env.UAT_SCENARIOS ?? 'assessment,withdrawal')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean) as ScenarioName[];
const allowedScenarios = new Set<ScenarioName>(['assessment', 'withdrawal']);

if (!apiKey || !password || password.length < 12) {
  throw new Error('Set VITE_FIREBASE_API_KEY and UAT_PASSWORD (minimum 12 characters).');
}
if (requestedScenarios.length === 0 || requestedScenarios.some((scenario) => !allowedScenarios.has(scenario))) {
  throw new Error('UAT_SCENARIOS must contain assessment or withdrawal.');
}

const app = initializeApp({
  credential: applicationDefault(),
  projectId,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
});
const auth = getAuth(app);
const db = getFirestore(app);
const bucket = getStorage(app).bucket();
const authorityTypes: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM'];

async function run() {
  const organizer = await provisionUser('uat-organizer@steras.test', 'STERAS UAT Organizer', 'organizer');
  const authorities = new Map<AuthorityType, ProvisionedUser>();
  for (const authorityType of authorityTypes) {
    authorities.set(authorityType, await provisionUser(
      `uat-${authorityType.toLowerCase()}@steras.test`,
      `${authorityType} UAT Reviewer`,
      'authority',
      authorityType,
    ));
  }

  const results: ScenarioResult[] = [];
  for (const [index, scenario] of requestedScenarios.entries()) {
    const context = await createScenario(scenario, index, organizer, authorities);
    if (scenario === 'assessment') results.push(await runAssessment(context));
    if (scenario === 'withdrawal') results.push(await runWithdrawal(context));
  }

  console.info(JSON.stringify({
    projectId,
    scenarios: results,
    accounts: [organizer.profile.email, ...authorityTypes.map((type) => authorities.get(type)?.profile.email)],
  }, null, 2));
}

async function createScenario(
  scenario: ScenarioName,
  index: number,
  organizer: ProvisionedUser,
  authorities: Map<AuthorityType, ProvisionedUser>,
): Promise<ScenarioContext> {
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const eventId = `uat-${scenario}-${runId}`;
  const startDatetime = Date.now() + (30 + index) * 24 * 60 * 60 * 1_000;
  const eventDetails: EventDetails = {
    name: `STERAS ${scenario} UAT ${runId}`,
    type: 'conference',
    venueName: 'Putrajaya International Convention Centre',
    venueAddress: 'Presint 5, Putrajaya, Malaysia',
    venueLocation: { lat: 2.9006, lng: 101.6805 },
    venueCapacity: 3_000,
    expectedAttendance: 1_800,
    environment: 'indoor',
    coverage: 'covered',
    seating: 'seated',
    startDatetime,
    endDatetime: startDatetime + 8 * 60 * 60 * 1_000,
    description: `Automated staging ${scenario} scenario for release-candidate verification.`,
    emergencyPlanSummary: 'Marked exits, assembly points, first-aid stations, and an incident command post are assigned.',
    organizerName: organizer.profile.name,
    organizerEmail: organizer.profile.email,
    organizerPhone: '+601100000001',
  };
  const now = Date.now();
  const evidencePath = await uploadEvidence(eventId, 'v1', `${scenario}-safety-plan.pdf`);
  const draft: EventRecord = {
    eventId,
    organizerId: organizer.profile.uid,
    eventDetails,
    status: 'Draft',
    currentVersionNumber: 0,
    editableVersionId: 'v1',
    draftDocumentPaths: [evidencePath],
    requiredAuthorities: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.collection(COLLECTIONS.EVENTS).doc(eventId).set(draft);
  return { eventId, organizer, authorities, eventDetails };
}

async function runAssessment(context: ScenarioContext): Promise<ScenarioResult> {
  const { event, assessment } = await submitAndAssess(context, 'v1');
  if (!event.requiredAuthorities.includes('PDRM')) throw new Error(`PDRM was not assigned to ${context.eventId}.`);
  await assertProvisionalDecisionBlocked(context, 'PDRM');
  if (!('provisionalResult' in assessment) || assessment.aiProposal.status !== 'success') throw new Error('A successful provisional assessment is required.');
  const categories = assessment.aiProposal.categories.map((category) => ({
    categoryId: category.categoryId,
    likelihood: category.likelihood,
    severity: category.severity,
    decision: 'confirmed' as const,
  }));
  for (const authorityType of event.requiredAuthorities) {
    const reviewer = requiredAuthority(context.authorities, authorityType);
    await callFunction('submitAuthorityScoreReview', await idTokenFor(reviewer.profile.email), {
      eventId: context.eventId,
      categories,
      rationale: `${authorityType} staging reviewer confirmed all category scores after reviewing the supplied evidence.`,
      idempotencyKey: `uat_${context.eventId}_${authorityType}_v1`,
    });
  }
  const official = await assessmentFor(context.eventId, 'v1');
  if (official.status !== 'official_ready') throw new Error(`Expected official_ready after all authority reviews, received ${official.status}.`);
  const currentEvent = await eventFor(context.eventId);
  if (!currentEvent.currentResourceId) throw new Error('Official finalisation did not publish a current resource revision.');
  const resource = await db.doc(`${COLLECTIONS.EVENTS}/${context.eventId}/${COLLECTIONS.RESOURCES}/${currentEvent.currentResourceId}`).get();
  if (resource.data()?.stage !== 'official') throw new Error('The current resource revision is not official.');
  return verifyScenario(context.eventId, 'assessment', 'Pending', 1, false, official);
}

async function runWithdrawal(context: ScenarioContext): Promise<ScenarioResult> {
  const token = await idTokenFor(context.organizer.profile.email);
  await callFunction('submitEvent', token, { eventId: context.eventId });
  await callFunction('withdrawEvent', token, {
    eventId: context.eventId,
    rationale: 'Organizer withdrawal scenario verifies the Pending cancellation path.',
  });
  return verifyScenario(context.eventId, 'withdrawal', 'Withdrawn', 1, false);
}

async function submitAndAssess(context: ScenarioContext, expectedVersionId: string) {
  const token = await idTokenFor(context.organizer.profile.email);
  const submission = await callFunction<{ eventId: string }, { versionId: string }>('submitEvent', token, { eventId: context.eventId });
  if (submission.versionId !== expectedVersionId) throw new Error(`Expected ${expectedVersionId}, received ${submission.versionId}.`);
  const event = await waitForAssessment(context.eventId, submission.versionId);
  const assessment = await assessmentFor(context.eventId, submission.versionId);
  if (!('provisionalResult' in assessment)
    || assessment.provisionalResult.overallScore < 0 || assessment.provisionalResult.overallScore > 100
    || assessment.provisionalResult.categories.length === 0
    || assessment.aiProposal.status !== 'success') {
    throw new Error(`Category assessment contract failed for ${context.eventId}/${submission.versionId}.`);
  }
  if (event.requiredAuthorities.join(',') !== authorityTypes.join(',')) {
    throw new Error(`Unexpected authorities: ${event.requiredAuthorities.join(', ')}.`);
  }
  return { event, assessment };
}

async function assertProvisionalDecisionBlocked(context: ScenarioContext, authorityType: AuthorityType) {
  const reviewer = requiredAuthority(context.authorities, authorityType);
  try {
    await callFunction('makeAuthorityDecision', await idTokenFor(reviewer.profile.email), {
      eventId: context.eventId,
      decision: 'Approved',
      rationale: 'PR1 UAT verifies that provisional assessments cannot be used for final approval.',
      materialsReviewed: true,
    });
  } catch (error) {
    if (error instanceof Error && /official risk assessment/i.test(error.message)) return;
    throw error;
  }
  throw new Error(`Provisional assessment unexpectedly allowed a final decision for ${context.eventId}.`);
}

async function verifyScenario(
  eventId: string,
  scenario: ScenarioName,
  expectedStatus: EventRecord['status'],
  expectedVersions: number,
  expectedPublic: boolean,
  assessment?: RiskAssessment,
): Promise<ScenarioResult> {
  const event = await eventFor(eventId);
  const versions = await db.collection(`${COLLECTIONS.EVENTS}/${eventId}/${COLLECTIONS.VERSIONS}`).get();
  const publicRecord = await db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(eventId).get();
  if (event.status !== expectedStatus || versions.size !== expectedVersions || publicRecord.exists !== expectedPublic) {
    throw new Error(`${scenario} failed: status=${event.status}, versions=${versions.size}, public=${publicRecord.exists}.`);
  }
  return {
    scenario,
    eventId,
    finalStatus: event.status,
    versions: versions.size,
    publicPublished: publicRecord.exists,
    ...(assessment ? { assessment: assessmentSummary(assessment) } : {}),
  };
}

async function provisionUser(email: string, name: string, role: UserProfile['role'], authorityType?: AuthorityType): Promise<ProvisionedUser> {
  const existing = await auth.getUserByEmail(email).catch(() => null);
  const user = existing
    ? await auth.updateUser(existing.uid, { password, displayName: name, disabled: false })
    : await auth.createUser({ email, password, displayName: name });
  const now = Date.now();
  const current = await db.collection(COLLECTIONS.USERS).doc(user.uid).get();
  const profile: UserProfile = {
    uid: user.uid,
    name,
    email,
    role,
    ...(authorityType ? { authorityType } : {}),
    createdAt: current.data()?.createdAt ?? now,
    updatedAt: now,
  };
  await db.collection(COLLECTIONS.USERS).doc(user.uid).set(profile);
  return { profile };
}

async function uploadEvidence(eventId: string, versionId: string, fileName: string) {
  const path = `event_documents/${eventId}/${versionId}/${randomUUID()}-${fileName}`;
  await bucket.file(path).save(Buffer.from('%PDF-1.4\n% STERAS staging UAT evidence\n%%EOF\n'), {
    resumable: false,
    metadata: { contentType: 'application/pdf' },
  });
  return path;
}

async function idTokenFor(email: string): Promise<string> {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await response.json() as { idToken?: string; error?: { message?: string } };
  if (!response.ok || !body.idToken) throw new Error(`Token exchange failed: ${body.error?.message ?? response.status}`);
  return body.idToken;
}

async function callFunction<TRequest = unknown, TResponse = Record<string, unknown>>(name: string, token: string, data: TRequest): Promise<TResponse> {
  const response = await fetch(`https://${region}-${projectId}.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await response.json() as { result?: TResponse; data?: TResponse; error?: { message?: string } };
  if (!response.ok) throw new Error(`${name} failed: ${body.error?.message ?? response.status}`);
  const result = body.result ?? body.data;
  if (!result) throw new Error(`${name} returned no result.`);
  return result;
}

async function waitForAssessment(eventId: string, versionId: string): Promise<EventRecord> {
  const deadline = Date.now() + 120_000;
  const eventReference = db.collection(COLLECTIONS.EVENTS).doc(eventId);
  while (Date.now() < deadline) {
    const event = (await eventReference.get()).data() as EventRecord | undefined;
    if (event?.currentAssessmentId === versionId && event.currentResourceId) {
      const resource = await eventReference.collection(COLLECTIONS.RESOURCES).doc(event.currentResourceId).get();
      if (resource.exists
        && resource.data()?.schemaVersion === RESOURCE_SCHEMA_VERSION
        && resource.data()?.stage === 'provisional'
        && resource.data()?.versionId === versionId) return event;
    }
    const assessment = await eventReference.collection(COLLECTIONS.ASSESSMENTS).doc(versionId).get();
    if (assessment.data()?.status === 'failed') throw new Error(`Assessment failed: ${assessment.data()?.error ?? 'unknown error'}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Assessment ${eventId}/${versionId} did not finish within 120 seconds.`);
}

async function eventFor(eventId: string): Promise<EventRecord> {
  const snapshot = await db.collection(COLLECTIONS.EVENTS).doc(eventId).get();
  if (!snapshot.exists) throw new Error(`Event ${eventId} does not exist.`);
  return snapshot.data() as EventRecord;
}

async function assessmentFor(eventId: string, versionId: string): Promise<RiskAssessment> {
  const snapshot = await db.doc(`${COLLECTIONS.EVENTS}/${eventId}/${COLLECTIONS.ASSESSMENTS}/${versionId}`).get();
  if (!snapshot.exists || !['provisional_ready', 'authority_review', 'official_ready'].includes(snapshot.data()?.status)) {
    throw new Error(`Assessment ${eventId}/${versionId} has no validated result.`);
  }
  return snapshot.data() as RiskAssessment;
}

function requiredAuthority(authorities: Map<AuthorityType, ProvisionedUser>, authorityType: AuthorityType) {
  const authority = authorities.get(authorityType);
  if (!authority) throw new Error(`${authorityType} UAT account was not provisioned.`);
  return authority;
}

function assessmentSummary(assessment: RiskAssessment) {
  if (!('provisionalResult' in assessment)) throw new Error('Assessment requires manual review and has no provisional result.');
  return {
    provisionalScore: assessment.provisionalResult.overallScore,
    provisionalRiskLevel: assessment.provisionalResult.overallRiskLevel,
    categories: assessment.provisionalResult.categories.length,
    aiStatus: assessment.aiProposal.status,
    status: assessment.status,
    ...(assessment.status === 'official_ready' ? { officialScore: assessment.officialResult.overallScore, reviewCount: assessment.officialResult.reviewIds.length } : {}),
  };
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
