/**
 * STERAS — One-off role update script
 * =====================================================================
 * Updates the Firestore user profile role for two accounts:
 *   - steras-admin@steras.test  →  role: 'admin'  (was 'organizer')
 *   - kongjiyu0198@gmail.com    →  role: 'public' (was 'organizer')
 *
 * Run from: steras/functions/
 *   node scripts/updateRoles.js
 *
 * Uses listUsers() to find the UID (avoids getUserByEmail which
 * may hit permission issues with the new key).
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

const UPDATES = [
  { email: 'steras-admin@steras.test', newRole: 'admin' },
  { email: 'kongjiyu0198@gmail.com',   newRole: 'public' },
];

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(`Service account key not found: ${SERVICE_ACCOUNT_PATH}`);
  }
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  const app = admin.initializeApp(
    { credential: admin.credential.cert(serviceAccount), projectId: PROJECT_ID },
    'update-roles-script',
  );
  const auth = app.auth();
  const db = app.firestore();

  console.log('--- listing users to find UIDs ---');
  const listResult = await auth.listUsers(1000);
  const byEmail = new Map(listResult.users.map((u) => [u.email, u]));
  console.log(`  found ${listResult.users.length} users`);

  for (const { email, newRole } of UPDATES) {
    console.log(`\n--- ${email} → role: ${newRole} ---`);
    const user = byEmail.get(email);
    if (!user) {
      console.warn(`  Auth user not found for ${email} — skipping.`);
      continue;
    }
    console.log(`  uid: ${user.uid}`);

    const ref = db.collection('users').doc(user.uid);
    const before = await ref.get();
    if (!before.exists) {
      console.warn(`  No Firestore profile doc for ${email} — skipping.`);
      continue;
    }
    const beforeData = before.data();
    console.log(`  before: role=${beforeData.role}`);

    const updatePayload = {
      role: newRole,
      updatedAt: Date.now(),
    };
    if (newRole !== 'authority') {
      updatePayload.authorityType = admin.firestore.FieldValue.delete();
    }
    await ref.update(updatePayload);

    const after = await ref.get();
    const afterData = after.data();
    console.log(
      `  after:  role=${afterData.role}` +
      (afterData.authorityType ? `, authorityType=${afterData.authorityType}` : ''),
    );
  }

  await app.delete();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
