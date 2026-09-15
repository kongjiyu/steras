import { describe, expect, it } from 'vitest';
import { scenarioTemplateFor } from '../../features/m1/templateRegistry';
import { applicationFileNameError } from './applicationFileName';

const selectedScenario = scenarioTemplateFor('sports_recreational', 'outdoor_fixed_site');

describe('applicationFileNameError', () => {
  it('rejects a scenario document placed in the Core upload box', () => {
    expect(applicationFileNameError(
      'Sports_and_Recreational_Event_Outdoor_Fixed-Site_Completed.docx',
      'core_template',
      selectedScenario,
    )).toMatch(/scenario template/i);
  });

  it('accepts completed Core and selected scenario filename variants', () => {
    expect(applicationFileNameError('Core_Event_Application_Template_Completed.docx', 'core_template', selectedScenario)).toBeUndefined();
    expect(applicationFileNameError('STERAS_DEMO_T05_Completed_Scenario_Application.docx', 'scenario_template', selectedScenario)).toBeUndefined();
  });

  it('rejects the Core file and a different registered scenario in the scenario box', () => {
    expect(applicationFileNameError('Core Event Application Template.docx', 'scenario_template', selectedScenario)).toMatch(/Core template/i);
    expect(applicationFileNameError('Sports and Recreational Event - Indoor.docx', 'scenario_template', selectedScenario)).toMatch(/selected Sports and Recreational Event - Outdoor Fixed-Site/i);
  });

  it('does not impose application-template naming on supporting evidence', () => {
    expect(applicationFileNameError('my-photo.jpg', 'supporting_evidence', selectedScenario)).toBeUndefined();
  });
});
