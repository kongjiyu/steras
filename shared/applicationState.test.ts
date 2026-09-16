import { describe, expect, it } from 'vitest';
import { resolveInitialReviewReadiness, resolveOfficerDecisionReadiness } from './applicationState';

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

describe('resolveOfficerDecisionReadiness', () => {
  const input = {
    eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', resourceId: 'r1', authorityType: 'PDRM' as const,
    eventStatus: 'UnderReview' as const, reviewStage: 'authority' as const,
    assignment: { eventId: 'event-1', versionId: 'v1', authorityType: 'PDRM' as const, officerUid: 'officer-1', status: 'in_progress' as const },
    assessment: { eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', status: 'official_ready' as const, sourceKind: 'admin_manual', complianceStatus: 'pass' as const },
    resource: { resourceId: 'r1', eventId: 'event-1', versionId: 'v1', assessmentId: 'a1', stage: 'official' as const },
    officerUid: 'officer-1', requiredAuthorities: ['PDRM'] as const,
  };

  it('enables a named officer after acknowledgement-ready manual officialisation', () => {
    expect(resolveOfficerDecisionReadiness(input)).toMatchObject({ ready: true });
  });

  it('explains own and other score-review blockers for AI-assisted assessment', () => {
    const ai = { ...input, assessment: { ...input.assessment, status: 'authority_review' as const, sourceKind: undefined, authorityReviewRequired: true, authorityReviewState: { activeReviewHeads: {} }, officialResult: null } };
    expect(resolveOfficerDecisionReadiness(ai).reason).toBe('own_score_review_required');
    const completeHeads = { PDRM: { reviewId: 'pdrm-review' }, BOMBA: { reviewId: 'bomba-review' } };
    expect(resolveOfficerDecisionReadiness({ ...ai, requiredAuthorities: ['PDRM', 'BOMBA'], assessment: { ...ai.assessment, authorityReviewState: { activeReviewHeads: completeHeads } } }).reason).toBe('officialisation_pending');
    expect(resolveOfficerDecisionReadiness({ ...ai, requiredAuthorities: ['PDRM', 'BOMBA'], assessment: { ...ai.assessment, authorityReviewState: { activeReviewHeads: { PDRM: { reviewId: 'pdrm-review' } } } } }).reason).toBe('other_score_reviews_pending');
  });

  it('reports an integrity blocker for an AI assessment marked official without review provenance', () => {
    const incompleteOfficial = { ...input, assessment: { ...input.assessment, sourceKind: undefined, authorityReviewRequired: false, authorityReviewState: { activeReviewHeads: {} }, officialResult: { reviewIds: [] } } };
    expect(resolveOfficerDecisionReadiness(incompleteOfficial).reason).toBe('score_review_record_missing');
  });

  it('keeps score-review guidance visible while M2 still has provisional resources', () => {
    const ai = {
      ...input,
      assessment: {
        ...input.assessment,
        sourceKind: undefined,
        status: 'authority_review' as const,
        authorityReviewRequired: true,
        authorityReviewState: { activeReviewHeads: {} },
        officialResult: null,
      },
      resource: { ...input.resource, stage: 'provisional' as const },
    };
    expect(resolveOfficerDecisionReadiness(ai).reason).toBe('own_score_review_required');
  });

  it('does not hide a closed-review blocker behind the checkbox state', () => {
    expect(resolveOfficerDecisionReadiness({ ...input, reviewStage: 'second' }).reason).toBe('review_closed');
  });
});
