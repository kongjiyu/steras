import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { submitEventForUser } from '../src/http/submitEvent';
import { withdrawEventForUser } from '../src/http/withdrawEvent';
import { __testOnlyMarkFailed, recomputeResourceForStoredAssessment, runRiskAndResourcePipeline } from '../src/triggers/onEventCreated';
import { makeAuthorityDecisionForUser } from '../src/http/authorityDecision';
import { overrideResourcesForUser } from '../src/http/overrideResources';
import { fetchHistoricalContext, fetchVenueContext } from '../src/engines/ruleBased';
import {
  ASSESSMENT_SCHEMA_VERSION, HARD_RULE_VERSION, PROVISIONAL_FORMULA_VERSION,
  RESOURCE_CONFIG_VERSION, RESOURCE_FORMULA_VERSION, RESOURCE_KEYS, RESOURCE_SCHEMA_VERSION, RESOURCE_SOURCE_REGISTRY_VERSION,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../src/config/categorySchema';
import { computeResources } from '../src/engines/resourceCalculator';
import {
  assessmentStateHashFor,
  abortResourceCutoverBeforeMutation,
  assertSafeResourceCutoverApply,
  backupChecksumFor,
  createAndVerifyCutoverStartAudit,
  drainQueuedResourceEvents,
  preflightResourceCutoverCapacity,
  restoreBackup,
  transitionCutoverAnchor,
} from '../src/scripts/cutoverResourceV3';
import { encodeFirestoreValue } from '../src/scripts/firestoreBackupCodec';
import {
  acquireResourceCutoverLock,
  createResourceCutoverQueueToken,
  releaseResourceCutoverLock,
  RESOURCE_CUTOVER_LEASE_MS,
  startResourceCutoverHeartbeat,
  RESOURCE_CUTOVER_LOCK_PATH,
} from '../src/config/resourceCutoverLock';

let environment: RulesTestEnvironment;
let adminApp: App;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  environment = await initializeTestEnvironment({
    projectId: 'steras-test',
    firestore: {
      host,
      port: Number(port),
      rules: readFileSync('../firestore.rules', 'utf8'),
    },
  });
  adminApp = initializeApp({ projectId: 'steras-test' });
});

afterEach(() => environment.clearFirestore());
afterAll(async () => {
  await environment.cleanup();
  await deleteApp(adminApp);
});

const validDetails = {
  name: 'KL Cultural Festival',
  type: 'cultural',
  venueName: 'Central Venue',
  venueAddress: 'Kuala Lumpur',
  venueLocation: { lat: 3.139, lng: 101.687 },
  venueCapacity: 2_000,
  expectedAttendance: 1_500,
  environment: 'outdoor',
  coverage: 'partially_covered',
  seating: 'mixed',
  startDatetime: 2_000,
  endDatetime: 3_000,
  emergencyPlanSummary: 'Emergency exits and first-aid posts are documented.',
  organizerName: 'Organizer',
  organizerEmail: 'organizer@example.com',
  organizerPhone: '+60123456789',
};

async function seedProfilesAndEvent() {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
    await setDoc(doc(db, 'users/authority-1'), { role: 'authority', authorityType: 'PDRM' });
    await setDoc(doc(db, 'events/event-1'), { organizerId: 'organizer-1', status: 'Pending', requiredAuthorities: ['PDRM'] });
    await setDoc(doc(db, 'events/event-1/assessments/v1'), { officialScore: 50 });
    await setDoc(doc(db, 'events/event-1/assessment_summaries/v1'), {
      assessmentId: 'v1', eventId: 'event-1', versionId: 'v1', status: 'provisional_ready',
      overallScore: 50, overallRiskLevel: 'Medium', categories: [], resourceQuantities: {}, computedAt: 1,
    });
    await setDoc(doc(db, 'events/event-1/decisions/v1-PDRM'), { reviewerId: 'authority-1', rationale: 'private' });
    await setDoc(doc(db, 'events/event-1/decision_history/history-1'), { reviewerId: 'authority-1', rationale: 'private' });
    await setDoc(doc(db, 'events/event-1/resource_overrides/override-1'), { reviewerId: 'authority-1', rationale: 'private' });
    await setDoc(doc(db, 'public_events/event-1'), { eventName: 'Public Event' });
  });
}

