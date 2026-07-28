import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResourceRecommendation, RiskAssessment } from '@shared/types';
import AIAdvisory from './AIAdvisory';
import CategoryProfile from './CategoryProfile';
import ResourceRecommendationView from './ResourceRecommendation';

const assessment = {
  officialScore: 74,
  officialRiskLevel: 'High',
  categorySchemaVersion: 'schema-v1',
  scoringLogicVersion: 'logic-v1',
  categorySchemaStatus: 'prototype',
  categoryAssignments: [{
    categoryId: 'crowd', categoryName: 'Crowd pressure', score: 74, riskLevel: 'High', weight: 1,
    weightedContribution: 74, rationale: 'Venue approaches capacity.', evidenceKeys: ['crowd'], guidelineChecks: ['prototype.crowd'],
  }],
  aiAdvisory: {
    status: 'success', label: 'advisory', overallBand: 'Medium', overallExplanation: 'AI sees a manageable crowd pattern.',
    categories: [], keyConcerns: [], resourceConsiderations: [], citedEvidenceKeys: [], model: 'MiniMax-M3', promptVersion: 'p1',
    responseSchemaVersion: 'a1', cacheStatus: 'miss', generatedAt: 1,
  },
} as unknown as RiskAssessment;

const recommendation = {
  police: 12, security: 20, medicalTeams: 2, ambulances: 1, fireOfficers: 3, toilets: 8, wasteBins: 10,
  formulaVersion: 'formula-v1', guidelineVersion: 'guideline-v1', guidelineStatus: 'prototype', confidenceLevel: 'prototype',
  rationales: {}, aiConsiderations: ['Keep an additional ingress team on standby.'],
} as unknown as ResourceRecommendation;

describe('M2 presentation components', () => {
  it('labels the deterministic result as official', () => {
    render(<CategoryProfile assessment={assessment} />);
    expect(screen.getByText('Official deterministic result')).toBeInTheDocument();
    expect(screen.getByText('/ 100 official')).toBeInTheDocument();
    expect(screen.getByText('Crowd pressure')).toBeInTheDocument();
  });

  it('labels AI output as advisory and preserves the official band', () => {
    render(<AIAdvisory advisory={assessment.aiAdvisory} officialRiskLevel={assessment.officialRiskLevel} />);
    expect(screen.getByText('Advisory only · MiniMax M3')).toBeInTheDocument();
    expect(screen.getByText(/Official result remains/)).toHaveTextContent('Official result remains High');
  });

  it('shows versioned prototype resource quantities and considerations', () => {
    render(<ResourceRecommendationView recommendation={recommendation} />);
    expect(screen.getByText('Police officers')).toBeInTheDocument();
    expect(screen.getByText('Prototype guidance')).toBeInTheDocument();
    expect(screen.getByText('formula-v1')).toBeInTheDocument();
    expect(screen.getByText(/additional ingress team/)).toBeInTheDocument();
  });
});
