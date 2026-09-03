import { describe, expect, it } from 'vitest';
import { validateVerificationEvidencePath } from './verifyStage1Doc';

describe('Stage 1 verification evidence locator', () => {
  it('accepts a safe relative locator and allows omission', () => {
    expect(validateVerificationEvidencePath(' evidence/control-plan.pdf ')).toBe('evidence/control-plan.pdf');
    expect(validateVerificationEvidencePath(undefined)).toBeUndefined();
  });

  it('rejects executable URLs, traversal, absolute paths, and non-text values', () => {
    for (const value of ['javascript:alert(1)', '../private.pdf', '/private.pdf', 'https://example.test/file.pdf', 123]) {
      expect(() => validateVerificationEvidencePath(value)).toThrow();
    }
  });
});
