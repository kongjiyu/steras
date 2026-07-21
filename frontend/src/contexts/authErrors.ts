const AUTH_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'An account already exists for this email. Sign in or reset your password.',
  'auth/invalid-credential': 'The email or password is incorrect.',
  'auth/user-not-found': 'The email or password is incorrect.',
  'auth/wrong-password': 'The email or password is incorrect.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/weak-password': 'Use a stronger password with at least 6 characters.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment before trying again.',
};

export function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  if (error instanceof Error && error.message && !/firebase/i.test(error.message)) return error.message;
  return 'Authentication failed. Please try again.';
}
