import { describe, expect, it } from 'vitest';
import { resolveInitialReviewReadiness } from './applicationState';

const base = {
  eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', resourceId: 'r1',
};

describe('resolveInitialReviewReadiness', () => {
  it('accepts a complete provisional AI generation', () => {
    expect(resolveInitialReviewReadiness({
      ...base,
      assessment: { ...base, status: 'provisional_ready', assessmentReadiness: 'complete', authorityReviewRequired: true, complianceStatus: 'pass' },
      resource: { ...base, stage: 'provisional' },
    })).toMatchObject({ ready: true });
  });

  it('accepts a provisional-ready generation with provisional readiness', () => {
    expect(resolveInitialReviewReadiness({
      ...base,
      assessment: { ...base, status: 'provisional_ready', assessmentReadiness: 'provisional', authorityReviewRequired: true, complianceStatus: 'pass' },
      resource: { ...base, stage: 'provisional' },
    }).ready).toBe(true);
  });

  it('requires the matching official resource for a manual-official assessment', () => {
    const input = {
      ...base,
      assessment: { ...base, status: 'official_ready' as const, sourceKind: 'admin_manual', assessmentReadiness: 'complete' as const, authorityReviewRequired: false, complianceStatus: 'pass' as const },
    };
    expect(resolveInitialReviewReadiness(input).reason).toBe('resource_missing');
    expect(resolveInitialReviewReadiness({ ...input, resource: { ...base, stage: 'official' } })).toMatchObject({ ready: true });
  });

  it('allows a manual-official result to retain insufficient-data readiness', () => {
    const input = {
      ...base,
      assessment: { ...base, status: 'official_ready' as const, sourceKind: 'admin_manual', assessmentReadiness: 'insufficient_data' as const, authorityReviewRequired: false, complianceStatus: 'pass' as const },
      resource: { ...base, stage: 'official' as const },
    };
    expect(resolveInitialReviewReadiness(input).ready).toBe(true);
  });

  it('rejects blocked, stale, and authority-finalized AI generations', () => {
    const ready = { ...base, assessment: { ...base, status: 'provisional_ready' as const, assessmentReadiness: 'complete' as const, authorityReviewRequired: true, complianceStatus: 'pass' as const }, resource: { ...base, stage: 'provisional' as const } };
    expect(resolveInitialReviewReadiness({ ...ready, assessment: { ...ready.assessment, complianceStatus: 'blocked' } }).reason).toBe('compliance_blocked');
    expect(resolveInitialReviewReadiness({ ...ready, assessment: { ...ready.assessment, versionId: 'old' } }).reason).toBe('assessment_identity_mismatch');
    expect(resolveInitialReviewReadiness({ ...ready, assessment: { ...ready.assessment, status: 'official_ready' } }).reason).toBe('official_ai_not_allowed');
  });

  it('fails closed when a provisional AI record omits the authority-review gate', () => {
    const input = {
      ...base,
      assessment: { ...base, status: 'provisional_ready' as const, assessmentReadiness: 'complete' as const, complianceStatus: 'pass' as const },
      resource: { ...base, stage: 'provisional' as const },
    };
    expect(resolveInitialReviewReadiness(input).ready).toBe(false);
    expect(resolveInitialReviewReadiness(input).reason).toBe('assessment_not_ready');
  });
});
