export type ApplicationIssueStatus = 'unresolved' | 'changed' | 'resolved';

export function mergeApplicationIssues(previous: string[], current: string[]): string[] {
  return [...new Set([...previous, ...current])];
}

export function applicationIssueStatus(
  message: string,
  currentErrors: string[],
  lastValidatedErrors: string[],
): ApplicationIssueStatus {
  if (currentErrors.includes(message)) return 'unresolved';
  return lastValidatedErrors.includes(message) ? 'changed' : 'resolved';
}
