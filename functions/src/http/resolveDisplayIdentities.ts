import { firestore } from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COLLECTIONS, type UserProfile, type UserRole } from '@shared/types';
import { FUNCTION_REGION } from '../config/runtime';

const MAX_IDENTITIES_PER_REQUEST = 50;

interface ResolveDisplayIdentitiesRequest {
  uids?: unknown;
}

export interface DisplayIdentity {
  name: string;
  role: UserRole;
  authorityType?: UserProfile['authorityType'];
}

export const resolveDisplayIdentities = onCall<ResolveDisplayIdentitiesRequest>({ region: FUNCTION_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before resolving account names.');

  const uids = validateIdentityUids(request.data?.uids);
  const db = firestore();
  const viewerSnapshot = await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).get();
  const viewer = viewerSnapshot.data() as UserProfile | undefined;
  if (!viewer || viewer.uid !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'A registered user profile is required.');
  }

  const snapshots = uids.length > 0
    ? await db.getAll(...uids.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid)))
    : [];
  const identities: Record<string, DisplayIdentity> = {};
  snapshots.forEach((snapshot, index) => {
    const candidate = snapshot.data() as UserProfile | undefined;
    const uid = uids[index];
    if (!candidate || candidate.uid !== uid || !canViewDisplayIdentity(viewer, candidate)) return;
    identities[uid] = {
      name: candidate.name.trim(),
      role: candidate.role,
      ...(candidate.authorityType ? { authorityType: candidate.authorityType } : {}),
    };
  });

  return { identities };
});

export function validateIdentityUids(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpsError('invalid-argument', 'uids must be an array.');
  if (value.length > MAX_IDENTITIES_PER_REQUEST) {
    throw new HttpsError('invalid-argument', `At most ${MAX_IDENTITIES_PER_REQUEST} identities may be resolved at once.`);
  }
  const uids = value.map((item) => {
    if (typeof item !== 'string' || !item.trim() || item.length > 128 || /[/\s]/.test(item)) {
      throw new HttpsError('invalid-argument', 'Each uid must be a valid account identifier.');
    }
    return item;
  });
  return [...new Set(uids)];
}

export function canViewDisplayIdentity(viewer: UserProfile, candidate: UserProfile): boolean {
  if (!candidate.name.trim()) return false;
  if (viewer.role === 'admin') return true;
  if (candidate.uid === viewer.uid) return true;
  return viewer.role === 'authority' && (candidate.role === 'authority' || candidate.role === 'admin');
}
