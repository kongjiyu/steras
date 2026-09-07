export const TERMS_VERSION = '2026-09-07';
export const ADMIN_CONTACT_EMAIL = 'admin1@steras.test';

export function validPersonName(name: string): boolean {
  return name.trim().length >= 2 && name.trim().length <= 100
    && /^[\p{L}\p{M} .'/’-]+$/u.test(name.trim()) && /\p{L}/u.test(name);
}

export function normalizePhone(value: string): string | undefined {
  let phone = value.replace(/[\s()-]/g, '');
  if (phone.startsWith('0')) phone = `+60${phone.slice(1)}`;
  if (phone.startsWith('60')) phone = `+${phone}`;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : undefined;
}

export function passwordRequirements(password: string) {
  return [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'An uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'A lowercase letter', met: /[a-z]/.test(password) },
    { label: 'A number', met: /[0-9]/.test(password) },
    { label: 'A symbol', met: /[^A-Za-z0-9\s]/.test(password) },
  ];
}
