import { describe, expect, it } from 'vitest';
import { AuthorityType, DecisionValue } from '@shared/types';
import { aggregateDecisionStatus, validateDecisionRequest } from './authorityDecision';

const required: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM'];

describe('aggregateDecisionStatus', () => {
  it('keeps the application under review until every required authority approves', () => {
    expect(aggregateDecisionStatus(required, new Map([['PDRM', 'Approved']]))).toBe('UnderReview');
    expect(aggregateDecisionStatus(required, new Map<AuthorityType, DecisionValue>([
      ['PDRM', 'Approved'], ['BOMBA', 'Approved'], ['KKM', 'Approved'],
    ]))).toBe('Approved');
  });

  it('gives rejection precedence over amendment and approval', () => {
    expect(aggregateDecisionStatus(required, new Map<AuthorityType, DecisionValue>([
      ['PDRM', 'Approved'], ['BOMBA', 'AmendmentRequested'], ['KKM', 'Rejected'],
    ]))).toBe('Rejected');
  });

  it('blocks approval when any authority requests amendment', () => {
    expect(aggregateDecisionStatus(required, new Map<AuthorityType, DecisionValue>([
      ['PDRM', 'Approved'], ['BOMBA', 'AmendmentRequested'], ['KKM', 'Approved'],
    ]))).toBe('AmendmentRequested');
  });
});

describe('validateDecisionRequest', () => {
  it('normalizes a valid decision request', () => {
    expect(validateDecisionRequest({ eventId: ' event-1 ', decision: 'Approved', rationale: '  Evidence verified.  ' }))
      .toEqual({ eventId: 'event-1', decision: 'Approved', rationale: 'Evidence verified.' });
  });

  it.each([
    [{ decision: 'Approved', rationale: 'Evidence verified.' }, 'eventId is required.'],
    [{ eventId: 'event-1', decision: 'Maybe', rationale: 'Evidence verified.' }, 'A valid decision is required.'],
    [{ eventId: 'event-1', decision: 'Approved', rationale: 'short' }, 'Rationale must be between 10 and 1,000 characters.'],
  ])('rejects malformed decision input', (request, message) => {
    expect(() => validateDecisionRequest(request)).toThrow(message);
  });
});