describe('Firestore security rules', () => {
  it('allows organizer drafts but rejects direct Pending creation and generated-field changes', async () => {
    await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'users/organizer-1'), { role: 'organizer' }));
    const db = environment.authenticatedContext('organizer-1').firestore();
    const draft = {
      organizerId: 'organizer-1', eventDetails: validDetails, status: 'Draft', currentVersionNumber: 0,
      editableVersionId: 'v1', draftDocumentPaths: [], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
    };
    await assertSucceeds(setDoc(doc(db, 'events/draft-1'), draft));
    await assertFails(setDoc(doc(db, 'events/pending-1'), { ...draft, status: 'Pending' }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), { currentVersionNumber: 1 }));
  });

  it('submits exactly one immutable version through the server transaction', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
      await setDoc(doc(db, 'events/draft-1'), {
        organizerId: 'organizer-1', eventDetails: validDetails, status: 'Draft', currentVersionNumber: 0,
        editableVersionId: 'v1', draftDocumentPaths: [], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      });
    });
    await submitEventForUser('organizer-1', 'draft-1', 1_000);
    const db = environment.authenticatedContext('organizer-1').firestore();
    const eventSnapshot = await assertSucceeds(getDoc(doc(db, 'events/draft-1')));
    const versionSnapshot = await assertSucceeds(getDoc(doc(db, 'events/draft-1/versions/v1')));
    if (!eventSnapshot.exists() || !versionSnapshot.exists()) throw new Error('Submission records were not created.');
    if (eventSnapshot.data().status !== 'Pending' || eventSnapshot.data().currentVersionId !== 'v1') throw new Error('Event was not advanced to version 1.');
    await assertFails(setDoc(doc(db, 'events/draft-1/versions/v1'), { versionNumber: 99 }));
    await submitEventForUser('organizer-1', 'draft-1', 1_001).then(
      () => { throw new Error('Duplicate submission unexpectedly succeeded.'); },
      () => undefined,
    );
    const versionOne = versionSnapshot.data();
    await environment.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'events/draft-1'), {
      status: 'AmendmentRequested',
      editableVersionId: 'v2',
      draftDocumentPaths: [],
      eventDetails: { ...validDetails, name: 'KL Cultural Festival - Revised' },
    }));
    await submitEventForUser('organizer-1', 'draft-1', 1_002);
    const versionOneAfter = await assertSucceeds(getDoc(doc(db, 'events/draft-1/versions/v1')));
    const versionTwo = await assertSucceeds(getDoc(doc(db, 'events/draft-1/versions/v2')));
    if (JSON.stringify(versionOneAfter.data()) !== JSON.stringify(versionOne)) throw new Error('Version 1 changed during resubmission.');
    if (versionTwo.data()?.versionNumber !== 2 || versionTwo.data()?.eventDetails.name !== 'KL Cultural Festival - Revised') throw new Error('Version 2 was not created from the amendment.');
  });

  it('allows only the owner to withdraw an eligible event', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
      await setDoc(doc(db, 'events/draft-1'), {
        organizerId: 'organizer-1', eventDetails: validDetails, status: 'Draft', currentVersionNumber: 0,
        editableVersionId: 'v1', draftDocumentPaths: [], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      });
    });
    await withdrawEventForUser('organizer-2', 'draft-1', undefined, 1_000).then(
      () => { throw new Error('Non-owner withdrawal unexpectedly succeeded.'); },
      () => undefined,
    );
    await withdrawEventForUser('organizer-1', 'draft-1', 'Cancelled by organizer', 1_001);
    const snapshot = await assertSucceeds(getDoc(doc(environment.authenticatedContext('organizer-1').firestore(), 'events/draft-1')));
    if (snapshot.data()?.status !== 'Withdrawn') throw new Error('Event was not withdrawn.');
  });

  it('claims one assessment when duplicate triggers run concurrently', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
      await setDoc(doc(db, 'events/draft-1'), {
        organizerId: 'organizer-1', eventDetails: validDetails, status: 'Draft', currentVersionNumber: 0,
        editableVersionId: 'v1', draftDocumentPaths: [], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      });
    });
    await submitEventForUser('organizer-1', 'draft-1', 1_000);
    const minimaxKey = process.env.MINIMAX_API_KEY;
    const weatherKey = process.env.OPENWEATHER_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    delete process.env.OPENWEATHER_API_KEY;
    try {
      const results = await Promise.all([
        runRiskAndResourcePipeline('draft-1', 2_000),
        runRiskAndResourcePipeline('draft-1', 2_000),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(['processed', 'skipped']);
      const adminDb = getFirestore(adminApp);
      const assessment = await adminDb.doc('events/draft-1/assessments/v1').get();
      const organizerSummary = await adminDb.doc('events/draft-1/assessment_summaries/v1').get();
      const resources = await adminDb.collection('events/draft-1/resources').get();
      const audits = await adminDb.collection('events/draft-1/audit_logs').get();
      expect(assessment.data()).toMatchObject({ status: 'manual_review_required', versionId: 'v1' });
      expect(organizerSummary.data()).toMatchObject({
        status: 'manual_review_required', versionId: 'v1', categories: [], authorityReviewRequired: true,
      });
      expect(organizerSummary.data()).not.toHaveProperty('aiProposal');
      expect(organizerSummary.data()).not.toHaveProperty('warnings');
      expect(organizerSummary.data()).not.toHaveProperty('manualReviewReason');
      expect(resources.docs).toHaveLength(0);
      expect(audits.docs.map((item) => item.id).sort()).toEqual([
        '1000-submitted-v1',
        'v1-risk-score-computed-v3',
      ]);
      await Promise.all([
        adminDb.doc('users/pdrm-unassigned').set({ role: 'authority', authorityType: 'PDRM' }),
        adminDb.doc('events/draft-1').update({ requiredAuthorities: ['BOMBA'] }),
      ]);
      const unauthorizedRetry = await runRiskAndResourcePipeline('draft-1', 2_100, true, {
        uid: 'pdrm-unassigned', authorityType: 'PDRM',
      });
      expect(unauthorizedRetry).toMatchObject({ status: 'skipped', reason: 'retry-not-authorized' });
      await Promise.all([
        adminDb.doc('events/draft-1').update({ requiredAuthorities: ['PDRM'] }),
        adminDb.doc('events/draft-1/assessments/v1').set({
          status: 'provisional_ready', inputHash: 'stale-hash', versionId: 'v1',
        }),
      ]);
      const nonRetryable = await runRiskAndResourcePipeline('draft-1', 2_200, true, {
        uid: 'pdrm-unassigned', authorityType: 'PDRM',
      });
      expect(nonRetryable).toMatchObject({ status: 'skipped', reason: 'retry-not-retryable' });
    } finally {
      if (minimaxKey) process.env.MINIMAX_API_KEY = minimaxKey;
      if (weatherKey) process.env.OPENWEATHER_API_KEY = weatherKey;
    }
  });

  it('UC-M2-02/06 rejects missing or inconsistent submitted records without publishing output', async () => {
    expect(await runRiskAndResourcePipeline('missing-event', 1_000)).toMatchObject({
      status: 'skipped', reason: 'event-not-found',
    });
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/missing-version').set({
      organizerId: 'organizer-1', status: 'Pending', currentVersionId: 'v404', currentVersionNumber: 1,
      requiredAuthorities: ['PDRM'], draftDocumentPaths: [], createdAt: 1, updatedAt: 1,
    });
    expect(await runRiskAndResourcePipeline('missing-version', 1_000)).toMatchObject({
      status: 'processed', reason: 'version-not-found', versionId: 'v404',
    });
    expect((await adminDb.doc('events/missing-version/assessments/v404').get()).data()).toMatchObject({
      status: 'failed', error: 'Immutable event version v404 was not found.',
    });
    expect((await adminDb.doc('events/missing-version/assessment_summaries/v404').get()).data()).toMatchObject({
      status: 'failed', categories: [], authorityReviewRequired: true,
    });
    expect((await adminDb.collection('events/missing-version/resources').get()).empty).toBe(true);
  });

  it('UC-M2-07 rejects ambiguous venue names and excludes incidents that are not verified and eligible', async () => {
    const adminDb = getFirestore(adminApp);
    await Promise.all([
      adminDb.doc('venues/venue-a').set({ name: 'Twin Hall', capacity: 100 }),
      adminDb.doc('venues/venue-b').set({ name: 'Twin Hall', capacity: 200 }),
    ]);
    expect(await fetchVenueContext(undefined, 'Twin Hall', 50, 10)).toMatchObject({ matched: false });

    await adminDb.doc('venues/stable-venue').set({ name: 'Stable Hall', capacity: 500 });
    const event = {
      eventId: 'history-event', organizerId: 'organizer-1', status: 'Pending', currentVersionNumber: 1,
      draftDocumentPaths: [], requiredAuthorities: ['PDRM'], createdAt: 1, updatedAt: 1,
      eventDetails: { ...validDetails, venueId: 'stable-venue', venueName: 'Stable Hall', startDatetime: 1_800_000_000_000, endDatetime: 1_800_003_600_000 },
    } as const;
    const incidentBase = {
      venueId: 'stable-venue', eventType: 'cultural', incidentType: 'test', severity: 'medium',
      date: event.eventDetails.startDatetime - 1_000,
    };
    await Promise.all([
      adminDb.doc('incidents/eligible').set({ ...incidentBase, status: 'verified', assessmentEligible: true }),
      adminDb.doc('incidents/unverified').set({ ...incidentBase, status: 'under_review', assessmentEligible: true }),
      adminDb.doc('incidents/not-eligible').set({ ...incidentBase, status: 'verified', assessmentEligible: false }),
      adminDb.doc('incidents/missing-provenance').set(incidentBase),
    ]);
    const history = await fetchHistoricalContext(event, 20);
    expect(history.incidentIds).toEqual(['eligible']);
    expect(history.total).toBe(1);
  });

  it('UC-M2-18 exposes only the owner-safe summary and denies raw assessment/resource records', async () => {
    await seedProfilesAndEvent();
    const db = environment.authenticatedContext('organizer-1').firestore();
    await assertFails(getDoc(doc(db, 'events/event-1/assessments/v1')));
    await assertFails(getDoc(doc(db, 'events/event-1/resources/v1')));
    await assertFails(getDoc(doc(db, 'events/event-1/decisions/v1-PDRM')));
    await assertFails(getDoc(doc(db, 'events/event-1/decision_history/history-1')));
    await assertFails(getDoc(doc(db, 'events/event-1/resource_overrides/override-1')));
    await assertSucceeds(getDoc(doc(db, 'events/event-1/assessment_summaries/v1')));
    await assertFails(setDoc(doc(db, 'events/event-1/assessments/v1'), { officialScore: 1 }));
    await assertFails(setDoc(doc(db, 'events/event-1/assessment_summaries/v1'), { overallScore: 1 }));
  });

  it('UC-M2-15/16 allows assigned authorities to read full M2 records and rejects unassigned authorities', async () => {
    await seedProfilesAndEvent();
    await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'users/authority-2'), { role: 'authority', authorityType: 'KKM' }));
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('authority-1').firestore(), 'events/event-1')));
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('authority-1').firestore(), 'events/event-1/assessments/v1')));
    await assertFails(getDoc(doc(environment.authenticatedContext('authority-2').firestore(), 'events/event-1')));
    await assertFails(getDoc(doc(environment.authenticatedContext('authority-2').firestore(), 'events/event-1/assessments/v1')));
  });

  it('UC-M2-17 restricts full AI analysis to assigned authorities and admins', async () => {
    await seedProfilesAndEvent();
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/admin-1'), { role: 'admin' });
      await setDoc(doc(context.firestore(), 'users/public-1'), { role: 'public' });
    });
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('authority-1').firestore(), 'events/event-1/assessments/v1')));
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('admin-1').firestore(), 'events/event-1/assessments/v1')));
    await assertFails(getDoc(doc(environment.authenticatedContext('public-1').firestore(), 'events/event-1/assessments/v1')));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'events/event-1/assessments/v1')));
  });

  it('keeps append-only score reviews restricted to assigned authorities and admins', async () => {
    await seedProfilesAndEvent();
    await environment.withSecurityRulesDisabled((context) => setDoc(
      doc(context.firestore(), 'events/event-1/assessments/v1/score_reviews/review-1'),
      { reviewId: 'review-1', reviewerId: 'authority-1' },
    ));
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('authority-1').firestore(), 'events/event-1/assessments/v1/score_reviews/review-1')));
    await assertFails(getDoc(doc(environment.authenticatedContext('organizer-1').firestore(), 'events/event-1/assessments/v1/score_reviews/review-1')));
    await assertFails(setDoc(doc(environment.authenticatedContext('authority-1').firestore(), 'events/event-1/assessments/v1/score_reviews/review-2'), { reviewerId: 'authority-1' }));
  });

  it('prevents authorities from reading organizer profiles or provisioning roles', async () => {
    await seedProfilesAndEvent();
    const authorityDb = environment.authenticatedContext('authority-1').firestore();
    await assertSucceeds(getDoc(doc(authorityDb, 'users/authority-1')));
    await assertFails(getDoc(doc(authorityDb, 'users/organizer-1')));

    const attackerDb = environment.authenticatedContext('attacker-1').firestore();
    await assertFails(setDoc(doc(attackerDb, 'users/attacker-1'), {
      uid: 'attacker-1', name: 'Attacker', email: 'attacker@example.com', role: 'organizer', authorityType: 'PDRM', createdAt: 1, updatedAt: 1,
    }));
    await assertSucceeds(setDoc(doc(attackerDb, 'users/attacker-1'), {
      uid: 'attacker-1', name: 'Organizer', email: 'organizer@example.com', role: 'organizer', createdAt: 1, updatedAt: 1,
    }));
    await assertFails(updateDoc(doc(attackerDb, 'users/attacker-1'), { createdAt: 2 }));
  });

  it('aggregates concurrent authority approvals and publishes only unanimous same-version approval', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const results = await Promise.all([
      makeAuthorityDecisionForUser('pdrm-1', { eventId: 'review-1', decision: 'Approved', rationale: 'PDRM operational requirements are satisfied.' }, 2_000),
      makeAuthorityDecisionForUser('bomba-1', { eventId: 'review-1', decision: 'Approved', rationale: 'BOMBA fire safety requirements are satisfied.' }, 2_000),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['Approved', 'UnderReview']);
    const adminDb = getFirestore(adminApp);
    expect((await adminDb.doc('events/review-1').get()).data()?.status).toBe('Approved');
    expect((await adminDb.doc('public_events/review-1').get()).data()).toMatchObject({ versionId: 'v1', approvedBy: ['PDRM', 'BOMBA'] });
    expect((await adminDb.collection('events/review-1/decisions').get()).size).toBe(2);
    expect((await adminDb.collection('events/review-1/decision_history').get()).size).toBe(2);
    const duplicate = await makeAuthorityDecisionForUser('pdrm-1', { eventId: 'review-1', decision: 'Approved', rationale: 'PDRM operational requirements are satisfied.' }, 2_001);
    expect(duplicate.idempotent).toBe(true);
  });

  it('gives a concurrent rejection precedence and keeps the event private', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const results = await Promise.allSettled([
      makeAuthorityDecisionForUser('pdrm-1', { eventId: 'review-1', decision: 'Approved', rationale: 'PDRM operational requirements are satisfied.' }, 3_000),
      makeAuthorityDecisionForUser('bomba-1', { eventId: 'review-1', decision: 'Rejected', rationale: 'Emergency exits do not satisfy fire requirements.' }, 3_000),
    ]);
    const adminDb = getFirestore(adminApp);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect((await adminDb.doc('events/review-1').get()).data()?.status).toBe('Rejected');
    expect((await adminDb.doc('public_events/review-1').get()).exists).toBe(false);
  });

  it('does not let an idempotent decision replay bypass the current official contract', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const request = {
      eventId: 'review-1', decision: 'Approved' as const,
      rationale: 'PDRM confirms the version one operating plan.',
    };
    await makeAuthorityDecisionForUser('pdrm-1', request, 2_500);
    const adminDb = getFirestore(adminApp);
    await Promise.all([
      adminDb.doc('events/review-1/assessments/v1').delete(),
      adminDb.doc(`events/review-1/resources/${officialResourceId('v1')}`).delete(),
    ]);
    await expect(makeAuthorityDecisionForUser('pdrm-1', request, 2_501))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('does not carry authority approvals into a resubmitted version', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    await makeAuthorityDecisionForUser('pdrm-1', {
      eventId: 'review-1', decision: 'Approved', rationale: 'PDRM approves the version one operating plan.',
    }, 3_100);
    await makeAuthorityDecisionForUser('bomba-1', {
      eventId: 'review-1', decision: 'AmendmentRequested', rationale: 'Revise the version one emergency exit arrangement.',
    }, 3_101);

    const adminDb = getFirestore(adminApp);
    const revisedDetails = {
      ...validDetails,
      startDatetime: 20_000,
      endDatetime: 30_000,
      emergencyPlanSummary: 'Revised emergency exits and fire assembly points.',
    };
    await adminDb.doc('events/review-1').update({ eventDetails: revisedDetails });
    await submitEventForUser('organizer-1', 'review-1', 3_200);
    await adminDb.doc('events/review-1').update({ currentAssessmentId: 'v2', currentResourceId: officialResourceId('v2', revisedDetails) });
    await adminDb.doc(`events/review-1/resources/${officialResourceId('v2', revisedDetails)}`).set(officialResourceFixture('v2', 3_201, revisedDetails));
    await adminDb.doc('events/review-1/assessments/v2').set(officialAssessmentFixture('v2'));

    const result = await makeAuthorityDecisionForUser('bomba-1', {
      eventId: 'review-1', decision: 'Approved', rationale: 'BOMBA approves the revised version two exit arrangement.',
    }, 3_300);
    expect(result).toMatchObject({ versionId: 'v2', status: 'UnderReview' });
    expect((await adminDb.doc('events/review-1').get()).data()?.status).toBe('UnderReview');
    expect((await adminDb.doc('public_events/review-1').get()).exists).toBe(false);
    expect((await adminDb.collection('events/review-1/decisions').get()).docs.map((item) => item.id).sort()).toEqual([
      'v1_BOMBA', 'v1_PDRM', 'v2_BOMBA',
    ]);
  });

  it('rejects resource overrides without mutating the immutable baseline', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const quantities = { police: 12, medicalTeams: 3, ambulances: 2, toilets: 60, wasteBins: 20, security: 25, fireOfficers: 4 };
    const adminDb = getFirestore(adminApp);
    const baselineReference = adminDb.doc(`events/review-1/resources/${officialResourceId('v1')}`);
    const before = (await baselineReference.get()).data();
    await expect(overrideResourcesForUser('pdrm-1', { eventId: 'review-1', quantities, rationale: 'Increased staffing for controlled entry and traffic management.' }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await baselineReference.get()).data()).toEqual(before);
    expect((await adminDb.collection('events/review-1/resource_overrides').get()).size).toBe(0);
  });

  it('unpublishes a stale resource projection when resource-only recomputation fails', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const assessment = officialAssessmentFixture('v1');
    delete (assessment as Record<string, unknown>).officialResult;
    await Promise.all([
      adminDb.doc('events/review-1/versions/v1').update({ 'eventDetails.expectedAttendance': 0 }),
      adminDb.doc('events/review-1/assessments/v1').set({ ...assessment, status: 'provisional_ready' }),
      adminDb.doc('events/review-1/assessment_summaries/v1').set({ resourceQuantities: { police: 1 }, resourceRecommendation: { resourceId: officialResourceId('v1') } }),
    ]);
    await expect(recomputeResourceForStoredAssessment('review-1', 4_100)).resolves.toMatchObject({ status: 'failed', reason: 'invalid_input' });
    expect((await adminDb.doc('events/review-1').get()).data()?.currentResourceId).toBeUndefined();
    expect((await adminDb.doc(`events/review-1/resources/${officialResourceId('v1')}`).get()).exists).toBe(true);
    expect((await adminDb.doc('events/review-1/assessment_summaries/v1').get()).data()).not.toHaveProperty('resourceQuantities');
  });

  it('recomputes resources idempotently from the stored provisional result without mutating the assessment', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const assessmentReference = adminDb.doc('events/review-1/assessments/v1');
    const assessment = officialAssessmentFixture('v1');
    delete (assessment as Record<string, unknown>).officialResult;
    await Promise.all([
      adminDb.doc('events/review-1').update({ currentResourceId: FieldValue.delete() }),
      adminDb.doc(`events/review-1/resources/${officialResourceId('v1')}`).delete(),
      assessmentReference.set({ ...assessment, status: 'provisional_ready' }),
    ]);
    const before = (await assessmentReference.get()).data();
    const first = await recomputeResourceForStoredAssessment('review-1', 4_200);
    const second = await recomputeResourceForStoredAssessment('review-1', 4_201);
    expect(first).toMatchObject({ status: 'created' });
    expect(second).toMatchObject({ status: 'reused', resourceId: first.resourceId });
    expect((await assessmentReference.get()).data()).toEqual(before);
    expect((await adminDb.collection('events/review-1/resources').get()).size).toBe(1);
  });

  it('continues the immutable provisional revision chain after a failed run cleared the pointer', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const assessment = officialAssessmentFixture('v1');
    delete (assessment as Record<string, unknown>).officialResult;
    const previous = provisionalResourceFixture('v1', 4_250);
    await Promise.all([
      adminDb.doc('events/review-1').update({ currentResourceId: previous.resourceId }),
      adminDb.doc('events/review-1/versions/v1').update({ 'eventDetails.expectedAttendance': 0 }),
      adminDb.doc('events/review-1/assessments/v1').set({ ...assessment, status: 'provisional_ready' }),
      adminDb.doc(`events/review-1/resources/${previous.resourceId}`).set(previous),
    ]);
    await expect(recomputeResourceForStoredAssessment('review-1', 4_251)).resolves.toMatchObject({ status: 'failed' });
    await adminDb.doc('events/review-1/versions/v1').update({ 'eventDetails.expectedAttendance': 100 });
    const recovered = await recomputeResourceForStoredAssessment('review-1', 4_252);
    expect(recovered).toMatchObject({ status: 'created' });
    const current = (await adminDb.doc(`events/review-1/resources/${recovered.resourceId}`).get()).data();
    expect(current).toMatchObject({ revision: 2, supersedesResourceId: previous.resourceId });
    expect((await adminDb.doc(`events/review-1/resources/${previous.resourceId}`).get()).data()).toEqual(previous);
  });

  it('does not rewind a newer resource pointer when stale code reuses an older deterministic record', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const assessment = officialAssessmentFixture('v1');
    delete (assessment as Record<string, unknown>).officialResult;
    await Promise.all([
      adminDb.doc('events/review-1').update({ currentResourceId: FieldValue.delete() }),
      adminDb.doc(`events/review-1/resources/${officialResourceId('v1')}`).delete(),
      adminDb.doc('events/review-1/assessments/v1').set({ ...assessment, status: 'provisional_ready' }),
    ]);
    const first = await recomputeResourceForStoredAssessment('review-1', 4_255);
    if (!first.resourceId) throw new Error('Expected first resource.');
    const old = (await adminDb.doc(`events/review-1/resources/${first.resourceId}`).get()).data();
    if (!old) throw new Error('Expected stored resource.');
    const newerHash = 'e'.repeat(64);
    const newerId = `provisional-v1-${newerHash}`;
    const newer = {
      ...old,
      resourceId: newerId,
      resourceInputHash: newerHash,
      revision: 2,
      supersedesResourceId: first.resourceId,
      computedAt: 4_256,
    };
    await Promise.all([
      adminDb.doc(`events/review-1/resources/${newerId}`).set(newer),
      adminDb.doc('events/review-1').update({ currentResourceId: newerId }),
    ]);
    await expect(recomputeResourceForStoredAssessment('review-1', 4_257))
      .resolves.toEqual({ status: 'reused', resourceId: newerId });
    expect((await adminDb.doc('events/review-1').get()).data()?.currentResourceId).toBe(newerId);
  });

  it('refuses to append to a branched or duplicate resource revision history', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const assessment = officialAssessmentFixture('v1');
    delete (assessment as Record<string, unknown>).officialResult;
    await Promise.all([
      adminDb.doc('events/review-1').update({ currentResourceId: FieldValue.delete() }),
      adminDb.doc(`events/review-1/resources/${officialResourceId('v1')}`).delete(),
      adminDb.doc('events/review-1/assessments/v1').set({ ...assessment, status: 'provisional_ready' }),
    ]);
    const first = await recomputeResourceForStoredAssessment('review-1', 4_258);
    if (!first.resourceId) throw new Error('Expected root resource.');
    const root = (await adminDb.doc(`events/review-1/resources/${first.resourceId}`).get()).data();
    if (!root) throw new Error('Expected root document.');
    const branches = ['a', 'b'].map((suffix) => ({
      ...root,
      resourceId: `provisional-v1-${suffix.repeat(64)}`,
      resourceInputHash: suffix.repeat(64),
      revision: 2,
      supersedesResourceId: first.resourceId,
      computedAt: 4_259,
    }));
    await Promise.all(branches.map((branch) =>
      adminDb.doc(`events/review-1/resources/${branch.resourceId}`).set(branch)));
    await adminDb.doc('events/review-1').update({ currentResourceId: branches[0].resourceId });
    await expect(recomputeResourceForStoredAssessment('review-1', 4_260))
      .resolves.toMatchObject({ status: 'failed', reason: 'invalid-resource-revision-chain' });
    expect((await adminDb.doc('events/review-1').get()).data()?.currentResourceId).toBe(branches[0].resourceId);
  });

  it('does not publish a resource calculated from an assessment replaced before persistence', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const assessmentReference = adminDb.doc('events/review-1/assessments/v1');
    const assessment = officialAssessmentFixture('v1');
    delete (assessment as Record<string, unknown>).officialResult;
    await assessmentReference.set({ ...assessment, status: 'provisional_ready' });
    const previousPointer = (await adminDb.doc('events/review-1').get()).data()?.currentResourceId;
    const result = await recomputeResourceForStoredAssessment('review-1', 4_260, {
      beforePersist: async () => {
        await assessmentReference.set({
          ...assessment,
          status: 'provisional_ready',
          aiProposal: { status: 'success', proposalId: 'replacement-proposal' },
          provisionalResult: {
            ...assessment.provisionalResult,
            proposalId: 'replacement-proposal',
            calculatedAt: 4_259,
          },
        });
      },
    });
    expect(result).toMatchObject({ status: 'failed', reason: 'event-or-assessment-changed' });
    expect((await adminDb.doc('events/review-1').get()).data()?.currentResourceId).toBe(previousPointer);
  });

  it('reuses the stored provisional result while the assessment is in authority review', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const assessment = officialAssessmentFixture('v1');
    delete (assessment as Record<string, unknown>).officialResult;
    await Promise.all([
      adminDb.doc('events/review-1').update({ currentResourceId: FieldValue.delete() }),
      adminDb.doc(`events/review-1/resources/${officialResourceId('v1')}`).delete(),
      adminDb.doc('events/review-1/assessments/v1').set({ ...assessment, status: 'authority_review' }),
    ]);
    await expect(recomputeResourceForStoredAssessment('review-1', 4_270)).resolves.toMatchObject({ status: 'created' });
  });

  it('does not publish or clear resources while the cutover maintenance lock is active', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const eventReference = adminDb.doc('events/review-1');
    const assessment = officialAssessmentFixture('v1');
    delete (assessment as Record<string, unknown>).officialResult;
    await adminDb.doc('events/review-1/assessments/v1').set({ ...assessment, status: 'provisional_ready' });
    const before = (await eventReference.get()).data()?.currentResourceId;
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).set({
      active: true, sessionId: 'cutover-test', acquiredAt: 1, leaseExpiresAt: 1,
      mode: 'apply', phase: 'post_destructive', queuedEvents: [],
    });
    await expect(recomputeResourceForStoredAssessment('review-1', 4_280))
      .resolves.toMatchObject({ status: 'failed', reason: 'resource-cutover-in-progress' });
    expect((await eventReference.get()).data()?.currentResourceId).toBe(before);
    await expect(recomputeResourceForStoredAssessment('review-1', 4_281, { cutoverSessionId: 'cutover-test' }))
      .resolves.toMatchObject({ status: 'failed', reason: 'resource-cutover-fencing-failed' });
    expect((await eventReference.get()).data()?.currentResourceId).toBe(before);
    const auditCount = (await eventReference.collection('audit_logs').get()).size;
    await eventReference.collection('versions').doc('v1').update({
      'eventDetails.expectedAttendance': FieldValue.delete(),
    });
    await expect(recomputeResourceForStoredAssessment('review-1', 4_282, { cutoverSessionId: 'cutover-test' }))
      .resolves.toMatchObject({ status: 'failed', reason: 'resource-cutover-fencing-failed' });
    expect((await eventReference.collection('audit_logs').get()).size).toBe(auditCount);
    expect((await eventReference.get()).data()?.currentResourceId).toBe(before);
  });

  it('prevents concurrent cutover owners and refuses a foreign lock release', async () => {
    const adminDb = getFirestore(adminApp);
    await acquireResourceCutoverLock(adminDb, 'owner-a', 'apply');
    const token = queueToken();
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [token] });
    await expect(acquireResourceCutoverLock(adminDb, 'owner-b', 'apply')).rejects.toThrow(/already locked/);
    await expect(releaseResourceCutoverLock(adminDb, 'owner-b')).rejects.toThrow(/another session/);
    await expect(acquireResourceCutoverLock(adminDb, 'restore-owner', 'restore', 'owner-a')).rejects.toThrow(/post-destructive/);
    await expect(acquireResourceCutoverLock(adminDb, 'apply-takeover', 'apply', 'owner-a')).rejects.toThrow(/already locked/);
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ phase: 'pre_destructive_aborted' });
    await acquireResourceCutoverLock(adminDb, 'recovery-owner', 'apply', 'owner-a');
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents).toEqual([token]);
    await expect(releaseResourceCutoverLock(adminDb, 'recovery-owner')).rejects.toThrow(/queued events remain/);
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [] });
    await releaseResourceCutoverLock(adminDb, 'recovery-owner');
    await acquireResourceCutoverLock(adminDb, 'post-owner', 'apply');
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ phase: 'post_destructive', leaseExpiresAt: 1 });
    await acquireResourceCutoverLock(adminDb, 'restore-owner', 'restore', 'post-owner');
    const restoreLock = (await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data();
    await expect(acquireResourceCutoverLock(adminDb, 'invalid-apply', 'apply', 'restore-owner')).rejects.toThrow(/already locked/);
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()).toEqual(restoreLock);
    await expect(acquireResourceCutoverLock(adminDb, 'restore-takeover', 'restore', 'post-owner'))
      .rejects.toThrow(/lineage/);
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ leaseExpiresAt: 1 });
    await acquireResourceCutoverLock(adminDb, 'restore-takeover', 'restore', 'post-owner');
    await releaseResourceCutoverLock(adminDb, 'restore-takeover');
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).exists).toBe(false);
  });

  it('leases and fences stale pre-destructive owners without permitting post-destructive takeover', async () => {
    const adminDb = getFirestore(adminApp);
    const now = Date.now();
    const expiredStart = now - RESOURCE_CUTOVER_LEASE_MS - 10;
    await acquireResourceCutoverLock(adminDb, 'stale-owner', 'apply', undefined, expiredStart);
    const backupPath = '/tmp/steras-stale-prepared/backup.json';
    await createAndVerifyCutoverStartAudit(adminDb, {
      action: 'resource_cutover_start', sessionId: 'stale-owner', projectId: 'linkos-496505',
      backupId: 'steras-stale-prepared', backupPath, backupChecksum: 'a'.repeat(64),
      resourceSchemaVersion: RESOURCE_SCHEMA_VERSION, createdAt: expiredStart,
      lifecycle: 'prepared', phase: 'pre_destructive',
    });
    await acquireResourceCutoverLock(adminDb, 'new-owner', 'apply', 'stale-owner', now);
    await expect(transitionCutoverAnchor(adminDb, 'stale-owner', 'stale-owner', 'post_destructive'))
      .rejects.toThrow(/ownership/);
    expect((await adminDb.collection('system_controls/m2_resource_v3_cutover/cutover_start_audits')
      .doc('stale-owner').get()).data()?.lifecycle).toBe('prepared');
    await expect(acquireResourceCutoverLock(adminDb, 'too-early', 'apply', 'new-owner', now + 1))
      .rejects.toThrow(/already locked/);
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ phase: 'post_destructive', leaseExpiresAt: expiredStart });
    await expect(acquireResourceCutoverLock(adminDb, 'forbidden-post', 'apply', 'new-owner', now))
      .rejects.toThrow(/already locked/);
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [] });
    await releaseResourceCutoverLock(adminDb, 'new-owner');
  });

  it('surfaces background heartbeat ownership loss and can always stop the timer', async () => {
    const adminDb = getFirestore(adminApp);
    await acquireResourceCutoverLock(adminDb, 'heartbeat-owner', 'apply');
    const heartbeat = startResourceCutoverHeartbeat(adminDb, 'heartbeat-owner', 5);
    try {
      await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ sessionId: 'replacement-owner' });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(() => heartbeat.assertHealthy()).toThrow(/lost ownership/);
    } finally {
      heartbeat.stop();
      await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).delete();
    }
  });

  it('rejects an oversized per-event transaction before destructive mutation', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const eventReference = adminDb.doc('events/review-1');
    const batch = adminDb.batch();
    for (let index = 0; index < 401; index += 1) {
      batch.set(eventReference.collection('audit_logs').doc(`unrelated-capacity-${index}`), {
        action: 'decision_made', marker: index,
      });
    }
    await batch.commit();
    const eventSnapshot = await eventReference.get();
    const assessmentSnapshot = await eventReference.collection('assessments').doc('v1').get();
    const resourcePath = `events/review-1/resources/${officialResourceId('v1')}`;
    const resourceSnapshot = await adminDb.doc(resourcePath).get();
    const backup = restoreBackupFixture(eventSnapshot.data(), assessmentSnapshot.data(), resourcePath, resourceSnapshot.data());
    await expect(preflightResourceCutoverCapacity(adminDb, backup)).rejects.toThrow(/capacity exceeded/);
    const oversizedSummaryBackup = {
      ...backup,
      summaries: [{
        path: 'events/review-1/assessment_summaries/v1',
        data: encodeFirestoreValue({ resourceRecommendation: { disclaimer: 'x'.repeat(6 * 1024 * 1024) } }),
      }],
    };
    await expect(preflightResourceCutoverCapacity(adminDb, oversizedSummaryBackup)).rejects.toThrow(/capacity exceeded/);
    expect((await adminDb.doc(resourcePath).get()).data()).toEqual(resourceSnapshot.data());
    expect((await eventReference.get()).data()).toEqual(eventSnapshot.data());
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).exists).toBe(false);
  });

  it('durably audits and acknowledges terminal queued events so a pre-delete abort can release', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/review-1/assessments/v1').set({
      assessmentId: 'v1', eventId: 'review-1', versionId: 'v1', status: 'manual_review_required',
    });
    expect(() => assertSafeResourceCutoverApply({
      state: 'mixed', legacyPaths: ['legacy'], v3Resources: [], issues: [],
    })).toThrow('mixed legacy/V3');
    for (const [sessionId, abortReason] of [
      ['classification-owner', 'classification:mixed-state'],
      ['backup-owner', 'backup-write:disk-failure'],
    ]) {
      await acquireResourceCutoverLock(adminDb, sessionId, 'apply');
      await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [queueToken()] });
      await abortResourceCutoverBeforeMutation(adminDb, sessionId, abortReason);
      expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).exists).toBe(false);
    }
    const audits = await adminDb.collection('events/review-1/audit_logs').get();
    expect(audits.docs.filter((document) => document.data().metadata?.disposition === 'terminal_failure')).toHaveLength(2);
    expect((await adminDb.doc('events/review-1').get()).data()?.currentResourceId).toBeUndefined();
    const summary = (await adminDb.doc('events/review-1/assessment_summaries/v1').get()).data();
    expect(summary?.resourceQuantities).toBeUndefined();
    expect(summary?.resourceRecommendation).toBeUndefined();
  });

  it('queues a generation-bound terminal token when a version disappears during cutover inventory', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    await acquireResourceCutoverLock(adminDb, 'inventory-owner', 'apply');
    await adminDb.doc('events/review-1/versions/v1').delete();
    await runRiskAndResourcePipeline('review-1', 4_300);
    const queued = (await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents;
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ eventId: 'review-1', currentVersionId: 'v1', currentAssessmentId: 'v1' });
    await drainQueuedResourceEvents(adminDb, 'inventory-owner', []);
    expect((await adminDb.doc('events/review-1').get()).data()?.currentResourceId).toBeUndefined();
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents).toEqual([]);
    await releaseResourceCutoverLock(adminDb, 'inventory-owner');
  });

  it('retires a late v1 failure without touching the current v2 resource generation', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const eventReference = adminDb.doc('events/review-1');
    const v1Assessment = eventReference.collection('assessments').doc('v1');
    const v2ResourceId = officialResourceId('v2');
    await Promise.all([
      v1Assessment.set({
        assessmentId: 'v1', eventId: 'review-1', versionId: 'v1', status: 'processing',
        inputHash: 'v1-input', claimId: 'late-v1-claim', claimedAt: 1, leaseExpiresAt: 99,
      }),
      eventReference.collection('versions').doc('v2').set({
        versionId: 'v2', eventId: 'review-1', versionNumber: 2,
        eventDetails: validDetails, documentPaths: [], submittedBy: 'organizer-1', submittedAt: 2, inputHash: 'v2-input',
      }),
      eventReference.collection('assessments').doc('v2').set(officialAssessmentFixture('v2')),
      eventReference.collection('resources').doc(v2ResourceId).set(officialResourceFixture('v2', 2)),
      eventReference.collection('assessment_summaries').doc('v2').set({
        assessmentId: 'v2', status: 'official_ready', resourceQuantities: { police: 2 },
        resourceRecommendation: { resourceId: v2ResourceId }, marker: 'preserve-v2',
      }),
      eventReference.update({
        currentVersionId: 'v2', currentVersionNumber: 2, currentAssessmentId: 'v2', currentResourceId: v2ResourceId,
      }),
    ]);
    await acquireResourceCutoverLock(adminDb, 'late-failure-owner', 'apply');
    const v2SummaryBefore = (await eventReference.collection('assessment_summaries').doc('v2').get()).data();
    await __testOnlyMarkFailed(
      eventReference, v1Assessment, eventReference.collection('assessment_summaries').doc('v1'),
      'late-v1-claim', 'failed-v1-input', new Error('late v1 crash'),
    );
    expect((await v1Assessment.get()).data()?.status).toBe('failed');
    expect((await eventReference.get()).data()).toMatchObject({
      currentVersionId: 'v2', currentAssessmentId: 'v2', currentResourceId: v2ResourceId,
    });
    expect((await eventReference.collection('assessment_summaries').doc('v2').get()).data()).toEqual(v2SummaryBefore);
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents).toEqual([]);
    await releaseResourceCutoverLock(adminDb, 'late-failure-owner');
  });

  it('audits thrown queued recomputes as retryable and retains a recoverable takeover lock', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    await acquireResourceCutoverLock(adminDb, 'backup-owner', 'apply');
    const token = queueToken();
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [token] });
    const failures: Array<{ eventId: string; reason: string }> = [];
    const result = await drainQueuedResourceEvents(adminDb, 'backup-owner', failures, {
      recompute: async () => { throw new Error('transient transport failure'); },
    });
    expect(result).toEqual({ acknowledgedTokenIds: [], retryableTokenIds: [token.tokenId] });
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents).toEqual([token]);
    const audits = await adminDb.collection('events/review-1/audit_logs').get();
    expect(audits.docs.some((document) => document.data().metadata?.disposition === 'retryable_failure')).toBe(true);
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ phase: 'pre_destructive_aborted' });
    await acquireResourceCutoverLock(adminDb, 'recovery-owner', 'apply', 'backup-owner');
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents).toEqual([token]);
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [] });
    await releaseResourceCutoverLock(adminDb, 'recovery-owner');
  });

  it('preserves resource-eligible queued generations during a pre-destructive abort', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const assessment = officialAssessmentFixture('v1');
    delete (assessment as Record<string, unknown>).officialResult;
    await adminDb.doc('events/review-1/assessments/v1').set({ ...assessment, status: 'provisional_ready' });
    await acquireResourceCutoverLock(adminDb, 'abort-owner', 'apply');
    const token = queueToken();
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [token] });
    const pointerBefore = (await adminDb.doc('events/review-1').get()).data()?.currentResourceId;
    const resourcesBefore = (await adminDb.collection('events/review-1/resources').get()).size;
    await adminDb.doc('events/review-1/assessments/v1').update({ status: 'failed' });
    const raced = await drainQueuedResourceEvents(adminDb, 'abort-owner', [], {
      abortMode: true,
      beforeAbortTransaction: async () => {
        await adminDb.doc('events/review-1/assessments/v1').update({ status: 'provisional_ready' });
      },
    });
    expect(raced.retryableTokenIds).toEqual([token.tokenId]);
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents).toEqual([token]);
    expect((await adminDb.collection('events/review-1/resources').get()).size).toBe(resourcesBefore);
    await expect(abortResourceCutoverBeforeMutation(adminDb, 'abort-owner', 'backup-write:forced'))
      .rejects.toThrow(/--takeover-session=abort-owner/);
    const aborted = (await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data();
    expect(aborted).toMatchObject({ sessionId: 'abort-owner', phase: 'pre_destructive_aborted', queuedEvents: [token] });
    expect((await adminDb.collection('events/review-1/resources').get()).size).toBe(resourcesBefore);
    expect((await adminDb.doc('events/review-1').get()).data()?.currentResourceId).toBe(pointerBefore);
    await acquireResourceCutoverLock(adminDb, 'takeover-owner', 'apply', 'abort-owner');
    await drainQueuedResourceEvents(adminDb, 'takeover-owner', []);
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents).toEqual([]);
    await releaseResourceCutoverLock(adminDb, 'takeover-owner');
  });

  it('acknowledges only the processed generation token when a newer generation queues concurrently', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    await acquireResourceCutoverLock(adminDb, 'generation-owner', 'apply');
    const tokenA = queueToken();
    const tokenB = createResourceCutoverQueueToken({
      eventId: 'review-1', currentVersionId: 'v2', currentAssessmentId: 'v2',
      assessmentInputHash: 'generation-b', generationId: 'generation-b', queuedAt: 2,
    });
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [tokenA] });
    const result = await drainQueuedResourceEvents(adminDb, 'generation-owner', [], {
      recompute: async () => {
        await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: FieldValue.arrayUnion(tokenB) });
        return { status: 'created', resourceId: 'resource-a' };
      },
    });
    expect(result.acknowledgedTokenIds).toEqual([tokenA.tokenId]);
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents).toEqual([tokenB]);
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [] });
    await releaseResourceCutoverLock(adminDb, 'generation-owner');
  });

  it('acks a stale same-id token without clearing the newer assessment resource projection', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    await acquireResourceCutoverLock(adminDb, 'stale-token-owner', 'apply');
    const staleToken = createResourceCutoverQueueToken({
      eventId: 'review-1', currentVersionId: 'v1', currentAssessmentId: 'v1',
      assessmentInputHash: 'old-input-hash', generationId: 'old-generation', queuedAt: 1,
    });
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [staleToken] });
    const pointerBefore = (await adminDb.doc('events/review-1').get()).data()?.currentResourceId;
    const summaryBefore = (await adminDb.doc('events/review-1/assessment_summaries/v1').get()).data();
    await drainQueuedResourceEvents(adminDb, 'stale-token-owner', []);
    expect((await adminDb.doc('events/review-1').get()).data()?.currentResourceId).toBe(pointerBefore);
    expect((await adminDb.doc('events/review-1/assessment_summaries/v1').get()).data()).toEqual(summaryBefore);
    expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents).toEqual([]);
    await releaseResourceCutoverLock(adminDb, 'stale-token-owner');
  });

  it('restores resource documents, pointers, and organizer projections from a cutover backup', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const eventReference = adminDb.doc('events/review-1');
    const resourcePath = `events/review-1/resources/${officialResourceId('v1')}`;
    const summaryPath = 'events/review-1/assessment_summaries/v1';
    const overridePath = 'events/review-1/resource_overrides/original-override';
    const auditPath = 'events/review-1/audit_logs/original-resource-audit';
    const summaryProjection = { resourceQuantities: { police: 1 }, resourceRecommendation: { resourceId: officialResourceId('v1') } };
    const summary = { assessmentId: 'v1', status: 'official_ready', ...summaryProjection };
    const originalOverride = { resourceId: officialResourceId('v1'), police: 2 };
    const originalAudit = { action: 'resource_overridden', eventId: 'review-1', timestamp: 1 };
    await Promise.all([
      adminDb.doc(summaryPath).set(summary),
      adminDb.doc(overridePath).set(originalOverride),
      adminDb.doc(auditPath).set(originalAudit),
    ]);
    const [eventSnapshot, assessmentSnapshot, resourceSnapshot, overrideSnapshot, auditSnapshot] = await Promise.all([
      eventReference.get(), adminDb.doc('events/review-1/assessments/v1').get(), adminDb.doc(resourcePath).get(),
      adminDb.doc(overridePath).get(), adminDb.doc(auditPath).get(),
    ]);
    const backup = {
      projectId: 'linkos-496505', resourceSchemaVersion: RESOURCE_SCHEMA_VERSION, createdAt: new Date(0).toISOString(),
      cutoverSessionId: 'apply-owner',
      manifest: {
        version: 2, eventPaths: [eventReference.path],
        managedCollections: ['resources', 'resource_overrides'],
        managedAuditActions: ['resource_recommended', 'resource_overridden', 'resource_schema_cutover'],
      },
      events: [{
        path: eventReference.path,
        updatedAt: eventSnapshot.data()?.updatedAt,
        currentVersionId: eventSnapshot.data()?.currentVersionId,
        currentAssessmentId: eventSnapshot.data()?.currentAssessmentId,
        currentResourceId: eventSnapshot.data()?.currentResourceId,
        assessmentStateHash: assessmentStateHashFor(assessmentSnapshot.data()),
      }],
      resources: [{ path: resourcePath, data: encodeFirestoreValue(resourceSnapshot.data()) }],
      overrides: [{ path: overridePath, data: encodeFirestoreValue(overrideSnapshot.data()) }],
      summaries: [{ path: summaryPath, data: encodeFirestoreValue(summaryProjection) }],
      auditReferences: [{ path: auditPath, data: encodeFirestoreValue(auditSnapshot.data()) }],
    };
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'steras-resource-restore-'));
    const backupPath = path.join(temporaryDirectory, 'backup.json');
    try {
      const rawBackup = JSON.stringify(backup);
      await writeFile(backupPath, rawBackup);
      await createRestoreAnchor(adminDb, backupPath, rawBackup, 'apply-owner');
      await acquireResourceCutoverLock(adminDb, 'apply-owner', 'apply', undefined, Date.now() - RESOURCE_CUTOVER_LEASE_MS - 10);
      await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ phase: 'post_destructive' });
      await acquireResourceCutoverLock(adminDb, 'restore-owner', 'restore', 'apply-owner');
      await transitionCutoverAnchor(adminDb, 'apply-owner', 'restore-owner', 'restore_in_progress');
      await Promise.all([
        adminDb.doc(resourcePath).delete(),
        adminDb.doc('events/review-1/resources/new-cutover-resource').set({ resourceId: 'new-cutover-resource' }),
        adminDb.doc(overridePath).delete(),
        adminDb.doc('events/review-1/resource_overrides/new-cutover-override').set({ resourceId: 'new-cutover-resource' }),
        adminDb.doc('events/review-1/assessment_summaries/v2').set({ resourceRecommendation: { resourceId: 'new-cutover-resource' } }),
        adminDb.doc(auditPath).delete(),
        adminDb.doc('events/review-1/audit_logs/new-cutover-audit').set({ action: 'resource_schema_cutover' }),
        adminDb.doc('events/review-1/audit_logs/unrelated-audit').set({ action: 'decision_made' }),
        eventReference.update({ currentResourceId: FieldValue.delete() }),
        adminDb.doc(summaryPath).set({ status: 'provisional_ready' }),
      ]);
      await restoreBackup(adminDb, backupPath, backupChecksumFor(rawBackup), 'apply-owner', 'restore-owner');
      expect((await adminDb.doc(resourcePath).get()).data()).toEqual(resourceSnapshot.data());
      expect((await adminDb.doc('events/review-1/resources/new-cutover-resource').get()).exists).toBe(false);
      expect((await adminDb.doc(overridePath).get()).data()).toEqual(originalOverride);
      expect((await adminDb.doc('events/review-1/resource_overrides/new-cutover-override').get()).exists).toBe(false);
      expect((await adminDb.doc('events/review-1/assessment_summaries/v2').get()).exists).toBe(true);
      expect((await adminDb.doc(auditPath).get()).data()).toEqual(originalAudit);
      expect((await adminDb.doc('events/review-1/audit_logs/new-cutover-audit').get()).exists).toBe(false);
      expect((await adminDb.doc('events/review-1/audit_logs/unrelated-audit').get()).exists).toBe(true);
      expect((await eventReference.get()).data()?.currentResourceId).toBe(officialResourceId('v1'));
      expect((await adminDb.doc(summaryPath).get()).data()).toEqual({ status: 'provisional_ready', ...summaryProjection });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a restore backup with an out-of-scope path before mutating Firestore', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const eventReference = adminDb.doc('events/review-1');
    const before = (await eventReference.get()).data();
    const assessmentBefore = (await adminDb.doc('events/review-1/assessments/v1').get()).data();
    const maliciousBackup = {
      projectId: 'linkos-496505', resourceSchemaVersion: RESOURCE_SCHEMA_VERSION, createdAt: new Date(0).toISOString(),
      cutoverSessionId: 'apply-owner',
      manifest: {
        version: 2, eventPaths: [eventReference.path],
        managedCollections: ['resources', 'resource_overrides'],
        managedAuditActions: ['resource_recommended', 'resource_overridden', 'resource_schema_cutover'],
      },
      events: [{
        path: eventReference.path, updatedAt: before?.updatedAt,
        currentVersionId: before?.currentVersionId, currentAssessmentId: before?.currentAssessmentId,
        currentResourceId: before?.currentResourceId, assessmentStateHash: assessmentStateHashFor(assessmentBefore),
      }],
      resources: [{ path: 'users/organizer-1', data: encodeFirestoreValue({ role: 'attacker' }) }],
      overrides: [], summaries: [], auditReferences: [],
    };
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'steras-resource-hostile-restore-'));
    const backupPath = path.join(temporaryDirectory, 'backup.json');
    try {
      const rawBackup = JSON.stringify(maliciousBackup);
      await writeFile(backupPath, rawBackup);
      await expect(restoreBackup(adminDb, backupPath, backupChecksumFor(rawBackup), 'apply-owner', 'restore-owner'))
        .rejects.toThrow('outside the allowed resources scope');
      expect((await eventReference.get()).data()).toEqual(before);
      expect((await adminDb.doc('users/organizer-1').get()).data()?.role).toBe('organizer');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a tampered backup checksum before the first Firestore mutation', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const eventReference = adminDb.doc('events/review-1');
    const resourcePath = `events/review-1/resources/${officialResourceId('v1')}`;
    const [eventSnapshot, assessmentSnapshot, resourceSnapshot] = await Promise.all([
      eventReference.get(),
      adminDb.doc('events/review-1/assessments/v1').get(),
      adminDb.doc(resourcePath).get(),
    ]);
    const backup = restoreBackupFixture(eventSnapshot.data(), assessmentSnapshot.data(), resourcePath, resourceSnapshot.data());
    const trustedRaw = JSON.stringify(backup);
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'steras-resource-checksum-'));
    const backupPath = path.join(temporaryDirectory, 'backup.json');
    try {
      await writeFile(backupPath, JSON.stringify({ ...backup, createdAt: new Date(1).toISOString() }));
      await expect(restoreBackup(adminDb, backupPath, backupChecksumFor(trustedRaw), 'apply-owner', 'restore-owner')).rejects.toThrow('checksum');
      expect((await eventReference.get()).data()).toEqual(eventSnapshot.data());
      expect((await adminDb.doc(resourcePath).get()).data()).toEqual(resourceSnapshot.data());
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a missing or mismatched trusted cutover-start anchor with zero resource mutation', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const eventReference = adminDb.doc('events/review-1');
    const resourcePath = `events/review-1/resources/${officialResourceId('v1')}`;
    const [eventSnapshot, assessmentSnapshot, resourceSnapshot] = await Promise.all([
      eventReference.get(), adminDb.doc('events/review-1/assessments/v1').get(), adminDb.doc(resourcePath).get(),
    ]);
    const backup = restoreBackupFixture(eventSnapshot.data(), assessmentSnapshot.data(), resourcePath, resourceSnapshot.data());
    const rawBackup = JSON.stringify(backup);
    const checksum = backupChecksumFor(rawBackup);
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'steras-resource-anchor-'));
    const backupPath = path.join(temporaryDirectory, 'backup.json');
    try {
      await writeFile(backupPath, rawBackup);
      await expect(restoreBackup(adminDb, backupPath, checksum, 'apply-owner', 'restore-owner')).rejects.toThrow('Trusted cutover start audit');
      expect((await eventReference.get()).data()).toEqual(eventSnapshot.data());
      expect((await adminDb.doc(resourcePath).get()).data()).toEqual(resourceSnapshot.data());
      await createAndVerifyCutoverStartAudit(adminDb, {
        action: 'resource_cutover_start', sessionId: 'apply-owner', projectId: 'linkos-496505',
        backupId: path.basename(temporaryDirectory), backupPath, backupChecksum: 'f'.repeat(64),
        resourceSchemaVersion: RESOURCE_SCHEMA_VERSION, createdAt: 1,
      });
      await expect(restoreBackup(adminDb, backupPath, checksum, 'apply-owner', 'restore-owner')).rejects.toThrow('does not match');
      expect((await eventReference.get()).data()).toEqual(eventSnapshot.data());
      expect((await adminDb.doc(resourcePath).get()).data()).toEqual(resourceSnapshot.data());
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects replay of a completed backup before any resource mutation', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const eventReference = adminDb.doc('events/review-1');
    const resourcePath = `events/review-1/resources/${officialResourceId('v1')}`;
    const [eventSnapshot, assessmentSnapshot, resourceSnapshot] = await Promise.all([
      eventReference.get(), adminDb.doc('events/review-1/assessments/v1').get(), adminDb.doc(resourcePath).get(),
    ]);
    const backup = restoreBackupFixture(eventSnapshot.data(), assessmentSnapshot.data(), resourcePath, resourceSnapshot.data());
    const rawBackup = JSON.stringify(backup);
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'steras-resource-replay-'));
    const backupPath = path.join(temporaryDirectory, 'backup.json');
    try {
      await writeFile(backupPath, rawBackup);
      await createRestoreAnchor(adminDb, backupPath, rawBackup, 'apply-owner');
      await adminDb.collection('system_controls/m2_resource_v3_cutover/cutover_start_audits')
        .doc('apply-owner').update({ lifecycle: 'restore_in_progress', phase: 'restore', restoreSessionId: 'ghost-restore' });
      await expect(restoreBackup(
        adminDb, backupPath, backupChecksumFor(rawBackup), 'apply-owner', 'ghost-restore',
      )).rejects.toThrow(/Restore lock ownership is missing, expired, or changed/);
      expect((await adminDb.doc(resourcePath).get()).data()).toEqual(resourceSnapshot.data());
      await adminDb.collection('system_controls/m2_resource_v3_cutover/cutover_start_audits')
        .doc('apply-owner').update({ lifecycle: 'completed', phase: 'completed' });
      await adminDb.doc('events/review-1/resources/newer-resource').set({ resourceId: 'newer-resource' });
      await expect(restoreBackup(adminDb, backupPath, backupChecksumFor(rawBackup), 'apply-owner', 'restore-owner'))
        .rejects.toThrow('Trusted cutover start audit');
      expect((await adminDb.doc('events/review-1/resources/newer-resource').get()).exists).toBe(true);
      expect((await eventReference.get()).data()).toEqual(eventSnapshot.data());
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('fences an old restore owner when takeover occurs between classification and mutation', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const eventReference = adminDb.doc('events/review-1');
    const resourcePath = `events/review-1/resources/${officialResourceId('v1')}`;
    const assessmentReference = adminDb.doc('events/review-1/assessments/v1');
    const [eventSnapshot, assessmentSnapshot, resourceSnapshot] = await Promise.all([
      eventReference.get(), assessmentReference.get(), adminDb.doc(resourcePath).get(),
    ]);
    const backup = restoreBackupFixture(eventSnapshot.data(), assessmentSnapshot.data(), resourcePath, resourceSnapshot.data());
    const rawBackup = JSON.stringify(backup);
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'steras-resource-fenced-restore-'));
    const backupPath = path.join(temporaryDirectory, 'backup.json');
    try {
      await writeFile(backupPath, rawBackup);
      await createRestoreAnchor(adminDb, backupPath, rawBackup, 'apply-owner');
      const expiredStart = Date.now() - RESOURCE_CUTOVER_LEASE_MS - 10;
      await acquireResourceCutoverLock(adminDb, 'apply-owner', 'apply', undefined, expiredStart);
      await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ phase: 'post_destructive' });
      await acquireResourceCutoverLock(adminDb, 'old-restore', 'restore', 'apply-owner');
      await transitionCutoverAnchor(adminDb, 'apply-owner', 'old-restore', 'restore_in_progress');
      await adminDb.doc(resourcePath).delete();
      await expect(restoreBackup(
        adminDb, backupPath, backupChecksumFor(rawBackup), 'apply-owner', 'old-restore', {
          beforeAffectedEventTransaction: async () => {
            await assessmentReference.update({ inputHash: 'new-generation' });
            await adminDb.doc('events/review-1/resources/new-generation').set({ resourceId: 'new-generation' });
            await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ leaseExpiresAt: 1 });
            await acquireResourceCutoverLock(adminDb, 'new-restore', 'restore', 'apply-owner');
            await transitionCutoverAnchor(adminDb, 'apply-owner', 'new-restore', 'restore_in_progress');
          },
        },
      )).rejects.toThrow(/ownership changed/);
      expect((await adminDb.doc(resourcePath).get()).exists).toBe(false);
      expect((await adminDb.doc('events/review-1/resources/new-generation').get()).exists).toBe(true);
      const result = await restoreBackup(
        adminDb, backupPath, backupChecksumFor(rawBackup), 'apply-owner', 'new-restore',
      );
      expect(result.deferredEventIds).toEqual(['review-1']);
      expect((await adminDb.doc('events/review-1/resources/new-generation').get()).exists).toBe(true);
      await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [] });
      await releaseResourceCutoverLock(adminDb, 'new-restore');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('defers an in-flight assessment finalization without overwriting its pointer or summary', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const eventReference = adminDb.doc('events/review-1');
    const resourcePath = `events/review-1/resources/${officialResourceId('v1')}`;
    const summaryPath = 'events/review-1/assessment_summaries/v1';
    const assessmentReference = adminDb.doc('events/review-1/assessments/v1');
    const [eventSnapshot, assessmentSnapshot, resourceSnapshot] = await Promise.all([
      eventReference.get(), assessmentReference.get(), adminDb.doc(resourcePath).get(),
    ]);
    const backup = {
      ...restoreBackupFixture(eventSnapshot.data(), assessmentSnapshot.data(), resourcePath, resourceSnapshot.data()),
      cutoverSessionId: 'apply-owner',
      summaries: [{
        path: summaryPath,
        data: encodeFirestoreValue({
          resourceQuantities: { police: 1 },
          resourceRecommendation: { resourceId: officialResourceId('v1') },
        }),
      }],
    };
    const rawBackup = JSON.stringify(backup);
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'steras-resource-concurrent-restore-'));
    const backupPath = path.join(temporaryDirectory, 'backup.json');
    try {
      await writeFile(backupPath, rawBackup);
      await createRestoreAnchor(adminDb, backupPath, rawBackup, 'apply-owner');
      await acquireResourceCutoverLock(adminDb, 'apply-owner', 'apply');
      await Promise.all([
        assessmentReference.update({ status: 'authority_review', inputHash: 'finalized-after-backup' }),
        eventReference.update({ currentResourceId: FieldValue.delete() }),
        adminDb.doc('events/review-1/resources/newer-resource').set({ resourceId: 'newer-resource' }),
        adminDb.doc('events/review-1/resource_overrides/newer-override').set({ resourceId: 'newer-resource' }),
        adminDb.doc('events/review-1/audit_logs/newer-audit').set({ action: 'resource_recommended', generation: 'newer' }),
        adminDb.doc(summaryPath).set({
          status: 'authority_review', assessmentId: 'v1', internalFinalizationMarker: 'preserve-me',
        }),
      ]);
      const queuedBeforeRestore = queueToken('finalized-after-backup');
      await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({
        phase: 'post_destructive', leaseExpiresAt: 1, queuedEvents: [queuedBeforeRestore],
      });
      await acquireResourceCutoverLock(adminDb, 'restore-owner', 'restore', 'apply-owner');
      await transitionCutoverAnchor(adminDb, 'apply-owner', 'restore-owner', 'restore_in_progress');
      const result = await restoreBackup(
        adminDb, backupPath, backupChecksumFor(rawBackup), 'apply-owner', 'restore-owner',
      );
      expect(result.deferredEventIds).toEqual(['review-1']);
      expect((await eventReference.get()).data()?.currentResourceId).toBeUndefined();
      expect((await adminDb.doc(summaryPath).get()).data()).toEqual({
        status: 'authority_review', assessmentId: 'v1', internalFinalizationMarker: 'preserve-me',
      });
      expect((await adminDb.doc('events/review-1/resources/newer-resource').get()).exists).toBe(true);
      expect((await adminDb.doc('events/review-1/resource_overrides/newer-override').get()).exists).toBe(true);
      expect((await adminDb.doc('events/review-1/audit_logs/newer-audit').get()).data()?.generation).toBe('newer');
      expect((await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents)
        .toEqual(expect.arrayContaining([queuedBeforeRestore]));
      await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).update({ queuedEvents: [] });
      await releaseResourceCutoverLock(adminDb, 'restore-owner');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('allows public reads only from the sanitized public collection', async () => {
    await seedProfilesAndEvent();
    const db = environment.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'public_events/event-1')));
    await assertFails(getDoc(doc(db, 'events/event-1')));
  });

  it('limits historical evidence and dataset manifests to authority reviewers', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
      await setDoc(doc(db, 'users/authority-1'), { role: 'authority', authorityType: 'KKM' });
      await setDoc(doc(db, 'historical_events/history-1'), { synthetic: true });
      await setDoc(doc(db, 'dataset_manifests/demo-v1'), { synthetic: true });
    });
    const authorityDb = environment.authenticatedContext('authority-1').firestore();
    const organizerDb = environment.authenticatedContext('organizer-1').firestore();
    await assertSucceeds(getDoc(doc(authorityDb, 'historical_events/history-1')));
    await assertSucceeds(getDoc(doc(authorityDb, 'dataset_manifests/demo-v1')));
    await assertFails(getDoc(doc(organizerDb, 'historical_events/history-1')));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'dataset_manifests/demo-v1')));
  });
});

