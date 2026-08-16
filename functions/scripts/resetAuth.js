/**
 * STERAS — Auth Re-seed Script
 * =====================================================================
 * One-off destructive script. Wipes all Firebase Auth users + their
 * `users/{uid}` Firestore profile docs, then re-provisions the keep-list
 * with a shared password.
 *
 * Run from: steras/functions/  (so it can resolve firebase-admin from
 * the local node_modules)
 *
 *   cd steras/functions
 *   node scripts/resetAuth.js
 *
 * What it does:
 *   1. Backs up all current Auth users + their Firestore profile docs
 *      to docs/auth-backup-<timestamp>.json  (gitignored)
 *   2. Deletes every Auth user in the project
 *   3. Deletes every doc in the `users` Firestore collection
 *   4. Creates 7 new Auth users with the shared password below
 *   5. Writes 7 new `users/{uid}` profile docs to Firestore
 *
 * SAFETY: requires the user to have already approved this run verbally.
 * =====================================================================
 */

const path = require('node:path');
const fs = require('node:fs');
const admin = require('firebase-admin');

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_ACCOUNT_PATH = path.join(
  PROJECT_ROOT,
  'linkos-496505-firebase-adminsdk-fbsvc-a52af67423.json',
);
const BACKUP_DIR = path.join(PROJECT_ROOT, 'docs');
const BACKUP_PATH = path.join(
  BACKUP_DIR,
  `auth-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);
const PROJECT_ID = 'linkos-496505';
const SHARED_PASSWORD = 'Steras@Reset2026!';

// Keep list — these will be re-provisioned after the wipe.
const KEEP_ACCOUNTS = [
  { email: 'steras-admin@steras.test',  displayName: 'STERAS Admin Reviewer',  role: 'organizer' },
  { email: 'uat-organizer@steras.test', displayName: 'STERAS UAT Organizer',   role: 'organizer' },
  { email: 'uat-pdrm@steras.test',      displayName: 'PDRM UAT Reviewer',      role: 'authority', authorityType: 'PDRM'  },
  { email: 'uat-bomba@steras.test',     displayName: 'BOMBA UAT Reviewer',     role: 'authority', authorityType: 'BOMBA' },
  { email: 'uat-kkm@steras.test',       displayName: 'KKM UAT Reviewer',       role: 'authority', authorityType: 'KKM'   },
  { email: 'uat-dbkl@steras.test',      displayName: 'DBKL UAT Reviewer',      role: 'authority', authorityType: 'DBKL'  },
  { email: 'kongjiyu0198@gmail.com',    displayName: 'Kong Ji Yu',             role: 'organizer' },
];

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function log(step, msg) {
  console.log(`\n=== ${step}: ${msg} ===`);
}
function info(msg)  { console.log(`  ${msg}`); }
function ok(msg)    { console.log(`  ✓ ${msg}`); }
function fail(msg)  { console.error(`  ✗ ${msg}`); }

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  // ---- Pre-flight checks -------------------------------------------
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(`Service account key not found at: ${SERVICE_ACCOUNT_PATH}`);
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  log('PRE-FLIGHT', 'verifying environment');
  info(`project: ${PROJECT_ID}`);
  info(`service account: ${SERVICE_ACCOUNT_PATH}`);
  info(`backup target: ${BACKUP_PATH}`);
  info(`keep list: ${KEEP_ACCOUNTS.length} accounts`);

  // ---- Init Admin SDK ----------------------------------------------
  log('STEP 0', 'initializing Firebase Admin SDK');
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  const app = admin.initializeApp(
    { credential: admin.credential.cert(serviceAccount), projectId: PROJECT_ID },
    'reset-auth-script',
  );
  const auth = app.auth();
  const db = app.firestore();
  ok('Admin SDK ready');

  // ---- STEP 1: Backup ---------------------------------------------
  log('STEP 1', 'backing up current Auth users + Firestore profiles');
  const listResult = await auth.listUsers(1000);
  info(`Found ${listResult.users.length} Auth users`);
  const backup = {
    timestamp: new Date().toISOString(),
    project: PROJECT_ID,
    sharedPasswordUsedForReseed: SHARED_PASSWORD,
    accountCount: listResult.users.length,
    accounts: [],
  };
  for (const user of listResult.users) {
    const userDoc = await db.collection('users').doc(user.uid).get();
    const profile = userDoc.exists ? userDoc.data() : null;
    backup.accounts.push({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      emailVerified: user.emailVerified,
      disabled: user.disabled,
      providerUserInfo: user.providerUserInfo,
      metadata: {
        creationTime: user.metadata.creationTime,
        lastSignInTime: user.metadata.lastSignInTime,
      },
      firestoreProfile: profile,
    });
    info(`  snapshot: ${user.email} (uid ${user.uid}) — profile ${profile ? 'found' : 'none'}`);
  }
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2));
  ok(`Backup written: ${BACKUP_PATH}`);

  // ---- STEP 2: Delete all Auth users -------------------------------
  log('STEP 2', `deleting all ${listResult.users.length} Auth users`);
  const uids = listResult.users.map((u) => u.uid);
  const deleteResult = await auth.deleteUsers(uids);
  ok(`Deleted ${deleteResult.successCount} users`);
  if (deleteResult.failureCount > 0) {
    fail(`${deleteResult.failureCount} failures during Auth delete`);
    for (const err of deleteResult.errors) {
      fail(`  [${err.index}] ${err.error.message}`);
    }
    throw new Error('Aborting: Auth delete had failures — review before re-running');
  }

  // ---- STEP 3: Wipe users collection -------------------------------
  log('STEP 3', 'wiping Firestore `users` collection');
  const usersSnap = await db.collection('users').get();
  info(`Found ${usersSnap.size} docs in users/`);
  if (usersSnap.size > 0) {
    // Firestore batches support up to 500 writes; we have <100, so one batch is fine
    const batch = db.batch();
    usersSnap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    ok(`Deleted ${usersSnap.size} users/* docs`);
  }

  // ---- STEP 4: Create new Auth users -------------------------------
  log('STEP 4', `creating ${KEEP_ACCOUNTS.length} new Auth users`);
  const createdUsers = [];
  for (const account of KEEP_ACCOUNTS) {
    const userRecord = await auth.createUser({
      email: account.email,
      password: SHARED_PASSWORD,
      displayName: account.displayName,
    });
    ok(`${account.email}  →  uid ${userRecord.uid}`);
    createdUsers.push({ ...account, uid: userRecord.uid });
  }

  // ---- STEP 5: Write Firestore profile docs -----------------------
  log('STEP 5', `writing ${createdUsers.length} users/{uid} profile docs`);
  const now = Date.now();
  for (const u of createdUsers) {
    const profile = {
      uid: u.uid,
      name: u.displayName,
      email: u.email,
      role: u.role,
      ...(u.authorityType ? { authorityType: u.authorityType } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await db.collection('users').doc(u.uid).set(profile);
    const roleLabel = u.authorityType ? `${u.role}:${u.authorityType}` : u.role;
    ok(`${u.email}  →  users/${u.uid}  (${roleLabel})`);
  }

  // ---- Done --------------------------------------------------------
  log('COMPLETE', 'auth re-seed finished');
  info(`Shared password for all 7 accounts: ${SHARED_PASSWORD}`);
  info(`Backup file: ${BACKUP_PATH}`);
  info(`Next: trash the service account key + revoke it in Firebase Console`);

  await app.delete();
}

main().catch((err) => {
  console.error('\n!!! FATAL:', err);
  process.exit(1);
});
