import { UserRole } from '@shared/types';

export interface ReturnLocation {
  pathname: string;
  search?: string;
  hash?: string;
}

export function getRoleHome(role?: UserRole | null): string | null {
  if (role === 'organizer') return '/organizer';
  if (role === 'authority') return '/authority';
  return null;
}

export function getPostLoginPath(role: UserRole | undefined, from?: ReturnLocation): string | null {
  const home = getRoleHome(role);
  if (!home) return null;

  const isAllowedReturn = from?.pathname === home || from?.pathname.startsWith(`${home}/`);
  if (!from || !isAllowedReturn) return home;

  return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
}
