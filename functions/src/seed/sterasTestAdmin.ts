import { Buffer } from 'node:buffer';
import {
  STERAS_TEST_ACCOUNT_EMAILS,
  STERAS_TEST_DATASET_ID,
  STERAS_TEST_EVENTS,
} from '@shared/sterasTestFixtures';
import {
  assertSharedProjectAuthorization,
  initializeSterasTestContext,
  prepareSterasTestForPlaywright,
  resetSterasTestControlVerificationForPlaywright,
  type SterasTestContext,
} from './seedSterasTest';

type Action = 'prepare' | 'reset-food-fair' | 'reset-mountain-run' | 'reset-approved-event' | 'reset-control-verification' | 'reset-marathon' | 'identity-uids' | 'seed-public-event';

const ctx = initializeSterasTestContext();
assertSharedProjectAuthorization(ctx.projectId, 'apply');

async function uids(context: SterasTestContext) {
  const entries = await Promise.all(Object.entries(STERAS_TEST_ACCOUNT_EMAILS).map(async ([key, email]) => [key, (await context.auth.getUserByEmail(email)).uid] as const));
  return Object.fromEntries(entries) as Record<keyof typeof STERAS_TEST_ACCOUNT_EMAILS, string>;
}

async function assertManagedEvent(context: SterasTestContext, eventId: string) {
  const ref = context.db.collection('events').doc(eventId);
  const snap = await ref.get();
  const marker = snap.data()?.sterasTest;
  if (!snap.exists || marker?.datasetId !== STERAS_TEST_DATASET_ID || marker?.fixtureId !== eventId) {
    throw new Error(`Refusing to reset unmanaged events/${eventId}.`);
  }
  return ref;
}

