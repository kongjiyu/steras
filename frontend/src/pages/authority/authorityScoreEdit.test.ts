import { describe, expect, it } from 'vitest';
import type { Assignment, RiskAssessment } from '@shared/types';
import { canEditAuthorityScores } from './authorityScoreEdit';

const assignment = { status: 'in_progress' } as Assignment;
const assessment = { status: 'authority_review', aiProposal: { status: 'success' } } as RiskAssessment;

describe('canEditAuthorityScores', () => {
  it('shows the score editor for an active assigned officer before a decision', () => {
    expect(canEditAuthorityScores({ assignment, reviewOpen: true, assessment, editing: false })).toBe(true);
  });

  it('does not offer a change the score Function would reject for an official assessment', () => {
    expect(canEditAuthorityScores({ assignment, reviewOpen: true, assessment: { ...assessment, status: 'official_ready' } as RiskAssessment, editing: false })).toBe(false);
  });

  it('locks the editor immediately after the assigned officer decides', () => {
    expect(canEditAuthorityScores({ assignment: { ...assignment, status: 'completed' }, reviewOpen: true, assessment, editing: false })).toBe(false);
  });

  it('locks the editor for unassigned officers and closed reviews', () => {
    expect(canEditAuthorityScores({ assignment: undefined, reviewOpen: true, assessment, editing: false })).toBe(false);
    expect(canEditAuthorityScores({ assignment, reviewOpen: false, assessment, editing: false })).toBe(false);
  });
});
