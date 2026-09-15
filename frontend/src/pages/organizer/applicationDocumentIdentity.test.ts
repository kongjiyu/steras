import { describe, expect, it } from 'vitest';
import { scenarioTemplateFor } from '../../features/m1/templateRegistry';
import { applicationDocumentIdentityErrorFromText } from './applicationDocumentIdentity';

const selectedScenario = scenarioTemplateFor('entertainment_performance', 'indoor');
const otherScenario = scenarioTemplateFor('sports_recreational', 'indoor');

describe('applicationDocumentIdentityErrorFromText', () => {
  it('accepts the expected Core and scenario identities', () => {
    expect(applicationDocumentIdentityErrorFromText(
      'STERAS-CORE EVENT_NAME EVENT_DATES EVENT_ADDRESS TOTAL_ATTENDANCE RESPONSIBLE_PERSON',
      'core_template',
      selectedScenario,
    )).toBeUndefined();
    expect(applicationDocumentIdentityErrorFromText(
      `${selectedScenario?.templateId} T01-A01 / EVENT_FORMAT`,
      'scenario_template',
      selectedScenario,
    )).toBeUndefined();
  });

  it('detects documents placed in the wrong upload box', () => {
    expect(applicationDocumentIdentityErrorFromText(
      `${selectedScenario?.templateId} T01-A01 / EVENT_FORMAT`,
      'core_template',
      selectedScenario,
    )).toMatch(/Scenario-specific document detected/);
    expect(applicationDocumentIdentityErrorFromText(
      'STERAS-CORE EVENT_NAME EVENT_DATES EVENT_ADDRESS TOTAL_ATTENDANCE RESPONSIBLE_PERSON',
      'scenario_template',
      selectedScenario,
    )).toMatch(/Core application document detected/);
  });

  it('detects a scenario document for a different recommendation', () => {
    expect(applicationDocumentIdentityErrorFromText(
      `${otherScenario?.templateId} T06-A01 / EVENT_FORMAT`,
      'scenario_template',
      selectedScenario,
    )).toContain(otherScenario?.title);
  });

  it('rejects unrelated or non-searchable document content', () => {
    expect(applicationDocumentIdentityErrorFromText('unrelated report', 'core_template', selectedScenario)).toMatch(/could not verify/i);
    expect(applicationDocumentIdentityErrorFromText('unrelated report', 'scenario_template', selectedScenario)).toMatch(/could not verify/i);
  });
});
