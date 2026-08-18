import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ASSESSMENT_SCHEMA_VERSION, OrganizerAssessmentSummary } from '@shared/types';
import OrganizerAssessmentSummaryView, { OrganizerResourceSummaryView } from './OrganizerAssessmentSummaryView';
import { isOrganizerAssessmentSummary } from './m2Contract';

const summary: OrganizerAssessmentSummary = {
  assessmentId: 'v1', eventId: 'event-1', versionId: 'v1', schemaVersion: ASSESSMENT_SCHEMA_VERSION,
  status: 'provisional_ready', overallScore: 64, overallRiskLevel: 'High',
  categories: [
    ['crowd', 'Crowd safety'], ['venue_fire', 'Venue and fire safety'],
    ['weather_environment', 'Weather and environment'], ['public_health', 'Public health'],
    ['food_water_sanitation', 'Food, water, and sanitation'], ['medical_capacity', 'Medical capacity'],
    ['security_cbrn', 'Security and CBRN'], ['transport_accessibility', 'Transport and accessibility'],
  ].map(([categoryId, categoryName]) => ({ categoryId, categoryName, normalizedScore: 64, riskLevel: 'High' as const })),
  assessmentReadiness: 'complete', complianceStatus: 'pass', authorityReviewRequired: true,
  resourceQuantities: { police: 10, security: 12, medicalTeams: 2, ambulances: 1, fireOfficers: 3, toilets: 20, wasteBins: 10 },
  computedAt: 1,
};

describe('UC-M2-18 organizer-safe assessment summary', () => {
  it('renders only safe risk/category/resource fields and ignores injected authority internals', () => {
    const hostile = {
      ...summary,
      aiProposal: { prompt: 'SECRET PROMPT', rationale: 'INTERNAL RATIONALE' },
      warnings: ['INTERNAL WARNING'],
      appliedHardRules: ['INTERNAL RULE'],
    } as OrganizerAssessmentSummary;
    render(<><OrganizerAssessmentSummaryView summary={hostile} /><OrganizerResourceSummaryView summary={hostile} /></>);
    expect(screen.getByText('Crowd safety')).toBeInTheDocument();
    expect(screen.getByText('Police officers')).toBeInTheDocument();
    expect(screen.queryByText(/SECRET PROMPT|INTERNAL RATIONALE|INTERNAL WARNING|INTERNAL RULE/)).not.toBeInTheDocument();
  });

  it('rejects malformed or fabricated summary calculations at the runtime boundary', () => {
    expect(isOrganizerAssessmentSummary(summary)).toBe(true);
    expect(isOrganizerAssessmentSummary({ ...summary, overallScore: Number.NaN })).toBe(false);
    expect(isOrganizerAssessmentSummary({ ...summary, resourceQuantities: { ...summary.resourceQuantities, police: -1 } })).toBe(false);
    expect(isOrganizerAssessmentSummary({ ...summary, categories: [null] })).toBe(false);
  });

  it('shows a safe manual-review state without fabricating a score', () => {
    const manual: OrganizerAssessmentSummary = {
      ...summary, status: 'manual_review_required', categories: [], authorityReviewRequired: true,
      overallScore: undefined, overallRiskLevel: undefined, resourceQuantities: undefined,
    };
    render(<OrganizerAssessmentSummaryView summary={manual} />);
    expect(screen.getByText('Manual Review Required')).toBeInTheDocument();
    expect(screen.queryByText('/ 100 weighted')).not.toBeInTheDocument();
  });
});
