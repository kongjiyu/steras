import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  it('requires a decision for all eight categories and reveals override controls intentionally', () => {
    render(<AuthorityScoreReviewForm eventId="event-1" assessment={assessment} authorityType="PDRM" />);
    expect(screen.getAllByRole('combobox')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Submit score review' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Crowd safety review decision'), { target: { value: 'overridden' } });
    expect(screen.getByLabelText('Override reason')).toBeInTheDocument();
    expect(screen.getByText(/Deterministic safety floors are reapplied/i)).toBeInTheDocument();
  });

  it('preserves an unsaved draft when another authority updates review progress', () => {
    const { rerender } = render(<AuthorityScoreReviewForm eventId="event-1" assessment={assessment} authorityType="PDRM" />);
    fireEvent.change(screen.getByLabelText('Crowd safety review decision'), { target: { value: 'overridden' } });
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
    rerender(<AuthorityScoreReviewForm eventId="event-1" assessment={refreshed} authorityType="PDRM" />);
    expect(screen.getByLabelText('Override reason')).toHaveValue('Locally verified crowd evidence requires a different score.');
    expect(screen.getByLabelText('Review rationale')).toHaveValue('I am still reviewing the complete evidence package.');
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
    fireEvent.change(screen.getByLabelText('Crowd safety review decision'), { target: { value: 'overridden' } });
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
    vi.mocked(getDoc).mockClear();
    const { rerender } = render(<AuthorityScoreReviewForm eventId="event-1" assessment={assessment} authorityType="PDRM" />);
    fireEvent.change(screen.getByLabelText('Crowd safety review decision'), { target: { value: 'overridden' } });
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
