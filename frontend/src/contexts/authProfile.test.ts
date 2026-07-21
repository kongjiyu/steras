import { describe, expect, it } from 'vitest';
import { buildOrganizerProfile } from './authProfile';

const baseInput = {
  uid: 'organizer-1',
  name: 'Test Organizer',
  email: 'organizer@example.com',
  now: 1_700_000_000_000,
};

describe('buildOrganizerProfile', () => {
  it('omits an optional phone instead of writing undefined to Firestore', () => {
    const profile = buildOrganizerProfile(baseInput);
    expect(profile).not.toHaveProperty('phone');
    expect(Object.values(profile)).not.toContain(undefined);
  });

  it('trims and stores a provided phone number', () => {
    const profile = buildOrganizerProfile({ ...baseInput, phone: '  +60 12-345 6789  ' });
    expect(profile.phone).toBe('+60 12-345 6789');
  });
});
