import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';
import { M1ExtractedField } from '@shared/types';

export interface ParsedM1Document {
  text: string;
  fields: Map<string, string>;
}

export interface M1MappedExtraction {
  extractedFields: M1ExtractedField[];
  warnings: string[];
  completionPercent: number;
}

const MAX_DOCUMENT_XML_BYTES = 8_000_000;
const MAX_ARCHIVE_ENTRIES = 1_000;
const MAX_PDF_TEXT_CHARACTERS = 2_000_000;

const REQUIRED_AUTO_FILL_TARGETS = [
  'name',
  'description',
  'venueAddress',
  'expectedAttendance',
  'startDatetime',
  'endDatetime',
  'emergencyPlanSummary',
  'organizerName',
  'organizerEmail',
  'organizerPhone',
] as const;

export async function parseM1Docx(buffer: Buffer): Promise<ParsedM1Document> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('The uploaded file is not a readable DOCX archive.');
  }
  if (Object.keys(archive.files).length > MAX_ARCHIVE_ENTRIES) {
    throw new Error('The DOCX archive contains too many entries to extract safely.');
  }
  const document = archive.file('word/document.xml');
  if (!document) throw new Error('The uploaded DOCX does not contain word/document.xml.');
  const declaredSize = (document as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
  if (typeof declaredSize === 'number' && (!Number.isSafeInteger(declaredSize) || declaredSize > MAX_DOCUMENT_XML_BYTES)) {
    throw new Error('The DOCX document XML is too large to extract safely.');
  }
  const xml = await readDocumentXml(document);
  const text = xmlText(xml);
  const fields = new Map<string, string>();
  for (const row of xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? []) {
    const cells = (row.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? []).map(xmlText);
    if (cells.length < 2) continue;
    const match = cells[0].match(/\b(?:[A-Z]\d{2}|T\d{2}-[A-Z]\d{2})\s*\/\s*([A-Z][A-Z0-9_]+)\b/);
    if (!match) continue;
    const value = cleanResponse(cells.slice(1).join('\n'));
    if (fields.has(match[1])) throw new Error(`The DOCX contains duplicate field ID ${match[1]}.`);
    fields.set(match[1], value);
  }
  if (fields.size === 0) throw new Error('No STERAS Field IDs were found in the DOCX.');
  return { text, fields };
}

export async function parseM1Pdf(buffer: Buffer): Promise<ParsedM1Document> {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('The uploaded file is not a readable PDF.');
  }
  const parser = new PDFParse({ data: buffer });
  let text: string;
  let tableRows: string[][] = [];
  try {
    const result = await parser.getText();
    text = result.text.replace(/\r/g, '').trim();
    try {
      const tableResult = await parser.getTable();
      tableRows = tableResult.pages.flatMap((page) => page.tables.flatMap((table) => table));
    } catch {
      tableRows = [];
    }
  } catch {
    throw new Error('The uploaded PDF could not be read.');
  } finally {
    await parser.destroy();
  }
  if (!text) throw new Error('The combined PDF contains no searchable text. Upload a text-based PDF rather than a scanned image.');
  if (text.length > MAX_PDF_TEXT_CHARACTERS) throw new Error('The combined PDF contains too much text to extract safely.');

  const fields = new Map<string, string>();
  for (const row of tableRows) {
    const match = row[0]?.match(/\b(?:[A-Z]\d{2}|T\d{2}-[A-Z]\d{2})\s*\/\s*([A-Z][A-Z0-9_]+)\b/);
    if (!match) continue;
    if (fields.has(match[1])) throw new Error(`The combined PDF contains duplicate field ID ${match[1]}.`);
    fields.set(match[1], cleanPdfResponse(row.slice(1).join('\n').replace(/\[[\s\S]*?\]/g, '')));
  }
  if (fields.size === 0) {
    const markers = [...text.matchAll(/\b(?:[A-Z]\d{2}|T\d{2}-[A-Z]\d{2})\s*\/\s*([A-Z][A-Z0-9_]+)\b/g)];
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      const fieldId = marker[1];
      if (fields.has(fieldId)) throw new Error(`The combined PDF contains duplicate field ID ${fieldId}.`);
      const start = (marker.index ?? 0) + marker[0].length;
      const end = markers[index + 1]?.index ?? text.length;
      fields.set(fieldId, pdfResponse(text.slice(start, end)));
    }
  }
  if (fields.size === 0) throw new Error('No STERAS Field IDs were found in the combined PDF.');
  return { text, fields };
}

