import { M1DocumentRole } from '@shared/types';
import { M1_CORE_TEMPLATE, M1_SCENARIO_TEMPLATES, M1TemplateDefinition } from '../../features/m1/templateRegistry';

function searchableName(value: string): string {
  return value
    .replace(/\.[^.]+$/, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(completed|complete|filled|final|copy|template|application|event|v\d+(?:[._-]\d+)*)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function templateTokens(template: M1TemplateDefinition): string[] {
  const id = template.templateId.match(/STERAS-(T\d{2})-/)?.[1]?.toLocaleLowerCase();
  return [id, searchableName(template.fileName), searchableName(template.title)].filter((value): value is string => Boolean(value));
}

function matchesTemplate(fileName: string, template: M1TemplateDefinition): boolean {
  const name = searchableName(fileName);
  return templateTokens(template).some((token) => name.includes(token));
}

export function applicationFileNameError(
  fileName: string,
  role: M1DocumentRole,
  selectedScenario?: M1TemplateDefinition,
): string | undefined {
  if (role === 'supporting_evidence') return undefined;

  const looksCore = matchesTemplate(fileName, M1_CORE_TEMPLATE) || /(^|\s)core(\s|$)/.test(searchableName(fileName));
  const namedScenario = M1_SCENARIO_TEMPLATES.find((template) => matchesTemplate(fileName, template));

  if (role === 'core_template') {
    if (namedScenario) return `${fileName} appears to be a scenario template. Upload it in the Scenario-specific box.`;
    if (!looksCore) return `${fileName} does not identify the Core application. Use the completed Core template file.`;
    return undefined;
  }

  if (looksCore) return `${fileName} appears to be the Core template. Upload it in the Core application box.`;
  if (namedScenario && selectedScenario && namedScenario.templateId !== selectedScenario.templateId) {
    return `${fileName} is for ${namedScenario.title}. Upload the selected ${selectedScenario.title} file.`;
  }
  if (selectedScenario && !matchesTemplate(fileName, selectedScenario)) {
    return `${fileName} does not identify the selected scenario. Use the completed ${selectedScenario.title} file.`;
  }
  return undefined;
}
