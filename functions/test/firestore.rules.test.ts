import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { submitEventForUser } from '../src/http/submitEvent';
import { withdrawEventForUser } from '../src/http/withdrawEvent';
import { runRiskAndResourcePipeline } from '../src/triggers/onEventCreated';
import { makeAuthorityDecisionForUser } from '../src/http/authorityDecision';
import { overrideResourcesForUser } from '../src/http/overrideResources';

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
    await setDoc(doc(db, 'events/event-1/assessments/v1'), { finalScore: 50 });
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
      const resources = await adminDb.collection('events/draft-1/resources').get();
      const audits = await adminDb.collection('events/draft-1/audit_logs').get();
      expect(assessment.data()).toMatchObject({ status: 'ready', versionId: 'v1' });
      expect(resources.docs.map((item) => item.id)).toEqual(['v1']);
      expect(audits.docs.map((item) => item.id).sort()).toEqual([
        '1000-submitted-v1',
        'v1-resource-recommended',
        'v1-risk-score-computed',
      ]);
    } finally {
      if (minimaxKey) process.env.MINIMAX_API_KEY = minimaxKey;
      if (weatherKey) process.env.OPENWEATHER_API_KEY = weatherKey;
    }
  });

  it('allows an organizer to read the owned assessment but not write it', async () => {
    await seedProfilesAndEvent();
    const db = environment.authenticatedContext('organizer-1').firestore();
    await assertSucceeds(getDoc(doc(db, 'events/event-1/assessments/v1')));
    await assertFails(setDoc(doc(db, 'events/event-1/assessments/v1'), { finalScore: 1 }));
  });

  it('allows assigned authorities to read applications and rejects unassigned authorities', async () => {
    await seedProfilesAndEvent();
    await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'users/authority-2'), { role: 'authority', authorityType: 'KKM' }));
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('authority-1').firestore(), 'events/event-1')));
    await assertFails(getDoc(doc(environment.authenticatedContext('authority-2').firestore(), 'events/event-1')));
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

  it('does not carry authority approvals into a resubmitted version', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    await makeAuthorityDecisionForUser('pdrm-1', {
      eventId: 'review-1', decision: 'Approved', rationale: 'PDRM approves the version one operating plan.',
    }, 3_100);
    await makeAuthorityDecisionForUser('bomba-1', {
      eventId: 'review-1', decision: 'AmendmentRequested', rationale: 'Revise the version one emergency exit arrangement.',
    }, 3_101);

    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/review-1').update({
      eventDetails: {
        ...validDetails,
        startDatetime: 20_000,
        endDatetime: 30_000,
        emergencyPlanSummary: 'Revised emergency exits and fire assembly points.',
      },
    });
    await submitEventForUser('organizer-1', 'review-1', 3_200);
    await adminDb.doc('events/review-1').update({ currentAssessmentId: 'v2', currentResourceId: 'v2' });
    await adminDb.doc('events/review-1/resources/v2').set({
      resourceId: 'v2', eventId: 'review-1', versionId: 'v2', assessmentId: 'v2', police: 8, medicalTeams: 2,
      ambulances: 1, toilets: 50, wasteBins: 15, security: 20, fireOfficers: 3,
      formulaVersion: 'test', confidenceLevel: 'prototype', computedAt: 3_201,
    });

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

  it('stores an auditable authority resource override', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const quantities = { police: 12, medicalTeams: 3, ambulances: 2, toilets: 60, wasteBins: 20, security: 25, fireOfficers: 4 };
    await overrideResourcesForUser('pdrm-1', { eventId: 'review-1', quantities, rationale: 'Increased staffing for controlled entry and traffic management.' }, 4_000);
    const adminDb = getFirestore(adminApp);
    expect((await adminDb.doc('events/review-1/resources/v1').get()).data()).toMatchObject({ ...quantities, confidenceLevel: 'authorityValidated', overriddenBy: 'pdrm-1' });
    expect((await adminDb.collection('events/review-1/resource_overrides').get()).size).toBe(1);
  });

  it('allows public reads only from the sanitized public collection', async () => {
    await seedProfilesAndEvent();
    const db = environment.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'public_events/event-1')));
    await assertFails(getDoc(doc(db, 'events/event-1')));
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
      currentVersionId: 'v1', currentVersionNumber: 1, currentAssessmentId: 'v1', currentResourceId: 'v1',
      editableVersionId: null, draftDocumentPaths: [], requiredAuthorities, createdAt: 1, updatedAt: 1,
    });
    await setDoc(doc(db, 'events/review-1/versions/v1'), {
      versionId: 'v1', eventId: 'review-1', versionNumber: 1, eventDetails: validDetails, documentPaths: [], submittedBy: 'organizer-1', submittedAt: 1, inputHash: 'hash',
    });
    await setDoc(doc(db, 'events/review-1/resources/v1'), {
      resourceId: 'v1', eventId: 'review-1', versionId: 'v1', assessmentId: 'v1', police: 8, medicalTeams: 2,
      ambulances: 1, toilets: 50, wasteBins: 15, security: 20, fireOfficers: 3,
      formulaVersion: 'test', confidenceLevel: 'prototype', computedAt: 1,
    });
  });
}