function pdfResponse(section: string): string {
  const responseSection = section
    .split(/\nRequired Supporting Documents\b/i)[0]
    .replace(/\[[\s\S]*?\]/g, '');
  const lines = responseSection.split('\n').map((line) => line.trim()).filter(Boolean);
  const formatIndex = lines.findIndex((line) => /^Response format\s*:/i.test(line));
  const candidates = (formatIndex >= 0 ? lines.slice(formatIndex + 1) : lines)
    .filter((line) => !/^-- \d+ of \d+ --$/.test(line))
    .filter((line) => !/^Required Supporting Documents\b/i.test(line))
    .filter((line) => !/^Upload these files separately\b/i.test(line))
    .filter((line) => !/^Document \/ Reference\b/i.test(line));
  return cleanPdfResponse(candidates.join('\n'));
}

function cleanPdfResponse(value: string): string {
  return cleanResponse(value)
    .replace(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})[ \t]*\n[ \t]*([A-Z]{1,4})\b/gi, '$1$2')
    .replace(/([A-Za-z])-\n(?=[a-z])/g, '$1-')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function readDocumentXml(document: JSZip.JSZipObject): Promise<string> {
  const stream = document.nodeStream('nodebuffer') as NodeJS.ReadableStream & { destroy(error?: Error): void };
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    stream.on('data', (chunk: Buffer | Uint8Array | string) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > MAX_DOCUMENT_XML_BYTES) {
        const error = new Error('The DOCX document XML is too large to extract safely.');
        fail(error);
        stream.destroy(error);
        return;
      }
      chunks.push(bytes);
    });
    stream.on('error', (error) => fail(error instanceof Error ? error : new Error('The DOCX XML could not be read.')));
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, total).toString('utf8'));
    });
  });
}

