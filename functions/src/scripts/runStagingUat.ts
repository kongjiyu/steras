import { randomUUID } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  AuthorityType,
  COLLECTIONS,
  DecisionValue,
  EventDetails,
  EventRecord,
  EventVersion,
  ResourceRecommendation,
  RiskAssessment,
  UserProfile,
} from '@shared/types';

type ScenarioName = 'approval' | 'rejection' | 'amendment' | 'withdrawal';

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
  assessment?: { baseline: number; adjustment: number; final: number; aiStatus: string };
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? 'linkos-496505';
const apiKey = process.env.VITE_FIREBASE_API_KEY;
const password = process.env.UAT_PASSWORD;
const region = process.env.VITE_FIREBASE_FUNCTIONS_REGION ?? 'asia-southeast1';
const requestedScenarios = (process.env.UAT_SCENARIOS ?? 'approval,rejection,amendment,withdrawal')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean) as ScenarioName[];
const allowedScenarios = new Set<ScenarioName>(['approval', 'rejection', 'amendment', 'withdrawal']);

if (!apiKey || !password || password.length < 12) {
  throw new Error('Set VITE_FIREBASE_API_KEY and UAT_PASSWORD (minimum 12 characters).');
}
if (requestedScenarios.length === 0 || requestedScenarios.some((scenario) => !allowedScenarios.has(scenario))) {
  throw new Error('UAT_SCENARIOS must contain approval, rejection, amendment, or withdrawal.');
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
    if (scenario === 'approval') results.push(await runApproval(context));
    if (scenario === 'rejection') results.push(await runRejection(context));
    if (scenario === 'amendment') results.push(await runAmendment(context));
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

async function runApproval(context: ScenarioContext): Promise<ScenarioResult> {
  const { event, assessment } = await submitAndAssess(context, 'v1');
  const resources = await resourceFor(context.eventId, 'v1');
  const pdrm = requiredAuthority(context.authorities, 'PDRM');
  await callFunction('overrideResources', await idTokenFor(pdrm.profile.email), {
    eventId: context.eventId,
    quantities: {
      police: resources.police + 1,
      medicalTeams: resources.medicalTeams,
      ambulances: resources.ambulances,
      toilets: resources.toilets,
      wasteBins: resources.wasteBins,
      security: resources.security,
      fireOfficers: resources.fireOfficers,
    },
    rationale: 'Cloud UAT adjustment verifies authority resource provenance.',
  });
  await decideAll(context, event.requiredAuthorities, 'Approved');
  return verifyScenario(context.eventId, 'approval', 'Approved', 1, true, assessment);
}

async function runRejection(context: ScenarioContext): Promise<ScenarioResult> {
  const { event, assessment } = await submitAndAssess(context, 'v1');
  await decide(context, 'PDRM', 'Approved', 'PDRM confirms the traffic and crowd controls for this UAT scenario.');
  await decide(context, 'BOMBA', 'Rejected', 'BOMBA rejects the plan because the secondary emergency exit is insufficient.');
  const finalEvent = await eventFor(context.eventId);
  if (!event.requiredAuthorities.includes('BOMBA') || finalEvent.status !== 'Rejected') {
    throw new Error(`Rejection precedence failed for ${context.eventId}.`);
  }
  return verifyScenario(context.eventId, 'rejection', 'Rejected', 1, false, assessment);
}

async function runAmendment(context: ScenarioContext): Promise<ScenarioResult> {
  const { event: versionOneEvent } = await submitAndAssess(context, 'v1');
  await decide(context, 'PDRM', 'Approved', 'PDRM approves the version one traffic and crowd controls.');
  await decide(context, 'BOMBA', 'AmendmentRequested', 'BOMBA requires a revised emergency exit and assembly-point arrangement.');

  const versionOne = await versionFor(context.eventId, 'v1');
  const evidencePath = await uploadEvidence(context.eventId, 'v2', 'revised-emergency-plan.pdf');
  await db.collection(COLLECTIONS.EVENTS).doc(context.eventId).update({
    eventDetails: {
      ...context.eventDetails,
      name: `${context.eventDetails.name} - Revised`,
      emergencyPlanSummary: 'Revised secondary exits, signed evacuation routes, and separated fire assembly points are assigned.',
    },
    draftDocumentPaths: [evidencePath],
    updatedAt: Date.now(),
  });

  const { event: versionTwoEvent, assessment } = await submitAndAssess(context, 'v2');
  const versionOneAfter = await versionFor(context.eventId, 'v1');
  if (JSON.stringify(versionOneAfter) !== JSON.stringify(versionOne)) {
    throw new Error(`Version 1 changed during amendment scenario ${context.eventId}.`);
  }
  if (versionTwoEvent.currentVersionNumber !== 2 || versionTwoEvent.requiredAuthorities.join(',') !== versionOneEvent.requiredAuthorities.join(',')) {
    throw new Error(`Version 2 contract failed for ${context.eventId}.`);
  }

  await decideAll(context, versionTwoEvent.requiredAuthorities, 'Approved');
  const result = await verifyScenario(context.eventId, 'amendment', 'Approved', 2, true, assessment);
  const history = await db.collection(`${COLLECTIONS.EVENTS}/${context.eventId}/${COLLECTIONS.DECISION_HISTORY}`).get();
  if (history.size !== 5) throw new Error(`Expected 5 decision history records, received ${history.size}.`);
  const publicEvent = await db.collection(COLLECTIONS.PUBLIC_EVENTS).doc(context.eventId).get();
  if (publicEvent.data()?.versionId !== 'v2') throw new Error(`Amendment scenario did not publish v2 for ${context.eventId}.`);
  return result;
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
  if (assessment.finalScore < assessment.baselineScore || assessment.finalScore > Math.min(assessment.baselineScore + 15, 100)) {
    throw new Error(`Assessment bounds failed for ${context.eventId}/${submission.versionId}.`);
  }
  if (event.requiredAuthorities.join(',') !== authorityTypes.join(',')) {
    throw new Error(`Unexpected authorities: ${event.requiredAuthorities.join(', ')}.`);
  }
  return { event, assessment };
}

async function decideAll(context: ScenarioContext, authorities: AuthorityType[], decision: DecisionValue) {
  for (const authorityType of authorities) {
    await decide(context, authorityType, decision, `${authorityType} cloud UAT review confirms the submitted controls for this version.`);
  }
}

async function decide(context: ScenarioContext, authorityType: AuthorityType, decision: DecisionValue, rationale: string) {
  const reviewer = requiredAuthority(context.authorities, authorityType);
  return callFunction('makeAuthorityDecision', await idTokenFor(reviewer.profile.email), {
    eventId: context.eventId,
    decision,
    rationale,
  });
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
    if (event?.currentAssessmentId === versionId && event.currentResourceId === versionId) return event;
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

async function versionFor(eventId: string, versionId: string): Promise<EventVersion> {
  const snapshot = await db.doc(`${COLLECTIONS.EVENTS}/${eventId}/${COLLECTIONS.VERSIONS}/${versionId}`).get();
  if (!snapshot.exists) throw new Error(`Version ${eventId}/${versionId} does not exist.`);
  return snapshot.data() as EventVersion;
}

async function assessmentFor(eventId: string, versionId: string): Promise<RiskAssessment> {
  const snapshot = await db.doc(`${COLLECTIONS.EVENTS}/${eventId}/${COLLECTIONS.ASSESSMENTS}/${versionId}`).get();
  if (!snapshot.exists || snapshot.data()?.status !== 'ready') throw new Error(`Assessment ${eventId}/${versionId} is not ready.`);
  return snapshot.data() as RiskAssessment;
}

async function resourceFor(eventId: string, versionId: string): Promise<ResourceRecommendation> {
  const snapshot = await db.doc(`${COLLECTIONS.EVENTS}/${eventId}/${COLLECTIONS.RESOURCES}/${versionId}`).get();
  if (!snapshot.exists) throw new Error(`Resources ${eventId}/${versionId} do not exist.`);
  return snapshot.data() as ResourceRecommendation;
}

function requiredAuthority(authorities: Map<AuthorityType, ProvisionedUser>, authorityType: AuthorityType) {
  const authority = authorities.get(authorityType);
  if (!authority) throw new Error(`${authorityType} UAT account was not provisioned.`);
  return authority;
}

function assessmentSummary(assessment: RiskAssessment) {
  return {
    baseline: assessment.baselineScore,
    adjustment: assessment.ai.validatedAdjustment,
    final: assessment.finalScore,
    aiStatus: assessment.ai.status,
  };
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
