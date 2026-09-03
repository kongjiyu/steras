import { describe, expect, it } from 'vitest';
import type { EventRecord } from '@shared/types';
import { isCurrentSecondReviewEvent, sameAuthoritySet } from './makeSecondReviewDecision';

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