async function deleteCollection(context: SterasTestContext, query: FirebaseFirestore.Query): Promise<void> {
  const snap = await query.get();
  for (let offset = 0; offset < snap.docs.length; offset += 400) {
    const docs = snap.docs.slice(offset, offset + 400);
    if (docs.length === 0) continue;
    const batch = context.db.batch();
    docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function resetOfficerWorkloads(context: SterasTestContext): Promise<void> {
  const ids = await uids(context);
  const batch = context.db.batch();
  for (const authority of ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'] as const) {
    batch.set(context.db.collection('officers').doc(ids[authority]), { workloadCount: 0, lastAssignedAt: null, updatedAt: Date.now() }, { merge: true });
  }
  await batch.commit();
}

async function resetFoodFair(context: SterasTestContext): Promise<void> {
  const eventId = STERAS_TEST_EVENTS.authorityPartial;
  const eventRef = await assertManagedEvent(context, eventId);
  const ids = await uids(context);
  await deleteCollection(context, eventRef.collection('decisions'));
  await deleteCollection(context, eventRef.collection('decision_history'));
  await deleteCollection(context, eventRef.collection('assignments'));
  await deleteCollection(context, context.db.collection('notifications').where('eventId', '==', eventId));
  await context.db.collection('public_events').doc(eventId).delete().catch(() => undefined);
  await resetOfficerWorkloads(context);
  const now = Date.now();
  const officerByAuthority = { PDRM: ids.PDRM, BOMBA: ids.BOMBA, KKM: ids.KKM, MOTAC: ids.MOTAC };
  const batch = context.db.batch();
  for (const [authorityType, officerUid] of Object.entries(officerByAuthority)) {
    const assignmentId = `v1_${authorityType}`;
    batch.set(eventRef.collection('assignments').doc(assignmentId), { assignmentId, eventId, versionId: 'v1', authorityType, officerUid, assignedBy: ids.admin, assignedAt: now, status: 'pending', sterasTest: { datasetId: STERAS_TEST_DATASET_ID, fixtureId: eventId, managedBy: 'seed:steras:test' } });
    batch.set(context.db.collection('officers').doc(officerUid), { workloadCount: 1, updatedAt: now }, { merge: true });
  }
  await batch.commit();
  await eventRef.set({ status: 'UnderReview', reviewStage: 'authority', initialReview: { decision: 'Approved', reason: 'STERAS test initial review approved.', reviewerUid: ids.admin, reviewedAt: now }, assignedOfficerUids: Object.values(officerByAuthority), assignedOfficerByAuthority: officerByAuthority, organizerId: ids.organizer, updatedAt: now }, { merge: true });
}

async function resetMountainRun(context: SterasTestContext): Promise<void> {
  const eventId = STERAS_TEST_EVENTS.initialReady;
  const eventRef = await assertManagedEvent(context, eventId);
  const ids = await uids(context);
  await deleteCollection(context, eventRef.collection('decisions'));
  await deleteCollection(context, eventRef.collection('assignments'));
  await eventRef.set({ status: 'Pending', reviewStage: 'initial', assignedOfficerUids: [], assignedOfficerByAuthority: {}, organizerId: ids.organizer, updatedAt: Date.now() }, { merge: true });
}

async function resetApprovedEvent(context: SterasTestContext): Promise<void> {
  const eventId = STERAS_TEST_EVENTS.controlVerification;
  const eventRef = await assertManagedEvent(context, eventId);
  const ids = await uids(context);
  const event = (await eventRef.get()).data() as {
    currentVersionId?: string;
    eventDetails?: {
      name?: string;
      venueName?: string;
      type?: string;
      startDatetime?: number;
      endDatetime?: number;
    };
    requiredAuthorities?: string[];
  } | undefined;
  const controls = await eventRef.collection('event_controls').get();
  for (const control of controls.docs) await context.db.recursiveDelete(control.ref);
  const publicControls = context.db.collection('public_event_controls').doc(eventId);
  if ((await publicControls.get()).exists) await context.db.recursiveDelete(publicControls);
  await deleteCollection(context, context.db.collection('public_reports').where('eventId', '==', eventId));
  await deleteCollection(context, context.db.collection('notifications').where('eventId', '==', eventId));
  await deleteCollection(context, eventRef.collection('audit_logs'));
  await eventRef.set({ status: 'Approved', organizerId: ids.organizer, controlListGenerated: false, controlListSnapshot: null, updatedAt: Date.now() }, { merge: true });
  // A previous workflow may have intentionally removed the public projection
  // (for example, the control-verification reset). Recreate the exact
  // managed approved projection so every Stage 2 public-view test starts
  // from a deterministic, publicly listed event.
  const details = event?.eventDetails ?? {};
  await context.db.collection('public_events').doc(eventId).set({
    eventId,
    versionId: event?.currentVersionId ?? 'v1',
    eventName: details.name ?? 'STERAS test event',
    venueName: details.venueName ?? 'STERAS test venue',
    eventType: details.type ?? 'other',
    startDatetime: details.startDatetime ?? Date.now(),
    endDatetime: details.endDatetime ?? Date.now() + 3_600_000,
    approvedBy: event?.requiredAuthorities ?? [],
    publicStatus: 'approved',
    publishedBy: ids.admin,
    sterasTest: { datasetId: STERAS_TEST_DATASET_ID, fixtureId: eventId, managedBy: 'seed:steras:test' },
  }, { merge: true });
}

async function resetMarathon(context: SterasTestContext): Promise<void> {
  const eventId = STERAS_TEST_EVENTS.awaitingAssignment;
  const eventRef = await assertManagedEvent(context, eventId);
  const ids = await uids(context);
  await deleteCollection(context, eventRef.collection('assignments'));
  await deleteCollection(context, eventRef.collection('audit_logs'));
  await deleteCollection(context, context.db.collection('notifications').where('eventId', '==', eventId));
  await resetOfficerWorkloads(context);
  await eventRef.set({ status: 'UnderReview', reviewStage: 'initial', initialReview: { decision: 'Approved', reason: 'STERAS test initial review approved.', reviewerUid: ids.admin, reviewedAt: Date.now() }, assignedOfficerUids: [], assignedOfficerByAuthority: {}, secondReview: null, organizerId: ids.organizer, updatedAt: Date.now() }, { merge: true });
}

async function seedPublicEvent(context: SterasTestContext, encoded: string | undefined): Promise<void> {
  if (!encoded) throw new Error('seed-public-event requires a base64url payload.');
  const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { eventId?: string; payload?: Record<string, unknown> };
  if (!decoded.eventId || !decoded.payload) throw new Error('Invalid seed-public-event payload.');
  await assertManagedEvent(context, decoded.eventId);
  await context.db.collection('public_events').doc(decoded.eventId).set({ ...decoded.payload, sterasTest: { datasetId: STERAS_TEST_DATASET_ID, fixtureId: decoded.eventId, managedBy: 'seed:steras:test' } }, { merge: true });
}

async function run(action: Action, argument?: string): Promise<void> {
  if (action === 'prepare') await prepareSterasTestForPlaywright(ctx);
  if (action === 'reset-food-fair') await resetFoodFair(ctx);
  if (action === 'reset-mountain-run') await resetMountainRun(ctx);
  if (action === 'reset-approved-event') await resetApprovedEvent(ctx);
  if (action === 'reset-control-verification') await resetSterasTestControlVerificationForPlaywright(ctx);
  if (action === 'reset-marathon') await resetMarathon(ctx);
  if (action === 'seed-public-event') await seedPublicEvent(ctx, argument);
  if (action === 'identity-uids') {
    const ids = await uids(ctx);
    process.stdout.write(JSON.stringify({ pdrm: ids.PDRM, bomba: ids.BOMBA, kkm: ids.KKM, dbkl: ids.DBKL, motac: ids.MOTAC }));
  }
}

const action = process.argv[2] as Action | undefined;
if (!action) throw new Error('STERAS test admin action is required.');
run(action, process.argv[3]).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

