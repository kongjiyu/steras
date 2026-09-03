import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { submitEventForUser } from '../src/http/submitEvent';
import { withdrawEventForUser } from '../src/http/withdrawEvent';
import { cancelEventForUser, prepareApplicationRevisionForUser } from '../src/http/applicationLifecycle';
import { __testOnlyMarkFailed, __testOnlyPersistResourceCalculation, recomputeResourceForStoredAssessment, runRiskAndResourcePipeline } from '../src/triggers/onEventCreated';
import { makeAuthorityDecisionForUser } from '../src/http/authorityDecision';
import { makeInitialReviewDecisionForUser } from '../src/http/initialReview';
import {
  submitScoreReviewForUser,
  resolveScoreConflictForAdmin,
  retryOfficialFinalisationForAdmin,
} from '../src/http/authorityScoreReview';
import { overrideResourcesForUser } from '../src/http/overrideResources';
import {
  __testOnly as manualAssessmentTestOnly,
  retryManualOfficialFinalisationForAdmin,
  submitAdminManualAssessmentForUser,
} from '../src/http/adminManualAssessment';
import { fetchHistoricalContext, fetchVenueContext } from '../src/engines/ruleBased';
import {
  ASSESSMENT_SCHEMA_VERSION, HARD_RULE_VERSION, PROVISIONAL_FORMULA_VERSION,
  SCORE_REVIEW_SCHEMA_VERSION,
  RESOURCE_CONFIG_VERSION, RESOURCE_FORMULA_VERSION, RESOURCE_KEYS, RESOURCE_SCHEMA_VERSION, RESOURCE_SOURCE_REGISTRY_VERSION,
} from '@shared/types';
import { ACTIVE_CATEGORY_SCHEMA } from '../src/config/categorySchema';
import { computeResources } from '../src/engines/resourceCalculator';
import { buildAuthorityReviewState, buildOfficialAssessmentResult } from '../src/engines/authorityFinalisation';
import { m1EvidenceRequirementsFor } from '@shared/m1EvidenceContract';
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
import { __testOnlyRollbackHardeningAttempt } from '../src/scripts/cutoverM2Hardening';
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
  adminApp = initializeApp({ projectId: 'steras-test', storageBucket: 'steras-test.appspot.com' });
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
  riskProfile: {
    internationalAttendees: false, alcoholServed: false, foodServed: true, freeDrinkingWater: true,
    ticketedEntry: true, overnightAccommodation: false, pyrotechnics: false, temporaryStructures: false,
    rivalryOrTensionExpected: false, crowdManagementPlan: true, trafficManagementPlan: true,
    severeWeatherPlan: true, medicalPlan: true, evacuationPlanTested: true,
    authorityCoordinationConfirmed: true, vulnerableAttendeesPercent: 10, standingAttendeesPercent: 20,
    nearestHospitalTravelMinutes: 15,
  },
};

const validTemplateSelection = {
  eventCategory: 'cultural_heritage_festival',
  venueSetting: 'outdoor_fixed_site',
  coreTemplateId: 'STERAS-CORE',
  scenarioTemplateId: 'STERAS-T08-CUL-OF-v1.0',
  templateRegistryVersion: '2026-08-28-v1',
  selectedAt: 1,
};

async function uploadTestEvidence(eventId: string, versionId: string): Promise<string> {
  const evidencePath = `event_documents/${eventId}/${versionId}/evidence.pdf`;
  await getStorage(adminApp).bucket().file(evidencePath).save(Buffer.from('%PDF-1.4\ntest\n%%EOF\n'), {
    resumable: false,
    metadata: { contentType: 'application/pdf' },
  });
  return evidencePath;
}

async function uploadTestDocx(eventId: string, versionId: string, role: 'core_template' | 'scenario_template', sourcePath: string) {
  const bytes = readFileSync(sourcePath);
  const originalName = sourcePath.split('/').pop()!;
  const evidencePath = `event_documents/${eventId}/${versionId}/${role}.docx`;
  await getStorage(adminApp).bucket().file(evidencePath).save(bytes, {
    resumable: false,
    metadata: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  });
  return { path: evidencePath, role, originalName, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: bytes.length, uploadedAt: 1, schemaVersion: '2026-08-28-document-v1' };
}

