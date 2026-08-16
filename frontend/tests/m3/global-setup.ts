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
  if (!eventSnap.exists) {
    console.log(`  [setup] ${spec.id}: not present in Firestore — skipping (test must create it first)`);
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

export default async function globalSetup(_config: FullConfig): Promise<void> {
  console.log('[M3 setup] Resetting UAT events to known state...');
  for (const spec of UAT_EVENTS) {
    await seedEvent(spec);
  }
  console.log('[M3 setup] Done.');
}
