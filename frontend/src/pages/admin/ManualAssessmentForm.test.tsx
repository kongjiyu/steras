import { describe, expect, it } from 'vitest';
import { validateManualAssessmentDraft } from './ManualAssessmentForm';
import type { AdminManualCategoryInput, AdminManualHazard } from '@shared/types';

const categories = (): AdminManualCategoryInput[] => ['crowd', 'venue_fire', 'weather_environment', 'public_health', 'food_water_sanitation', 'medical_capacity', 'security_cbrn', 'transport_accessibility'].map((categoryId) => ({
  categoryId: categoryId as AdminManualCategoryInput['categoryId'], likelihood: 1, severity: 1, evidenceReferences: [], rationale: 'Category rationale is complete.', missingInformation: 'No additional information was available.',
}));

const hazards: AdminManualHazard[] = [{ hazardId: 'h1', hazardName: 'Crowd congestion', categoryId: 'crowd', evidenceReferences: [], rationale: 'The hazard and information gap are documented.' }];

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
});