async function seedProfilesAndEvent() {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
    await setDoc(doc(db, 'users/authority-1'), { role: 'authority', authorityType: 'PDRM' });
    await setDoc(doc(db, 'events/event-1'), {
      organizerId: 'organizer-1', status: 'Pending', requiredAuthorities: ['PDRM'],
      assignedOfficerUids: ['authority-1'], assignedOfficerByAuthority: { PDRM: 'authority-1' },
    });
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
  it('keeps organizer drafts private from Admin until submission', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/admin-1'), { role: 'admin' });
      await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
      await setDoc(doc(db, 'users/public-1'), { role: 'public' });
      await setDoc(doc(db, 'events/draft-private'), {
        organizerId: 'organizer-1', eventDetails: validDetails, status: 'Draft', currentVersionNumber: 0,
        editableVersionId: 'v1', draftDocumentPaths: [], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      });
      await setDoc(doc(db, 'events/draft-private/versions/v1'), { eventId: 'draft-private', versionId: 'v1' });
      await setDoc(doc(db, 'events/draft-private/event_controls/control-1'), { controlId: 'control-1' });
    });
    const adminDb = environment.authenticatedContext('admin-1').firestore();
    const organizerDb = environment.authenticatedContext('organizer-1').firestore();
    const publicDb = environment.authenticatedContext('public-1').firestore();
    await assertFails(getDoc(doc(adminDb, 'events/draft-private')));
    await assertFails(getDoc(doc(adminDb, 'events/draft-private/versions/v1')));
    await assertFails(getDoc(doc(adminDb, 'events/draft-private/event_controls/control-1')));
    await assertSucceeds(getDoc(doc(organizerDb, 'events/draft-private')));
    await assertSucceeds(getDoc(doc(organizerDb, 'events/draft-private/versions/v1')));
    await assertSucceeds(getDoc(doc(organizerDb, 'events/draft-private/event_controls/control-1')));
    await assertFails(getDoc(doc(publicDb, 'events/draft-private/event_controls/control-1')));
    await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'events/submitted-visible'), {
      organizerId: 'organizer-1', eventDetails: validDetails, status: 'Pending', currentVersionNumber: 1,
      requiredAuthorities: ['PDRM'], createdAt: 2, updatedAt: 2,
    }));
    const submittedQuery = query(collection(adminDb, 'events'), where('status', 'in', [
      'Pending', 'UnderReview', 'Approved', 'Rejected', 'Withdrawn', 'Manual Review Required',
    ]));
    const submitted = await assertSucceeds(getDocs(submittedQuery));
    expect(submitted.docs.map((item) => item.id)).toEqual(['submitted-visible']);
    await assertFails(getDocs(collection(adminDb, 'events')));
  });

  it('keeps privileged accounts, venue mutations, and admin operation records backend-only', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/admin-1'), { uid: 'admin-1', role: 'admin' });
      await setDoc(doc(db, 'users/organizer-1'), { uid: 'organizer-1', role: 'organizer' });
      await setDoc(doc(db, 'venues/venue-1'), { venueId: 'venue-1', active: true, verificationStatus: 'verified', name: 'Venue', address: 'Address', capacity: 100, location: { lat: 1, lng: 1 } });
      await setDoc(doc(db, 'venues/venue-1/audit_logs/1-created'), { action: 'venue_created' });
      await setDoc(doc(db, 'admin_audit_logs/account-1'), { action: 'privileged_account_created' });
    });
    const adminDb = environment.authenticatedContext('admin-1').firestore();
    const organizerDb = environment.authenticatedContext('organizer-1').firestore();
    await assertFails(setDoc(doc(adminDb, 'users/authority-forged'), { uid: 'authority-forged', role: 'authority', authorityType: 'PDRM' }));
    await assertFails(updateDoc(doc(adminDb, 'venues/venue-1'), { active: false }));
    await assertFails(setDoc(doc(adminDb, 'admin_operations/op-1'), { kind: 'save_venue' }));
    await assertSucceeds(getDoc(doc(adminDb, 'venues/venue-1/audit_logs/1-created')));
    await assertFails(getDoc(doc(organizerDb, 'venues/venue-1/audit_logs/1-created')));
    await assertSucceeds(getDoc(doc(adminDb, 'admin_audit_logs/account-1')));
    await assertFails(getDoc(doc(organizerDb, 'admin_audit_logs/account-1')));
  });

  it('keeps submission notifications server-written and recipient-scoped', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/admin-1'), { uid: 'admin-1', role: 'admin' });
      await setDoc(doc(db, 'users/organizer-1'), { uid: 'organizer-1', role: 'organizer' });
      await setDoc(doc(db, 'users/organizer-2'), { uid: 'organizer-2', role: 'organizer' });
      await setDoc(doc(db, 'notifications/admin-submission-1'), {
        notificationId: 'admin-submission-1', recipientUid: 'admin-1', eventId: 'event-1', versionId: 'v1',
        type: 'application_submitted_for_review', title: 'New application submitted', message: 'Event (v1) is ready for administrative review.',
        sourceActionId: 'application-submitted:event-1:v1', read: false, createdAt: 1,
      });
    });
    const adminDb = environment.authenticatedContext('admin-1').firestore();
    const recipientDb = environment.authenticatedContext('organizer-1').firestore();
    const otherDb = environment.authenticatedContext('organizer-2').firestore();
    await assertSucceeds(getDoc(doc(adminDb, 'notifications/admin-submission-1')));
    await assertFails(getDoc(doc(recipientDb, 'notifications/admin-submission-1')));
    await assertFails(getDoc(doc(otherDb, 'notifications/admin-submission-1')));
    await assertFails(setDoc(doc(adminDb, 'notifications/forged'), { recipientUid: 'admin-1' }));
    await assertFails(updateDoc(doc(adminDb, 'notifications/admin-submission-1'), { read: true }));
  });

  it('prepares Pending edits and rejected revisions without mutating submitted versions', async () => {
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('users/organizer-1').set({ role: 'organizer' });
    await adminDb.doc('events/lifecycle-1').set({
      organizerId: 'organizer-1', eventDetails: validDetails, templateSelection: validTemplateSelection,
      status: 'Pending', currentVersionId: 'v1', currentVersionNumber: 1, editableVersionId: null,
      draftDocumentPaths: ['event_documents/lifecycle-1/v1/original.pdf'], requiredAuthorities: ['PDRM'],
      assignedOfficerUids: [], assignedOfficerByAuthority: {}, reviewStage: 'initial', createdAt: 1, updatedAt: 1,
    });
    const lifecycleV1 = { eventId: 'lifecycle-1', versionId: 'v1', versionNumber: 1, marker: 'immutable-original' };
    await adminDb.doc('events/lifecycle-1/versions/v1').set(lifecycleV1);

    await expect(prepareApplicationRevisionForUser('organizer-1', 'lifecycle-1', 10)).resolves.toMatchObject({
      status: 'Draft', editableVersionId: 'v2', revisionKind: 'pending_edit',
    });
    await expect(prepareApplicationRevisionForUser('organizer-1', 'lifecycle-1', 11)).resolves.toMatchObject({ status: 'Draft', editableVersionId: 'v2' });
    const pendingEdit = (await adminDb.doc('events/lifecycle-1').get()).data()!;
    expect(pendingEdit).toMatchObject({ status: 'Draft', editableVersionId: 'v2', draftDocumentPaths: [], draftDocuments: [] });
    expect(pendingEdit.activeRevision).toEqual({ kind: 'pending_edit', sourceVersionId: 'v1', startedAt: 10 });
    expect(pendingEdit.draftEvidenceManifest).toHaveLength(17);
    expect((await adminDb.doc('events/lifecycle-1/versions/v1').get()).data()).toEqual(lifecycleV1);

    await adminDb.doc('events/lifecycle-2').set({
      organizerId: 'organizer-1', eventDetails: validDetails, templateSelection: validTemplateSelection,
      status: 'Rejected', currentVersionId: 'v1', currentVersionNumber: 1, editableVersionId: null,
      draftDocumentPaths: [], requiredAuthorities: [], reviewStage: 'closed', createdAt: 1, updatedAt: 1,
      initialReview: { decision: 'Rejected', reason: 'Missing signed route plan.', suggestion: 'Attach the signed route plan.', reviewerUid: 'admin-1', reviewedAt: 5 },
    });
    await adminDb.doc('events/lifecycle-2/versions/v1').set({ eventId: 'lifecycle-2', versionId: 'v1', versionNumber: 1 });
    await prepareApplicationRevisionForUser('organizer-1', 'lifecycle-2', 20);
    expect((await adminDb.doc('events/lifecycle-2').get()).data()?.activeRevision).toEqual({
      kind: 'rejected_revision', sourceVersionId: 'v1', startedAt: 20,
      rejectionReason: 'Missing signed route plan.', rejectionSuggestion: 'Attach the signed route plan.',
    });
  });

  it('cancels only pre-review Pending applications and withdraws eligible records atomically from public view', async () => {
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('users/organizer-1').set({ role: 'organizer' });
    const base = {
      organizerId: 'organizer-1', eventDetails: validDetails, status: 'Pending', currentVersionId: 'v1', currentVersionNumber: 1,
      editableVersionId: null, draftDocumentPaths: [], requiredAuthorities: [], assignedOfficerUids: [], assignedOfficerByAuthority: {}, reviewStage: 'initial', createdAt: 1, updatedAt: 1,
    };
    await adminDb.doc('events/cancel-1').set(base);
    await adminDb.doc('events/cancel-1/versions/v1').set({ eventId: 'cancel-1', versionId: 'v1', versionNumber: 1 });
    await expect(cancelEventForUser('organizer-1', 'cancel-1', 30)).resolves.toEqual({ eventId: 'cancel-1', status: 'Cancelled' });
    expect((await adminDb.doc('events/cancel-1').get()).data()).toMatchObject({ status: 'Cancelled', cancelledAt: 30, cancelledFromVersionId: 'v1' });
    await expect(cancelEventForUser('organizer-1', 'cancel-1', 31)).resolves.toEqual({ eventId: 'cancel-1', status: 'Cancelled' });

    await adminDb.doc('events/cancel-locked').set({ ...base, assignedOfficerUids: ['officer-1'], assignedOfficerByAuthority: { PDRM: 'officer-1' } });
    await adminDb.doc('events/cancel-locked/versions/v1').set({ eventId: 'cancel-locked', versionId: 'v1', versionNumber: 1 });
    await expect(cancelEventForUser('organizer-1', 'cancel-locked', 32)).rejects.toThrow('before Admin review begins');

    await adminDb.doc('events/missing-history').set(base);
    await expect(prepareApplicationRevisionForUser('organizer-1', 'missing-history', 33)).rejects.toThrow('immutable submitted application version');
    await expect(cancelEventForUser('organizer-1', 'missing-history', 34)).rejects.toThrow('immutable submitted application version');

    await adminDb.doc('events/withdraw-1').set({ ...base, status: 'Approved', reviewStage: 'closed' });
    await adminDb.doc('events/withdraw-1/versions/v1').set({ eventId: 'withdraw-1', versionId: 'v1', versionNumber: 1 });
    await adminDb.doc('public_events/withdraw-1').set({ eventName: 'Public event' });
    await withdrawEventForUser('organizer-1', 'withdraw-1', 'The venue is no longer available.', 40);
    expect((await adminDb.doc('events/withdraw-1').get()).data()).toMatchObject({
      status: 'Withdrawn', withdrawnAt: 40, withdrawnFromStatus: 'Approved', withdrawalRationale: 'The venue is no longer available.',
    });
    expect((await adminDb.doc('public_events/withdraw-1').get()).exists).toBe(false);
    await adminDb.doc('events/withdraw-missing-history').set({ ...base, status: 'Approved', reviewStage: 'closed' });
    await expect(withdrawEventForUser('organizer-1', 'withdraw-missing-history', 'The venue is no longer available.', 41))
      .rejects.toThrow('immutable submitted application version');
  });

  it('allows organizer drafts but rejects direct Pending creation and generated-field changes', async () => {
    await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'users/organizer-1'), { role: 'organizer' }));
    const db = environment.authenticatedContext('organizer-1').firestore();
    const draft = {
      organizerId: 'organizer-1', eventDetails: validDetails, templateSelection: validTemplateSelection, status: 'Draft', currentVersionNumber: 0,
      editableVersionId: 'v1', draftDocumentPaths: [], draftDocuments: [], documentSchemaVersion: '2026-08-28-document-v1', requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      evidenceManifestSchemaVersion: '2026-08-28-evidence-v1',
      draftEvidenceManifest: Array.from({ length: 17 }, (_, index) => ({ requirementId: `placeholder-${index}`, applicability: 'not_applicable', notApplicableReason: 'Not applicable to this event.' })),
    };
    await assertSucceeds(setDoc(doc(db, 'events/draft-1'), draft));
    await assertFails(setDoc(doc(db, 'events/invalid-template-draft'), {
      ...draft,
      templateSelection: { ...validTemplateSelection, scenarioTemplateId: 'STERAS-T01-ENT-IN-v2.0' },
    }));
    await assertFails(setDoc(doc(db, 'events/mismatched-category-draft'), {
      ...draft,
      eventDetails: { ...validDetails, type: 'sports' },
    }));
    await assertFails(setDoc(doc(db, 'events/mismatched-venue-draft'), {
      ...draft,
      eventDetails: { ...validDetails, environment: 'indoor' },
    }));
    await assertFails(setDoc(doc(db, 'events/pending-1'), { ...draft, status: 'Pending' }));
    await assertFails(setDoc(doc(db, 'events/spoofed-id-draft'), { ...draft, eventId: 'different-event' }));
    await assertFails(setDoc(doc(db, 'events/spoofed-revision-draft'), {
      ...draft, activeRevision: { kind: 'rejected_revision', sourceVersionId: 'v0', startedAt: 1 },
    }));
    await assertFails(setDoc(doc(db, 'events/spoofed-withdrawal-draft'), {
      ...draft, withdrawnAt: 1, withdrawnFromStatus: 'Approved', withdrawalRationale: 'Forged withdrawal.',
    }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), { currentVersionNumber: 1 }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), { currentExtractionId: 'attacker-controlled' }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), { documentSchemaVersion: 'legacy-bypass' }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), { evidenceManifestSchemaVersion: 'legacy-bypass' }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), { activeRevision: { kind: 'pending_edit', sourceVersionId: 'v0', startedAt: 1 } }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), { cancelledAt: 1, cancelledFromVersionId: 'v0' }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), { withdrawnAt: 1, withdrawnFromStatus: 'Draft', withdrawalRationale: 'Forged withdrawal.' }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), { eventId: 'different-event' }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), {
      templateSelection: { ...validTemplateSelection, venueSetting: 'indoor' },
    }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), {
      eventDetails: { ...validDetails, type: 'sports' },
    }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), {
      eventDetails: { ...validDetails, environment: 'indoor' },
    }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), {
      templateSelection: {
        ...validTemplateSelection,
        venueSetting: 'indoor',
        scenarioTemplateId: 'STERAS-T07-CUL-IN-v1.0',
      },
      draftDocumentPaths: ['event_documents/draft-1/v1/completed-template.docx'],
    }));
    await assertSucceeds(updateDoc(doc(db, 'events/draft-1'), {
      eventDetails: { ...validDetails, environment: 'indoor' },
      templateSelection: {
        ...validTemplateSelection,
        venueSetting: 'indoor',
        scenarioTemplateId: 'STERAS-T07-CUL-IN-v1.0',
      },
    }));
    await assertSucceeds(updateDoc(doc(db, 'events/draft-1'), {
      draftDocumentPaths: ['event_documents/draft-1/v1/completed-template.docx'],
    }));
    await assertFails(updateDoc(doc(db, 'events/draft-1'), {
      eventDetails: validDetails,
      templateSelection: validTemplateSelection,
    }));
  });

  it('submits exactly one immutable version through the server transaction', async () => {
    const v1Evidence = await uploadTestEvidence('draft-1', 'v1');
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
      await setDoc(doc(db, 'users/admin-1'), { role: 'admin', email: 'admin1@steras.test' });
      await setDoc(doc(db, 'users/admin-2'), { role: 'admin', email: 'admin2@steras.test' });
      await setDoc(doc(db, 'users/authority-1'), { role: 'authority', authorityType: 'PDRM' });
      await setDoc(doc(db, 'events/draft-1'), {
        organizerId: 'organizer-1', eventDetails: validDetails, templateSelection: validTemplateSelection, status: 'Draft', currentVersionNumber: 0,
        editableVersionId: 'v1', draftDocumentPaths: [v1Evidence], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      });
    });
    const concurrentSubmissions = await Promise.allSettled([
      submitEventForUser('organizer-1', 'draft-1', 1_000),
      submitEventForUser('organizer-1', 'draft-1', 1_000),
    ]);
    expect(concurrentSubmissions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrentSubmissions.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const db = environment.authenticatedContext('organizer-1').firestore();
    const eventSnapshot = await assertSucceeds(getDoc(doc(db, 'events/draft-1')));
    const versionSnapshot = await assertSucceeds(getDoc(doc(db, 'events/draft-1/versions/v1')));
    if (!eventSnapshot.exists() || !versionSnapshot.exists()) throw new Error('Submission records were not created.');
    if (eventSnapshot.data().status !== 'Pending' || eventSnapshot.data().currentVersionId !== 'v1') throw new Error('Event was not advanced to version 1.');
    const adminDb = getFirestore(adminApp);
    const notifications = await adminDb.collection('notifications').where('eventId', '==', 'draft-1').get();
    expect(notifications.size).toBe(2);
    expect(notifications.docs.map((document) => document.data().recipientUid).sort()).toEqual(['admin-1', 'admin-2']);
    for (const notification of notifications.docs.map((document) => document.data())) {
      expect(notification).toMatchObject({
        eventId: 'draft-1', versionId: 'v1', type: 'application_submitted_for_review',
        title: 'New application submitted', read: false, createdAt: 1_000,
      });
      expect(JSON.stringify(notification)).not.toMatch(/organizer@example|\+60123456789|riskProfile|documentPaths/i);
    }
    expect((await adminDb.doc('events/draft-1/audit_logs/1000-submitted-v1').get()).data()?.metadata.adminNotificationCount).toBe(2);
    await assertFails(setDoc(doc(db, 'events/draft-1/versions/v1'), { versionNumber: 99 }));
    await submitEventForUser('organizer-1', 'draft-1', 1_001).then(
      () => { throw new Error('Duplicate submission unexpectedly succeeded.'); },
      () => undefined,
    );
    expect((await adminDb.collection('notifications').where('eventId', '==', 'draft-1').get()).size).toBe(2);
  });

  it('binds a current structured DOCX extraction into the immutable submitted version', async () => {
    const core = await uploadTestDocx('structured-1', 'v1', 'core_template', '../docs/templates/m1/core/Core Event Application Template.docx');
    const scenario = await uploadTestDocx('structured-1', 'v1', 'scenario_template', '../docs/templates/m1/cultural-heritage-festival/Cultural, Heritage and Festival Event - Outdoor Fixed-Site.docx');
    const support = await uploadTestEvidence('structured-1', 'v1');
    const supportDocument = { path: support, role: 'supporting_evidence' as const, originalName: 'evidence.pdf', mimeType: 'application/pdf', sizeBytes: Buffer.byteLength('%PDF-1.4\ntest\n%%EOF\n'), uploadedAt: 1, schemaVersion: '2026-08-28-document-v1' as const };
    const evidenceManifest = m1EvidenceRequirementsFor('STERAS-T08-CUL-OF-v1.0').map((definition) => ({ requirementId: definition.id, applicability: 'required' as const, documentPath: support }));
    const extractionId = 'extract_current';
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
      await setDoc(doc(db, 'events/structured-1'), {
        eventId: 'structured-1', organizerId: 'organizer-1', eventDetails: validDetails, templateSelection: validTemplateSelection,
        status: 'Draft', currentVersionNumber: 0, editableVersionId: 'v1',
        draftDocumentPaths: [core.path, scenario.path, support], draftDocuments: [core, scenario, supportDocument],
        documentSchemaVersion: '2026-08-28-document-v1', currentExtractionId: extractionId,
        draftEvidenceManifest: evidenceManifest, evidenceManifestSchemaVersion: '2026-08-28-evidence-v1',
        requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      });
      await setDoc(doc(db, `events/structured-1/document_extractions/${extractionId}`), {
        extractionId, eventId: 'structured-1', editableVersionId: 'v1', status: 'needs_review',
        schemaVersion: '2026-08-29-document-fields-v2', templateRegistryVersion: '2026-08-28-v1',
        coreTemplateId: 'STERAS-CORE', scenarioTemplateId: 'STERAS-T08-CUL-OF-v1.0',
        sourceDocuments: [{ path: core.path, role: core.role, originalName: core.originalName, mimeType: core.mimeType, sizeBytes: core.sizeBytes, sha256: 'core' }, { path: scenario.path, role: scenario.role, originalName: scenario.originalName, mimeType: scenario.mimeType, sizeBytes: scenario.sizeBytes, sha256: 'scenario' }],
        extractedFields: [], rawFieldIds: [], warnings: ['manual review'], completionPercent: 0, createdAt: 1, createdBy: 'organizer-1',
      });
    });
    await submitEventForUser('organizer-1', 'structured-1', 1_000);
    const submitted = await getFirestore(adminApp).doc('events/structured-1/versions/v1').get();
    expect(submitted.data()?.extractionId).toBe(extractionId);
    expect(submitted.data()?.documentUploads).toHaveLength(3);
    expect(submitted.data()?.evidenceManifest).toHaveLength(17);
  });

  it('resubmits a rejected application as v2 while preserving v1 and rejection provenance', async () => {
    const eventId = 'revision-submit';
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('users/organizer-1').set({ role: 'organizer' });
    await adminDb.doc('users/admin-1').set({ role: 'admin' });
    await adminDb.doc(`events/${eventId}`).set({
      organizerId: 'organizer-1', eventDetails: validDetails, templateSelection: validTemplateSelection,
      status: 'Rejected', currentVersionId: 'v1', currentVersionNumber: 1, editableVersionId: null,
      draftDocumentPaths: [], requiredAuthorities: ['PDRM'], reviewStage: 'closed', createdAt: 1, updatedAt: 1,
      initialReview: {
        decision: 'Rejected', reason: 'The signed traffic route plan is missing.',
        suggestion: 'Attach the signed route plan and update emergency access.', reviewerUid: 'admin-1', reviewedAt: 900,
      },
    });
    const immutableV1 = { versionId: 'v1', eventId, versionNumber: 1, marker: 'must-not-change' };
    await adminDb.doc(`events/${eventId}/versions/v1`).set(immutableV1);
    await prepareApplicationRevisionForUser('organizer-1', eventId, 1_000);

    const core = await uploadTestDocx(eventId, 'v2', 'core_template', '../docs/templates/m1/core/Core Event Application Template.docx');
    const scenario = await uploadTestDocx(eventId, 'v2', 'scenario_template', '../docs/templates/m1/cultural-heritage-festival/Cultural, Heritage and Festival Event - Outdoor Fixed-Site.docx');
    const support = await uploadTestEvidence(eventId, 'v2');
    const supportDocument = {
      path: support, role: 'supporting_evidence' as const, originalName: 'evidence.pdf', mimeType: 'application/pdf',
      sizeBytes: Buffer.byteLength('%PDF-1.4\ntest\n%%EOF\n'), uploadedAt: 1, schemaVersion: '2026-08-28-document-v1' as const,
    };
    const evidenceManifest = m1EvidenceRequirementsFor(validTemplateSelection.scenarioTemplateId)
      .map((definition) => ({ requirementId: definition.id, applicability: 'required' as const, documentPath: support }));
    const extractionId = 'extract_revision_v2';
    await adminDb.doc(`events/${eventId}`).update({
      draftDocumentPaths: [core.path, scenario.path, support], draftDocuments: [core, scenario, supportDocument],
      currentExtractionId: extractionId, draftEvidenceManifest: evidenceManifest,
    });
    await adminDb.doc(`events/${eventId}/document_extractions/${extractionId}`).set({
      extractionId, eventId, editableVersionId: 'v2', status: 'needs_review',
      schemaVersion: '2026-08-29-document-fields-v2', templateRegistryVersion: '2026-08-28-v1',
      coreTemplateId: 'STERAS-CORE', scenarioTemplateId: validTemplateSelection.scenarioTemplateId,
      sourceDocuments: [core, scenario].map((document) => ({
        path: document.path, role: document.role, originalName: document.originalName,
        mimeType: document.mimeType, sizeBytes: document.sizeBytes, sha256: document.role,
      })),
      extractedFields: [], rawFieldIds: [], warnings: ['manual review'], completionPercent: 0, createdAt: 1_001, createdBy: 'organizer-1',
    });

    await submitEventForUser('organizer-1', eventId, 1_100);
    expect((await adminDb.doc(`events/${eventId}/versions/v1`).get()).data()).toEqual(immutableV1);
    const v2 = (await adminDb.doc(`events/${eventId}/versions/v2`).get()).data();
    expect(v2?.revisionSource).toEqual({
      kind: 'rejected_revision', sourceVersionId: 'v1', startedAt: 1_000,
      rejectionReason: 'The signed traffic route plan is missing.',
      rejectionSuggestion: 'Attach the signed route plan and update emergency access.',
    });
    expect((await adminDb.doc(`events/${eventId}`).get()).data()).toMatchObject({
      status: 'Pending', currentVersionId: 'v2', currentVersionNumber: 2, editableVersionId: null,
    });
    expect((await adminDb.doc(`events/${eventId}`).get()).data()?.activeRevision).toBeUndefined();
    expect((await adminDb.doc(`events/${eventId}`).get()).data()?.initialReview).toBeUndefined();
    const notifications = await adminDb.collection('notifications').where('eventId', '==', eventId).get();
    expect(notifications.size).toBe(1);
    expect(notifications.docs[0].data()).toMatchObject({
      recipientUid: 'admin-1', versionId: 'v2', type: 'application_submitted_for_review',
      title: 'Updated application submitted', read: false, createdAt: 1_100,
    });
  });

  it('rejects missing evidence, tampered templates, and spoofed venue identity before version creation', async () => {
    const evidencePath = await uploadTestEvidence('integrity-draft', 'v1');
    const templateEvidencePath = await uploadTestEvidence('tampered-template', 'v1');
    const adminDb = getFirestore(adminApp);
    await Promise.all([
      adminDb.doc('users/organizer-1').set({ role: 'organizer' }),
      adminDb.doc('venues/venue-1').set({
        venueId: 'venue-1', active: true, name: 'Canonical Hall', address: 'Canonical Address',
        capacity: 2_000, location: { lat: 3.139, lng: 101.687 },
      }),
      adminDb.doc('events/missing-evidence').set({
        organizerId: 'organizer-1', eventDetails: validDetails, templateSelection: validTemplateSelection, status: 'Draft', currentVersionNumber: 0,
        editableVersionId: 'v1', draftDocumentPaths: ['event_documents/missing-evidence/v1/missing.pdf'], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      }),
      adminDb.doc('events/integrity-draft').set({
        organizerId: 'organizer-1', eventDetails: { ...validDetails, venueId: 'venue-1', venueName: 'Spoofed Hall' },
        templateSelection: validTemplateSelection,
        status: 'Draft', currentVersionNumber: 0, editableVersionId: 'v1', draftDocumentPaths: [evidencePath],
        requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      }),
      adminDb.doc('events/tampered-template').set({
        organizerId: 'organizer-1', eventDetails: validDetails,
        templateSelection: { ...validTemplateSelection, scenarioTemplateId: 'STERAS-T01-ENT-IN-v2.0' },
        status: 'Draft', currentVersionNumber: 0, editableVersionId: 'v1', draftDocumentPaths: [templateEvidencePath],
        requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      }),
    ]);
    await expect(submitEventForUser('organizer-1', 'missing-evidence', 1_000)).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(submitEventForUser('organizer-1', 'integrity-draft', 1_000)).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(submitEventForUser('organizer-1', 'tampered-template', 1_000)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await adminDb.collection('events/integrity-draft/versions').get()).empty).toBe(true);
    expect((await adminDb.collection('events/tampered-template/versions').get()).empty).toBe(true);
  });

  it('allows only the owner to withdraw an eligible event', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
      await setDoc(doc(db, 'users/organizer-2'), { role: 'organizer' });
      await setDoc(doc(db, 'events/draft-1'), {
        organizerId: 'organizer-1', eventDetails: validDetails, templateSelection: validTemplateSelection, status: 'Approved', currentVersionId: 'v1', currentVersionNumber: 1,
        editableVersionId: null, draftDocumentPaths: [], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      });
      await setDoc(doc(db, 'events/draft-1/versions/v1'), { eventId: 'draft-1', versionId: 'v1', versionNumber: 1 });
    });
    await withdrawEventForUser('organizer-2', 'draft-1', 'The venue is no longer available.', 1_000).then(
      () => { throw new Error('Non-owner withdrawal unexpectedly succeeded.'); },
      () => undefined,
    );
    await withdrawEventForUser('organizer-1', 'draft-1', 'The venue is no longer available.', 1_001);
    const snapshot = await assertSucceeds(getDoc(doc(environment.authenticatedContext('organizer-1').firestore(), 'events/draft-1')));
    if (snapshot.data()?.status !== 'Withdrawn') throw new Error('Event was not withdrawn.');
  });

  it('claims one assessment when duplicate triggers run concurrently', async () => {
    const evidencePath = await uploadTestEvidence('draft-1', 'v1');
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/organizer-1'), { role: 'organizer' });
      await setDoc(doc(db, 'events/draft-1'), {
        organizerId: 'organizer-1', eventDetails: validDetails, templateSelection: validTemplateSelection, status: 'Draft', currentVersionNumber: 0,
        editableVersionId: 'v1', draftDocumentPaths: [evidencePath], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
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
      const currentAssessmentId = (await adminDb.doc('events/draft-1').get()).data()?.currentAssessmentId;
      expect(currentAssessmentId).toMatch(/^v1-assessment-/);
      const assessment = await adminDb.doc(`events/draft-1/assessments/${currentAssessmentId}`).get();
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
      expect(audits.docs.map((item) => item.id).sort()).toEqual(['1000-submitted-v1', `${currentAssessmentId}-risk-score-computed`].sort());
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
        adminDb.doc(`events/draft-1/assessments/${currentAssessmentId}`).set({
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
    const missingAssessment = (await adminDb.collection('events/missing-version/assessments').get()).docs[0];
    expect(missingAssessment.data()).toMatchObject({
      status: 'failed', error: 'Immutable event version v404 was not found.',
    });
    expect((await adminDb.doc('events/missing-version/assessment_summaries/v404').get()).data()).toMatchObject({
      status: 'failed', categories: [], authorityReviewRequired: true,
    });
    expect((await adminDb.collection('events/missing-version/resources').get()).empty).toBe(true);

    await Promise.all([
      adminDb.doc('events/invalid-version').set({
        organizerId: 'organizer-1', status: 'Pending', currentVersionId: 'v1', currentVersionNumber: 1,
        requiredAuthorities: ['PDRM'], draftDocumentPaths: [], createdAt: 1, updatedAt: 1,
      }),
      adminDb.doc('events/invalid-version/versions/v1').set({
        eventId: 'different-event', versionId: 'v1', versionNumber: 1,
        eventDetails: validDetails, documentPaths: [], submittedBy: 'organizer-1', submittedAt: 1,
        inputHash: 'a'.repeat(64),
      }),
    ]);
    expect(await runRiskAndResourcePipeline('invalid-version', 1_100)).toMatchObject({
      status: 'processed', reason: 'invalid-version-contract', versionId: 'v1',
    });
    const invalidAssessment = (await adminDb.collection('events/invalid-version/assessments').get()).docs[0];
    expect(invalidAssessment.data()).toMatchObject({
      status: 'failed', error: 'Immutable event version v1 failed runtime contract validation.',
    });
    expect((await adminDb.collection('events/invalid-version/resources').get()).empty).toBe(true);

    await adminDb.doc('events/invalid-pointer').set({
      organizerId: 'organizer-1', status: 'Pending', currentVersionId: 'nested/version', currentVersionNumber: 1,
      requiredAuthorities: ['PDRM'], draftDocumentPaths: [], createdAt: 1, updatedAt: 1,
    });
    expect(await runRiskAndResourcePipeline('invalid-pointer', 1_200)).toMatchObject({
      status: 'skipped', reason: 'invalid-current-version',
    });
  });

  it('UC-M2-07 rejects ambiguous venue names and excludes incidents that are not verified and eligible', async () => {
    const adminDb = getFirestore(adminApp);
    await Promise.all([
      adminDb.doc('venues/venue-a').set({ active: true, name: 'Twin Hall', capacity: 100 }),
      adminDb.doc('venues/venue-b').set({ active: true, name: 'Twin Hall', capacity: 200 }),
    ]);
    expect(await fetchVenueContext({
      venueId: undefined, venueName: 'Twin Hall', venueAddress: 'KL', venueCapacity: 50,
      venueLocation: { lat: 3.1, lng: 101.7 },
    }, 10)).toMatchObject({ matched: false });

    await adminDb.doc('venues/stable-venue').set({
      active: true, name: 'Stable Hall', address: validDetails.venueAddress,
      capacity: validDetails.venueCapacity, location: validDetails.venueLocation,
    });
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
    expect(await fetchHistoricalContext({
      ...event, eventDetails: { ...event.eventDetails, venueAddress: 'Spoofed address' },
    }, 21)).toMatchObject({ matched: false, incidentIds: [] });
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
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/bomba-1'), { role: 'authority', authorityType: 'BOMBA' });
      await updateDoc(doc(context.firestore(), 'events/event-1'), {
        requiredAuthorities: ['PDRM', 'BOMBA'],
        assignedOfficerUids: ['authority-1', 'bomba-1'],
        assignedOfficerByAuthority: { PDRM: 'authority-1', BOMBA: 'bomba-1' },
      });
      await setDoc(doc(context.firestore(), 'events/event-1/assessments/v1/score_reviews/review-1'), { reviewId: 'review-1', reviewerId: 'authority-1', authorityType: 'PDRM' });
      await setDoc(doc(context.firestore(), 'events/event-1/assessments/v1/score_reviews/review-2'), { reviewId: 'review-2', reviewerId: 'bomba-1', authorityType: 'BOMBA' });
    });
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('authority-1').firestore(), 'events/event-1/assessments/v1/score_reviews/review-1')));
    await assertFails(getDoc(doc(environment.authenticatedContext('authority-1').firestore(), 'events/event-1/assessments/v1/score_reviews/review-2')));
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('bomba-1').firestore(), 'events/event-1/assessments/v1/score_reviews/review-2')));
    await assertFails(getDoc(doc(environment.authenticatedContext('organizer-1').firestore(), 'events/event-1/assessments/v1/score_reviews/review-1')));
    await assertFails(setDoc(doc(environment.authenticatedContext('authority-1').firestore(), 'events/event-1/assessments/v1/score_reviews/review-2'), { reviewerId: 'authority-1' }));
  });

  it('keeps manual assessments server-only and readable only by Admin or assigned authorities', async () => {
    await seedManualReviewEvent();
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/manual-1').update({
      assignedOfficerUids: ['pdrm-1'],
      assignedOfficerByAuthority: { PDRM: 'pdrm-1' },
    });
    await adminDb.doc('events/manual-1/assessments/v1/manual_assessments/manual-1').set({ manualAssessmentId: 'manual-1' });
    const path = 'events/manual-1/assessments/v1/manual_assessments/manual-1';
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('admin-1').firestore(), path)));
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('pdrm-1').firestore(), path)));
    await assertFails(getDoc(doc(environment.authenticatedContext('organizer-1').firestore(), path)));
    await assertFails(setDoc(doc(environment.authenticatedContext('admin-1').firestore(), `${path}-other`), { manualAssessmentId: 'other' }));
  });

  it('persists one append-only Admin manual assessment and atomically publishes proposal-free official output', async () => {
    await seedManualReviewEvent();
    const result = await submitAdminManualAssessmentForUser('admin-1', manualRequest(), 100);
    expect(result).toMatchObject({ status: 'official_ready', idempotent: false });
    const adminDb = getFirestore(adminApp);
    const event = (await adminDb.doc('events/manual-1').get()).data();
    const assessment = (await adminDb.doc('events/manual-1/assessments/v1').get()).data();
    const manuals = await adminDb.collection('events/manual-1/assessments/v1/manual_assessments').get();
    const resources = await adminDb.collection('events/manual-1/resources').get();
    expect(manuals.size).toBe(1);
    expect(assessment).toMatchObject({ status: 'official_ready', sourceKind: 'admin_manual', authorityReviewRequired: false });
    expect(assessment?.officialResult).not.toHaveProperty('proposalId');
    expect(resources.size).toBe(1);
    expect(resources.docs[0].data()).toMatchObject({ stage: 'official', resourceId: event?.currentResourceId, assessmentReference: { sourceKind: 'admin_manual', manualAssessmentId: assessment?.activeManualAssessmentId } });
    const summary = (await adminDb.doc('events/manual-1/assessment_summaries/v1').get()).data();
    expect(summary).not.toHaveProperty('manualReviewReason');
    expect(summary).not.toHaveProperty('activeManualAssessmentId');
    await expect(recomputeResourceForStoredAssessment('manual-1', 105)).resolves.toMatchObject({ status: 'reused', resourceId: event?.currentResourceId });
    expect((await adminDb.doc('events/manual-1/assessments/v1').get()).data()).toEqual(assessment);
    // A prior provisional revision may remain beside the official record. An
    // exact manual-submit replay must still be idempotent and inspect only the
    // official revision chain.
    const official = resources.docs[0].data();
    await adminDb.doc(`events/manual-1/resources/provisional-v1-${official.resourceInputHash}`).set({
      ...official,
      resourceId: `provisional-v1-${official.resourceInputHash}`,
      stage: 'provisional',
      revision: 1,
      supersedesResourceId: null,
      assessmentReference: { stage: 'provisional', assessmentId: official.assessmentId, proposalId: 'manual-prototype' },
      confidenceLevel: 'prototype',
      authorityReviewRequired: true,
      items: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, {
        ...official.items[key], confidence: 'prototype', authorityReviewRequired: true,
      }])),
    });
    await expect(submitAdminManualAssessmentForUser('admin-1', manualRequest(), 106))
      .resolves.toMatchObject({ status: 'official_ready', idempotent: true });
    const decision = await makeAuthorityDecisionForUser('pdrm-1', { eventId: 'manual-1', decision: 'Approved', rationale: 'The manual official assessment and resources were reviewed.', materialsReviewed: true }, 110);
    expect(decision.decision).toBe('Approved');
  });

  it('releases a finalized Admin manual assessment through the pointer-driven initial review', async () => {
    await seedManualReviewEvent();
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/manual-1').update({ status: 'Manual Review Required', reviewStage: 'manual' });
    await submitAdminManualAssessmentForUser('admin-1', manualRequest(), 115);
    const result = await makeInitialReviewDecisionForUser('admin-1', {
      eventId: 'manual-1',
      decision: 'Approved',
      reason: 'The finalized manual assessment and resource recommendation are ready for officer review.',
    }, 116);
    expect(result).toMatchObject({
      status: 'UnderReview',
      decision: 'Approved',
      manualAssessmentRecorded: true,
    });
    expect((await adminDb.doc('events/manual-1').get()).data()).toMatchObject({
      status: 'UnderReview',
      reviewStage: 'initial',
      initialReview: { manualAssessmentRecorded: true },
    });
  });

  it('makes an initial-review rejection terminal and removes the editable pointer', async () => {
    await seedManualReviewEvent();
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/manual-1').update({ status: 'Manual Review Required', reviewStage: 'manual', editableVersionId: 'v2' });
    await submitAdminManualAssessmentForUser('admin-1', manualRequest(), 117);
    const result = await makeInitialReviewDecisionForUser('admin-1', {
      eventId: 'manual-1',
      decision: 'Rejected',
      reason: 'The application cannot proceed because the submitted operating plan is incomplete.',
      suggestion: 'Start a new application with a complete operating and emergency plan.',
    }, 118);
    expect(result).toMatchObject({ status: 'Rejected', decision: 'Rejected' });
    expect((await adminDb.doc('events/manual-1').get()).data()).toMatchObject({ status: 'Rejected', reviewStage: 'closed', assignedOfficerUids: [], assignedOfficerByAuthority: {} });
    expect((await adminDb.doc('events/manual-1').get()).data()).not.toHaveProperty('editableVersionId');
  });

  it('makes duplicate manual submission idempotent and rejects a second record or key collision', async () => {
    await seedManualReviewEvent();
    const [first, second] = await Promise.all([
      submitAdminManualAssessmentForUser('admin-1', manualRequest(), 120),
      submitAdminManualAssessmentForUser('admin-1', manualRequest(), 120),
    ]);
    expect(first.status).toBe('official_ready');
    expect(second.status).toBe('official_ready');
    const adminDb = getFirestore(adminApp);
    expect((await adminDb.collection('events/manual-1/assessments/v1/manual_assessments').get()).size).toBe(1);
    expect((await adminDb.collection('events/manual-1/resources').get()).size).toBe(1);
    await expect(submitAdminManualAssessmentForUser('admin-1', {
      ...manualRequest(), rationale: 'Different content deliberately reuses the same idempotency key and must conflict.',
    }, 121)).rejects.toMatchObject({ code: 'already-exists' });
    await expect(submitAdminManualAssessmentForUser('admin-1', { ...manualRequest(), idempotencyKey: 'manual-key-0002' }, 121))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('fails closed when an orphan manual record exists without an active pointer', async () => {
    await seedManualReviewEvent();
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/manual-1/assessments/v1/manual_assessments/orphan-manual').set({
      manualAssessmentId: 'orphan-manual',
    });
    await expect(submitAdminManualAssessmentForUser('admin-1', manualRequest(), 122))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    const manuals = await adminDb.collection('events/manual-1/assessments/v1/manual_assessments').get();
    expect(manuals.docs.map((snapshot) => snapshot.id)).toEqual(['orphan-manual']);
    expect((await adminDb.doc('events/manual-1/assessments/v1').get()).data()?.activeManualAssessmentId).toBeUndefined();
  });

  it('does not recreate a locked manual record that has gone missing', async () => {
    await seedManualReviewEvent();
    const adminDb = getFirestore(adminApp);
    const manualId = manualAssessmentTestOnly.manualId('v1', 'admin-1', manualRequest().idempotencyKey);
    await adminDb.doc('events/manual-1/assessments/v1').update({ activeManualAssessmentId: manualId });
    await expect(submitAdminManualAssessmentForUser('admin-1', manualRequest(), 123))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await adminDb.collection('events/manual-1/assessments/v1/manual_assessments').get()).size).toBe(0);
  });

  it('retains the manual record when resource finalisation fails and allows a fenced Admin retry', async () => {
    await seedManualReviewEvent();
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/manual-1/resources/corrupt-official').set({ versionId: 'v1', stage: 'official' });
    await expect(submitAdminManualAssessmentForUser('admin-1', manualRequest(), 130)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await adminDb.collection('events/manual-1/assessments/v1/manual_assessments').get()).size).toBe(1);
    expect((await adminDb.doc('events/manual-1/assessments/v1').get()).data()).toMatchObject({ status: 'manual_review_required' });
    const failedResources = await adminDb.collection('events/manual-1/resources').get();
    expect(failedResources.size).toBe(1);
    expect(failedResources.docs[0].id).toBe('corrupt-official');
    expect((await adminDb.doc('events/manual-1').get()).data()?.currentResourceId).toBeUndefined();
    expect((await adminDb.collection('events/manual-1/audit_logs').get()).docs.some((item) => item.data().action === 'manual_official_finalization_failed')).toBe(true);
    await adminDb.doc('events/manual-1/resources/corrupt-official').delete();
    const manualSnapshot = await adminDb.collection('events/manual-1/assessments/v1/manual_assessments').limit(1).get();
    const manualRef = manualSnapshot.docs[0].ref;
    const manualId = manualSnapshot.docs[0].id;
    await manualRef.update({ manualAssessmentId: 'embedded-id-does-not-match-document' });
    await expect(retryManualOfficialFinalisationForAdmin('admin-1', 'manual-1', 131)).rejects.toMatchObject({ code: 'failed-precondition' });
    await manualRef.update({ manualAssessmentId: manualId });
    await retryManualOfficialFinalisationForAdmin('admin-1', 'manual-1', 131);
    expect((await adminDb.collection('events/manual-1/resources').get()).size).toBe(1);
    const audits = await adminDb.collection('events/manual-1/audit_logs').get();
    expect(audits.docs.some((item) => item.data().action === 'manual_official_finalization_retried')).toBe(true);
  });

  it('rejects unauthorized, stale, non-manual, and cutover-locked manual submissions', async () => {
    await seedManualReviewEvent();
    await expect(submitAdminManualAssessmentForUser('organizer-1', manualRequest(), 140)).rejects.toMatchObject({ code: 'permission-denied' });
    const adminDb = getFirestore(adminApp);
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).set({ active: false });
    await expect(submitAdminManualAssessmentForUser('admin-1', manualRequest(), 140)).rejects.toMatchObject({ code: 'unavailable' });
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).delete();
    await adminDb.doc('events/manual-1').update({ currentAssessmentId: 'stale' });
    await expect(submitAdminManualAssessmentForUser('admin-1', manualRequest(), 140)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('fails closed when the active manual-assessment lock is malformed', async () => {
    await seedManualReviewEvent();
    const adminDb = getFirestore(adminApp);
    const assessmentRef = adminDb.doc('events/manual-1/assessments/v1');
    for (const malformedLock of [null, 42, '', [], 'manual/child']) {
      await assessmentRef.update({ activeManualAssessmentId: malformedLock });
      await expect(submitAdminManualAssessmentForUser('admin-1', manualRequest(), 141))
        .rejects.toMatchObject({ code: 'failed-precondition' });
      expect((await adminDb.collection('events/manual-1/assessments/v1/manual_assessments').get()).size).toBe(0);
      await assessmentRef.update({ activeManualAssessmentId: FieldValue.delete() });
    }
  });

  it('rejects malformed manual input without persisting a partial record', async () => {
    await seedManualReviewEvent();
    await expect(submitAdminManualAssessmentForUser('admin-1', { ...manualRequest(), categories: manualRequest().categories.slice(0, 7) }, 145))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await getFirestore(adminApp).collection('events/manual-1/assessments/v1/manual_assessments').get()).size).toBe(0);
  });

  it('rejects an AI-success document even when its readiness is mislabeled insufficient', async () => {
    await seedManualReviewEvent();
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/manual-1/assessments/v1').update({
      assessmentReadiness: 'insufficient_data',
      aiProposal: { status: 'success', proposalId: 'unexpected-success' },
    });
    await expect(submitAdminManualAssessmentForUser('admin-1', manualRequest(), 146))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await adminDb.collection('events/manual-1/assessments/v1/manual_assessments').get()).size).toBe(0);
    await adminDb.doc('events/manual-1/assessments/v1').update({
      assessmentReadiness: 'provisional', aiProposal: { status: 'timeout' },
    });
    await expect(submitAdminManualAssessmentForUser('admin-1', manualRequest(), 147))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await adminDb.collection('events/manual-1/assessments/v1/manual_assessments').get()).size).toBe(0);
  });

  it('rejects tampered manual provenance in decision and resource-only recompute', async () => {
    await seedManualReviewEvent();
    await submitAdminManualAssessmentForUser('admin-1', manualRequest(), 150);
    const adminDb = getFirestore(adminApp);
    const assessment = (await adminDb.doc('events/manual-1/assessments/v1').get()).data()!;
    await adminDb.doc(`events/manual-1/assessments/v1/manual_assessments/${assessment.activeManualAssessmentId}`).update({
      rationale: 'Tampered rationale is not the signed manual input.',
      eventVersionInputHash: 'tampered-version-hash',
    });
    await expect(makeAuthorityDecisionForUser('pdrm-1', { eventId: 'manual-1', decision: 'Approved', rationale: 'All official materials were reviewed and accepted.', materialsReviewed: true }, 151))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(recomputeResourceForStoredAssessment('manual-1', 151)).resolves.toMatchObject({ status: 'failed', reason: 'official-provenance-invalid' });
  });

  it('rejects a manual official resource that points to a different manual record', async () => {
    await seedManualReviewEvent();
    await submitAdminManualAssessmentForUser('admin-1', manualRequest(), 155);
    const adminDb = getFirestore(adminApp);
    const event = (await adminDb.doc('events/manual-1').get()).data()!;
    await adminDb.doc(`events/manual-1/resources/${event.currentResourceId}`).update({
      'assessmentReference.manualAssessmentId': 'different-manual-record',
    });
    await expect(makeAuthorityDecisionForUser('pdrm-1', { eventId: 'manual-1', decision: 'Approved', rationale: 'All official materials were reviewed and accepted.', materialsReviewed: true }, 156))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    const resource = (await adminDb.doc(`events/manual-1/resources/${event.currentResourceId}`).get()).data()!;
    const assessment = (await adminDb.doc('events/manual-1/assessments/v1').get()).data()!;
    await adminDb.doc(`events/manual-1/resources/${event.currentResourceId}`).update({
      assessmentReference: { ...resource.assessmentReference, manualAssessmentId: assessment.activeManualAssessmentId, finalizedBy: 'tampered-admin' },
    });
    await expect(recomputeResourceForStoredAssessment('manual-1', 156)).resolves.toMatchObject({ status: 'failed' });
  });

  it('rejects a tampered manual official hash and hard-rule result', async () => {
    await seedManualReviewEvent();
    await submitAdminManualAssessmentForUser('admin-1', manualRequest(), 157);
    const adminDb = getFirestore(adminApp);
    const assessmentRef = adminDb.doc('events/manual-1/assessments/v1');
    const assessment = (await assessmentRef.get()).data()!;
    await assessmentRef.update({ 'officialResult.officialInputHash': 'f'.repeat(64) });
    await expect(makeAuthorityDecisionForUser('pdrm-1', { eventId: 'manual-1', decision: 'Approved', rationale: 'All official materials were reviewed and accepted.', materialsReviewed: true }, 158))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    const categories = assessment.officialResult.categories.map((category: Record<string, unknown>, index: number) => index === 0
      ? { ...category, validatedLikelihood: category.validatedLikelihood === 5 ? 1 : 5 }
      : category);
    await assessmentRef.update({ officialResult: { ...assessment.officialResult, categories } });
    await expect(recomputeResourceForStoredAssessment('manual-1', 159)).resolves.toMatchObject({ status: 'failed' });
  });

  it('keeps blocked manual official assessments rejectable but not approvable', async () => {
    await seedManualReviewEvent();
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/manual-1/assessments/v1').update({ complianceStatus: 'blocked' });
    await submitAdminManualAssessmentForUser('admin-1', manualRequest(), 160);
    await expect(makeAuthorityDecisionForUser('pdrm-1', { eventId: 'manual-1', decision: 'Approved', rationale: 'All official materials were reviewed and accepted.', materialsReviewed: true }, 161))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(makeAuthorityDecisionForUser('pdrm-1', { eventId: 'manual-1', decision: 'Rejected', rationale: 'Blocked compliance prevents a positive recommendation.', suggestion: 'Resolve every blocked compliance check before resubmission.' }, 162))
      .resolves.toMatchObject({ decision: 'Rejected' });
  });

  it('keeps private Stage 2 data named-officer scoped and exposes only the public projection', async () => {
    await seedProfilesAndEvent();
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'events/event-1/event_controls/control-1'), {
        controlId: 'control-1', eventId: 'event-1', versionId: 'v1', authority: 'PDRM',
        controlName: 'PDRM control', stageRequirement: 'stage1_and_stage2',
        stage1Requirements: [], stage2Requirement: { kind: 'image', label: 'Venue photo' },
        controlItemVersion: 1, label: 'pending', createdAt: 1, updatedAt: 1,
      });
      await setDoc(doc(db, 'events/event-1/event_controls/control-1/stage2_docs/control-1-s2'), {
        docId: 'control-1-s2', imageUrl: 'data:image/png;base64,AA==', uploadedAt: 1,
        uploadedBy: 'organizer-1', publicConfirmCount: 0, published: false,
      });
      await setDoc(doc(db, 'public_event_controls/event-1/items/control-1-stage2'), {
        publicControlId: 'control-1-stage2', eventId: 'event-1', versionId: 'v1',
        controlId: 'control-1', docId: 'control-1-s2', authority: 'PDRM',
        controlName: 'PDRM control', stage2Label: 'Venue photo', imageUrl: 'https://example.test/photo.png',
        publicConfirmCount: 0, publishedAt: 1, sanitized: true, sanitizedAt: 1, sanitizedBy: 'system',
      });
    });
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('authority-1').firestore(), 'events/event-1/event_controls/control-1/stage2_docs/control-1-s2')));
    await assertFails(getDoc(doc(environment.authenticatedContext('authority-2').firestore(), 'events/event-1/event_controls/control-1/stage2_docs/control-1-s2')));
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('organizer-1').firestore(), 'events/event-1/event_controls/control-1/stage2_docs/control-1-s2')));
    await assertSucceeds(getDoc(doc(environment.unauthenticatedContext().firestore(), 'public_event_controls/event-1/items/control-1-stage2')));
    await assertFails(setDoc(doc(environment.unauthenticatedContext().firestore(), 'public_event_controls/event-1/items/attacker'), { sanitized: true }));
  });

  it('rejects direct public report creation and scopes confirmation markers to their owner', async () => {
    await seedProfilesAndEvent();
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'events/event-1/event_controls/control-1/stage2_confirms/public-1'), { userId: 'public-1', confirmedAt: 1 });
      await setDoc(doc(db, 'public_reports/ticket-1'), {
        ticketId: 'ticket-1', eventId: 'event-1', controlId: 'control-1', docId: 'control-1-s2',
        reporterUid: 'public-1', category: 'inaccurate', description: 'Report', createdAt: 1, updatedAt: 1,
      });
    });
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('public-1').firestore(), 'events/event-1/event_controls/control-1/stage2_confirms/public-1')));
    await assertFails(getDoc(doc(environment.authenticatedContext('authority-1').firestore(), 'events/event-1/event_controls/control-1/stage2_confirms/public-1')));
    await assertFails(setDoc(doc(environment.authenticatedContext('public-1').firestore(), 'public_reports/ticket-2'), {
      ticketId: 'ticket-2', eventId: 'event-1', controlId: 'control-1', docId: 'control-1-s2',
      reporterUid: 'public-1', category: 'inaccurate', description: 'Direct write', createdAt: 1, updatedAt: 1,
    }));
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

  it('records append-only authority reviews and atomically publishes official assessment and resources', async () => {
    await seedProvisionalReviewEvent(['PDRM', 'BOMBA']);
    const first = await submitScoreReviewForUser('pdrm-1', {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'PDRM reviewed all assessment materials and evidence.', idempotencyKey: 'pdrm_review_0001',
    }, 10);
    expect(first.status).toBe('authority_review');
    const second = await submitScoreReviewForUser('bomba-1', {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'BOMBA reviewed all assessment materials and evidence.', idempotencyKey: 'bomba_review_001',
    }, 11);
    expect(second.status).toBe('official_ready');
    const adminDb = getFirestore(adminApp);
    const event = (await adminDb.doc('events/review-1').get()).data();
    const assessment = (await adminDb.doc('events/review-1/assessments/v1').get()).data();
    const resources = await adminDb.collection('events/review-1/resources').get();
    expect(assessment).toMatchObject({ status: 'official_ready', authorityReviewRequired: false });
    expect(assessment?.officialResult.reviewIds).toHaveLength(2);
    expect(resources.docs).toHaveLength(1);
    expect(resources.docs[0].data()).toMatchObject({ stage: 'official', resourceId: event?.currentResourceId, authorityReviewRequired: false });
    expect((await adminDb.collection('events/review-1/assessments/v1/score_reviews').get()).size).toBe(2);
    const replay = await submitScoreReviewForUser('bomba-1', {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'BOMBA reviewed all assessment materials and evidence.', idempotencyKey: 'bomba_review_001',
    }, 12);
    expect(replay).toMatchObject({ status: 'official_ready', idempotent: true });
  });

  it('finalizes concurrent duplicate last-review requests once without a false failure audit', async () => {
    await seedProvisionalReviewEvent(['PDRM', 'BOMBA']);
    await submitScoreReviewForUser('pdrm-1', {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'PDRM reviewed all assessment materials and evidence.', idempotencyKey: 'pdrm_concurrent_01',
    }, 12);
    const request = {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'BOMBA reviewed all assessment materials and evidence.', idempotencyKey: 'bomba_concurrent_1',
    };
    const results = await Promise.all([
      submitScoreReviewForUser('bomba-1', request, 13),
      submitScoreReviewForUser('bomba-1', request, 14),
    ]);
    expect(results.every((result) => result.status === 'official_ready')).toBe(true);
    const adminDb = getFirestore(adminApp);
    expect((await adminDb.collection('events/review-1/resources').get()).size).toBe(1);
    const audits = await adminDb.collection('events/review-1/audit_logs').get();
    expect(audits.docs.filter((item) => item.data().action === 'official_assessment_finalized')).toHaveLength(1);
    expect(audits.docs.some((item) => item.data().action === 'official_finalization_failed')).toBe(false);
  });

  it('keeps the latest authority review head when an older idempotency key is replayed', async () => {
    await seedProvisionalReviewEvent(['PDRM', 'BOMBA']);
    const first = await submitScoreReviewForUser('pdrm-1', {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'PDRM completed the first full evidence review.', idempotencyKey: 'pdrm_revision_001',
    }, 13);
    const overridden = confirmedReviewCategories(5);
    overridden[0] = { categoryId: overridden[0].categoryId, likelihood: 4, severity: 4, decision: 'overridden', reason: 'Updated verified evidence supports the revised score.' };
    const second = await submitScoreReviewForUser('pdrm-1', {
      eventId: 'review-1', categories: overridden, rationale: 'PDRM completed the revised full evidence review.', idempotencyKey: 'pdrm_revision_002',
    }, 14);
    const replay = await submitScoreReviewForUser('pdrm-1', {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'PDRM completed the first full evidence review.', idempotencyKey: 'pdrm_revision_001',
    }, 15);
    const adminDb = getFirestore(adminApp);
    const assessment = (await adminDb.doc('events/review-1/assessments/v1').get()).data();
    expect(first.reviewId).not.toBe(second.reviewId);
    expect(replay).toMatchObject({ reviewId: first.reviewId, idempotent: true, shouldFinalize: false });
    expect(assessment?.authorityReviewState.activeReviewHeads.PDRM.reviewId).toBe(second.reviewId);
    expect((await adminDb.collection('events/review-1/assessments/v1/score_reviews').get()).size).toBe(2);
  });

  it('pauses conflicting reviews and finalizes only an admin resolution bound to current heads', async () => {
    await seedProvisionalReviewEvent(['PDRM', 'BOMBA']);
    await submitScoreReviewForUser('pdrm-1', {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'PDRM reviewed all assessment materials and evidence.', idempotencyKey: 'pdrm_conflict_01',
    }, 20);
    const conflicting = confirmedReviewCategories(5);
    conflicting[0] = { categoryId: conflicting[0].categoryId, likelihood: 4, severity: 4, decision: 'overridden', reason: 'BOMBA verified evidence supports a lower category score.' };
    const second = await submitScoreReviewForUser('bomba-1', {
      eventId: 'review-1', categories: conflicting, rationale: 'BOMBA reviewed all assessment materials and evidence.', idempotencyKey: 'bomba_conflict_1',
    }, 21);
    expect(second.status).toBe('authority_review');
    const adminDb = getFirestore(adminApp);
    const before = (await adminDb.doc('events/review-1/assessments/v1').get()).data();
    expect(before?.authorityReviewState.conflicts).toHaveLength(1);
    expect((await adminDb.collection('events/review-1/resources').get()).size).toBe(0);
    const heads = Object.fromEntries(Object.entries(before?.authorityReviewState.activeReviewHeads ?? {}).map(([authority, head]) => [authority, (head as { reviewId: string }).reviewId]));
    await expect(resolveScoreConflictForAdmin('pdrm-1', {
      eventId: 'review-1', reviewHeadIds: heads, categories: [{ categoryId: before!.authorityReviewState.conflicts[0].categoryId, likelihood: 5, severity: 5, reason: 'Admin reconciled the category after reviewing both submissions.' }], rationale: 'Both authority submissions were reviewed and reconciled.',
    }, 22)).rejects.toMatchObject({ code: 'permission-denied' });
    const resolutionInput = {
      eventId: 'review-1', reviewHeadIds: heads, categories: [{ categoryId: before!.authorityReviewState.conflicts[0].categoryId, likelihood: 5, severity: 5, reason: 'Admin reconciled the category after reviewing both submissions.' }], rationale: 'Both authority submissions were reviewed and reconciled.',
    };
    const concurrentResolutions = await Promise.all([
      resolveScoreConflictForAdmin('admin-1', resolutionInput, 23),
      resolveScoreConflictForAdmin('admin-1', resolutionInput, 24),
    ]);
    expect(concurrentResolutions.every((item) => item.status === 'official_ready')).toBe(true);
    expect((await adminDb.doc('events/review-1/assessments/v1').get()).data()).toMatchObject({ status: 'official_ready' });
    expect((await adminDb.collection('events/review-1/assessments/v1/score_resolutions').get()).size).toBe(1);
    const replay = await resolveScoreConflictForAdmin('admin-1', resolutionInput, 25);
    expect(replay).toMatchObject({ status: 'official_ready', idempotent: true, shouldFinalize: false });
    expect((await adminDb.collection('events/review-1/assessments/v1/score_resolutions').get()).size).toBe(1);
    const audits = await adminDb.collection('events/review-1/audit_logs').get();
    expect(audits.docs.some((item) => item.data().action === 'official_finalization_failed')).toBe(false);
  });

  it('preserves a valid resolution when the active review is replayed after finalisation fails', async () => {
    await seedProvisionalReviewEvent(['PDRM', 'BOMBA']);
    const pdrmRequest = {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'PDRM reviewed all assessment materials and evidence.', idempotencyKey: 'pdrm_resolution_01',
    };
    await submitScoreReviewForUser('pdrm-1', pdrmRequest, 25);
    const conflicting = confirmedReviewCategories(5);
    conflicting[0] = { categoryId: conflicting[0].categoryId, likelihood: 4, severity: 4, decision: 'overridden', reason: 'BOMBA verified evidence supports a lower category score.' };
    await submitScoreReviewForUser('bomba-1', {
      eventId: 'review-1', categories: conflicting, rationale: 'BOMBA reviewed all assessment materials and evidence.', idempotencyKey: 'bomba_resolution_1',
    }, 26);
    const adminDb = getFirestore(adminApp);
    const before = (await adminDb.doc('events/review-1/assessments/v1').get()).data()!;
    const heads = Object.fromEntries(Object.entries(before.authorityReviewState.activeReviewHeads).map(([authority, head]) => [authority, (head as { reviewId: string }).reviewId]));
    await adminDb.doc('events/review-1/versions/v1').update({ 'eventDetails.expectedAttendance': 0 });
    const resolutionInput = {
      eventId: 'review-1', reviewHeadIds: heads,
      categories: [{ categoryId: before.authorityReviewState.conflicts[0].categoryId, likelihood: 5 as const, severity: 5 as const, reason: 'Admin reconciled the category after reviewing both submissions.' }],
      rationale: 'Both authority submissions were considered and reconciled.',
    };
    await expect(resolveScoreConflictForAdmin('admin-1', resolutionInput, 27)).rejects.toMatchObject({ code: 'failed-precondition' });
    const resolutionId = (await adminDb.doc('events/review-1/assessments/v1').get()).data()?.authorityReviewState.activeResolutionId;
    expect(resolutionId).toBeTruthy();
    await expect(submitScoreReviewForUser('pdrm-1', pdrmRequest, 28)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await adminDb.doc('events/review-1/assessments/v1').get()).data()?.authorityReviewState.activeResolutionId).toBe(resolutionId);
    await adminDb.doc(`events/review-1/assessments/v1/score_resolutions/${resolutionId}`).update({ eventId: 'wrong-event' });
    await expect(resolveScoreConflictForAdmin('admin-1', resolutionInput, 29)).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('rejects unauthorized, stale, locked and post-official score review mutations', async () => {
    await seedProvisionalReviewEvent(['PDRM']);
    const request = {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'The complete application and risk evidence were reviewed.', idempotencyKey: 'authorization_001',
    };
    await expect(submitScoreReviewForUser('organizer-1', request, 31)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(submitScoreReviewForUser('bomba-1', request, 31)).rejects.toMatchObject({ code: 'permission-denied' });
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/review-1').update({ currentAssessmentId: 'stale-assessment' });
    await expect(submitScoreReviewForUser('pdrm-1', request, 31)).rejects.toMatchObject({ code: 'failed-precondition' });
    await adminDb.doc('events/review-1').update({ currentAssessmentId: 'v1' });
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).set({ active: false, malformed: true });
    await expect(submitScoreReviewForUser('pdrm-1', request, 31)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(retryOfficialFinalisationForAdmin('admin-1', 'review-1', 31)).rejects.toMatchObject({ code: 'unavailable' });
    expect((await adminDb.collection('events/review-1/audit_logs').get()).docs
      .some((item) => item.data().action === 'official_finalization_failed')).toBe(false);
    await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).delete();
    await submitScoreReviewForUser('pdrm-1', request, 31);
    await expect(submitScoreReviewForUser('pdrm-1', { ...request, idempotencyKey: 'authorization_002' }, 32))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects score review submission when the stored provisional result is no longer bound to the AI proposal', async () => {
    await seedProvisionalReviewEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    const assessmentRef = adminDb.doc('events/review-1/assessments/v1');
    const assessment = (await assessmentRef.get()).data()!;
    const categories = assessment.provisionalResult.categories.map((category: Record<string, unknown>, index: number) => index === 0
      ? { ...category, rationale: 'Tampered rationale no longer matches the stored AI proposal.' }
      : category);
    await assessmentRef.update({ provisionalResult: { ...assessment.provisionalResult, categories } });
    await expect(submitScoreReviewForUser('pdrm-1', {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'The complete application and risk evidence were reviewed.', idempotencyKey: 'tampered_provisional_1',
    }, 33)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await adminDb.collection('events/review-1/assessments/v1/score_reviews').get()).empty).toBe(true);
  });

  it('retains the final review and records a failure without publishing partial official output', async () => {
    await seedProvisionalReviewEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/review-1/versions/v1').update({ 'eventDetails.expectedAttendance': 0 });
    await expect(submitScoreReviewForUser('pdrm-1', {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'PDRM reviewed all assessment materials and evidence.', idempotencyKey: 'pdrm_failure_001',
    }, 30)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await adminDb.doc('events/review-1/assessments/v1').get()).data()).toMatchObject({ status: 'authority_review' });
    expect((await adminDb.collection('events/review-1/assessments/v1/score_reviews').get()).size).toBe(1);
    expect((await adminDb.collection('events/review-1/resources').get()).size).toBe(0);
    const audits = await adminDb.collection('events/review-1/audit_logs').get();
    expect(audits.docs.some((item) => item.data().action === 'official_finalization_failed')).toBe(true);
    await expect(retryOfficialFinalisationForAdmin('admin-1', 'review-1', 31)).rejects.toMatchObject({ code: 'failed-precondition' });
    const retryAudits = await adminDb.collection('events/review-1/audit_logs').get();
    expect(retryAudits.docs.filter((item) => item.data().action === 'official_finalization_failed')).toHaveLength(2);
  });

  it('does not bind a delayed finalisation failure audit to a newer event generation', async () => {
    await seedProvisionalReviewEvent(['PDRM', 'BOMBA']);
    const adminDb = getFirestore(adminApp);
    await submitScoreReviewForUser('pdrm-1', {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'PDRM reviewed all assessment materials and evidence.', idempotencyKey: 'pdrm_delayed_failure',
    }, 32);
    await expect(retryOfficialFinalisationForAdmin('admin-1', 'review-1', 33, {
      beforeFailureAudit: async () => {
        await adminDb.doc('events/review-1').update({ currentVersionId: 'v2', currentAssessmentId: 'assessment-v2' });
      },
    })).rejects.toMatchObject({ code: 'failed-precondition' });
    const audits = await adminDb.collection('events/review-1/audit_logs').get();
    expect(audits.docs.some((item) => item.data().action === 'official_finalization_failed')).toBe(false);
  });

  it('records concurrent officer recommendations without publishing a final application decision', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const results = await Promise.all([
      makeAuthorityDecisionForUser('pdrm-1', { eventId: 'review-1', decision: 'Approved', rationale: 'PDRM operational requirements are satisfied.', materialsReviewed: true }, 2_000),
      makeAuthorityDecisionForUser('bomba-1', { eventId: 'review-1', decision: 'Approved', rationale: 'BOMBA fire safety requirements are satisfied.', materialsReviewed: true }, 2_000),
    ]);
    expect(results.map((result) => result.status)).toEqual(['UnderReview', 'UnderReview']);
    const adminDb = getFirestore(adminApp);
    expect((await adminDb.doc('events/review-1').get()).data()).toMatchObject({ status: 'UnderReview', authorityReviewCompletedAt: 2_000 });
    expect((await adminDb.doc('public_events/review-1').get()).exists).toBe(false);
    expect((await adminDb.collection('events/review-1/decisions').get()).size).toBe(2);
    expect((await adminDb.collection('events/review-1/decision_history').get()).size).toBe(2);
    const duplicate = await makeAuthorityDecisionForUser('pdrm-1', { eventId: 'review-1', decision: 'Approved', rationale: 'PDRM operational requirements are satisfied.', materialsReviewed: true }, 2_001);
    expect(duplicate.idempotent).toBe(true);
  });

  it('gives a concurrent rejection precedence and keeps the event private', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const results = await Promise.allSettled([
      makeAuthorityDecisionForUser('pdrm-1', { eventId: 'review-1', decision: 'Approved', rationale: 'PDRM operational requirements are satisfied.', materialsReviewed: true }, 3_000),
      makeAuthorityDecisionForUser('bomba-1', { eventId: 'review-1', decision: 'Rejected', rationale: 'Emergency exits do not satisfy fire requirements.', suggestion: 'Add verified emergency exit controls before the next review.' }, 3_000),
    ]);
    const adminDb = getFirestore(adminApp);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect((await adminDb.doc('events/review-1').get()).data()?.status).toBe('UnderReview');
    expect((await adminDb.doc('public_events/review-1').get()).exists).toBe(false);
  });

  it('does not let an idempotent decision replay bypass the current official contract', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const request = {
      eventId: 'review-1', decision: 'Approved' as const,
      rationale: 'PDRM confirms the version one operating plan.',
      materialsReviewed: true,
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

  it('rejects the removed amendment decision and keeps a rejected application terminal', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const legacyDecision = {
      eventId: 'review-1',
      decision: 'AmendmentRequested' as unknown as 'Approved' | 'Rejected',
      rationale: 'Legacy amendment decision must no longer be accepted.',
      suggestion: 'Submit a new application if the event needs a different proposal.',
    };
    await expect(makeAuthorityDecisionForUser('bomba-1', legacyDecision, 3_101))
      .rejects.toMatchObject({ code: 'invalid-argument' });

    const adminDb = getFirestore(adminApp);
    const v2Evidence = await uploadTestEvidence('review-1', 'v2');
    await adminDb.doc('events/review-1').update({
      status: 'Rejected',
      editableVersionId: 'v2',
      draftDocumentPaths: [v2Evidence],
      eventDetails: { ...validDetails, name: 'Terminally Rejected Event' },
    });
    await expect(submitEventForUser('organizer-1', 'review-1', 3_200)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await adminDb.doc('events/review-1').get()).data()?.status).toBe('Rejected');
    expect((await adminDb.collection('events/review-1/versions').doc('v2').get()).exists).toBe(false);
  });

  it('allows an assigned authority to override resources with an audit record', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const adminDb = getFirestore(adminApp);
    await adminDb.doc('events/review-1').update({
      assignedOfficerUids: ['pdrm-1', 'bomba-1'],
      initialReview: { decision: 'Approved', reason: 'Initial review complete.', reviewerUid: 'admin-1', reviewedAt: 1 },
    });
    await adminDb.doc('events/review-1/assignments/v1_PDRM').set({
      assignmentId: 'v1_PDRM', eventId: 'review-1', versionId: 'v1', authorityType: 'PDRM', officerUid: 'pdrm-1', assignedBy: 'admin-1', assignedAt: 1, status: 'pending',
    });
    const quantities = { police: 12, medicalTeams: 3, ambulances: 2, toilets: 60, wasteBins: 20, security: 25, fireOfficers: 4 };
    const baselineReference = adminDb.doc(`events/review-1/resources/${officialResourceId('v1')}`);
    const before = (await baselineReference.get()).data();
    const override = await overrideResourcesForUser('pdrm-1', {
      eventId: 'review-1', quantities,
      rationale: 'Increased staffing for controlled entry and traffic management.',
      idempotencyKey: 'resource-override-test-1',
    }, 4_000);
    expect(override).toMatchObject({ eventId: 'review-1', baseResourceId: before?.resourceId, quantities, idempotent: false });
    expect((await baselineReference.get()).data()).toEqual(before);
    const replay = await overrideResourcesForUser('pdrm-1', {
      eventId: 'review-1', quantities,
      rationale: 'Increased staffing for controlled entry and traffic management.',
      idempotencyKey: 'resource-override-test-1',
    }, 4_001);
    expect(replay).toMatchObject({ overrideId: override.overrideId, idempotent: true });
    expect((await adminDb.collection('events/review-1/resource_overrides').get()).size).toBe(1);
    expect((await adminDb.doc(`events/review-1/resource_overrides/${override.overrideId}`).get()).data())
      .toMatchObject({ baseResourceId: before?.resourceId, resourceId: before?.resourceId, reviewerId: 'pdrm-1', quantities });
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

  it('publishes a new provisional assessment, resource, pointers, summary and audits atomically', async () => {
    const adminDb = getFirestore(adminApp);
    const eventReference = adminDb.doc('events/atomic-1');
    const versionId = 'v1';
    const assessmentId = 'v1-assessment-atomic';
    const claimId = 'atomic-claim';
    const official = officialAssessmentFixture(versionId);
    const { officialResult: _official, authorityReviewState: _state, ...base } = official;
    void _official;
    void _state;
    const assessment = {
      ...base,
      eventId: 'atomic-1', assessmentId, status: 'provisional_ready' as const,
      authorityReviewRequired: true as const,
    };
    const version = {
      versionId, eventId: 'atomic-1', versionNumber: 1, eventDetails: validDetails,
      documentPaths: ['event_documents/atomic-1/v1/evidence.pdf'], submittedBy: 'organizer-1', submittedAt: 1,
      inputHash: 'f'.repeat(64),
    };
    const calculation = computeResources({
      eventId: 'atomic-1', versionId, assessmentId, eventDetails: validDetails,
      assessmentResult: assessment.provisionalResult,
    });
    if (!calculation.ok) throw new Error('Expected a valid atomic publication fixture.');
    await Promise.all([
      eventReference.set({
        eventId: 'atomic-1', organizerId: 'organizer-1', eventDetails: validDetails, status: 'Pending',
        currentVersionId: versionId, currentVersionNumber: 1, draftDocumentPaths: version.documentPaths,
        requiredAuthorities: ['PDRM'], createdAt: 1, updatedAt: 1,
      }),
      eventReference.collection('versions').doc(versionId).set(version),
      eventReference.collection('assessments').doc(assessmentId).set({
        assessmentId, eventId: 'atomic-1', versionId, status: 'processing', inputHash: assessment.inputHash,
        claimId, claimedAt: 1, leaseExpiresAt: Number.MAX_SAFE_INTEGER, createdAt: 1,
      }),
      eventReference.collection('resources').doc('corrupt').set({ versionId, stage: 'provisional' }),
    ]);
    const failed = await __testOnlyPersistResourceCalculation(
      eventReference, version as never, assessment as never, calculation, 5_000,
      undefined, undefined, false, false, claimId,
    );
    expect(failed.status).toBe('failed');
    expect((await eventReference.get()).data()?.currentAssessmentId).toBeUndefined();
    expect((await eventReference.collection('assessment_summaries').doc(versionId).get()).exists).toBe(false);
    expect((await eventReference.collection('audit_logs').get()).empty).toBe(true);
    await eventReference.collection('resources').doc('corrupt').delete();
    const published = await __testOnlyPersistResourceCalculation(
      eventReference, version as never, assessment as never, calculation, 5_001,
      undefined, undefined, false, false, claimId,
    );
    expect(published.status).toBe('created');
    expect((await eventReference.get()).data()).toMatchObject({
      currentAssessmentId: assessmentId,
      currentResourceId: published.resourceId,
    });
    expect((await eventReference.collection('assessments').doc(assessmentId).get()).data()?.status).toBe('provisional_ready');
    expect((await eventReference.collection('assessment_summaries').doc(versionId).get()).data()).toMatchObject({
      assessmentId,
      resourceRecommendation: { resourceId: published.resourceId },
    });
    expect((await eventReference.collection('audit_logs').get()).size).toBe(2);
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

  it('preserves organizer review progress during an authority-review resource recompute', async () => {
    await seedProvisionalReviewEvent(['PDRM', 'BOMBA']);
    await submitScoreReviewForUser('pdrm-1', {
      eventId: 'review-1', categories: confirmedReviewCategories(5), rationale: 'PDRM reviewed all assessment materials and evidence.', idempotencyKey: 'progress_review_01',
    }, 4_220);
    const result = await recomputeResourceForStoredAssessment('review-1', 4_221);
    expect(result.status).toBe('created');
    const adminDb = getFirestore(adminApp);
    expect((await adminDb.doc('events/review-1/assessment_summaries/v1').get()).data()?.authorityReviewProgress)
      .toEqual({ completed: 1, required: 2 });
  });

  it('recomputes an official resource revision after resource configuration changes without mutating assessment provenance', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const adminDb = getFirestore(adminApp);
    const eventRef = adminDb.doc('events/review-1');
    const assessmentRef = adminDb.doc('events/review-1/assessments/v1');
    const currentEvent = (await eventRef.get()).data()!;
    const currentResourceRef = adminDb.doc(`events/review-1/resources/${currentEvent.currentResourceId}`);
    const currentResource = (await currentResourceRef.get()).data()!;
    const oldHash = 'a'.repeat(64);
    const oldId = `official-v1-${oldHash}`;
    const oldResource = {
      ...currentResource,
      resourceId: oldId,
      resourceInputHash: oldHash,
      configVersion: 'obsolete-resource-config',
      revision: 1,
      supersedesResourceId: null,
      computedAt: 4_230,
    };
    const assessmentBefore = (await assessmentRef.get()).data();
    await Promise.all([
      currentResourceRef.delete(),
      adminDb.doc(`events/review-1/resources/${oldId}`).set(oldResource),
      eventRef.update({ currentResourceId: oldId }),
    ]);
    const recomputed = await recomputeResourceForStoredAssessment('review-1', 4_231);
    expect(recomputed).toMatchObject({ status: 'created' });
    const newResource = (await adminDb.doc(`events/review-1/resources/${recomputed.resourceId}`).get()).data();
    expect(newResource).toMatchObject({ stage: 'official', revision: 2, supersedesResourceId: oldId, configVersion: RESOURCE_CONFIG_VERSION });
    expect((await assessmentRef.get()).data()).toEqual(assessmentBefore);
    expect((await adminDb.doc(`events/review-1/resources/${oldId}`).get()).data()).toEqual(oldResource);
    expect((await eventRef.get()).data()?.currentResourceId).toBe(recomputed.resourceId);
  });

  it('refuses official resource recomputation when the stored result is not reproducible from review provenance', async () => {
    await seedReviewableEvent(['PDRM', 'BOMBA']);
    const adminDb = getFirestore(adminApp);
    const eventRef = adminDb.doc('events/review-1');
    const assessmentRef = adminDb.doc('events/review-1/assessments/v1');
    const beforeEvent = (await eventRef.get()).data()!;
    const beforeResources = await adminDb.collection('events/review-1/resources').get();
    const tampered = (await assessmentRef.get()).data()!;
    tampered.officialResult.officialInputHash = 'b'.repeat(64);
    await assessmentRef.set(tampered);
    const reviewId = Object.values(tampered.authorityReviewState.activeReviewHeads)[0].reviewId;
    await adminDb.doc(`events/review-1/assessments/v1/score_reviews/${reviewId}`).update({ rationale: 'Tampered stored review provenance.' });
    await expect(recomputeResourceForStoredAssessment('review-1', 4_235))
      .resolves.toMatchObject({ status: 'failed', reason: 'official-provenance-invalid' });
    expect((await eventRef.get()).data()?.currentResourceId).toBe(beforeEvent.currentResourceId);
    expect((await adminDb.collection('events/review-1/resources').get()).size).toBe(beforeResources.size);
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

  it('rolls back only the hardening generation and restores its original pointers and summary', async () => {
    const adminDb = getFirestore(adminApp);
    const eventPath = 'events/hardening-rollback';
    await adminDb.doc(eventPath).set({
      eventId: 'hardening-rollback', currentVersionId: 'v1', currentAssessmentId: 'new-assessment',
      currentResourceId: 'new-resource', status: 'Pending', updatedAt: 2,
    });
    await Promise.all([
      adminDb.doc(`${eventPath}/assessments/old-assessment`).set({ immutable: 'old-assessment' }),
      adminDb.doc(`${eventPath}/resources/old-resource`).set({ immutable: 'old-resource' }),
      adminDb.doc(`${eventPath}/assessments/new-assessment`).set({ assessmentId: 'new-assessment' }),
      adminDb.doc(`${eventPath}/resources/new-resource`).set({ resourceId: 'new-resource', assessmentId: 'new-assessment' }),
      adminDb.doc(`${eventPath}/audit_logs/new-assessment-risk-score-computed`).set({ action: 'risk_score_computed' }),
      adminDb.doc(`${eventPath}/audit_logs/new-resource-recommended`).set({ action: 'resource_recommended' }),
      adminDb.doc(`${eventPath}/assessment_summaries/v1`).set({ assessmentId: 'new-assessment' }),
    ]);
    const oldSummary = { assessmentId: 'old-assessment', marker: 'original-summary' };
    const backup = {
      manifestVersion: 1 as const, projectId: 'linkos-496505' as const, sessionId: 'hardening-session', createdAt: 1,
      events: [{ eventId: 'hardening-rollback', path: eventPath, currentVersionId: 'v1', currentAssessmentId: 'old-assessment', currentResourceId: 'old-resource', versionInputHash: 'a'.repeat(64), summary: { path: `${eventPath}/assessment_summaries/v1`, data: encodeFirestoreValue(oldSummary) } }],
      documents: [
        { path: `${eventPath}/assessments/old-assessment`, data: encodeFirestoreValue({ immutable: 'old-assessment' }) },
        { path: `${eventPath}/resources/old-resource`, data: encodeFirestoreValue({ immutable: 'old-resource' }) },
      ],
    };
    await acquireResourceCutoverLock(adminDb, 'hardening-session', 'apply');
    await __testOnlyRollbackHardeningAttempt(adminDb, backup, {
      eventId: 'hardening-rollback', eventPath, versionId: 'v1', assessmentId: 'new-assessment',
      originalAssessmentId: 'old-assessment', originalResourceId: 'old-resource', auditPaths: [], status: 'succeeded',
    }, 'hardening-session');
    const restored = (await adminDb.doc(eventPath).get()).data();
    expect(restored).toMatchObject({ currentAssessmentId: 'old-assessment', currentResourceId: 'old-resource' });
    expect((await adminDb.doc(`${eventPath}/assessment_summaries/v1`).get()).data()).toEqual(oldSummary);
    expect((await adminDb.doc(`${eventPath}/assessments/new-assessment`).get()).exists).toBe(false);
    expect((await adminDb.doc(`${eventPath}/resources/new-resource`).get()).exists).toBe(false);
    expect((await adminDb.doc(`${eventPath}/assessments/old-assessment`).get()).exists).toBe(true);
    expect((await adminDb.doc(`${eventPath}/resources/old-resource`).get()).exists).toBe(true);
    await releaseResourceCutoverLock(adminDb, 'hardening-session');
  });

  it('leases and fences stale pre-destructive owners without permitting post-destructive takeover', async () => {
    const adminDb = getFirestore(adminApp);
    const now = Date.now();
    const expiredStart = now - RESOURCE_CUTOVER_LEASE_MS - 10;
    await acquireResourceCutoverLock(adminDb, 'stale-owner', 'apply', undefined, expiredStart);
    const backupPath = path.join(tmpdir(), 'steras-stale-prepared', 'backup.json');
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
      let ownershipLost = false;
      for (let attempt = 0; attempt < 30 && !ownershipLost; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        try { heartbeat.assertHealthy(); } catch { ownershipLost = true; }
      }
      expect(ownershipLost).toBe(true);
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

  it('fails closed without changing pointers when a version disappears during cutover inventory', async () => {
    await seedReviewableEvent(['PDRM']);
    const adminDb = getFirestore(adminApp);
    await acquireResourceCutoverLock(adminDb, 'inventory-owner', 'apply');
    await adminDb.doc('events/review-1/versions/v1').delete();
    const pointerBefore = (await adminDb.doc('events/review-1').get()).data()?.currentResourceId;
    await runRiskAndResourcePipeline('review-1', 4_300);
    const queued = (await adminDb.doc(RESOURCE_CUTOVER_LOCK_PATH).get()).data()?.queuedEvents;
    expect(queued).toEqual([]);
    expect((await adminDb.doc('events/review-1').get()).data()?.currentResourceId).toBe(pointerBefore);
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

  it('denies direct client access to M4 incidents, history, and authority directory', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'incidents/incident-1'), { schemaVersion: '2026-09-03-m4-v1' });
      await setDoc(doc(context.firestore(), 'incidents/incident-1/history/history-1'), { action: 'submitted' });
      await setDoc(doc(context.firestore(), 'authority_directory/pdrm-kl'), { active: true });
    });
    const reporter = environment.authenticatedContext('reporter-1').firestore();
    const admin = environment.authenticatedContext('admin-1').firestore();
    await assertFails(getDoc(doc(reporter, 'incidents/incident-1')));
    await assertFails(setDoc(doc(reporter, 'incidents/incident-2'), { reporterUid: 'reporter-1' }));
    await assertFails(getDoc(doc(admin, 'incidents/incident-1/history/history-1')));
    await assertFails(getDoc(doc(admin, 'authority_directory/pdrm-kl')));
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
    await setDoc(doc(db, 'events/review-1/assessments/v1/score_reviews/v1-PDRM-review'), scoreReviewFixture('v1', 'PDRM'));
    await setDoc(doc(db, 'events/review-1/assessments/v1/score_reviews/v1-BOMBA-review'), scoreReviewFixture('v1', 'BOMBA'));
  });
}

async function seedManualReviewEvent(detailsPatch: Partial<typeof validDetails> = {}) {
  const adminDb = getFirestore(adminApp);
  const eventDetails = { ...validDetails, ...detailsPatch };
  await Promise.all([
    adminDb.doc('users/organizer-1').set({ role: 'organizer' }),
    adminDb.doc('users/pdrm-1').set({ role: 'authority', authorityType: 'PDRM' }),
    adminDb.doc('users/admin-1').set({ role: 'admin' }),
    adminDb.doc('events/manual-1').set({
      eventId: 'manual-1', organizerId: 'organizer-1', eventDetails, status: 'Pending', currentVersionId: 'v1', currentVersionNumber: 1,
      currentAssessmentId: 'v1', editableVersionId: null, draftDocumentPaths: [], requiredAuthorities: ['PDRM'], createdAt: 1, updatedAt: 1,
    }),
    adminDb.doc('events/manual-1/versions/v1').set({ versionId: 'v1', eventId: 'manual-1', versionNumber: 1, eventDetails, documentPaths: [], submittedBy: 'organizer-1', submittedAt: 1, inputHash: 'manual-version-hash' }),
    adminDb.doc('events/manual-1/assessments/v1').set({
      status: 'manual_review_required', schemaVersion: ASSESSMENT_SCHEMA_VERSION, assessmentId: 'v1', eventId: 'manual-1', versionId: 'v1',
      assessmentReadiness: 'provisional', complianceStatus: 'pass', contextSnapshot: benignContextSnapshot(), inputHash: 'a'.repeat(64),
      warnings: [], sourceTimestamps: {}, contextStatuses: {}, complianceChecks: [], dataConfidenceScore: 50, dataConfidenceLevel: 'medium', authorityReviewRequired: true,
      evidence: [{ key: 'crowd', description: 'Verified attendance and venue evidence', sourceTimestamp: 1, source: 'test', status: 'available', quality: 'verified', confidenceScore: 100, eligibility: 'eligible', syntheticStatus: 'none' }],
      contextEvidence: [{ evidenceId: 'manual-document', evidenceKey: 'compliance', sourceKind: 'submitted_document', sourceLocator: 'event_documents/manual-1/v1/evidence.pdf', retrievedAt: 1, sourceVersion: 'storage-generation:1', eligibility: 'eligible', synthetic: false, visibility: 'authority_only' }],
      createdAt: 1, aiProposal: { status: 'timeout', model: 'test-model', promptVersion: 'test-prompt', responseSchemaVersion: 'test-schema', retryable: true, errorSummary: 'Timed out', cacheStatus: 'not-applicable', generatedAt: 1 },
      manualReviewReason: 'AI proposal timed out and no score fallback was created.',
    }),
  ]);
}

function manualRequest() {
  return {
    eventId: 'manual-1', idempotencyKey: 'manual-key-0001',
    hazards: [{ hazardId: 'manual-hazard-1', hazardName: 'Crowd congestion', categoryId: 'crowd' as const, evidenceReferences: ['crowd' as const], rationale: 'Verified attendance evidence supports the identified congestion hazard.' }],
    categories: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ categoryId: category.id, likelihood: 2 as const, severity: 2 as const, evidenceReferences: ['crowd' as const], rationale: `Admin reviewed all available evidence for ${category.name}.`, missingInformation: '' })),
    rationale: 'The complete immutable application and available contextual evidence were assessed manually.',
  };
}

