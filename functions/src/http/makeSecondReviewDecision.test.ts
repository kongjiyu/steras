import { describe, expect, it } from 'vitest';
import type { EventRecord } from '@shared/types';
import { isCurrentSecondReviewEvent, isManagedFixture, isManagedPresentationFixture, isManagedRealReviewFixture, sameAuthoritySet } from './makeSecondReviewDecision';

describe('managed review fixture publication guard', () => {
  it('recognises only the owned Module 3 fixture marker', () => {
    expect(isManagedRealReviewFixture({ sterasFixture: {
      datasetId: 'steras-module3-real-review-samples-v1',
      managedBy: 'seed:steras:real-review-samples',
    } } as never)).toBe(true);
    expect(isManagedRealReviewFixture({ sterasFixture: {
      datasetId: 'other-dataset', managedBy: 'seed:steras:real-review-samples',
    } } as never)).toBe(false);
  });

  it('recognises the owned presentation portfolio marker and no other marker', () => {
    const presentation = { presentationData: {
      datasetId: 'steras-presentation-portfolio-2026-09-v1',
      managedBy: 'seed:presentation-portfolio',
    } } as never;
    expect(isManagedPresentationFixture(presentation)).toBe(true);
    expect(isManagedFixture(presentation)).toBe(true);
    expect(isManagedFixture({ presentationData: {
      datasetId: 'steras-presentation-portfolio-2026-09-v1',
      managedBy: 'someone-else',
    } } as never)).toBe(false);
  });
});

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    currentVersionId: 'version-1',
    status: 'UnderReview',
    reviewStage: 'second',
    requiredAuthorities: ['PDRM', 'BOMBA'],
    ...overrides,
  } as EventRecord;
}

describe('Admin second-review transaction fence', () => {
  it('rejects a withdrawn or otherwise no-longer-reviewable application', () => {
    expect(isCurrentSecondReviewEvent(event(), 'version-1', ['PDRM', 'BOMBA'])).toBe(true);
    expect(isCurrentSecondReviewEvent(event({ status: 'Withdrawn' }), 'version-1', ['PDRM', 'BOMBA'])).toBe(false);
    expect(isCurrentSecondReviewEvent(event({ status: 'Rejected' }), 'version-1', ['PDRM', 'BOMBA'])).toBe(false);
  });

  it('rejects stale generation and authority-set changes', () => {
    expect(isCurrentSecondReviewEvent(event({ currentVersionId: 'version-2' }), 'version-1', ['PDRM', 'BOMBA'])).toBe(false);
    expect(isCurrentSecondReviewEvent(event({ requiredAuthorities: ['PDRM', 'BOMBA', 'KKM'] }), 'version-1', ['PDRM', 'BOMBA'])).toBe(false);
    expect(isCurrentSecondReviewEvent(event({ requiredAuthorities: ['PDRM', 'PDRM'] }), 'version-1', ['PDRM', 'BOMBA'])).toBe(false);
    expect(isCurrentSecondReviewEvent(event({ requiredAuthorities: [] }), 'version-1', [])).toBe(false);
  });

  it('compares authority membership without depending on display order', () => {
    expect(sameAuthoritySet(['PDRM', 'BOMBA'], ['BOMBA', 'PDRM'])).toBe(true);
    expect(sameAuthoritySet(['PDRM', 'PDRM'], ['PDRM', 'BOMBA'])).toBe(false);
  });
});
