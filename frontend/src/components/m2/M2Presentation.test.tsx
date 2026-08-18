import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResourceRecommendation } from '@shared/types';
import { mockAssessments } from '../../mock_data/assessments';
import AIAdvisory from './AIAdvisory';
import CategoryProfile from './CategoryProfile';
import ResourceRecommendationView from './ResourceRecommendation';
import { assessmentRiskLevel } from './m2Contract';

const assessment = mockAssessments.find((item) => item.status === 'provisional_ready')!;
const recommendation = {
  police: 12, security: 20, medicalTeams: 2, ambulances: 1, fireOfficers: 3, toilets: 8, wasteBins: 10,
  formulaVersion: 'formula-v1', guidelineVersion: 'guideline-v1', guidelineStatus: 'prototype', confidenceLevel: 'prototype',
  rationales: {}, aiConsiderations: ['Keep an additional ingress team on standby.'],
} as unknown as ResourceRecommendation;

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
    expect(screen.getByText('Police officers')).toBeInTheDocument();
    expect(screen.getByText('Prototype guidance')).toBeInTheDocument();
    expect(screen.getByText('formula-v1')).toBeInTheDocument();
    expect(screen.getByText(/additional ingress team/)).toBeInTheDocument();
  });
});
