import { UserRole } from '@shared/types';

export interface ReturnLocation {
  pathname: string;
  search?: string;
  hash?: string;
}

export function getRoleHome(role?: UserRole | null): string | null {
  if (role === 'organizer') return '/organizer';
  if (role === 'authority') return '/authority';
  if (role === 'admin') return '/admin';
  if (role === 'public') return '/calendar';
  return null;
}

/**
 * Public visitors are allowed to return to a few public-only routes after
 * login. Listed explicitly because the home `'/'` is a prefix of every path.
 */
const PUBLIC_ALLOWED_RETURN_PREFIXES = ['/calendar', '/events'];

function isPublicAllowedReturn(pathname: string): boolean {
  if (pathname === '/') return true;
  return PUBLIC_ALLOWED_RETURN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function getPostLoginPath(role: UserRole | undefined, from?: ReturnLocation): string | null {
  const home = getRoleHome(role);
  if (!home) return null;

  if (role === 'public') {
    if (!from) return home;
    return isPublicAllowedReturn(from.pathname)
      ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
      : home;
  }

  const isAllowedReturn = from?.pathname === home || from?.pathname.startsWith(`${home}/`);
  if (!from || !isAllowedReturn) return home;

  return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
}
