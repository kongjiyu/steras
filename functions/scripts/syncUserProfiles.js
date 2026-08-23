/**
 * STERAS — User Profile Sync
 * =====================================================================
 * Ensures the Firestore `users` collection mirrors the Firebase Auth
 * accounts exactly:
 *   - Wipes any doc whose uid is NOT in the current Auth list
 *   - Upserts a profile doc for every Auth user
 *
 * Role mapping (by email):
 *   steras-admin@steras.test   → role: 'admin'
 *   uat-organizer@steras.test  → role: 'organizer'
 *   uat-{pdrm,bomba,kkm,dbkl,motac}@steras.test → role: 'authority' (with authorityType)
 *   everyone else              → role: 'public'
 *
 * Run from: steras/functions/
 *   node scripts/syncUserProfiles.js
 *
 * Idempotent. Safe to run multiple times.
 * =====================================================================
 */

const path = require('node:path');
const fs = require('node:fs');
const admin = require('firebase-admin');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_ACCOUNT_PATH = path.join(
  PROJECT_ROOT,
  'linkos-496505-firebase-adminsdk-fbsvc-a951ea775c.json',
);
const PROJECT_ID = 'linkos-496505';

const ROLE_BY_EMAIL = {
  'steras-admin@steras.test':   { role: 'admin',     authorityType: null },
  'uat-organizer@steras.test':  { role: 'organizer', authorityType: null },
  'uat-pdrm@steras.test':       { role: 'authority', authorityType: 'PDRM' },
  'uat-bomba@steras.test':      { role: 'authority', authorityType: 'BOMBA' },
  'uat-kkm@steras.test':        { role: 'authority', authorityType: 'KKM' },
  'uat-dbkl@steras.test':       { role: 'authority', authorityType: 'DBKL' },
  'uat-motac@steras.test':      { role: 'authority', authorityType: 'MOTAC' },
};

function roleFor(email) {
  if (ROLE_BY_EMAIL[email]) return ROLE_BY_EMAIL[email];
  return { role: 'public', authorityType: null };
}

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(`Service account key not found: ${SERVICE_ACCOUNT_PATH}`);
  }
  const sa = require(SERVICE_ACCOUNT_PATH);
  const app = admin.initializeApp(
    { credential: admin.credential.cert(sa), projectId: PROJECT_ID },
    'sync-users',
  );
  const auth = app.auth();
  const db = app.firestore();

  // 1) Read all Auth users
  const listResult = await auth.listUsers(200);
  const authUsers = listResult.users;
  console.log(`Auth accounts found: ${authUsers.length}`);

  // 2) Build the desired set of profile docs (uid -> profile)
  const desired = new Map();
  for (const u of authUsers) {
    const { role, authorityType } = roleFor(u.email);
    const profile = {
      uid: u.uid,
      name: u.displayName || u.email,
      email: u.email,
      role,
      phone: '+60 12-000 0000',
      createdAt: Number(u.metadata.creationTime) || Date.now(),
      updatedAt: Date.now(),
    };
    if (authorityType) profile.authorityType = authorityType;
    desired.set(u.uid, profile);
  }

  // 3) Wipe any users doc whose uid is NOT in the desired set
  const existingSnap = await db.collection('users').get();
  const toDelete = existingSnap.docs
    .filter((d) => !desired.has(d.id))
    .map((d) => d.ref);
  if (toDelete.length > 0) {
    console.log(`Deleting ${toDelete.length} stale user doc(s)...`);
    const batch = db.batch();
    toDelete.forEach((ref) => batch.delete(ref));
    await batch.commit();
  } else {
    console.log('No stale user docs to delete.');
  }

  // 4) Upsert each desired profile
  console.log(`Upserting ${desired.size} user profile(s)...`);
  const batch = db.batch();
  for (const [uid, profile] of desired) {
    batch.set(db.collection('users').doc(uid), profile, { merge: true });
  }
  await batch.commit();

  // 5) Print final state
  const finalSnap = await db.collection('users').get();
  console.log(`\nFinal users collection (${finalSnap.size} docs):`);
  for (const d of finalSnap.docs) {
    const data = d.data();
    console.log(`  ${d.id}  ${data.email}  role=${data.role}${data.authorityType ? ':' + data.authorityType : ''}  name="${data.name}"`);
  }

  await app.delete();
  console.log('\n✅ User profiles synced.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