async function seedReviewableEvent(requiredAuthorities: string[]) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
    await setDoc(doc(db, 'users/pdrm-1'), { role: 'authority', authorityType: 'PDRM' });
    await setDoc(doc(db, 'users/bomba-1'), { role: 'authority', authorityType: 'BOMBA' });
    await setDoc(doc(db, 'events/review-1'), {
      eventId: 'review-1', organizerId: 'organizer-1', eventDetails: validDetails, status: 'Pending',
      currentVersionId: 'v1', currentVersionNumber: 1, currentAssessmentId: 'v1', currentResourceId: officialResourceId('v1'),
      editableVersionId: null, draftDocumentPaths: [], requiredAuthorities, createdAt: 1, updatedAt: 1,
    });
    await setDoc(doc(db, 'events/review-1/versions/v1'), {
      versionId: 'v1', eventId: 'review-1', versionNumber: 1, eventDetails: validDetails, documentPaths: [], submittedBy: 'organizer-1', submittedAt: 1, inputHash: 'hash',
    });
    await setDoc(doc(db, `events/review-1/resources/${officialResourceId('v1')}`), officialResourceFixture('v1', 1));
    await setDoc(doc(db, 'events/review-1/assessments/v1'), officialAssessmentFixture('v1'));
  });
}

function restoreBackupFixture(
  eventData: FirebaseFirestore.DocumentData | undefined,
  assessmentData: FirebaseFirestore.DocumentData | undefined,
  resourcePath: string,
  resourceData: FirebaseFirestore.DocumentData | undefined,
) {
  return {
    projectId: 'linkos-496505',
    resourceSchemaVersion: RESOURCE_SCHEMA_VERSION,
    createdAt: new Date(0).toISOString(),
    cutoverSessionId: 'apply-owner',
    manifest: {
      version: 2,
      eventPaths: ['events/review-1'],
      managedCollections: ['resources', 'resource_overrides'],
      managedAuditActions: ['resource_recommended', 'resource_overridden', 'resource_schema_cutover'],
    },
    events: [{
      path: 'events/review-1',
      updatedAt: eventData?.updatedAt,
      currentVersionId: eventData?.currentVersionId,
      currentAssessmentId: eventData?.currentAssessmentId,
      currentResourceId: eventData?.currentResourceId,
      assessmentStateHash: assessmentStateHashFor(assessmentData),
    }],
    resources: [{ path: resourcePath, data: encodeFirestoreValue(resourceData) }],
    overrides: [],
    summaries: [],
    auditReferences: [],
  };
}

