/**
 * Admin-reset helper — uses the Firebase Admin SDK directly (bypasses
 * security rules) to reset event state between tests. Used by beforeEach
 * hooks that need to wipe decisions, restore status, etc.
 *
 * The page-context `api` helper uses the signed-in user's auth, which
 * can't always write to event docs (e.g. admin role doesn't have
 * client-side write permission on the events collection).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

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

/** Real auth UID for the UAT organiser (mirrors Firebase Auth). */
const UAT_ORGANIZER_UID = 'RTocM1dFipZfNcIacVAMMPRwazE3';

/** Reset evt-002 to a clean UnderReview state with no decisions. */
export async function resetFoodFair(): Promise<void> {
  const eventRef = db.collection('events').doc('evt-002-pj-food-fair');
  const decs = await eventRef.collection('decisions').get();
  const batch = db.batch();
  for (const d of decs.docs) batch.delete(d.ref);
  await batch.commit();
  await eventRef.update({
    status: 'UnderReview',
    organizerId: UAT_ORGANIZER_UID,
    updatedAt: Date.now(),
  });
  // Drop the public_events projection if any
  await db.collection('public_events').doc('evt-002-pj-food-fair').delete().catch(() => undefined);
}

/**
 * Write a public_events/{eventId} doc directly via the Admin SDK. The
 * client-side `setDoc` would be blocked by the Firestore rules (write
 * is server-only). Workstream 4 tests use this to mirror the effect of
 * the second-review flow on the Approved event fixture.
 */
export async function seedPublicEvent(eventId: string, payload: Record<string, unknown>): Promise<void> {
  await db.collection('public_events').doc(eventId).set(payload, { merge: true });
}

/** Reset evt-003 to a clean Pending state. */
export async function resetMountainRun(): Promise<void> {
  const eventRef = db.collection('events').doc('evt-003-kl-mountain-run');
  const decs = await eventRef.collection('decisions').get();
  const batch = db.batch();
  for (const d of decs.docs) batch.delete(d.ref);
  await batch.commit();
  await eventRef.update({ status: 'Pending', organizerId: UAT_ORGANIZER_UID, updatedAt: Date.now() });
}

/**
 * Reset evt-001-kl-music-festival (Approved) for Workstream 2 tests:
 * Approved, no control list generated, no per-control docs. Wipes the
 * `event_controls/` sub-collection + audit logs + control list snapshot
 * + notifications. Used by generate-control-list.spec.ts and
 * organizer-event-controls.spec.ts.
 */
export async function resetApprovedEvent(): Promise<void> {
  const eventId = 'evt-001-kl-music-festival';
  const eventRef = db.collection('events').doc(eventId);
  // Wipe per-control docs + their stage1_docs, stage2_docs, and
  // the Workstream 4 rate-limit counter sub-collections.
  const ctrls = await eventRef.collection('event_controls').get();
  const b1 = db.batch();
  for (const c of ctrls.docs) {
    const s1 = await c.ref.collection('stage1_docs').get();
    for (const d of s1.docs) b1.delete(d.ref);
    const s2 = await c.ref.collection('stage2_docs').get();
    for (const d of s2.docs) b1.delete(d.ref);
    const confirms = await c.ref.collection('stage2_confirms').get();
    for (const d of confirms.docs) b1.delete(d.ref);
    const reports = await c.ref.collection('stage2_reports').get();
    for (const d of reports.docs) b1.delete(d.ref);
    b1.delete(c.ref);
  }
  await b1.commit();
  // Also wipe orphan sub-collections at the known controlId paths.
  // This is needed when a previous test run's editEventControlList
  // deleted the parent control doc but left the stage2_docs sub-
  // collection behind (Firestore doesn't auto-delete sub-collections
  // when the parent is deleted). These orphans would otherwise block
  // a fresh upload in this run (e.g. a stale m4TicketId would trip
  // the "A report is open" guard).
  const allAuthorities = ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'];
  for (const auth of allAuthorities) {
    const ctrlId = `${eventId}-ctrl-${auth.toLowerCase()}-v1`;
    const ctrlRef = eventRef.collection('event_controls').doc(ctrlId);
    const subCollections = ['stage1_docs', 'stage2_docs', 'stage2_confirms', 'stage2_reports'];
    for (const subName of subCollections) {
      const docs = await ctrlRef.collection(subName).get();
      const b = db.batch();
      for (const d of docs.docs) b.delete(d.ref);
      if (!docs.empty) await b.commit();
    }
    // Wipe the control doc itself if it exists.
    await ctrlRef.delete().catch(() => undefined);
  }
  // Wipe any public_reports for this event (M4 handoff target).
  const reportsSnap = await db.collection('public_reports').where('eventId', '==', eventId).get();
  const bReports = db.batch();
  for (const r of reportsSnap.docs) bReports.delete(r.ref);
  await bReports.commit();
  // Wipe audit logs (in case prior runs wrote them).
  const audits = await eventRef.collection('audit_logs').get();
  const bAudit = db.batch();
  for (const a of audits.docs) bAudit.delete(a.ref);
  await bAudit.commit();
  // Wipe notifications from prior runs.
  const ns = await db.collection('notifications').get();
  const b2 = db.batch();
  ns.docs.forEach((d) => b2.delete(d.ref));
  await b2.commit();
  // Reset the event's control-list fields + ensure status + organizer.
  await eventRef.update({
    status: 'Approved',
    organizerId: UAT_ORGANIZER_UID,
    controlListGenerated: false,
    controlListSnapshot: null,
    updatedAt: Date.now(),
  });
}

/**
 * Reset evt-004 (marathon) for Workstream 1 tests: UnderReview +
 * reviewStage='initial', no assignments. Resets all 5 officers'
 * workloadCount to 0. Also clears the event's audit logs (so the
 * assignment_created assertions in officer-assignment.spec.ts don't
 * pick up old data from prior test runs) and any prior
 * `second_review_*` / `assignment_*` audit entries.
 */
export async function resetMarathon(): Promise<void> {
  const eventRef = db.collection('events').doc('evt-004-kl-marathon');
  // Wipe assignments
  const assn = await eventRef.collection('assignments').get();
  const b1 = db.batch();
  assn.docs.forEach((d) => b1.delete(d.ref));
  await b1.commit();
  // Wipe audit logs (assignment_created, assignment_revoked, decision_made, etc.)
  const audits = await eventRef.collection('audit_logs').get();
  const bAudit = db.batch();
  audits.docs.forEach((d) => bAudit.delete(d.ref));
  await bAudit.commit();
  // Reset event
  await eventRef.update({
    status: 'UnderReview',
    reviewStage: 'initial',
    secondReview: null,
    updatedAt: Date.now(),
  });
  // Reset officer workload
  const o = await db.collection('officers').get();
  const b2 = db.batch();
  o.docs.forEach((d) => b2.update(d.ref, { workloadCount: 0, updatedAt: Date.now() }));
  await b2.commit();
  // Wipe notifications from prior runs
  const ns = await db.collection('notifications').get();
  const b3 = db.batch();
  ns.docs.forEach((d) => b3.delete(d.ref));
  await b3.commit();
}