async function seedProvisionalReviewEvent(requiredAuthorities: string[]) {
  const adminDb = getFirestore(adminApp);
  const official = officialAssessmentFixture('v1');
  const { officialResult: _officialResult, authorityReviewState: _authorityReviewState, ...base } = official;
  void _officialResult;
  void _authorityReviewState;
  await Promise.all([
    adminDb.doc('users/organizer-1').set({ role: 'organizer' }),
    adminDb.doc('users/pdrm-1').set({ role: 'authority', authorityType: 'PDRM' }),
    adminDb.doc('users/bomba-1').set({ role: 'authority', authorityType: 'BOMBA' }),
    adminDb.doc('users/admin-1').set({ role: 'admin' }),
    adminDb.doc('events/review-1').set({
      eventId: 'review-1', organizerId: 'organizer-1', eventDetails: validDetails, status: 'Pending', currentVersionId: 'v1', currentVersionNumber: 1,
      currentAssessmentId: 'v1', editableVersionId: null, draftDocumentPaths: [], requiredAuthorities, createdAt: 1, updatedAt: 1,
    }),
    adminDb.doc('events/review-1/versions/v1').set({ versionId: 'v1', eventId: 'review-1', versionNumber: 1, eventDetails: validDetails, documentPaths: [], submittedBy: 'organizer-1', submittedAt: 1, inputHash: 'hash' }),
    adminDb.doc('events/review-1/assessments/v1').set({ ...base, status: 'provisional_ready', authorityReviewRequired: true }),
  ]);
}

