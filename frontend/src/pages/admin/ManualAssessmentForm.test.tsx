import { describe, expect, it } from 'vitest';
import { validateManualAssessmentDraft } from './ManualAssessmentForm';
import type { AdminManualCategoryInput, AdminManualHazard, AdminManualResourcePlan } from '@shared/types';

const categories = (): AdminManualCategoryInput[] => ['crowd', 'venue_fire', 'weather_environment', 'public_health', 'food_water_sanitation', 'medical_capacity', 'security_cbrn', 'transport_accessibility'].map((categoryId) => ({
  categoryId: categoryId as AdminManualCategoryInput['categoryId'], likelihood: 1, severity: 1, evidenceReferences: [], rationale: 'Category rationale is complete.', missingInformation: 'No additional information was available.',
}));

const hazards: AdminManualHazard[] = [{ hazardId: 'h1', hazardName: 'Crowd congestion', categoryId: 'crowd', evidenceReferences: [], rationale: 'The hazard and information gap are documented.' }];
const resourcePlan: AdminManualResourcePlan = { police: { quantity: 2, maximum: 4 }, security: { quantity: 3, maximum: 5 }, medicalTeams: { quantity: 1, maximum: 2 }, ambulances: { quantity: 1, maximum: 2 }, fireOfficers: { quantity: 2, maximum: 3 }, toilets: { quantity: 20, maximum: 25 }, wasteBins: { quantity: 10, maximum: 15 } };

describe('ManualAssessmentForm validation', () => {
  it('requires all fields before submission', () => {
    const errors = validateManualAssessmentDraft([{ ...hazards[0], hazardName: '', rationale: '' }], categories().map((category) => ({ ...category, rationale: '' })), '', ['crowd']);
    expect(errors['hazard-0-name']).toBeTruthy();
    expect(errors['category-0-rationale']).toBeTruthy();
    expect(errors.rationale).toBeTruthy();
  });

  it('accepts a complete no-evidence assessment with missing-information explanations', () => {
    expect(Object.keys(validateManualAssessmentDraft(hazards, categories(), 'The full application was reviewed and the official category scores are recorded.', [])).length).toBe(0);
  });

  it('requires a complete Admin-owned resource plan and valid ranges', () => {
    const errors = validateManualAssessmentDraft(hazards, categories(), 'The full application was reviewed and the official category scores are recorded.', [], resourcePlan, 'The quantities reflect venue capacity and the response plan.');
    expect(Object.keys(errors)).toHaveLength(0);
    expect(validateManualAssessmentDraft(hazards, categories(), 'The full application was reviewed and the official category scores are recorded.', [], { ...resourcePlan, police: { quantity: 5, maximum: 2 } }, 'The quantities reflect venue capacity and the response plan.')['resource-police-range']).toBeTruthy();
    expect(validateManualAssessmentDraft(hazards, categories(), 'The full application was reviewed and the official category scores are recorded.', [], { ...resourcePlan, police: { quantity: '', maximum: '2' } } as never, 'The quantities reflect venue capacity and the response plan.')['resource-police-quantity']).toBeTruthy();
  });
});
