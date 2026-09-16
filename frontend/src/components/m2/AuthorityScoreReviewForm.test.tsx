import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc } from 'firebase/firestore';
import { AuthorityScoreReview, ProvisionalRiskAssessment, SCORE_REVIEW_SCHEMA_VERSION } from '@shared/types';
import { mockAssessments } from '../../mock_data/assessments';
import AuthorityScoreReviewForm from './AuthorityScoreReviewForm';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, doc: vi.fn(() => ({})), getDoc: vi.fn() };
});

const assessment = mockAssessments.find((item): item is ProvisionalRiskAssessment => item.status === 'provisional_ready')!;

describe('AuthorityScoreReviewForm', () => {
  beforeEach(() => vi.mocked(getDoc).mockReset());

  it('keeps the proposal read-only until a category is selected, then reveals inline override fields', () => {
    render(<AuthorityScoreReviewForm eventId="event-1" assessment={assessment} authorityType="PDRM" />);
    expect(screen.queryByLabelText('Likelihood')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit score review/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Crowd safety score category' }));
    expect(screen.getByLabelText('Likelihood')).toBeInTheDocument();
    expect(screen.getByLabelText('Severity')).toBeInTheDocument();
    expect(screen.getByLabelText('Override reason')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Likelihood'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'Locally verified crowd evidence supports this score.' } });
    fireEvent.change(screen.getByLabelText('Review rationale'), { target: { value: 'I reviewed the complete evidence package and AI proposal.' } });
    expect(screen.getByRole('button', { name: /Submit score review/i })).not.toBeDisabled();
  });

  it('preserves an unsaved draft when another authority updates review progress and supports cancellation', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<AuthorityScoreReviewForm eventId="event-1" assessment={assessment} authorityType="PDRM" onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Crowd safety score category' }));
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'Locally verified crowd evidence requires a different score.' } });
    fireEvent.change(screen.getByLabelText('Review rationale'), { target: { value: 'I am still reviewing the complete evidence package.' } });
    const refreshed = {
      ...assessment,
      status: 'authority_review' as const,
      authorityReviewState: {
        requiredAuthorities: ['PDRM', 'BOMBA'] as ('PDRM' | 'BOMBA')[],
        activeReviewHeads: { BOMBA: { reviewId: 'bomba-review-1', createdAt: 10 } },
        conflicts: [],
        updatedAt: 10,
      },
    };
    rerender(<AuthorityScoreReviewForm eventId="event-1" assessment={refreshed} authorityType="PDRM" onCancel={onCancel} />);
    expect(screen.getByLabelText('Override reason')).toHaveValue('Locally verified crowd evidence requires a different score.');
    expect(screen.getByLabelText('Review rationale')).toHaveValue('I am still reviewing the complete evidence package.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not let delayed own-head hydration overwrite a draft edited while loading', async () => {
    let resolveHead!: (value: { data: () => AuthorityScoreReview }) => void;
    vi.mocked(getDoc).mockReturnValueOnce(new Promise((resolve) => { resolveHead = resolve; }) as never);
    const withOwnHead = {
      ...assessment,
      status: 'authority_review' as const,
      authorityReviewState: {
        requiredAuthorities: ['PDRM'] as ('PDRM')[],
        activeReviewHeads: { PDRM: { reviewId: 'pdrm-review-1', createdAt: 10 } },
        conflicts: [],
        updatedAt: 10,
      },
    };
    render(<AuthorityScoreReviewForm eventId="event-1" assessment={withOwnHead} authorityType="PDRM" />);
    fireEvent.click(screen.getByRole('button', { name: 'Crowd safety score category' }));
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'My new verified crowd evidence supports this change.' } });
    fireEvent.change(screen.getByLabelText('Review rationale'), { target: { value: 'My new unsaved rationale must survive delayed hydration.' } });
    const stored: AuthorityScoreReview = {
      reviewId: 'pdrm-review-1', schemaVersion: SCORE_REVIEW_SCHEMA_VERSION,
      eventId: 'event-1', versionId: assessment.versionId, assessmentId: assessment.assessmentId,
      proposalId: assessment.aiProposal.proposalId, provisionalCalculatedAt: assessment.provisionalResult.calculatedAt,
      assessmentInputHash: assessment.inputHash, categorySchemaVersion: assessment.provisionalResult.categorySchemaVersion,
      authorityType: 'PDRM', reviewerId: 'pdrm-1',
      categories: assessment.aiProposal.categories.map((category) => ({
        categoryId: category.categoryId, likelihood: category.likelihood, severity: category.severity, decision: 'confirmed' as const,
      })),
      rationale: 'The older stored rationale should not replace current edits.', idempotencyKey: 'stored-review-key', createdAt: 10,
    };
    await act(async () => resolveHead({ data: () => stored }));
    expect(screen.getByLabelText('Override reason')).toHaveValue('My new verified crowd evidence supports this change.');
    expect(screen.getByLabelText('Review rationale')).toHaveValue('My new unsaved rationale must survive delayed hydration.');
  });

  it('does not start own-head hydration when a cross-tab revision arrives after the draft is dirty', () => {
    const { rerender } = render(<AuthorityScoreReviewForm eventId="event-1" assessment={assessment} authorityType="PDRM" />);
    fireEvent.click(screen.getByRole('button', { name: 'Crowd safety score category' }));
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'This local draft must survive a cross-tab head update.' } });
    fireEvent.change(screen.getByLabelText('Review rationale'), { target: { value: 'This local unsaved rationale remains authoritative for this tab.' } });
    const crossTabUpdate = {
      ...assessment,
      status: 'authority_review' as const,
      authorityReviewState: {
        requiredAuthorities: ['PDRM'] as ('PDRM')[],
        activeReviewHeads: { PDRM: { reviewId: 'cross-tab-review-2', createdAt: 20 } },
        conflicts: [],
        updatedAt: 20,
      },
    };
    rerender(<AuthorityScoreReviewForm eventId="event-1" assessment={crossTabUpdate} authorityType="PDRM" />);
    expect(getDoc).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Override reason')).toHaveValue('This local draft must survive a cross-tab head update.');
    expect(screen.getByLabelText('Review rationale')).toHaveValue('This local unsaved rationale remains authoritative for this tab.');
  });
});
