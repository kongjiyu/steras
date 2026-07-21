import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { AuthorityType, COLLECTIONS, UserProfile } from '@shared/types';

const app = initializeApp({
  credential: applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? 'linkos-496505',
});

const email = process.env.AUTHORITY_EMAIL?.trim();
const password = process.env.AUTHORITY_PASSWORD;
const name = process.env.AUTHORITY_NAME?.trim();
const authorityType = process.env.AUTHORITY_TYPE as AuthorityType | undefined;
const validAuthorities = new Set<AuthorityType>(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);

if (!email || !password || !name || !authorityType || !validAuthorities.has(authorityType)) {
  throw new Error('Set AUTHORITY_EMAIL, AUTHORITY_PASSWORD, AUTHORITY_NAME, and a valid AUTHORITY_TYPE.');
}
const config = { email, password, name, authorityType } as const;

async function run() {
  const auth = getAuth(app);
  const user = await auth.getUserByEmail(config.email).catch(() => auth.createUser({ email: config.email, password: config.password, displayName: config.name }));
  const now = Date.now();
  const profile: UserProfile = {
    uid: user.uid,
    name: config.name,
    email: config.email,
    role: 'authority',
    authorityType: config.authorityType,
    createdAt: now,
    updatedAt: now,
  };
  await getFirestore(app).collection(COLLECTIONS.USERS).doc(user.uid).set(profile, { merge: true });
  console.info(`Provisioned ${config.authorityType} authority account for ${config.email}.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
