import { describe, expect, it } from 'vitest';
import { displayIdentityName } from './useDisplayIdentities';

describe('displayIdentityName', () => {
  it('uses a resolved human-readable name', () => {
    expect(displayIdentityName('uid-1', { 'uid-1': { name: 'Aina Rahman', role: 'authority', authorityType: 'PDRM' } }, 'PDRM officer'))
      .toBe('Aina Rahman');
  });

  it('never exposes an unresolved raw uid', () => {
    expect(displayIdentityName('qS0keFy9pcZaee...', {}, 'PDRM officer')).toBe('PDRM officer');
  });

  it('uses the system label for backend actions', () => {
    expect(displayIdentityName('system', {}, 'Administrator')).toBe('STERAS system');
  });
});
