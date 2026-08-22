import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockAssessments } from '../../mock_data/assessments';
import { mockResourceRecommendations } from '../../mock_data/resources';
import AIAdvisory from './AIAdvisory';
import CategoryProfile from './CategoryProfile';
import ResourceRecommendationView from './ResourceRecommendation';
import { assessmentRiskLevel } from './m2Contract';

const assessment = mockAssessments.find((item) => item.status === 'provisional_ready')!;
const recommendation = mockResourceRecommendations[0];

describe('M2 presentation components', () => {
  it('labels a V3 result as provisional', () => {
    render(<CategoryProfile assessment={assessment} />);
    expect(screen.getByText('Validated provisional result')).toBeInTheDocument();
    expect(screen.getByText('/ 100 weighted')).toBeInTheDocument();
    expect(screen.getByText('Crowd safety')).toBeInTheDocument();
  });

  it('hides internal validation differences from organizers', () => {
    render(<CategoryProfile assessment={assessment} density="compact" showVersion={false} audience="organizer" />);
    expect(screen.queryByText('Warnings')).not.toBeInTheDocument();
    expect(screen.queryByText('Data confidence')).not.toBeInTheDocument();
    expect(screen.queryByText(/Proposed \d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/validated \d/)).not.toBeInTheDocument();
  });

  it('shows numeric AI proposals and the validated provisional band', () => {
    render(<AIAdvisory advisory={assessment.aiProposal} resultRiskLevel={assessmentRiskLevel(assessment)} />);
    expect(screen.getByText('AI proposal · MiniMax M3')).toBeInTheDocument();
    expect(screen.getByText(/Validated provisional result/)).toHaveTextContent(String(assessmentRiskLevel(assessment)));
  });

  it('shows versioned prototype resource quantities and considerations', () => {
    render(<ResourceRecommendationView recommendation={recommendation} />);
    expect(screen.getAllByText('Police officers').length).toBeGreaterThan(0);
    expect(screen.getByText('Prototype guidance')).toBeInTheDocument();
    expect(screen.getByText('2026-08-19-deterministic-v4')).toBeInTheDocument();
    expect(screen.getAllByText(/internal academic prototype/i).length).toBeGreaterThan(0);
  });
});
