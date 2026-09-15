import { M1DocumentRole } from '@shared/types';
import { M1_CORE_TEMPLATE, M1_SCENARIO_TEMPLATES, M1TemplateDefinition } from '../../features/m1/templateRegistry';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const CORE_FIELD_IDS = ['EVENT_NAME', 'EVENT_DATES', 'EVENT_ADDRESS', 'TOTAL_ATTENDANCE', 'RESPONSIBLE_PERSON'];

function includesToken(text: string, token: string): boolean {
  return text.toLocaleUpperCase().includes(token.toLocaleUpperCase());
}

function detectedScenario(text: string): M1TemplateDefinition | undefined {
  return M1_SCENARIO_TEMPLATES.find((template) => includesToken(text, template.templateId));
}

export function applicationDocumentIdentityErrorFromText(
  text: string,
  role: M1DocumentRole,
  selectedScenario?: M1TemplateDefinition,
): string | undefined {
  if (role === 'supporting_evidence') return undefined;

  const hasCoreIdentity = includesToken(text, M1_CORE_TEMPLATE.templateId);
  const scenario = detectedScenario(text);

  if (role === 'core_template') {
    if (scenario) {
      return `Scenario-specific document detected (${scenario.title}). This upload box requires the completed ${M1_CORE_TEMPLATE.title}. Upload this file in the Scenario-specific box instead.`;
    }
    if (!hasCoreIdentity || !CORE_FIELD_IDS.every((fieldId) => includesToken(text, fieldId))) {
      return `We could not verify this as the completed ${M1_CORE_TEMPLATE.title}. The file must contain the STERAS-CORE identifier and official Field IDs. Download the Core template, complete it, and upload the original text-searchable PDF or DOCX.`;
    }
    return undefined;
  }

  if (hasCoreIdentity) {
    return `Core application document detected. This upload box requires the completed ${selectedScenario?.title ?? 'selected scenario'} document. Upload this file in the Core application box instead.`;
  }
  if (!selectedScenario) {
    return 'Choose an event scenario before uploading the scenario-specific document.';
  }
  if (scenario && scenario.templateId !== selectedScenario.templateId) {
    return `This file is for ${scenario.title}. This draft requires ${selectedScenario.title}. Upload the completed document for the selected scenario.`;
  }
  const expectedPrefix = selectedScenario.templateId.match(/STERAS-(T\d{2})-/)?.[1];
  const hasExpectedFieldId = expectedPrefix ? new RegExp(`\\b${expectedPrefix}-[A-Z]\\d{2}\\b`, 'i').test(text) : false;
  if (!includesToken(text, selectedScenario.templateId) || !hasExpectedFieldId) {
    return `We could not verify this as the completed ${selectedScenario.title} document. The file must contain ${selectedScenario.templateId} and its official Field IDs. Download the selected scenario template, complete it, and upload the original text-searchable PDF or DOCX.`;
  }
  return undefined;
}

async function extractPdfText(file: File): Promise<string> {
  const { pdfjs } = await import('react-pdf');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
  } finally {
    await document.destroy();
  }
  return pages.join('\n');
}

async function extractDocxText(file: File): Promise<string> {
  const { default: mammoth } = await import('mammoth');
  return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
}

export async function applicationDocumentIdentityError(
  file: File,
  mimeType: string,
  role: M1DocumentRole,
  selectedScenario?: M1TemplateDefinition,
): Promise<string | undefined> {
  if (role === 'supporting_evidence') return undefined;
  try {
    const text = mimeType === DOCX_MIME
      ? await extractDocxText(file)
      : mimeType === PDF_MIME
        ? await extractPdfText(file)
        : '';
    return applicationDocumentIdentityErrorFromText(text, role, selectedScenario);
  } catch {
    const expected = role === 'core_template' ? M1_CORE_TEMPLATE.title : selectedScenario?.title ?? 'selected scenario template';
    return `We could not read this file to verify the ${expected}. Upload the original, text-searchable PDF or DOCX rather than a scan, image, protected file, or damaged copy.`;
  }
}
