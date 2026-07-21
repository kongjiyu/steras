import { describe, expect, it } from 'vitest';
import { authErrorMessage } from './authErrors';

describe('authErrorMessage', () => {
  it.each([
    ['auth/email-already-in-use', 'An account already exists for this email. Sign in or reset your password.'],
    ['auth/invalid-credential', 'The email or password is incorrect.'],
    ['auth/weak-password', 'Use a stronger password with at least 6 characters.'],
    ['auth/network-request-failed', 'Network error. Check your connection and try again.'],
    ['auth/too-many-requests', 'Too many attempts. Wait a moment before trying again.'],
  ])('maps %s to actionable copy', (code, message) => {
    expect(authErrorMessage({ code })).toBe(message);
  });

  it('does not expose unknown Firebase internals', () => {
    expect(authErrorMessage(new Error('Firebase: internal implementation detail'))).toBe('Authentication failed. Please try again.');
    expect(authErrorMessage(new Error('Workspace profile unavailable.'))).toBe('Workspace profile unavailable.');
  });
});
