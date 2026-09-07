import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { normalizePhone, validPersonName } from '@shared/accountValidation';
import { FUNCTION_REGION } from '../config/runtime';

export const updateOwnProfile = onCall({ region: FUNCTION_REGION }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const data = request.data ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) throw new HttpsError('invalid-argument', 'Invalid profile details.');
  if (Object.keys(data).some(key => !['name', 'phone', 'onboardingCompleted'].includes(key))) {
    throw new HttpsError('invalid-argument', 'Only your name, phone and tour preference can be updated.');
  }
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if ('name' in data || 'phone' in data) {
    if (typeof data.name !== 'string' || !validPersonName(data.name)) throw new HttpsError('invalid-argument', 'Enter your full name using letters.');
    const phone = typeof data.phone === 'string' ? normalizePhone(data.phone) : undefined;
    if (!phone) throw new HttpsError('invalid-argument', 'Enter a valid phone number with country code.');
    patch.name = data.name.trim();
    patch.phone = phone;
  }
  if ('onboardingCompleted' in data) {
    if (typeof data.onboardingCompleted !== 'boolean') throw new HttpsError('invalid-argument', 'Invalid tour preference.');
    patch.onboardingCompleted = data.onboardingCompleted;
  }
  const profile = getFirestore().collection('users').doc(request.auth.uid);
  await getFirestore().runTransaction(async tx => {
    if (!(await tx.get(profile)).exists) throw new HttpsError('not-found', 'Your profile was not found.');
    tx.update(profile, patch);
  });
  return { updated: true };
});
