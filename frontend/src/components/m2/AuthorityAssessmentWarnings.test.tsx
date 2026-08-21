import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthorityAssessmentWarnings from './AuthorityAssessmentWarnings';

describe('AuthorityAssessmentWarnings', () => {
  it('shows the warning message, category and evidence to authority reviewers', () => {
    render(<AuthorityAssessmentWarnings warnings={[{
      warningId: 'warning-1',
      code: 'low_confidence',
      message: 'The submitted crowd evidence has low confidence.',
      categoryId: 'crowd_control',
      evidenceReferences: ['crowd'],
    }]} />);
    expect(screen.getByText('The submitted crowd evidence has low confidence.')).toBeInTheDocument();
    expect(screen.getByText(/Crowd Control/)).toBeInTheDocument();
    expect(screen.getByText(/Evidence: Crowd/)).toBeInTheDocument();
  });

  it('renders nothing when there are no warnings', () => {
    const { container } = render(<AuthorityAssessmentWarnings warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
