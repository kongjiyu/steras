import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, UserProfile } from '@shared/types';

/**
 * STERAS — Admin Account Seeder
 * =====================================================================
 * Provisions (or updates) a single admin account. Admin role is
 * SERVER-ONLY — it cannot be self-assigned via the client RegisterPage.
 * Use this script to bootstrap the initial admin, or to provision
 * additional admin accounts in the future.
 *
 * Usage (from steras/functions/):
 *   ADMIN_EMAIL=steras-admin@steras.test \
 *   ADMIN_PASSWORD='SomeStrongP@ss' \
 *   ADMIN_NAME='STERAS Admin' \
 *   npm run seed:admin
 * =====================================================================
 */

const app = initializeApp({
  credential: applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? 'linkos-496505',
});

const email = process.env.ADMIN_EMAIL?.trim();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim();

if (!email || !password || !name) {
  throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_NAME.');
}
const config = { email, password, name } as const;

async function run() {
  const auth = getAuth(app);
  const user = await auth
    .getUserByEmail(config.email)
    .catch(() =>
      auth.createUser({
        email: config.email,
        password: config.password,
        displayName: config.name,
      }),
    );
  const now = Date.now();
  const profile: UserProfile = {
    uid: user.uid,
    name: config.name,
    email: config.email,
    role: 'admin',
    createdAt: now,
    updatedAt: now,
  };
  await getFirestore(app).collection(COLLECTIONS.USERS).doc(user.uid).set(profile, { merge: true });
  console.info(`Provisioned admin account for ${config.email} (uid ${user.uid}).`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