export function validateTemplateIdentity(
  core: ParsedM1Document,
  scenario: ParsedM1Document,
  expectedScenarioTemplateId: string,
): string[] {
  const errors: string[] = [];
  if (!containsToken(core.text, 'STERAS-CORE')) errors.push('The Core document does not identify itself as STERAS-CORE.');
  if (!['EVENT_NAME', 'EVENT_DATES', 'EVENT_ADDRESS', 'TOTAL_ATTENDANCE', 'RESPONSIBLE_PERSON'].every((fieldId) => core.fields.has(fieldId))) {
    errors.push('The Core document is missing required STERAS Field IDs.');
  }
  if (!containsToken(scenario.text, expectedScenarioTemplateId)) {
    errors.push(`The scenario document does not match ${expectedScenarioTemplateId}.`);
  }
  const expectedPrefix = expectedScenarioTemplateId.match(/STERAS-(T\d{2})-/)?.[1];
  const scenarioPrefixes = new Set([...scenario.text.matchAll(/\b(T\d{2})-[A-Z]\d{2}\s*\//g)].map((match) => match[1]));
  if (!expectedPrefix || scenarioPrefixes.size !== 1 || !scenarioPrefixes.has(expectedPrefix)) {
    errors.push(`The scenario Field IDs do not match ${expectedScenarioTemplateId}.`);
  }
  if (containsToken(core.text, expectedScenarioTemplateId)) errors.push('The Core and scenario document roles appear to be reversed.');
  return errors;
}

export function validateCombinedTemplateIdentity(document: ParsedM1Document, expectedScenarioTemplateId: string): string[] {
  const errors: string[] = [];
  if (!containsToken(document.text, 'STERAS-CORE')) errors.push('The combined PDF does not contain the STERAS Core template.');
  if (!['EVENT_NAME', 'EVENT_DATES', 'EVENT_ADDRESS', 'TOTAL_ATTENDANCE', 'RESPONSIBLE_PERSON'].every((fieldId) => document.fields.has(fieldId))) {
    errors.push('The combined PDF is missing required Core STERAS Field IDs.');
  }
  if (!containsToken(document.text, expectedScenarioTemplateId)) {
    errors.push(`The combined PDF does not contain scenario template ${expectedScenarioTemplateId}.`);
  }
  const expectedPrefix = expectedScenarioTemplateId.match(/STERAS-(T\d{2})-/)?.[1];
  const scenarioPrefixes = new Set([...document.text.matchAll(/\b(T\d{2})-[A-Z]\d{2}\s*\//g)].map((match) => match[1]));
  if (!expectedPrefix || scenarioPrefixes.size !== 1 || !scenarioPrefixes.has(expectedPrefix)) {
    errors.push(`The combined PDF scenario Field IDs do not match ${expectedScenarioTemplateId}.`);
  }
  return errors;
}

export function mapM1Documents(core: ParsedM1Document, scenario: ParsedM1Document): M1MappedExtraction {
  const extractedFields: M1ExtractedField[] = [];
  const warnings: string[] = [];
  const add = (target: M1ExtractedField['target'], value: string | number | boolean | undefined, ids: string[], confidence: M1ExtractedField['confidence'] = 'high') => {
    if (value === undefined || value === '') return;
    extractedFields.push({ target, value, sourceFieldIds: ids, confidence });
  };

  add('name', meaningful(core.fields.get('EVENT_NAME')), ['EVENT_NAME']);
  add('description', meaningful(core.fields.get('EVENT_PURPOSE')), ['EVENT_PURPOSE']);
  add('venueAddress', meaningful(core.fields.get('EVENT_ADDRESS')), ['EVENT_ADDRESS']);
  add('expectedAttendance', firstSafeInteger(core.fields.get('TOTAL_ATTENDANCE')), ['TOTAL_ATTENDANCE']);
  add('organizerName', meaningful(core.fields.get('RESPONSIBLE_PERSON')), ['RESPONSIBLE_PERSON']);
  const contact = core.fields.get('RESPONSIBLE_CONTACT') ?? '';
  add('organizerEmail', firstEmail(contact), ['RESPONSIBLE_CONTACT']);
  add('organizerPhone', firstPhone(contact), ['RESPONSIBLE_CONTACT'], 'medium');

  const dates = isoDates(core.fields.get('EVENT_DATES') ?? '');
  const times = clockTimes(core.fields.get('OPERATING_HOURS') ?? '');
  if (dates[0]) add('startDatetime', malaysiaTimestamp(dates[0], times[0] ?? '00:00'), ['EVENT_DATES', 'OPERATING_HOURS']);
  if (dates[1]) add('endDatetime', malaysiaTimestamp(dates[1], times[1] ?? '23:59'), ['EVENT_DATES', 'OPERATING_HOURS']);
  if (dates.length === 1) warnings.push('Only one event date was extracted; confirm the end date manually.');

  const emergencyParts = [
    ['CROWD_MANAGEMENT', 'Crowd management'],
    ['SECURITY', 'Security'],
    ['MEDICAL', 'Medical'],
    ['EVACUATION', 'Evacuation'],
    ['DISRUPTION_ARRANGEMENTS', 'Disruption arrangements'],
  ].flatMap(([fieldId, label]) => {
    const value = meaningful(core.fields.get(fieldId));
    return value ? [`${label}: ${value}`] : [];
  });
  add('emergencyPlanSummary', emergencyParts.join('\n'), ['CROWD_MANAGEMENT', 'SECURITY', 'MEDICAL', 'EVACUATION', 'DISRUPTION_ARRANGEMENTS'], emergencyParts.length >= 3 ? 'high' : 'low');

  const capacity = findScenarioInteger(scenario.fields, ['APPROVED_CAPACITY', 'SITE_CAPACITY', 'ROUTE_CAPACITY']);
  add('venueCapacity', capacity, scenarioIds(scenario, ['APPROVED_CAPACITY', 'SITE_CAPACITY', 'ROUTE_CAPACITY']));
  add('riskProfile.pyrotechnics', affirmativeScenarioField(scenario, ['SPECIAL_EFFECTS', 'PYROTECHNICS', 'FIREWORKS']), scenarioIds(scenario, ['SPECIAL_EFFECTS', 'PYROTECHNICS', 'FIREWORKS']));
  add('riskProfile.temporaryStructures', affirmativeScenarioField(scenario, ['TEMPORARY_STRUCTURES']), scenarioIds(scenario, ['TEMPORARY_STRUCTURES']));
  add('riskProfile.foodServed', affirmativeScenarioField(scenario, ['FOOD_BEVERAGE_INSIDE', 'FOOD_BEVERAGE', 'FOOD_SERVICE']), scenarioIds(scenario, ['FOOD_BEVERAGE_INSIDE', 'FOOD_BEVERAGE', 'FOOD_SERVICE']));
  add('riskProfile.alcoholServed', affirmativeScenarioField(scenario, ['ALCOHOL_SERVICE']), scenarioIds(scenario, ['ALCOHOL_SERVICE']));
  add('riskProfile.ticketedEntry', affirmative(core.fields.get('REGISTRATION_TICKETING')), ['REGISTRATION_TICKETING']);

  for (const target of REQUIRED_AUTO_FILL_TARGETS) {
    if (!extractedFields.some((field) => field.target === target)) warnings.push(`${target} was not extracted and must be completed manually.`);
  }
  const completed = REQUIRED_AUTO_FILL_TARGETS.filter((target) => extractedFields.some((field) => field.target === target)).length;
  return { extractedFields, warnings, completionPercent: Math.round((completed / REQUIRED_AUTO_FILL_TARGETS.length) * 100) };
}

function xmlText(xml: string): string {
  const withBreaks = xml.replace(/<w:(?:tab|br)\b[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n');
  return withBreaks
    .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_match, text: string) => decodeXml(text))
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function cleanResponse(value: string): string {
  return value.split('\n').map((line) => line.trim()).filter((line) => line && !isPlaceholder(line)).join('\n').slice(0, 8_000);
}

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
  return /^\[(?:enter|describe|explain|list|select|if yes|yyyy|hh:mm|assigned|yes\s*\/\s*no|0|n\/a)/.test(normalized)
    || /^(?:start date|end date|opening time|closing time|contact number|email address|previously organised similar event\?|any previous incidents\?|if yes, brief details)$/i.test(normalized);
}

function meaningful(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next && !isPlaceholder(next) ? next : undefined;
}

function containsToken(value: string, token: string): boolean {
  return value.toLocaleUpperCase().includes(token.toLocaleUpperCase());
}

function firstSafeInteger(value: string | undefined): number | undefined {
  const match = value?.replace(/,/g, '').match(/\b\d+\b/);
  if (!match) return undefined;
  const number = Number(match[0]);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function firstEmail(value: string): string | undefined {
  const repairedPdfWrap = value.replace(
    /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})[ \t]*\n[ \t]*([A-Z]{1,4})\b/i,
    '$1$2',
  );
  return repairedPdfWrap.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function firstPhone(value: string): string | undefined {
  return value.match(/(?:\+?\d[\d ()-]{7,}\d)/)?.[0].trim();
}

function isoDates(value: string): string[] {
  return [...value.matchAll(/\b(20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/g)].map((match) => match[1]).filter(validDate);
}

function clockTimes(value: string): string[] {
  return [...value.matchAll(/\b([01]\d|2[0-3]):([0-5]\d)\b/g)].map((match) => `${match[1]}:${match[2]}`);
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value);
}

function malaysiaTimestamp(date: string, time: string): number {
  return new Date(`${date}T${time}:00+08:00`).getTime();
}

function scenarioIds(document: ParsedM1Document, suffixes: string[]): string[] {
  return [...document.fields.keys()].filter((key) => suffixes.some((suffix) => key === suffix || key.endsWith(`_${suffix}`)));
}

function findScenarioInteger(document: Map<string, string>, suffixes: string[]): number | undefined {
  for (const [key, value] of document) if (suffixes.some((suffix) => key === suffix || key.endsWith(`_${suffix}`))) {
    const integer = firstSafeInteger(value);
    if (integer !== undefined) return integer;
  }
  return undefined;
}

function affirmativeScenarioField(document: ParsedM1Document, suffixes: string[]): boolean | undefined {
  const ids = scenarioIds(document, suffixes);
  for (const id of ids) {
    const answer = affirmative(document.fields.get(id));
    if (answer !== undefined) return answer;
  }
  return undefined;
}

function affirmative(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  for (const line of value.split('\n')) {
    const normalized = line.trim();
    if (!normalized || /\byes\s*\/\s*no\b/i.test(normalized) || /^\[.*\]$/.test(normalized)) continue;
    const answer = normalized.match(/^(?:[^:]{1,120}:\s*)?(yes|no)(?:\s*[.;])?$/i)?.[1]?.toLowerCase();
    if (answer === 'yes') return true;
    if (answer === 'no') return false;
  }
  return undefined;
}
