import { describe, expect, it } from 'vitest';
import type { UserProfile } from '@shared/types';
import { canViewDisplayIdentity, validateIdentityUids } from './resolveDisplayIdentities';

const profile = (uid: string, role: UserProfile['role'], name = 'Readable name'): UserProfile => ({
  uid, role, name, email: `${uid}@example.test`, createdAt: 1, updatedAt: 1,
});

describe('display identity boundary', () => {
  it('deduplicates bounded valid account identifiers', () => {
    expect(validateIdentityUids(['one', 'two', 'one'])).toEqual(['one', 'two']);
  });

  it.each([null, 'uid', ['has space'], ['slash/value'], [''], Array.from({ length: 51 }, (_, index) => `uid-${index}`)])(
    'rejects malformed or excessive identity requests',
    (value) => expect(() => validateIdentityUids(value)).toThrow(),
  );

  it('lets admins resolve any known profile', () => {
    expect(canViewDisplayIdentity(profile('admin', 'admin'), profile('organizer', 'organizer'))).toBe(true);
  });

  it('limits authorities to operational authority/admin identities', () => {
    const authority = profile('authority', 'authority');
    expect(canViewDisplayIdentity(authority, profile('other-authority', 'authority'))).toBe(true);
    expect(canViewDisplayIdentity(authority, profile('admin', 'admin'))).toBe(true);
    expect(canViewDisplayIdentity(authority, profile('organizer', 'organizer'))).toBe(false);
  });

  it('lets other roles resolve only themselves and rejects blank display names', () => {
    const organizer = profile('organizer', 'organizer');
    expect(canViewDisplayIdentity(organizer, organizer)).toBe(true);
    expect(canViewDisplayIdentity(organizer, profile('other', 'organizer'))).toBe(false);
    expect(canViewDisplayIdentity(profile('admin', 'admin'), profile('blank', 'authority', '   '))).toBe(false);
  });
});
