import { describe, expect, it } from 'vitest';
import { M1_TEMPLATE_REGISTRY_VERSION } from '@shared/types';
import {
  createTemplateSelection,
  isValidTemplateSelection,
  M1_CORE_TEMPLATE,
  M1_EVENT_CATEGORIES,
  M1_SCENARIO_TEMPLATES,
  M1_VENUE_SETTINGS,
  scenarioTemplateFor,
} from './templateRegistry';

describe('M1 template registry', () => {
  it('contains one unique scenario for every 5 x 3 combination', () => {
    expect(M1_EVENT_CATEGORIES).toHaveLength(5);
    expect(M1_VENUE_SETTINGS).toHaveLength(3);
    expect(M1_SCENARIO_TEMPLATES).toHaveLength(15);
    expect(new Set(M1_SCENARIO_TEMPLATES.map((template) => template.templateId)).size).toBe(15);

    for (const category of M1_EVENT_CATEGORIES) {
      for (const venue of M1_VENUE_SETTINGS) {
        const template = scenarioTemplateFor(category.value, venue.value);
        expect(template.eventCategory).toBe(category.value);
        expect(template.venueSetting).toBe(venue.value);
      }
    }
  });

  it('declares complete source and preview metadata for every template', () => {
    for (const template of [M1_CORE_TEMPLATE, ...M1_SCENARIO_TEMPLATES]) {
      expect(template.sourcePath).toMatch(/\.docx$/);
      expect(template.previewFileName).toMatch(/\.pdf$/);
      expect(template.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(template.pageCount).toBeGreaterThan(0);
    }
  });

  it('creates an exact, versioned selection and rejects tampering', () => {
    const selection = createTemplateSelection('sports_recreational', 'outdoor_route_based', 123);
    expect(selection).toEqual({
      eventCategory: 'sports_recreational',
      venueSetting: 'outdoor_route_based',
      coreTemplateId: 'STERAS-CORE',
      scenarioTemplateId: 'STERAS-T06-SPT-OR-v1.0',
      templateRegistryVersion: M1_TEMPLATE_REGISTRY_VERSION,
      selectedAt: 123,
    });
    expect(isValidTemplateSelection(selection)).toBe(true);
    expect(isValidTemplateSelection({ ...selection, scenarioTemplateId: 'STERAS-T01-ENT-IN-v2.0' })).toBe(false);
    expect(isValidTemplateSelection({ ...selection, unknown: true })).toBe(false);
    expect(isValidTemplateSelection({ ...selection, selectedAt: Number.NaN })).toBe(false);
  });
});
