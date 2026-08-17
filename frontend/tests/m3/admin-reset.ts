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

/** Reset evt-002 to a clean UnderReview state with no decisions. */
export async function resetFoodFair(): Promise<void> {
  const eventRef = db.collection('events').doc('evt-002-pj-food-fair');
  const decs = await eventRef.collection('decisions').get();
  const batch = db.batch();
  for (const d of decs.docs) batch.delete(d.ref);
  await batch.commit();
  await eventRef.update({ status: 'UnderReview', updatedAt: Date.now() });
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
  await eventRef.update({ status: 'Pending', updatedAt: Date.now() });
}
