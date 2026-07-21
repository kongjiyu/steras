import { describe, expect, it } from 'vitest';
import { validateWithdrawRequest } from './withdrawEvent';

describe('validateWithdrawRequest', () => {
  it('normalizes an optional rationale', () => {
    expect(validateWithdrawRequest({ eventId: ' event-1 ', rationale: '  Schedule cancelled.  ' }))
      .toEqual({ eventId: 'event-1', rationale: 'Schedule cancelled.' });
  });

  it('rejects missing identifiers and oversized rationales', () => {
    expect(() => validateWithdrawRequest({ eventId: ' ' })).toThrow('eventId is required.');
    expect(() => validateWithdrawRequest({ eventId: 'event-1', rationale: 'x'.repeat(501) }))
      .toThrow('Rationale must be at most 500 characters.');
  });
});
