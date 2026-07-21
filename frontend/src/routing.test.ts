import { describe, expect, it } from 'vitest';
import { getPostLoginPath, getRoleHome } from './routing';

describe('routing policy', () => {
  it('maps workspace roles to their home routes', () => {
    expect(getRoleHome('organizer')).toBe('/organizer');
    expect(getRoleHome('authority')).toBe('/authority');
    expect(getRoleHome('public')).toBeNull();
  });

  it('restores a same-role protected route including search and hash', () => {
    expect(getPostLoginPath('organizer', {
      pathname: '/organizer/events/evt-1',
      search: '?tab=evidence',
      hash: '#documents',
    })).toBe('/organizer/events/evt-1?tab=evidence#documents');
  });

  it('does not send a user into another role workspace', () => {
    expect(getPostLoginPath('authority', { pathname: '/organizer/events/new' })).toBe('/authority');
    expect(getPostLoginPath('organizer', { pathname: '/authority/applications' })).toBe('/organizer');
  });

  it('rejects accounts without a workspace role', () => {
    expect(getPostLoginPath('public')).toBeNull();
    expect(getPostLoginPath(undefined)).toBeNull();
  });
});
