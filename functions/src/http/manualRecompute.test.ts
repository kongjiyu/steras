import { describe, expect, it } from 'vitest';
import { manualRecomputeForUser, validateRecomputeEventId, validateRecomputeProfile } from './manualRecompute';

describe('validateRecomputeEventId', () => {
  it('trims a valid event id', () => {
    expect(validateRecomputeEventId(' event-1 ')).toBe('event-1');
  });

  it('rejects missing and oversized event ids', () => {
    expect(() => validateRecomputeEventId(undefined)).toThrow('eventId required.');
    expect(() => validateRecomputeEventId('x'.repeat(201))).toThrow('eventId must be at most 200 characters.');
  });
});

describe('validateRecomputeProfile', () => {
  it('accepts a provisioned authority and rejects every other profile', () => {
    expect(() => validateRecomputeProfile({ role: 'authority', authorityType: 'PDRM' })).not.toThrow();
    expect(() => validateRecomputeProfile({ role: 'organizer' })).toThrow('Only provisioned authority accounts can retry assessments.');
    expect(() => validateRecomputeProfile({ role: 'authority' })).toThrow('Only provisioned authority accounts can retry assessments.');
    expect(() => validateRecomputeProfile(undefined)).toThrow('Only provisioned authority accounts can retry assessments.');
  });
});

describe('manualRecomputeForUser', () => {
  it('returns the pipeline result for a provisioned authority', async () => {
    const result = await manualRecomputeForUser('authority-1', ' event-1 ', {
      loadProfile: async () => ({ role: 'authority', authorityType: 'PDRM' }),
      recompute: async (eventId) => ({ status: 'processed' as const, eventId, versionId: 'v1' }),
    });
    expect(result).toMatchObject({ success: true, status: 'processed', eventId: 'event-1' });
  });

  it('rejects an unprovisioned caller before running the pipeline', async () => {
    let calls = 0;
    await expect(manualRecomputeForUser('organizer-1', 'event-1', {
      loadProfile: async () => ({ role: 'organizer' }),
      recompute: async (eventId) => { calls += 1; return { status: 'processed' as const, eventId }; },
    })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(calls).toBe(0);
  });

  it('converts pipeline failures to a stable internal error', async () => {
    await expect(manualRecomputeForUser('authority-1', 'event-1', {
      loadProfile: async () => ({ role: 'authority', authorityType: 'PDRM' }),
      recompute: async () => { throw new Error('private upstream detail'); },
    })).rejects.toMatchObject({ code: 'internal', message: 'Recompute failed.' });
  });
});
