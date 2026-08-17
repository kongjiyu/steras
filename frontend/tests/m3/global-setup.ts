/**
 * Playwright globalSetup — runs ONCE before all tests.
 *
 * Uses the Firebase Admin SDK to set up test state in Firestore directly,
 * bypassing security rules (which rightly block client-side event writes).
 *
 * Responsibilities:
 *  - Reset the 4 UAT events to known states (decisions cleared, status reset)
 *  - Write minimal resource docs so the decision form is enabled
 *  - Seed the compliance/provisional scenarios needed for negative tests
 */
import type { FullConfig } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

// Path to the service account key (kept on disk per project policy)
const SA_PATH = path.resolve(
  process.env.STERAS_SA_PATH ??
  'C:/Users/HP/Website_Project/STERAS - Collaborative Asm/steras/linkos-496505-firebase-adminsdk-fbsvc-a951ea775c.json',
);

let adminApp: App;
if (getApps().length === 0) {
  const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf-8'));
  adminApp = initializeApp({ credential: cert(sa) });
} else {
  adminApp = getApps()[0];
}

const db: Firestore = getFirestore(adminApp);

/**
 * Mirror of the function's processingHash — see
 * functions/src/triggers/onEventCreated.ts. Must match the version
 * constants in shared/types.ts, functions/src/config/categorySchema.ts,
 * and functions/src/engines/aiPredictor.ts. If those change, update this too.
 */
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

/** Minimal mock resource recommendation for the M3 review form. */
const MOCK_RESOURCE = {
  police: 5, security: 14, medicalTeams: 1, ambulances: 1, toilets: 12, wasteBins: 8, fireOfficers: 2,
  formulaVersion: '2026-07-21-prototype-v2',
  guidelineVersion: '2026-07-21-unverified-guidance-v1',
  guidelineStatus: 'prototype',
  rationales: {
    police: { resource: 'police', baselineQuantity: 5, factors: ['UAT'], guidelineReferences: ['prototype.police.v1'] },
    security: { resource: 'security', baselineQuantity: 14, factors: ['UAT'], guidelineReferences: ['prototype.security.v1'] },
    medicalTeams: { resource: 'medicalTeams', baselineQuantity: 1, factors: ['UAT'], guidelineReferences: ['prototype.medicalTeams.v1'] },
    ambulances: { resource: 'ambulances', baselineQuantity: 1, factors: ['UAT'], guidelineReferences: ['prototype.ambulances.v1'] },
    toilets: { resource: 'toilets', baselineQuantity: 12, factors: ['UAT'], guidelineReferences: ['prototype.toilets.v1'] },
    wasteBins: { resource: 'wasteBins', baselineQuantity: 8, factors: ['UAT'], guidelineReferences: ['prototype.wasteBins.v1'] },
    fireOfficers: { resource: 'fireOfficers', baselineQuantity: 2, factors: ['UAT'], guidelineReferences: ['prototype.fireOfficers.v1'] },
  },
  aiConsiderations: ['UAT seed'],
  confidenceLevel: 'prototype',
  notes: 'Seeded for E2E tests (not an operational deployment authorisation).',
};

interface EventSpec {
  id: string;
  status: 'Pending' | 'UnderReview' | 'Approved' | 'Rejected' | 'AmendmentRequested';
  requiredAuthorities: string[];
  /** Override complianceStatus on the assessment (defaults to 'pass') */
  complianceStatus?: 'pass' | 'review_required' | 'blocked';
  /** Override assessmentReadiness on the assessment (defaults to 'complete') */
  assessmentReadiness?: 'complete' | 'provisional' | 'insufficient_data';
  /** Force-clear any existing decisions */
  clearDecisions?: boolean;
  /** When set, also seed event_controls with this many synthetic items */
  eventControls?: number;
}

const UAT_EVENTS: EventSpec[] = [
  {
    id: 'evt-001-kl-music-festival',
    status: 'Approved',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'],
    // Already approved; leave as-is but make sure resource exists
  },
  {
    id: 'evt-002-pj-food-fair',
    status: 'UnderReview',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL'],
    clearDecisions: true,
  },
  {
    id: 'evt-003-kl-mountain-run',
    status: 'Pending',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    clearDecisions: true,
  },
  {
    id: 'evt-004-kl-marathon',
    status: 'AmendmentRequested',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM', 'DBKL'],
    clearDecisions: true,
  },
  {
    // Negative-test fixtures — these events don't exist in the seed but the
    // negative tests will create their own data via Cloud Functions + admin
    // SDK. We just mark them here for documentation.
    id: 'evt-compliance-blocked',
    status: 'Pending',
    requiredAuthorities: ['PDRM', 'BOMBA'],
    complianceStatus: 'blocked',
    clearDecisions: true,
  },
  {
    id: 'evt-provisional-readiness',
    status: 'Pending',
    requiredAuthorities: ['PDRM', 'BOMBA'],
    assessmentReadiness: 'provisional',
    clearDecisions: true,
  },
  {
    id: 'evt-control-verification',
    status: 'UnderReview',
    requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'],
    clearDecisions: true,
    eventControls: 4,
  },
];

