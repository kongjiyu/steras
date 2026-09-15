import { describe, expect, it } from 'vitest';
import type { Assignment, AuthorityDecision, EventRecord } from '@shared/types';
import { adminOfficerDecisionRows } from './adminOfficerDecisionPresentation';

const event = {
  eventId: 'event-1',
  currentVersionId: 'v1',
  requiredAuthorities: ['PDRM', 'BOMBA'],
} as EventRecord;

describe('adminOfficerDecisionRows', () => {
  it('shows the immutable second-review snapshot for an approved event', () => {
    const approved = {
      ...event,
      status: 'Approved',
      secondReview: {
        reviewerUid: 'admin-1',
        decidedAt: 30,
        confirmedDecision: 'Approved',
        officerFeedback: [
          { authorityType: 'BOMBA', officerUid: 'bomba-1', decision: 'Approved', reason: 'Fire evidence accepted.', decidedAt: 20 },
          { authorityType: 'PDRM', officerUid: 'pdrm-1', decision: 'Approved', reason: 'Security evidence accepted.', decidedAt: 10 },
        ],
      },
    } as EventRecord;
    const rows = adminOfficerDecisionRows(approved, [], []);
    expect(rows.map((row) => [row.authorityType, row.decision, row.source])).toEqual([
      ['PDRM', 'Approved', 'second_review'],
      ['BOMBA', 'Approved', 'second_review'],
    ]);
  });

  it('shows completed current-version assignments while authority review is active', () => {
    const assignments = [
      assignment({ assignmentId: 'v0_PDRM', versionId: 'v0', authorityType: 'PDRM', decision: 'Rejected' }),
      assignment({ assignmentId: 'v1_PDRM', versionId: 'v1', authorityType: 'PDRM', decision: 'Approved' }),
      assignment({ assignmentId: 'v1_BOMBA', versionId: 'v1', authorityType: 'BOMBA', status: 'pending' }),
    ];
    expect(adminOfficerDecisionRows(event, assignments, [])).toMatchObject([
      { authorityType: 'PDRM', decision: 'Approved', source: 'assignment' },
    ]);
  });

  it('uses only current legacy decisions when no new-workflow records exist', () => {
    const legacy = [
      legacyDecision({ decisionId: 'old', versionId: 'v0', current: true }),
      legacyDecision({ decisionId: 'superseded', versionId: 'v1', current: false }),
      legacyDecision({ decisionId: 'current', versionId: 'v1', current: true }),
    ];
    expect(adminOfficerDecisionRows(event, [], legacy)).toMatchObject([
      { id: 'current', authorityType: 'PDRM', source: 'legacy' },
    ]);
  });
});

function assignment(overrides: Partial<Assignment>): Assignment {
  return {
    assignmentId: 'v1_PDRM', eventId: 'event-1', versionId: 'v1', authorityType: 'PDRM',
    officerUid: 'officer-1', assignedBy: 'admin-1', assignedAt: 1, status: 'completed',
    decision: 'Approved', reason: 'Current officer rationale.', decidedAt: 2, ...overrides,
  };
}

function legacyDecision(overrides: Partial<AuthorityDecision>): AuthorityDecision {
  return {
    decisionId: 'legacy-1', eventId: 'event-1', versionId: 'v1', authorityType: 'PDRM',
    decision: 'Approved', rationale: 'Legacy officer rationale.', reviewerId: 'officer-1', decidedAt: 2,
    current: true, ...overrides,
  };
}
