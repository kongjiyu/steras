import { describe, expect, it } from 'vitest';
import { applicationIssueStatus, mergeApplicationIssues } from './applicationValidationProgress';

describe('application validation progress', () => {
  it('keeps issues visible while distinguishing edits from verified fixes', () => {
    const stateIssue = 'Select the venue state or federal territory.';
    const capacityIssue = 'Venue capacity must be a positive integer.';

    expect(applicationIssueStatus(stateIssue, [stateIssue, capacityIssue], [stateIssue, capacityIssue])).toBe('unresolved');
    expect(applicationIssueStatus(stateIssue, [capacityIssue], [stateIssue, capacityIssue])).toBe('changed');
    expect(applicationIssueStatus(stateIssue, [capacityIssue], [capacityIssue])).toBe('resolved');
    expect(mergeApplicationIssues([stateIssue, capacityIssue], [capacityIssue])).toEqual([stateIssue, capacityIssue]);
  });
});
