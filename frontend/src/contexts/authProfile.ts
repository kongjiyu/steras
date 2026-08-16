import { UserProfile, UserRole } from '@shared/types';

interface ProfileInput {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  now: number;
}

export function buildOrganizerProfile({ uid, name, email, phone, now }: ProfileInput): UserProfile {
  const normalizedPhone = phone?.trim();
  return {
    uid,
    name,
    email,
    role: 'organizer',
    ...(normalizedPhone ? { phone: normalizedPhone } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Public viewer profile — same shape as organizer but role is 'public'.
 * Public users register themselves and have the same read access as
 * logged-out users (public_events). No organizer/authority powers.
 */
export function buildPublicProfile({ uid, name, email, phone, now }: ProfileInput): UserProfile {
  const normalizedPhone = phone?.trim();
  return {
    uid,
    name,
    email,
    role: 'public',
    ...(normalizedPhone ? { phone: normalizedPhone } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Dispatcher used by AuthContext.signUp to build a profile for any
 * self-registerable role. 'organizer' | 'public' are the only valid
 * choices for self-signup — 'admin' and 'authority' are server-provisioned
 * via seed scripts and cannot be created here.
 */
export function buildProfile(role: 'organizer' | 'public', input: ProfileInput): UserProfile {
  if (role === 'organizer') return buildOrganizerProfile(input);
  return buildPublicProfile(input);
}

export type { UserRole };
