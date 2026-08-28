/** Emulator-only adversarial UAT for FR-M1-03 and FR-M1-21. */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createPrivilegedAccount } from '../http/adminUserManagement';
import { deactivateVenue, saveVenue, verifyVenue } from '../http/adminVenueManagement';

const projectId = process.env.GCLOUD_PROJECT ?? 'steras-test';
if (projectId !== 'steras-test' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') {
  throw new Error('Refusing to run outside the steras-test Auth and Firestore emulators.');
}
const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);
const handlers = { createPrivilegedAccount, saveVenue, verifyVenue, deactivateVenue };

async function main() {
  await resetUatArtifacts();
  await Promise.all([
    seedUser('admin-uat', 'admin@steras.test', 'AdminTest!234', 'Registry Admin', 'admin'),
    seedUser('organizer-uat', 'organizer@steras.test', 'Organizer!234', 'Demo Organizer', 'organizer'),
  ]);
  const adminUid = await signIn('admin@steras.test', 'AdminTest!234');
  const organizerUid = await signIn('organizer@steras.test', 'Organizer!234');

  await expectError(() => call('createPrivilegedAccount', organizerUid, accountInput('organizer-denied')), 403, 'PERMISSION_DENIED');
  await expectError(() => call('createPrivilegedAccount', adminUid, { ...accountInput('weak-password'), password: 'weak' }), 400, 'INVALID_ARGUMENT');
  const account = await call('createPrivilegedAccount', adminUid, accountInput('account-create-01'));
  assert(account.role === 'authority' && account.idempotent === false, 'authority account was not created');
  const accountReplay = await call('createPrivilegedAccount', adminUid, accountInput('account-create-01'));
  assert(accountReplay.uid === account.uid && accountReplay.idempotent === true, 'account replay was not idempotent');
  await expectError(() => call('createPrivilegedAccount', adminUid, { ...accountInput('account-create-01'), email: 'other@steras.test' }), 409, 'ALREADY_EXISTS');
  const createdAuth = await auth.getUser(account.uid as string);
  const createdProfile = await db.doc(`users/${account.uid}`).get();
  assert(createdAuth.customClaims?.role === 'authority' && createdAuth.customClaims?.authorityType === 'PDRM', 'Auth claims do not match the assigned role');
  assert(createdProfile.data()?.role === 'authority' && createdProfile.data()?.authorityType === 'PDRM', 'profile does not match Auth claims');
  const accountOperations = await db.collection('admin_operations').where('kind', '==', 'create_privileged_account').get();
  const persistedAccountMetadata = JSON.stringify(accountOperations.docs.map((document) => document.data()));
  assert(!persistedAccountMetadata.includes('OfficerTest!234') && !persistedAccountMetadata.toLowerCase().includes('password'), 'password material leaked into Firestore operation metadata');

  const venuePayload = {
    idempotencyKey: 'venue-create-01', name: 'Merdeka Community Hall', address: '1 Jalan UAT, Kuala Lumpur',
    state: 'Kuala Lumpur', jurisdiction: 'DBKL', capacity: 2_000, location: { lat: 3.139, lng: 101.687 },
    verifiedSafeCapacity: 1_800, fireCertificateStatus: 'valid', fireCertificateExpiresAt: Date.UTC(2030, 0, 1),
    nearestHospitalTravelMinutes: 12, emergencyAccessVerified: true, riskNotes: 'Canonical UAT record.',
  };
  await expectError(() => call('saveVenue', organizerUid, venuePayload), 403, 'PERMISSION_DENIED');
  await expectError(() => call('saveVenue', adminUid, { ...venuePayload, idempotencyKey: 'invalid-venue-01', capacity: Number.NaN }), 400, 'INVALID_ARGUMENT');
  const createdVenue = await call('saveVenue', adminUid, venuePayload);
  assert(createdVenue.revision === 1 && createdVenue.verificationStatus === 'unverified', 'venue create state is incorrect');
  const venueId = createdVenue.venueId as string;
  const venueReplay = await call('saveVenue', adminUid, venuePayload);
  assert(venueReplay.venueId === venueId && venueReplay.idempotent === true, 'venue create replay was not idempotent');
  await expectError(() => call('saveVenue', adminUid, { ...venuePayload, name: 'Collision Venue' }), 409, 'ALREADY_EXISTS');
  await expectError(() => call('verifyVenue', adminUid, { venueId, expectedRevision: 0, idempotencyKey: 'verify-stale-01' }), 409, 'ABORTED');
  const verified = await call('verifyVenue', adminUid, { venueId, expectedRevision: 1, idempotencyKey: 'verify-current-01' });
  assert(verified.revision === 2 && verified.verificationStatus === 'verified', 'venue verification failed');

  const updated = await call('saveVenue', adminUid, {
    venueId, expectedRevision: 2, idempotencyKey: 'venue-update-01', name: venuePayload.name, address: venuePayload.address,
    state: venuePayload.state, jurisdiction: venuePayload.jurisdiction, capacity: venuePayload.capacity, location: venuePayload.location,
    fireCertificateStatus: 'unknown',
  });
  assert(updated.revision === 3 && updated.verificationStatus === 'unverified', 'venue update did not reset verification');
  const cleared = (await db.doc(`venues/${venueId}`).get()).data()!;
  assert(!('verifiedBy' in cleared) && !('verifiedAt' in cleared) && !('verifiedSafeCapacity' in cleared) && !('nearestHospitalTravelMinutes' in cleared), 'cleared safety facts or verification provenance were retained');
  await expectError(() => call('verifyVenue', adminUid, { venueId, expectedRevision: 3, idempotencyKey: 'verify-incomplete-01' }), 400, 'FAILED_PRECONDITION');

  const repaired = await call('saveVenue', adminUid, {
    ...venuePayload, venueId, expectedRevision: 3, idempotencyKey: 'venue-repair-01',
  });
  assert(repaired.revision === 4, 'venue repair revision is incorrect');
  const reverified = await call('verifyVenue', adminUid, { venueId, expectedRevision: 4, idempotencyKey: 'verify-repaired-01' });
  assert(reverified.revision === 5, 'venue re-verification failed');
  await expectError(() => call('deactivateVenue', adminUid, { venueId, expectedRevision: 4, idempotencyKey: 'deactivate-stale-01' }), 409, 'ABORTED');
  const deactivated = await call('deactivateVenue', adminUid, { venueId, expectedRevision: 5, idempotencyKey: 'deactivate-current-01' });
  assert(deactivated.revision === 6 && deactivated.active === false, 'venue deactivation failed');
  await expectError(() => call('verifyVenue', adminUid, { venueId, expectedRevision: 6, idempotencyKey: 'verify-deactivated-01' }), 400, 'FAILED_PRECONDITION');

  const audit = await db.collection(`venues/${venueId}/audit_logs`).get();
  assert(audit.size === 6, `expected 6 immutable venue audit entries, received ${audit.size}`);
  console.log(JSON.stringify({ ok: true, accountUid: account.uid, venueId, venueRevision: 6, auditEntries: audit.size }));
  process.exit(0);
}

