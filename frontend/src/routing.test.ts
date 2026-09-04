import { describe, expect, it } from 'vitest';
import { getIncidentPath, getPostLoginPath, getRoleHome } from './routing';

describe('routing policy', () => {
  it('maps workspace roles to their home routes', () => {
    expect(getRoleHome('organizer')).toBe('/organizer');
    expect(getRoleHome('authority')).toBe('/authority');
    expect(getRoleHome('admin')).toBe('/admin');
    expect(getRoleHome('public')).toBe('/calendar');
  });

  it('keeps incident reporting inside each authenticated workspace shell', () => {
    expect(getIncidentPath('organizer')).toBe('/organizer/incidents');
    expect(getIncidentPath('authority')).toBe('/authority/incidents');
    expect(getIncidentPath('admin')).toBe('/admin/incidents');
    expect(getIncidentPath('public')).toBe('/incidents');
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

  it('returns null for accounts without a workspace role', () => {
    expect(getPostLoginPath(undefined)).toBeNull();
  });

  it('routes public users to the public calendar by default', () => {
    expect(getPostLoginPath('public')).toBe('/calendar');
  });

  it('allows public users to return to public-only routes after login', () => {
    expect(getPostLoginPath('public', { pathname: '/calendar' })).toBe('/calendar');
    expect(getPostLoginPath('public', { pathname: '/events/evt-1' })).toBe('/events/evt-1');
    expect(
      getPostLoginPath('public', { pathname: '/events/evt-1', search: '?from=calendar' }),
    ).toBe('/events/evt-1?from=calendar');
  });

  it('does not send a public user into a role-protected workspace', () => {
    expect(getPostLoginPath('public', { pathname: '/organizer' })).toBe('/calendar');
    expect(getPostLoginPath('public', { pathname: '/authority/applications' })).toBe('/calendar');
    expect(getPostLoginPath('public', { pathname: '/admin' })).toBe('/calendar');
  });
});