async function createRestoreAnchor(
  db: ReturnType<typeof getFirestore>,
  backupPath: string,
  rawBackup: string,
  sessionId: string,
): Promise<void> {
  await createAndVerifyCutoverStartAudit(db, {
    action: 'resource_cutover_start',
    sessionId,
    projectId: 'linkos-496505',
    backupId: path.basename(path.dirname(backupPath)),
    backupPath,
    backupChecksum: backupChecksumFor(rawBackup),
    resourceSchemaVersion: RESOURCE_SCHEMA_VERSION,
    createdAt: 1,
  });
}

function queueToken(inputHash?: string) {
  return createResourceCutoverQueueToken({
    eventId: 'review-1',
    currentVersionId: 'v1',
    currentAssessmentId: 'v1',
    ...(inputHash ? { assessmentInputHash: inputHash } : {}),
    generationId: `test-${inputHash ?? 'current'}`,
    queuedAt: 1,
  });
}

function officialAssessmentFixture(versionId: string) {
  const categories = ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({
    categoryId: category.id, categoryName: category.name,
    proposedLikelihood: 5, proposedSeverity: 5, validatedLikelihood: 5, validatedSeverity: 5,
    matrixScore: 25, normalizedScore: 100, riskLevel: 'High', weight: category.weight,
    weightedContribution: 12.5, evidenceReferences: ['crowd'], rationale: 'Test', confidence: 'high',
    concerns: [], missingInformation: [], appliedHardRules: [], guidelineChecks: [...category.guidelineChecks],
  }));
  const result = {
    proposalId: `proposal-${versionId}`, validatedHazards: [], categories, overallScore: 100,
    weightedRiskLevel: 'High', highestCategoryRiskLevel: 'High', overallRiskLevel: 'High',
    formulaVersion: PROVISIONAL_FORMULA_VERSION, categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    hardRuleVersion: HARD_RULE_VERSION, calculatedAt: 1,
  };
  return {
    status: 'official_ready',
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    assessmentId: versionId,
    eventId: 'review-1',
    versionId,
    assessmentReadiness: 'complete',
    complianceStatus: 'pass',
    contextSnapshot: benignContextSnapshot(),
    inputHash: `assessment-${versionId}`,
    evidence: [{ key: 'crowd', description: 'Test attendance evidence', sourceTimestamp: 1, source: 'test', status: 'available', quality: 'verified' }],
    createdAt: 1,
    aiProposal: {
      status: 'success', proposalId: `proposal-${versionId}`, model: 'test-model', promptVersion: 'test-prompt',
      responseSchemaVersion: 'test-schema', cacheStatus: 'miss', generatedAt: 1, hazards: [],
      categories: categories.map((category) => ({
        categoryId: category.categoryId, likelihood: category.proposedLikelihood, severity: category.proposedSeverity,
        evidenceReferences: category.evidenceReferences, rationale: category.rationale, confidence: category.confidence,
        concerns: category.concerns, missingInformation: category.missingInformation,
      })),
    },
    provisionalResult: result,
    officialResult: { ...result, finalizedAt: 2, finalizedBy: 'authority-1' },
  };
}

