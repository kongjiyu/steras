import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import type { AuthorityType, UserRole } from '@shared/types';
import { functions, isFirebaseConfigured } from '../config/firebase';

export interface DisplayIdentity {
  name: string;
  role: UserRole;
  authorityType?: AuthorityType;
}

export type DisplayIdentityMap = Record<string, DisplayIdentity>;

export function useDisplayIdentities(requestedUids: Array<string | null | undefined>): DisplayIdentityMap {
  const requestKey = [...new Set(requestedUids.filter((uid): uid is string => Boolean(uid?.trim())))]
    .sort()
    .join('\u0000');
  const uids = useMemo(() => requestKey ? requestKey.split('\u0000') : [], [requestKey]);
  const [identities, setIdentities] = useState<DisplayIdentityMap>({});

  useEffect(() => {
    if (!isFirebaseConfigured || uids.length === 0) {
      setIdentities({});
      return;
    }
    let cancelled = false;
    const callable = httpsCallable<{ uids: string[] }, { identities: DisplayIdentityMap }>(functions, 'resolveDisplayIdentities');
    const chunks = Array.from({ length: Math.ceil(uids.length / 50) }, (_, index) => uids.slice(index * 50, (index + 1) * 50));
    Promise.all(chunks.map((chunk) => callable({ uids: chunk })))
      .then((results) => {
        if (!cancelled) setIdentities(Object.assign({}, ...results.map((result) => result.data.identities)));
      })
      .catch((error) => {
        console.error('[useDisplayIdentities] identity lookup failed', error);
        if (!cancelled) setIdentities({});
      });
    return () => { cancelled = true; };
  }, [requestKey, uids]);

  return identities;
}

export function displayIdentityName(
  uid: string | null | undefined,
  identities: DisplayIdentityMap,
  fallback: string,
): string {
  if (!uid) return fallback;
  if (uid === 'system') return 'STERAS system';
  return identities[uid]?.name || fallback;
}