function confirmedReviewCategories(score: 1 | 2 | 3 | 4 | 5) {
  return ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ categoryId: category.id, likelihood: score, severity: score, decision: 'confirmed' as const }));
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

function officialAssessmentFixture(versionId: string, eventDetails = validDetails) {
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
  const provisional = {
    status: 'authority_review',
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    assessmentId: versionId,
    eventId: 'review-1',
    versionId,
    assessmentReadiness: 'complete',
    complianceStatus: 'pass',
    contextSnapshot: benignContextSnapshot(),
    inputHash: assessmentInputHashFixture(versionId),
    warnings: [],
    sourceTimestamps: {},
    contextStatuses: {},
    complianceChecks: [],
    dataConfidenceScore: 100,
    dataConfidenceLevel: 'high',
    authorityReviewRequired: true,
    evidence: [{ key: 'crowd', description: 'Test attendance evidence', sourceTimestamp: 1, source: 'test', status: 'available', quality: 'verified', confidenceScore: 100, eligibility: 'eligible', syntheticStatus: 'none' }],
    contextEvidence: [{ evidenceId: `document-${versionId}`, evidenceKey: 'compliance', sourceKind: 'submitted_document', sourceLocator: `event_documents/review-1/${versionId}/evidence.pdf`, retrievedAt: 1, sourceVersion: 'storage-generation:1', eligibility: 'eligible', synthetic: false, visibility: 'authority_only' }],
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
  } as const;
  const reviews = [scoreReviewFixture(versionId, 'PDRM'), scoreReviewFixture(versionId, 'BOMBA')];
  const authorityReviewState = buildAuthorityReviewState(['PDRM', 'BOMBA'], reviews, 2);
  return {
    ...provisional,
    status: 'official_ready',
    authorityReviewRequired: false,
    authorityReviewState,
    officialResult: buildOfficialAssessmentResult({
      assessment: provisional as never,
      eventDetails: eventDetails as never,
      requiredAuthorities: ['PDRM', 'BOMBA'],
      reviews,
      finalizedAt: 2,
      finalizedBy: 'system',
    }),
  };
}

