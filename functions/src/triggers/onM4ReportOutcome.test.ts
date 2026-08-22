import { describe, expect, it } from 'vitest';
import { isM4TerminalOutcome } from './onM4ReportOutcome';

describe('onM4ReportOutcome contract', () => {
  it('accepts only the two terminal M4 outcomes', () => {
    expect(isM4TerminalOutcome('confirmed_true')).toBe(true);
    expect(isM4TerminalOutcome('dismissed_fake')).toBe(true);
    expect(isM4TerminalOutcome('under_review')).toBe(false);
    expect(isM4TerminalOutcome(undefined)).toBe(false);
  });
});