/** Compliance / readiness override patches applied to the v1 assessment. */
function assessmentOverride(spec: EventSpec): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (spec.complianceStatus) patch.complianceStatus = spec.complianceStatus;
  if (spec.assessmentReadiness) patch.assessmentReadiness = spec.assessmentReadiness;
  return patch;
}

async function seedEvent(spec: EventSpec): Promise<void> {
  const eventRef = db.collection('events').doc(spec.id);
  const eventSnap = await eventRef.get();

  // Negative-test fixtures: create the event from scratch if it doesn't exist
  if (!eventSnap.exists) {
    await createNegativeTestFixture(spec);
    return;
  }
  const eventData = eventSnap.data()!;

  // Set the event status (test isolation)
  await eventRef.update({ status: spec.status, updatedAt: Date.now() });

  // Clear decisions if requested
  if (spec.clearDecisions) {
    const decs = await eventRef.collection('decisions').get();
    const batch = db.batch();
    decs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // Write resource doc (M3 form needs it for evidenceReady)
  if (eventData.currentResourceId) {
    await eventRef.collection('resources').doc(eventData.currentResourceId).set({
      ...MOCK_RESOURCE,
      resourceId: eventData.currentResourceId,
      eventId: spec.id,
      versionId: eventData.currentVersionId,
      assessmentId: eventData.currentAssessmentId,
      computedAt: Date.now(),
    });
  }

  // Apply assessment overrides (complianceStatus / assessmentReadiness)
  if (eventData.currentAssessmentId) {
    const override = assessmentOverride(spec);
    if (Object.keys(override).length > 0) {
      await eventRef.collection('assessments').doc(eventData.currentAssessmentId).set(override, { merge: true });
    }
  }

  // Seed event controls for control-verification test
  if (spec.eventControls && spec.eventControls > 0) {
    const batch = db.batch();
    for (let i = 0; i < spec.eventControls; i++) {
      const ctrlId = `${spec.id}-ctrl-${i + 1}`;
      const ctrlRef = eventRef.collection('event_controls').doc(ctrlId);
      batch.set(ctrlRef, {
        controlId: ctrlId,
        eventId: spec.id,
        title: `Control item ${i + 1}`,
        stage: 'Stage1',
        status: 'declared',
        description: 'Seeded for E2E test',
        createdAt: Date.now(),
      });
    }
    await batch.commit();
  }

  console.log(`  [setup] ${spec.id}: status=${spec.status} decisions=${spec.clearDecisions ? 'cleared' : 'kept'}` +
    (spec.complianceStatus ? ` compliance=${spec.complianceStatus}` : '') +
    (spec.assessmentReadiness ? ` readiness=${spec.assessmentReadiness}` : '') +
    (spec.eventControls ? ` controls=${spec.eventControls}` : ''));
}

/**
 * Create a fresh event doc + assessment + resource + version for negative
 * tests so the spec doesn't have to do all that setup itself.
 */
async function createNegativeTestFixture(spec: EventSpec): Promise<void> {
  const now = Date.now();
  const eventRef = db.collection('events').doc(spec.id);
  const versionId = 'v1';
  const assessmentId = 'v1';
  const resourceId = 'v1';

  const eventDetails = {
    name: `Test event — ${spec.id}`,
    type: 'cultural',
    venueId: 'ven-001-dataran-merdeka',
    venueName: 'Dataran Merdeka',
    venueAddress: 'Jalan Raja, 50050 Kuala Lumpur',
    venueLocation: { lat: 3.1478, lng: 101.6953 },
    venueCapacity: 10_000,
    expectedAttendance: 1_000,
    environment: 'outdoor',
    coverage: 'uncovered',
    seating: 'mixed',
    startDatetime: now + 14 * 24 * 3600_000,
    endDatetime: now + 14 * 24 * 3600_000 + 6 * 3600_000,
    emergencyPlanSummary: 'Standard plan for UAT.',
    organizerName: 'UAT Organiser',
    organizerEmail: 'usr-org-003@steras.test',
    organizerPhone: '+60 12-000 0000',
  };

  const versionInputHash = 'uat-' + spec.id;

  // Build the full assessment object FIRST so we can include it in the
  // atomic batch below. Must pass `isCurrentRiskAssessment` in the
  // frontend (src/components/m2/m2Contract.ts) or the review form's
  // "Your decision" section stays disabled.
  const assessment: Record<string, unknown> = {
    assessmentId,
    eventId: spec.id,
    versionId,
    status: 'ready',
    inputHash: processingHash(versionInputHash),
    officialScore: 42,
    officialRiskLevel: 'Medium',
    categoryAssignments: [
      { categoryId: 'weather', categoryName: 'Weather exposure', score: 38, riskLevel: 'Medium', weight: 0.3, weightedContribution: 11.4, rationale: 'UAT', evidenceKeys: ['weather'], guidelineChecks: [] },
      { categoryId: 'crowd',   categoryName: 'Crowd pressure',     score: 44, riskLevel: 'Medium', weight: 0.3, weightedContribution: 13.2, rationale: 'UAT', evidenceKeys: ['crowd'],   guidelineChecks: [] },
      { categoryId: 'venue',   categoryName: 'Venue profile',      score: 44, riskLevel: 'Medium', weight: 0.2, weightedContribution: 8.8,  rationale: 'UAT', evidenceKeys: ['venue'],   guidelineChecks: [] },
      { categoryId: 'history', categoryName: 'Historical context', score: 42, riskLevel: 'Medium', weight: 0.1, weightedContribution: 4.2,  rationale: 'UAT', evidenceKeys: ['history'], guidelineChecks: [] },
      { categoryId: 'holiday', categoryName: 'Calendar context',   score: 44, riskLevel: 'Medium', weight: 0.1, weightedContribution: 4.4,  rationale: 'UAT', evidenceKeys: ['holiday'], guidelineChecks: [] },
    ],
    evidence: [
      { key: 'weather', description: 'UAT', source: 'openweather', sourceTimestamp: now, status: 'matched', quality: 'verified' },
      { key: 'crowd',   description: 'UAT', source: 'versioned-input', sourceTimestamp: now, status: 'matched', quality: 'verified' },
    ],
    categorySchemaVersion: '2026-07-24-all-hazards-v2',
    scoringLogicVersion: '2026-07-24-hirarc-residual-v2',
    categorySchemaStatus: 'prototype',
    complianceStatus: spec.complianceStatus ?? 'pass',
    assessmentReadiness: spec.assessmentReadiness ?? 'complete',
    computedAt: now,
    contextSnapshot: {
      weather: {
        data: { forecast: 'Partly cloudy', temperature: 31, humidity: 75, windSpeed: 12, precipitationProbability: 30, severeAlert: false },
        source: 'openweather', freshness: 'fresh', fetchedAt: now, expiresAt: now + 6 * 3600_000, forecastFor: now + 3600_000,
      },
      calendar: {
        localDate: new Date(now).toISOString().slice(0, 10), dayOfWeek: 'Saturday', isWeekend: true, isHolidayOrAdjacent: false,
        sourceVersion: 'uat-calendar-v1', sourceTimestamp: now,
      },
      venue: {
        matched: true, venueId: 'ven-001-dataran-merdeka', submittedCapacity: 10_000, registeredCapacity: 10_000, capacityDifference: 0,
        jurisdiction: 'DBKL', fireCertificateStatus: 'valid', fireCertificateExpiresAt: now + 200 * 24 * 3600_000,
        emergencyAccessVerified: true, nearestHospitalTravelMinutes: 8, fetchedAt: now,
      },
      incidentHistory: {
        matched: false, venueId: 'ven-001-dataran-merdeka', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 },
        fetchedAt: now,
      },
    },
    sourceTimestamps: { weather: now, holiday: now, venue: now, incidents: now },
    contextStatuses: { weather: 'matched', holiday: 'matched', venue: 'matched', incidents: 'unmatched', ai: 'not-applicable' },
    aiAdvisory: {
      model: 'MiniMax-M3', promptVersion: 'v2.3.0', responseSchemaVersion: '2026-07-21-advisory-v1',
      status: 'unavailable', label: 'advisory', overallBand: 'Medium',
      overallExplanation: 'UAT seed: MiniMax unavailable; deterministic baseline used.',
      categories: [],
      keyConcerns: [],
      resourceConsiderations: [],
      citedEvidenceKeys: ['weather', 'crowd'],
      cacheStatus: 'not-applicable', generatedAt: now,
    },
  };

  // Atomic write of event + version + assessment. The deployed
  // onEventCreated Cloud Function reads all three in sequence; if they
  // are visible together with the right inputHash, the function's claim
  // check (existing.status==='ready' && same inputHash) recognises our
  // seed and skips processing. (M3 test fixtures are also explicitly
  // skipped in the function body — see M3_TEST_FIXTURE_IDS.)
  const setupBatch = db.batch();
  setupBatch.set(eventRef, {
    eventId: spec.id,
    organizerId: 'usr-org-003',
    eventDetails,
    status: spec.status,
    currentVersionId: versionId,
    currentVersionNumber: 1,
    currentAssessmentId: assessmentId,
    currentResourceId: resourceId,
    editableVersionId: null,
    draftDocumentPaths: [],
    requiredAuthorities: spec.requiredAuthorities,
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
  });
  setupBatch.set(eventRef.collection('versions').doc(versionId), {
    versionId,
    eventId: spec.id,
    versionNumber: 1,
    eventDetails,
    documentPaths: [],
    submittedBy: 'usr-org-003',
    submittedAt: now,
    inputHash: versionInputHash,
  });
  setupBatch.set(eventRef.collection('assessments').doc(assessmentId), assessment);
  setupBatch.set(eventRef.collection('resources').doc(resourceId), {
    ...MOCK_RESOURCE,
    resourceId,
    eventId: spec.id,
    versionId,
    assessmentId,
    computedAt: now,
  });
  await setupBatch.commit();

  // ---- Settle any in-flight Cloud Function and re-overwrite ----
  // Belt-and-braces: even though the function is configured to skip
  // these fixture ids, older invocations (or a function version still
  // running on the old image) might still write. Re-overwrite a few
  // times to win the race deterministically.
  await settleAssessmentFunction(eventRef, assessmentId);
  for (let i = 0; i < 2; i++) {
    await eventRef.collection('assessments').doc(assessmentId).set(assessment);
    await new Promise((r) => setTimeout(r, 2_000));
  }
  await eventRef.collection('assessments').doc(assessmentId).set(assessment);
  const finalSnap = await eventRef.collection('assessments').doc(assessmentId).get();
  const finalData = finalSnap.data();
  console.log(`  [setup] ${spec.id} final: status=${finalData?.status} compliance=${finalData?.complianceStatus} readiness=${finalData?.assessmentReadiness} hasContextSnapshot=${!!finalData?.contextSnapshot} hasAiAdvisory=${!!finalData?.aiAdvisory}`);

  // Event controls (for the control-verification spec)
  if (spec.eventControls && spec.eventControls > 0) {
    const batch = db.batch();
    for (let i = 0; i < spec.eventControls; i++) {
      const ctrlId = `${spec.id}-ctrl-${i + 1}`;
      batch.set(eventRef.collection('event_controls').doc(ctrlId), {
        controlId: ctrlId,
        eventId: spec.id,
        title: `Control item ${i + 1}`,
        stage: 'Stage1',
        status: 'declared',
        description: 'Seeded for E2E test',
        createdAt: now,
      });
    }
    await batch.commit();
  }

  console.log(`  [setup] ${spec.id}: created fixture` +
    (spec.complianceStatus ? ` compliance=${spec.complianceStatus}` : '') +
    (spec.assessmentReadiness ? ` readiness=${spec.assessmentReadiness}` : '') +
    (spec.eventControls ? ` controls=${spec.eventControls}` : ''));
}

/**
 * Wait for the deployed onEventCreated Cloud Function to finish
 * processing the assessment for this event, then return. We poll the
 * assessment doc every 1s, up to 30s. We consider it 'settled' when:
 *   - The doc has status === 'ready' (function finalised)
 *   - OR the doc has status === 'failed' (function gave up)
 *   - OR 30s elapses (function is stuck — give up and let the caller
 *     overwrite so tests don't block forever)
 *
 * Note: the function will NOT re-trigger just because we write to the
 * assessment doc — onDocumentCreated only fires on event creation.
 */
async function settleAssessmentFunction(
  eventRef: FirebaseFirestore.DocumentReference,
  assessmentId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const assessRef = eventRef.collection('assessments').doc(assessmentId);
  while (Date.now() < deadline) {
    const snap = await assessRef.get();
    const status = snap.data()?.status as string | undefined;
    if (status === 'ready' || status === 'failed') return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  // Timed out — function is stuck. Continue anyway; the next overwrite
  // will replace whatever the function wrote (or didn't).
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  console.log('[M3 setup] Resetting UAT events to known state...');
  for (const spec of UAT_EVENTS) {
    await seedEvent(spec);
  }
  console.log('[M3 setup] Done.');
}