function scoreReviewFixture(versionId: string, authorityType: 'PDRM' | 'BOMBA') {
  return {
    reviewId: `${versionId}-${authorityType}-review`, schemaVersion: SCORE_REVIEW_SCHEMA_VERSION,
    eventId: 'review-1', versionId, assessmentId: versionId, proposalId: `proposal-${versionId}`,
    provisionalCalculatedAt: 1, assessmentInputHash: assessmentInputHashFixture(versionId), categorySchemaVersion: ACTIVE_CATEGORY_SCHEMA.version,
    authorityType, reviewerId: authorityType === 'PDRM' ? 'pdrm-1' : 'bomba-1',
    categories: ACTIVE_CATEGORY_SCHEMA.categories.map((category) => ({ categoryId: category.id, likelihood: 5 as const, severity: 5 as const, decision: 'confirmed' as const })),
    rationale: 'All application evidence and risk materials were reviewed.', idempotencyKey: `${versionId}_${authorityType}_review`, createdAt: 2,
  };
}

function benignContextSnapshot() {
  return {
    weather: {
      data: { forecast: 'Clear', temperature: 25, humidity: 50, windSpeed: 1, precipitationProbability: 0, severeAlert: false },
      measurementStatus: 'available',
      source: 'openweather', freshness: 'fresh', fetchedAt: 1, expiresAt: 2, forecastFor: 10_000,
    },
    calendar: {
      localDate: '2026-08-19', dayOfWeek: 'Wednesday', isWeekend: false, isHolidayOrAdjacent: false,
      holidayDistanceDays: 10, sourceVersion: 'test', sourceTimestamp: 1, coverageStatus: 'verified',
    },
    venue: { matched: true, venueId: 'venue-1', submittedCapacity: 1_000, registeredCapacity: 1_000, capacityDifference: 0, fetchedAt: 1 },
    incidentHistory: { matched: true, venueId: 'venue-1', incidentIds: [], total: 0, bySeverity: { low: 0, medium: 0, high: 0 }, syntheticStatus: 'none', fetchedAt: 1 },
  };
}

