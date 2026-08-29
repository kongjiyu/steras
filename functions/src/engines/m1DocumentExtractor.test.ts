import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { mapM1Documents, parseM1Docx, parseM1Pdf, validateCombinedTemplateIdentity, validateTemplateIdentity } from './m1DocumentExtractor';

describe('M1 DOCX extraction', () => {
  it('extracts searchable Field IDs from the repository PDF preview', async () => {
    const core = await parseM1Pdf(readFileSync('../output/pdf/m1-template-previews/Core Event Application Template.pdf'));
    const scenario = await parseM1Pdf(readFileSync('../output/pdf/m1-template-previews/Entertainment and Performance Event - Indoor.pdf'));
    expect(core.fields.size).toBeGreaterThan(25);
    expect(core.fields.has('EVENT_NAME')).toBe(true);
    expect(scenario.fields.size).toBeGreaterThan(20);
    expect(mapM1Documents(core, scenario).extractedFields).toEqual([]);
    expect(validateCombinedTemplateIdentity(core, 'STERAS-T01-ENT-IN-v2.0')).toContain(
      'The combined PDF does not contain scenario template STERAS-T01-ENT-IN-v2.0.',
    );
    await expect(parseM1Pdf(Buffer.from('not-a-pdf'))).rejects.toThrow('not a readable PDF');
  });

  it('validates a combined Core and scenario identity without requiring forged document roles', () => {
    const fields = new Map([
      ['EVENT_NAME', 'Event'], ['EVENT_DATES', '2026-10-10'], ['EVENT_ADDRESS', 'KL'],
      ['TOTAL_ATTENDANCE', '100'], ['RESPONSIBLE_PERSON', 'Organizer'], ['PERFORMANCE_TYPE', 'Concert'],
    ]);
    const combined = { text: 'STERAS-CORE STERAS-T01-ENT-IN-v2.0 T01-A01 / PERFORMANCE_TYPE', fields };
    expect(validateCombinedTemplateIdentity(combined, 'STERAS-T01-ENT-IN-v2.0')).toEqual([]);
    expect(validateCombinedTemplateIdentity(combined, 'STERAS-T02-ENT-OF-v1.0')).not.toEqual([]);
  });

  it('recognises the versioned repository Core and scenario templates', async () => {
    const core = await parseM1Docx(readFileSync('../docs/templates/m1/core/Core Event Application Template.docx'));
    const scenario = await parseM1Docx(readFileSync('../docs/templates/m1/entertainment-performance/Entertainment and Performance Event - Indoor.docx'));
    expect(core.fields.size).toBeGreaterThan(25);
    expect(scenario.fields.size).toBeGreaterThan(20);
    expect(validateTemplateIdentity(core, scenario, 'STERAS-T01-ENT-IN-v2.0')).toEqual([]);
    expect(validateTemplateIdentity(core, scenario, 'STERAS-T02-ENT-OF-v1.0')).toContain(
      'The scenario document does not match STERAS-T02-ENT-OF-v1.0.',
    );
    const forgedIdentity = await parseM1Docx(await docx([['T01-A01 / PERFORMANCE_TYPE', 'Concert']], 'STERAS-T02-ENT-OF-v1.0'));
    expect(validateTemplateIdentity(core, forgedIdentity, 'STERAS-T02-ENT-OF-v1.0')).toContain(
      'The scenario Field IDs do not match STERAS-T02-ENT-OF-v1.0.',
    );
  });

  it('does not interpret untouched Yes / No prompts in repository templates as organizer answers', async () => {
    const core = await parseM1Docx(readFileSync('../docs/templates/m1/core/Core Event Application Template.docx'));
    const scenario = await parseM1Docx(readFileSync('../docs/templates/m1/cultural-heritage-festival/Cultural, Heritage and Festival Event - Outdoor Fixed-Site.docx'));
    expect(mapM1Documents(core, scenario).extractedFields).toEqual([]);
  });

  it('maps completed stable Field IDs and excludes untouched placeholders', async () => {
    const core = await parseM1Docx(await docx([
      ['A01 / EVENT_NAME', 'Malaysia Night Market'],
      ['A02 / EVENT_PURPOSE', 'Promote local food and tourism.'],
      ['A04 / EVENT_DATES', 'Start date\n2026-10-10\nEnd date\n2026-10-11'],
      ['A05 / OPERATING_HOURS', 'Opening time\n10:00\nClosing time\n22:30'],
      ['A06 / EVENT_ADDRESS', 'Dataran Merdeka, Kuala Lumpur'],
      ['A07 / TOTAL_ATTENDANCE', '12,500'],
      ['B03 / RESPONSIBLE_PERSON', 'Nur Aisyah'],
      ['B04 / RESPONSIBLE_CONTACT', '+60 12-345 6789\nnur@example.co\nm'],
      ['C03 / REGISTRATION_TICKETING', 'Yes\nOnline QR ticket'],
      ['D01 / CROWD_MANAGEMENT', 'Zoned barriers and counters.'],
      ['D02 / SECURITY', 'PDRM liaison and bag screening.'],
      ['D03 / MEDICAL', 'Two first-aid posts.'],
      ['D05 / EVACUATION', 'Signed routes to assembly points.'],
      ['D09 / DISRUPTION_ARRANGEMENTS', 'Weather monitoring and shelter.'],
    ], 'STERAS-CORE'));
    const scenario = await parseM1Docx(await docx([
      ['T01-C02 / APPROVED_CAPACITY', 'Approved capacity: 15000'],
      ['T01-B06 / SPECIAL_EFFECTS', 'Yes\nStage flame effect'],
      ['T01-C13 / TEMPORARY_STRUCTURES', 'No'],
      ['T01-C14 / FOOD_BEVERAGE_INSIDE', 'Yes\nVendor hall'],
      ['T01-C15 / ALCOHOL_SERVICE', 'No'],
      ['T01-C16 / INDOOR_DRONE', '[Yes / No]'],
    ], 'STERAS-T01-ENT-IN-v2.0'));
    const result = mapM1Documents(core, scenario);
    const fields = Object.fromEntries(result.extractedFields.map((field) => [field.target, field.value]));
    expect(fields).toMatchObject({
      name: 'Malaysia Night Market', expectedAttendance: 12_500, venueCapacity: 15_000,
      organizerName: 'Nur Aisyah', organizerEmail: 'nur@example.com',
      'riskProfile.ticketedEntry': true, 'riskProfile.pyrotechnics': true,
      'riskProfile.temporaryStructures': false, 'riskProfile.foodServed': true,
      'riskProfile.alcoholServed': false,
    });
    expect(fields.startDatetime).toBe(new Date('2026-10-10T10:00:00+08:00').getTime());
    expect(fields.endDatetime).toBe(new Date('2026-10-11T22:30:00+08:00').getTime());
    expect(result.completionPercent).toBe(100);
    expect(result.warnings).toEqual([]);
  });

  it('rejects malformed archives, missing Word XML, and duplicate Field IDs', async () => {
    await expect(parseM1Docx(Buffer.from('not-a-zip'))).rejects.toThrow('not a readable DOCX');
    await expect(parseM1Docx(await new JSZip().generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('word/document.xml');
    await expect(parseM1Docx(await docx([
      ['A01 / EVENT_NAME', 'One'],
      ['A02 / EVENT_NAME', 'Two'],
    ], 'STERAS-CORE'))).rejects.toThrow('duplicate field ID EVENT_NAME');
  });

  it('rejects compressed XML bombs and archives with excessive entry counts', async () => {
    const oversized = new JSZip();
    oversized.file('word/document.xml', 'x'.repeat(8_000_001));
    await expect(parseM1Docx(await oversized.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })))
      .rejects.toThrow('XML is too large');

    const crowded = new JSZip();
    crowded.file('word/document.xml', '<w:document />');
    for (let index = 0; index < 1_000; index += 1) crowded.file(`custom/item-${index}.xml`, '<x />');
    await expect(parseM1Docx(await crowded.generateAsync({ type: 'nodebuffer' })))
      .rejects.toThrow('too many entries');
  });

  it('does not convert invalid dates, unsafe counts, or ambiguous yes/no responses', async () => {
    const core = await parseM1Docx(await docx([
      ['A01 / EVENT_NAME', '[Enter official event name]'],
      ['A04 / EVENT_DATES', '2026-02-30'],
      ['A07 / TOTAL_ATTENDANCE', '999999999999999999999999999'],
      ['C03 / REGISTRATION_TICKETING', 'Maybe'],
    ], 'STERAS-CORE'));
    const scenario = await parseM1Docx(await docx([['T01-B06 / SPECIAL_EFFECTS', 'Not confirmed']], 'STERAS-T01-ENT-IN-v2.0'));
    const targets = mapM1Documents(core, scenario).extractedFields.map((field) => field.target);
    expect(targets).not.toContain('name');
    expect(targets).not.toContain('startDatetime');
    expect(targets).not.toContain('expectedAttendance');
    expect(targets).not.toContain('riskProfile.ticketedEntry');
    expect(targets).not.toContain('riskProfile.pyrotechnics');
  });
});

async function docx(rows: Array<[string, string]>, identity: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>${identity}</w:t></w:r></w:p>${rows.map(([left, right]) => `<w:tr><w:tc><w:p><w:r><w:t>${escapeXml(left)}</w:t></w:r></w:p></w:tc><w:tc>${right.split('\n').map((line) => `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`).join('')}</w:tc></w:tr>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
