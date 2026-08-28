import { describe, expect, it } from 'vitest';
import { validateWithdrawRequest } from './withdrawEvent';

describe('validateWithdrawRequest', () => {
  it('normalizes an optional rationale', () => {
    expect(validateWithdrawRequest({ eventId: ' event-1 ', rationale: '  Venue booking was cancelled.  ' }))
      .toEqual({ eventId: 'event-1', rationale: 'Venue booking was cancelled.' });
  });

  it('rejects missing identifiers and oversized rationales', () => {
    expect(() => validateWithdrawRequest({ eventId: ' ' })).toThrow('eventId is required.');
    expect(() => validateWithdrawRequest({ eventId: 'event-1', rationale: 'short' })).toThrow('10–500');
    expect(() => validateWithdrawRequest({ eventId: 'event-1', rationale: 'x'.repeat(501) }))
      .toThrow('10–500');
    expect(() => validateWithdrawRequest({ eventId: 'event-1', rationale: 'Valid withdrawal reason.', status: 'Withdrawn' }))
      .toThrow('unsupported fields');
  });
});
