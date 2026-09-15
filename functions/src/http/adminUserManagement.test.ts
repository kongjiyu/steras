import { describe, expect, it } from 'vitest';
import { validatePrivilegedAccountInput, validateResetUserPasswordInput } from './adminUserManagement';

const valid = {
  email: ' Officer@Example.com ', password: 'StrongPass!234', name: ' Safety Officer ',
  role: 'authority', authorityType: 'PDRM', idempotencyKey: 'request_1234',
};

describe('M1 privileged account input', () => {
  it('normalizes a complete authority request without retaining extra fields', () => {
    expect(validatePrivilegedAccountInput(valid)).toEqual({
      email: 'officer@example.com', password: 'StrongPass!234', name: 'Safety Officer',
      role: 'authority', authorityType: 'PDRM', idempotencyKey: 'request_1234',
    });
  });

  it('accepts admin only without an authority type', () => {
    expect(validatePrivilegedAccountInput({ ...valid, role: 'admin', authorityType: undefined })).toMatchObject({ role: 'admin' });
    expect(() => validatePrivilegedAccountInput({ ...valid, role: 'admin' })).toThrow('cannot have an authorityType');
  });

  it.each([
    [{ ...valid, role: 'organizer' }, 'role must be'],
    [{ ...valid, authorityType: 'CIA' }, 'valid authorityType'],
    [{ ...valid, email: 'not-email' }, 'valid email'],
    [{ ...valid, password: 'weak-password' }, 'Temporary password'],
    [{ ...valid, idempotencyKey: '../collision' }, 'idempotencyKey'],
    [{ ...valid, admin: true }, 'Unsupported fields'],
    [{ ...valid, name: 'x'.repeat(101) }, 'name must be'],
  ])('rejects adversarial payload %#', (payload, message) => {
    expect(() => validatePrivilegedAccountInput(payload)).toThrow(message);
  });
});

describe('admin password reset input', () => {
  it('accepts only a target uid and idempotency key', () => {
    expect(validateResetUserPasswordInput({ uid: 'user_123', idempotencyKey: 'reset_123456' })).toEqual({
      uid: 'user_123',
      idempotencyKey: 'reset_123456',
    });
  });

  it.each([
    [null, 'user account is required'],
    [{ uid: '', idempotencyKey: 'reset_123456' }, 'uid must be'],
    [{ uid: 'user 123', idempotencyKey: 'reset_123456' }, 'uid cannot contain whitespace'],
    [{ uid: 'user_123', idempotencyKey: 'short' }, 'idempotencyKey'],
    [{ uid: 'user_123', idempotencyKey: 'reset_123456', password: 'attacker-controlled' }, 'Unsupported fields'],
  ])('rejects an unsafe reset payload %#', (payload, message) => {
    expect(() => validateResetUserPasswordInput(payload)).toThrow(message);
  });
});
