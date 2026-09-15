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
  loadEvent: async () => ({ requiredAuthorities: ['PDRM'], currentVersionId: 'v1', currentAssessmentId: 'assessment-1' }),
  loadAssessment: async () => ({ status: 'manual_review_required', eventId: 'event-1', versionId: 'v1', assessmentId: 'assessment-1' }),
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
  it('accepts provisioned Admin and authority profiles and rejects every other profile', () => {
    expect(validateRecomputeProfile({ role: 'admin' })).toEqual({ role: 'admin' });
    expect(validateRecomputeProfile({ role: 'authority', authorityType: 'PDRM' })).toEqual({ role: 'authority', authorityType: 'PDRM' });
    expect(() => validateRecomputeProfile({ role: 'organizer' })).toThrow('Only provisioned Admin or authority accounts can retry assessments.');
    expect(() => validateRecomputeProfile({ role: 'authority' })).toThrow('Only provisioned Admin or authority accounts can retry assessments.');
    expect(() => validateRecomputeProfile(undefined)).toThrow('Only provisioned Admin or authority accounts can retry assessments.');
  });
});

describe('manual recompute authorization', () => {
  it('requires the caller authority type to be assigned to the event', () => {
    const pdrm = { role: 'authority' as const, authorityType: 'PDRM' as const };
    expect(validateAuthorityAssignment({ requiredAuthorities: ['PDRM'], currentVersionId: 'v1', currentAssessmentId: 'a1' }, pdrm)).toBe('a1');
    expect(() => validateAuthorityAssignment({ requiredAuthorities: ['PDRM'], currentVersionId: 'failed-v1' }, pdrm))
      .toThrow('This application has no assessment that can be retried.');
    expect(validateAuthorityAssignment({ requiredAuthorities: ['PDRM'], currentVersionId: 'v2', currentAssessmentId: 'assessment-v2' }, pdrm)).toBe('assessment-v2');
    expect(() => validateAuthorityAssignment({ requiredAuthorities: ['BOMBA'], currentAssessmentId: 'a1' }, pdrm))
      .toThrow('Your authority is not assigned to this application.');
  });

  it('allows an Admin to retry the current assessment without authority assignment', () => {
    expect(validateAuthorityAssignment({ requiredAuthorities: [], currentAssessmentId: 'assessment-v1' }, { role: 'admin' }))
      .toBe('assessment-v1');
  });

  it('only permits forced retry from manual-review or failed state', () => {
    expect(() => validateRetryableAssessment({ status: 'manual_review_required' })).not.toThrow();
    expect(() => validateRetryableAssessment({ status: 'failed' })).not.toThrow();
    expect(() => validateRetryableAssessment({ status: 'manual_review_required', activeManualAssessmentId: 'manual-1' }))
      .toThrow('An Admin manual assessment is already locked');
    expect(() => validateRetryableAssessment({ status: 'manual_review_required', activeManualAssessmentId: null }))
      .toThrow('manual assessment lock is invalid');
    expect(() => validateRetryableAssessment({ status: 'manual_review_required', activeManualAssessmentId: 42 }))
      .toThrow('manual assessment lock is invalid');
    expect(() => validateRetryableAssessment({ status: 'manual_review_required', activeManualAssessmentId: 'manual/child' }))
      .toThrow('manual assessment lock is invalid');
    expect(() => validateRetryableAssessment({ status: 'provisional_ready' }))
      .toThrow('Only manual-review or failed assessments can be retried.');
  });

  it('rejects an assessment from a different event generation', () => {
    expect(() => validateRetryableAssessment({
      status: 'manual_review_required', eventId: 'event-1', versionId: 'v1', assessmentId: 'old-assessment',
    }, { eventId: 'event-1', versionId: 'v2', assessmentId: 'current-assessment' })).toThrow('assessment generation changed');
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

  it('returns the pipeline result for a provisioned Admin', async () => {
    let authorization: unknown;
    const result = await manualRecomputeForUser('admin-1', 'event-1', {
      ...retryableDependencies,
      loadProfile: async () => ({ role: 'admin' }),
      loadEvent: async () => ({ requiredAuthorities: [], currentVersionId: 'v1', currentAssessmentId: 'assessment-1' }),
      recompute: async (eventId, value) => {
        authorization = value;
        return { status: 'processed' as const, eventId, versionId: 'v1', assessmentStatus: 'provisional_ready' as const };
      },
    });
    expect(authorization).toEqual({ uid: 'admin-1', role: 'admin' });
    expect(result).toMatchObject({ success: true, assessmentStatus: 'provisional_ready' });
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
      loadAssessment: async () => ({ status: 'provisional_ready', eventId: 'event-1', versionId: 'v1', assessmentId: 'assessment-1' }),
      recompute,
    })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(calls).toBe(0);
  });

  it('fails closed while the resource cutover lock exists', async () => {
    let calls = 0;
    await expect(manualRecomputeForUser('authority-1', 'event-1', {
      ...retryableDependencies,
      loadCutoverLock: async () => true,
      recompute: async (eventId) => { calls += 1; return { status: 'processed' as const, eventId }; },
    })).rejects.toMatchObject({ code: 'unavailable' });
    expect(calls).toBe(0);
  });
});
