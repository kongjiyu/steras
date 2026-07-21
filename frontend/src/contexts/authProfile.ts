import { UserProfile } from '@shared/types';

interface OrganizerProfileInput {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  now: number;
}

export function buildOrganizerProfile({ uid, name, email, phone, now }: OrganizerProfileInput): UserProfile {
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
