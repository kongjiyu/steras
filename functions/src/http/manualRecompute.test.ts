import { describe, expect, it } from 'vitest';
import {
  manualRecomputeForUser,
  validateAuthorityAssignment,
  validateRecomputeEventId,
  validateRecomputeProfile,
  validateRetryableAssessment,
} from './manualRecompute';

const retryableDependencies = {
  loadProfile: async () => ({ role: 'authority', authorityType: 'PDRM' }),
  loadEvent: async () => ({ requiredAuthorities: ['PDRM'], currentAssessmentId: 'assessment-1' }),
  loadAssessment: async () => ({ status: 'manual_review_required' }),
};

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

describe('manual recompute authorization', () => {
  it('requires the caller authority type to be assigned to the event', () => {
    expect(validateAuthorityAssignment({ requiredAuthorities: ['PDRM'], currentAssessmentId: 'a1' }, 'PDRM')).toBe('a1');
    expect(validateAuthorityAssignment({ requiredAuthorities: ['PDRM'], currentVersionId: 'failed-v1' }, 'PDRM')).toBe('failed-v1');
    expect(validateAuthorityAssignment({ requiredAuthorities: ['PDRM'], currentVersionId: 'v2', currentAssessmentId: 'v1' }, 'PDRM')).toBe('v2');
    expect(() => validateAuthorityAssignment({ requiredAuthorities: ['BOMBA'], currentAssessmentId: 'a1' }, 'PDRM'))
      .toThrow('Your authority is not assigned to this application.');
  });

  it('only permits forced retry from manual-review or failed state', () => {
    expect(() => validateRetryableAssessment({ status: 'manual_review_required' })).not.toThrow();
    expect(() => validateRetryableAssessment({ status: 'failed' })).not.toThrow();
    expect(() => validateRetryableAssessment({ status: 'provisional_ready' }))
      .toThrow('Only manual-review or failed assessments can be retried.');
  });
});

describe('manualRecomputeForUser', () => {
  it('returns the pipeline result for a provisioned authority', async () => {
    const result = await manualRecomputeForUser('authority-1', ' event-1 ', {
      ...retryableDependencies,
      recompute: async (eventId) => ({ status: 'processed' as const, eventId, versionId: 'v1' }),
    });
    expect(result).toMatchObject({ success: true, status: 'processed', eventId: 'event-1' });
  });

  it('rejects an unprovisioned caller before running the pipeline', async () => {
    let calls = 0;
    await expect(manualRecomputeForUser('organizer-1', 'event-1', {
      loadProfile: async () => ({ role: 'organizer' }),
      loadEvent: async () => { throw new Error('must not load event'); },
      loadAssessment: async () => { throw new Error('must not load assessment'); },
      recompute: async (eventId) => { calls += 1; return { status: 'processed' as const, eventId }; },
    })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(calls).toBe(0);
  });

  it('converts pipeline failures to a stable internal error', async () => {
    await expect(manualRecomputeForUser('authority-1', 'event-1', {
      ...retryableDependencies,
      recompute: async () => { throw new Error('private upstream detail'); },
    })).rejects.toMatchObject({ code: 'internal', message: 'Recompute failed.' });
  });

  it('does not run the pipeline for an unassigned authority or a ready assessment', async () => {
    let calls = 0;
    const recompute = async (eventId: string) => { calls += 1; return { status: 'processed' as const, eventId }; };
    await expect(manualRecomputeForUser('authority-1', 'event-1', {
      ...retryableDependencies,
      loadEvent: async () => ({ requiredAuthorities: ['BOMBA'], currentAssessmentId: 'assessment-1' }),
      recompute,
    })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(manualRecomputeForUser('authority-1', 'event-1', {
      ...retryableDependencies,
      loadAssessment: async () => ({ status: 'provisional_ready' }),
      recompute,
    })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(calls).toBe(0);
  });
});
