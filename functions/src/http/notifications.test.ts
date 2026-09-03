import { describe, expect, it } from 'vitest';
import { validateNotificationId, validateNotificationListLimit } from './notifications';

describe('notification callable boundaries', () => {
  it('accepts bounded integer limits and safe document IDs', () => {
    expect(validateNotificationListLimit(undefined)).toBe(50);
    expect(validateNotificationListLimit(1)).toBe(1);
    expect(validateNotificationListLimit(50)).toBe(50);
    expect(validateNotificationId(' notification_123 ')).toBe('notification_123');
  });

  it('rejects coercion, non-finite limits, and nested document paths', () => {
    for (const value of [0, 51, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10']) {
      expect(() => validateNotificationListLimit(value)).toThrow();
    }
    for (const value of ['', 'other/user', '../notification', 123]) {
      expect(() => validateNotificationId(value)).toThrow();
    }
  });
});
