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