function assessmentInputHashFixture(versionId: string): string {
  return (versionId === 'v1' ? 'a' : 'b').repeat(64);
}

function officialResourceFixture(versionId: string, computedAt: number, eventDetails = validDetails) {
  const calculation = officialResourceCalculation(versionId, eventDetails);
  const items = Object.fromEntries(RESOURCE_KEYS.map((resource) => [resource, {
    ...calculation.items[resource], confidence: 'authority_validated', authorityReviewRequired: false,
  }]));
  return {
    resourceId: officialResourceId(versionId, eventDetails), eventId: 'review-1', versionId, assessmentId: versionId,
    schemaVersion: RESOURCE_SCHEMA_VERSION, stage: 'official', revision: 1, supersedesResourceId: null,
    assessmentReference: { stage: 'official', assessmentId: versionId, proposalId: `proposal-${versionId}`, finalizedAt: 2, finalizedBy: 'system' },
    resourceInputHash: calculation.resourceInputHash, formulaVersion: RESOURCE_FORMULA_VERSION, configVersion: RESOURCE_CONFIG_VERSION,
    sourceRegistryVersion: RESOURCE_SOURCE_REGISTRY_VERSION, items,
    validationScope: 'official_risk_input_only',
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
    validationScope: 'provisional_risk_input',
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