async function resetUatArtifacts() {
  const oldAccount = await auth.getUserByEmail('pdrm.officer@steras.test').catch((error: { code?: string }) => {
    if (error.code === 'auth/user-not-found') return undefined;
    throw error;
  });
  if (oldAccount) {
    await auth.deleteUser(oldAccount.uid);
    await db.doc(`users/${oldAccount.uid}`).delete();
  }
  for (const collectionName of ['admin_operations', 'admin_audit_logs']) {
    const snapshot = await db.collection(collectionName).where('actorId', '==', 'admin-uat').get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
  const venues = await db.collection('venues').where('name', '==', 'Merdeka Community Hall').get();
  await Promise.all(venues.docs.map((document) => db.recursiveDelete(document.ref)));
}

function accountInput(idempotencyKey: string) {
  return { email: 'pdrm.officer@steras.test', password: 'OfficerTest!234', name: 'PDRM UAT Officer', role: 'authority', authorityType: 'PDRM', idempotencyKey };
}

async function seedUser(uid: string, email: string, password: string, name: string, role: string) {
  await auth.createUser({ uid, email, password, displayName: name }).catch((error: { code?: string }) => {
    if (error.code !== 'auth/uid-already-exists' && error.code !== 'auth/email-already-exists') throw error;
  });
  await db.doc(`users/${uid}`).set({ uid, email, name, role, createdAt: 1, updatedAt: 1 });
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }), signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json() as { idToken?: string; localId?: string };
  if (!response.ok || !data.idToken || !data.localId) throw new Error(`Unable to sign in ${email}.`);
  return data.localId;
}

async function call(name: keyof typeof handlers, uid: string, data: unknown): Promise<Record<string, unknown>> {
  return handlers[name].run({ auth: { uid }, data } as never) as Promise<Record<string, unknown>>;
}

async function expectError(run: () => Promise<unknown>, httpStatus: number, functionStatus: string) {
  try { await run(); } catch (error) {
    const failure = error as { httpErrorCode?: { status?: number; canonicalName?: string } };
    assert(failure.httpErrorCode?.status === httpStatus && failure.httpErrorCode?.canonicalName === functionStatus, `expected ${httpStatus}/${functionStatus}, received ${failure.httpErrorCode?.status}/${failure.httpErrorCode?.canonicalName}`);
    return;
  }
  throw new Error(`Expected ${httpStatus}/${functionStatus}.`);
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

main().catch((error) => { console.error(error); process.exitCode = 1; });