function benignContextSnapshot() {
  return {
    weather: {
      data: { forecast: 'Clear', temperature: 25, humidity: 50, windSpeed: 1, precipitationProbability: 0, severeAlert: false },
      source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 2, forecastFor: 10_000,
    },
    calendar: {
      localDate: '2026-08-19', dayOfWeek: 'Wednesday', isWeekend: false, isHolidayOrAdjacent: false,
      holidayDistanceDays: 10, sourceVersion: 'test', sourceTimestamp: 1,
    },
    venue: { matched: true, venueId: 'venue-1', submittedCapacity: 1_000, registeredCapacity: 1_000, capacityDifference: 0, fetchedAt: 1 },
    incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, fetchedAt: 1 },
  };
}

function officialResourceFixture(versionId: string, computedAt: number, eventDetails = validDetails) {
  const calculation = officialResourceCalculation(versionId, eventDetails);
  const items = Object.fromEntries(RESOURCE_KEYS.map((resource) => [resource, {
    ...calculation.items[resource], confidence: 'authority_validated', authorityReviewRequired: false,
  }]));
  return {
    resourceId: officialResourceId(versionId, eventDetails), eventId: 'review-1', versionId, assessmentId: versionId,
    schemaVersion: RESOURCE_SCHEMA_VERSION, stage: 'official', revision: 1, supersedesResourceId: null,
    assessmentReference: { stage: 'official', assessmentId: versionId, proposalId: `proposal-${versionId}`, finalizedAt: 2, finalizedBy: 'authority-1' },
    resourceInputHash: calculation.resourceInputHash, formulaVersion: RESOURCE_FORMULA_VERSION, configVersion: RESOURCE_CONFIG_VERSION,
    sourceRegistryVersion: RESOURCE_SOURCE_REGISTRY_VERSION, items,
    confidenceLevel: 'authority_validated', authorityReviewRequired: false, computedAt,
  };
}

function provisionalResourceFixture(versionId: string, computedAt: number) {
  const official = officialResourceFixture(versionId, computedAt);
  const resourceInputHash = 'd'.repeat(64);
  const items = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, {
    ...official.items[key], confidence: 'prototype', authorityReviewRequired: true,
  }]));
  return {
    ...official,
    resourceId: `provisional-${versionId}-${resourceInputHash}`,
    stage: 'provisional',
    revision: 1,
    supersedesResourceId: null,
    assessmentReference: { stage: 'provisional', assessmentId: versionId, proposalId: `proposal-${versionId}` },
    resourceInputHash,
    items,
    confidenceLevel: 'prototype',
    authorityReviewRequired: true,
  };
}

function officialResourceId(versionId: string, eventDetails = validDetails): string {
  return `official-${versionId}-${officialResourceCalculation(versionId, eventDetails).resourceInputHash}`;
}

function officialResourceCalculation(versionId: string, eventDetails = validDetails) {
  const assessment = officialAssessmentFixture(versionId);
  const calculation = computeResources({
    eventId: 'review-1', versionId, assessmentId: versionId, eventDetails,
    assessmentResult: assessment.officialResult,
  });
  if (!calculation.ok) throw new Error(calculation.message);
  return calculation;
}
