const MODULE_LABELS: Record<string, string> = {
  '1': 'Application management',
  '2': 'Risk and resource assessment',
  '3': 'Authority approval',
  '4': 'Incident response',
  '5': 'Analytics and reporting',
};

/**
 * Removes internal module codes from persisted system-authored copy created by
 * older releases. Do not use this for organizer-authored event descriptions.
 */
export function userFacingSystemText(value: string): string {
  return value
    .replace(/\bModule\s*([1-5])\b/gi, (_, moduleNumber: string) => MODULE_LABELS[moduleNumber])
    .replace(/\bM([1-5])\b/g, (_, moduleNumber: string) => MODULE_LABELS[moduleNumber]);
}
