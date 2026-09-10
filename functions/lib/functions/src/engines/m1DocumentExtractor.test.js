"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const jszip_1 = __importDefault(require("jszip"));
const vitest_1 = require("vitest");
const m1DocumentExtractor_1 = require("./m1DocumentExtractor");
(0, vitest_1.describe)('M1 DOCX extraction', () => {
    (0, vitest_1.it)('extracts searchable Field IDs from the repository PDF preview', async () => {
        const core = await (0, m1DocumentExtractor_1.parseM1Pdf)((0, node_fs_1.readFileSync)('../output/pdf/m1-template-previews/Core Event Application Template.pdf'));
        const scenario = await (0, m1DocumentExtractor_1.parseM1Pdf)((0, node_fs_1.readFileSync)('../output/pdf/m1-template-previews/Entertainment and Performance Event - Indoor.pdf'));
        (0, vitest_1.expect)(core.fields.size).toBeGreaterThan(25);
        (0, vitest_1.expect)(core.fields.has('EVENT_NAME')).toBe(true);
        (0, vitest_1.expect)(scenario.fields.size).toBeGreaterThan(20);
        (0, vitest_1.expect)((0, m1DocumentExtractor_1.mapM1Documents)(core, scenario).extractedFields).toEqual([]);
        await (0, vitest_1.expect)((0, m1DocumentExtractor_1.parseM1Pdf)(Buffer.from('not-a-pdf'))).rejects.toThrow('not a readable PDF');
    });
    (0, vitest_1.it)('extracts the completed Core and scenario presentation files separately', async () => {
        const core = await (0, m1DocumentExtractor_1.parseM1Docx)((0, node_fs_1.readFileSync)('../output/m1-presentation-test-case/01_Filled_Core_Event_Application.docx'));
        const scenario = await (0, m1DocumentExtractor_1.parseM1Docx)((0, node_fs_1.readFileSync)('../output/m1-presentation-test-case/02_Filled_Entertainment_and_Performance_Event_Indoor.docx'));
        const mapped = (0, m1DocumentExtractor_1.mapM1Documents)(core, scenario);
        const fields = Object.fromEntries(mapped.extractedFields.map((field) => [field.target, field.value]));
        (0, vitest_1.expect)((0, m1DocumentExtractor_1.validateTemplateIdentity)(core, scenario, 'STERAS-T01-ENT-IN-v2.0')).toEqual([]);
        (0, vitest_1.expect)(core.fields.size + scenario.fields.size).toBe(90);
        (0, vitest_1.expect)(mapped.completionPercent).toBe(100);
        (0, vitest_1.expect)(mapped.warnings).toEqual([]);
        (0, vitest_1.expect)(fields).toMatchObject({
            name: 'Malaysia Tourism Storytelling Showcase 2026',
            venueName: 'Kuala Lumpur Convention Centre',
            venueAddress: 'Kuala Lumpur Convention Centre, Kuala Lumpur City Centre, 50088 Kuala Lumpur, Malaysia',
            expectedAttendance: 600,
            organizerEmail: 'aina.rahman@example.com',
            venueCapacity: 8000,
            'riskProfile.vulnerableAttendeesPercent': 10,
            'riskProfile.standingAttendeesPercent': 0,
            'riskProfile.internationalAttendees': false,
            'riskProfile.alcoholServed': false,
            'riskProfile.foodServed': false,
            'riskProfile.freeDrinkingWater': false,
            'riskProfile.ticketedEntry': false,
            'riskProfile.overnightAccommodation': false,
            'riskProfile.pyrotechnics': false,
            'riskProfile.temporaryStructures': false,
            'riskProfile.rivalryOrTensionExpected': false,
            'riskProfile.crowdManagementPlan': true,
            'riskProfile.trafficManagementPlan': true,
            'riskProfile.severeWeatherPlan': true,
            'riskProfile.medicalPlan': true,
            'riskProfile.evacuationPlanTested': true,
            'riskProfile.authorityCoordinationConfirmed': false,
            'riskProfile.nearestHospitalTravelMinutes': 10,
        });
        (0, vitest_1.expect)(fields.startDatetime).toBe(new Date('2026-09-30T09:00:00+08:00').getTime());
        (0, vitest_1.expect)(fields.endDatetime).toBe(new Date('2026-09-30T18:00:00+08:00').getTime());
        (0, vitest_1.expect)(fields.emergencyPlanSummary).toContain('two-metre stage buffer');
    });
    (0, vitest_1.it)('recognises the versioned repository Core and scenario templates', async () => {
        const core = await (0, m1DocumentExtractor_1.parseM1Docx)((0, node_fs_1.readFileSync)('../docs/templates/m1/core/Core Event Application Template.docx'));
        const scenario = await (0, m1DocumentExtractor_1.parseM1Docx)((0, node_fs_1.readFileSync)('../docs/templates/m1/entertainment-performance/Entertainment and Performance Event - Indoor.docx'));
        (0, vitest_1.expect)(core.fields.size).toBeGreaterThan(25);
        (0, vitest_1.expect)(scenario.fields.size).toBeGreaterThan(20);
        (0, vitest_1.expect)((0, m1DocumentExtractor_1.validateTemplateIdentity)(core, scenario, 'STERAS-T01-ENT-IN-v2.0')).toEqual([]);
        (0, vitest_1.expect)((0, m1DocumentExtractor_1.validateTemplateIdentity)(core, scenario, 'STERAS-T02-ENT-OF-v1.0')).toContain('The scenario document does not match STERAS-T02-ENT-OF-v1.0.');
        const forgedIdentity = await (0, m1DocumentExtractor_1.parseM1Docx)(await docx([['T01-A01 / PERFORMANCE_TYPE', 'Concert']], 'STERAS-T02-ENT-OF-v1.0'));
        (0, vitest_1.expect)((0, m1DocumentExtractor_1.validateTemplateIdentity)(core, forgedIdentity, 'STERAS-T02-ENT-OF-v1.0')).toContain('The scenario Field IDs do not match STERAS-T02-ENT-OF-v1.0.');
    });
    (0, vitest_1.it)('does not interpret untouched Yes / No prompts in repository templates as organizer answers', async () => {
        const core = await (0, m1DocumentExtractor_1.parseM1Docx)((0, node_fs_1.readFileSync)('../docs/templates/m1/core/Core Event Application Template.docx'));
        const scenario = await (0, m1DocumentExtractor_1.parseM1Docx)((0, node_fs_1.readFileSync)('../docs/templates/m1/cultural-heritage-festival/Cultural, Heritage and Festival Event - Outdoor Fixed-Site.docx'));
        (0, vitest_1.expect)((0, m1DocumentExtractor_1.mapM1Documents)(core, scenario).extractedFields).toEqual([]);
    });
    (0, vitest_1.it)('maps completed stable Field IDs and excludes untouched placeholders', async () => {
        const core = await (0, m1DocumentExtractor_1.parseM1Docx)(await docx([
            ['A01 / EVENT_NAME', 'Malaysia Night Market'],
            ['A02 / EVENT_PURPOSE', 'Promote local food and tourism.'],
            ['A04 / EVENT_DATES', 'Start date\n2026-10-10\nEnd date\n2026-10-11'],
            ['A05 / OPERATING_HOURS', 'Opening time\n10:00\nClosing time\n22:30'],
            ['A06A / VENUE_NAME', 'Dataran Merdeka'],
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
            ['H01 / VULNERABLE_ATTENDEES_PERCENT', '5'],
            ['H02 / STANDING_ATTENDEES_PERCENT', '25'],
            ['H03 / INTERNATIONAL_ATTENDEES', 'Yes'],
            ['H04 / ALCOHOL_SERVED', 'No'],
            ['H05 / FOOD_SERVED', 'Yes'],
            ['H06 / FREE_DRINKING_WATER', 'Yes'],
            ['H07 / TICKETED_ENTRY', 'Yes'],
            ['H08 / OVERNIGHT_ACCOMMODATION', 'No'],
            ['H09 / PYROTECHNICS', 'Yes'],
            ['H10 / ALL_HAZARDS_TEMPORARY_STRUCTURES', 'No'],
            ['H11 / RIVALRY_OR_TENSION_EXPECTED', 'No'],
            ['H12 / CROWD_MANAGEMENT_PLAN', 'Yes'],
            ['H13 / TRAFFIC_MANAGEMENT_PLAN', 'Yes'],
            ['H14 / SEVERE_WEATHER_PLAN', 'Yes'],
            ['H15 / MEDICAL_PLAN', 'Yes'],
            ['H16 / EVACUATION_PLAN_TESTED', 'No'],
            ['H17 / AUTHORITY_COORDINATION_CONFIRMED', 'Yes'],
            ['H18 / NEAREST_HOSPITAL_TRAVEL_MINUTES', '15'],
        ], 'STERAS-CORE'));
        const scenario = await (0, m1DocumentExtractor_1.parseM1Docx)(await docx([
            ['T01-C02 / APPROVED_CAPACITY', 'Approved capacity: 15000'],
            ['T01-B06 / SPECIAL_EFFECTS', 'Yes\nStage flame effect'],
            ['T01-C13 / TEMPORARY_STRUCTURES', 'No'],
            ['T01-C14 / FOOD_BEVERAGE_INSIDE', 'Yes\nVendor hall'],
            ['T01-C15 / ALCOHOL_SERVICE', 'No'],
            ['T01-C16 / INDOOR_DRONE', '[Yes / No]'],
        ], 'STERAS-T01-ENT-IN-v2.0'));
        const result = (0, m1DocumentExtractor_1.mapM1Documents)(core, scenario);
        const fields = Object.fromEntries(result.extractedFields.map((field) => [field.target, field.value]));
        (0, vitest_1.expect)(fields).toMatchObject({
            name: 'Malaysia Night Market', venueName: 'Dataran Merdeka', expectedAttendance: 12_500, venueCapacity: 15_000,
            organizerName: 'Nur Aisyah', organizerEmail: 'nur@example.com',
            'riskProfile.ticketedEntry': true, 'riskProfile.pyrotechnics': true,
            'riskProfile.temporaryStructures': false, 'riskProfile.foodServed': true,
            'riskProfile.alcoholServed': false, 'riskProfile.standingAttendeesPercent': 25,
            'riskProfile.nearestHospitalTravelMinutes': 15,
        });
        (0, vitest_1.expect)(fields.startDatetime).toBe(new Date('2026-10-10T10:00:00+08:00').getTime());
        (0, vitest_1.expect)(fields.endDatetime).toBe(new Date('2026-10-11T22:30:00+08:00').getTime());
        (0, vitest_1.expect)(result.completionPercent).toBe(100);
        (0, vitest_1.expect)(result.warnings).toEqual([]);
    });
    (0, vitest_1.it)('rejects malformed archives, missing Word XML, and duplicate Field IDs', async () => {
        await (0, vitest_1.expect)((0, m1DocumentExtractor_1.parseM1Docx)(Buffer.from('not-a-zip'))).rejects.toThrow('not a readable DOCX');
        await (0, vitest_1.expect)((0, m1DocumentExtractor_1.parseM1Docx)(await new jszip_1.default().generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('word/document.xml');
        await (0, vitest_1.expect)((0, m1DocumentExtractor_1.parseM1Docx)(await docx([
            ['A01 / EVENT_NAME', 'One'],
            ['A02 / EVENT_NAME', 'Two'],
        ], 'STERAS-CORE'))).rejects.toThrow('duplicate field ID EVENT_NAME');
    });
    (0, vitest_1.it)('rejects compressed XML bombs and archives with excessive entry counts', async () => {
        const oversized = new jszip_1.default();
        oversized.file('word/document.xml', 'x'.repeat(8_000_001));
        await (0, vitest_1.expect)((0, m1DocumentExtractor_1.parseM1Docx)(await oversized.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })))
            .rejects.toThrow('XML is too large');
        const crowded = new jszip_1.default();
        crowded.file('word/document.xml', '<w:document />');
        for (let index = 0; index < 1_000; index += 1)
            crowded.file(`custom/item-${index}.xml`, '<x />');
        await (0, vitest_1.expect)((0, m1DocumentExtractor_1.parseM1Docx)(await crowded.generateAsync({ type: 'nodebuffer' })))
            .rejects.toThrow('too many entries');
    });
    (0, vitest_1.it)('does not convert invalid dates, unsafe counts, or ambiguous yes/no responses', async () => {
        const core = await (0, m1DocumentExtractor_1.parseM1Docx)(await docx([
            ['A01 / EVENT_NAME', '[Enter official event name]'],
            ['A04 / EVENT_DATES', '2026-02-30'],
            ['A07 / TOTAL_ATTENDANCE', '999999999999999999999999999'],
            ['C03 / REGISTRATION_TICKETING', 'Maybe'],
        ], 'STERAS-CORE'));
        const scenario = await (0, m1DocumentExtractor_1.parseM1Docx)(await docx([['T01-B06 / SPECIAL_EFFECTS', 'Not confirmed']], 'STERAS-T01-ENT-IN-v2.0'));
        const targets = (0, m1DocumentExtractor_1.mapM1Documents)(core, scenario).extractedFields.map((field) => field.target);
        (0, vitest_1.expect)(targets).not.toContain('name');
        (0, vitest_1.expect)(targets).not.toContain('startDatetime');
        (0, vitest_1.expect)(targets).not.toContain('expectedAttendance');
        (0, vitest_1.expect)(targets).not.toContain('riskProfile.ticketedEntry');
        (0, vitest_1.expect)(targets).not.toContain('riskProfile.pyrotechnics');
    });
    (0, vitest_1.it)('accepts zero percentages and rejects out-of-range all-hazards numbers', async () => {
        const core = await (0, m1DocumentExtractor_1.parseM1Docx)(await docx([
            ['H01 / VULNERABLE_ATTENDEES_PERCENT', '101'],
            ['H02 / STANDING_ATTENDEES_PERCENT', '0'],
            ['H18 / NEAREST_HOSPITAL_TRAVEL_MINUTES', '241'],
        ], 'STERAS-CORE'));
        const scenario = await (0, m1DocumentExtractor_1.parseM1Docx)(await docx([['T01-A01 / PERFORMANCE_TYPE', '[Enter performance type]']], 'STERAS-T01-ENT-IN-v2.0'));
        const fields = Object.fromEntries((0, m1DocumentExtractor_1.mapM1Documents)(core, scenario).extractedFields.map((field) => [field.target, field.value]));
        (0, vitest_1.expect)(fields['riskProfile.standingAttendeesPercent']).toBe(0);
        (0, vitest_1.expect)(fields).not.toHaveProperty('riskProfile.vulnerableAttendeesPercent');
        (0, vitest_1.expect)(fields).not.toHaveProperty('riskProfile.nearestHospitalTravelMinutes');
    });
});
async function docx(rows, identity) {
    const zip = new jszip_1.default();
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>${identity}</w:t></w:r></w:p>${rows.map(([left, right]) => `<w:tr><w:tc><w:p><w:r><w:t>${escapeXml(left)}</w:t></w:r></w:p></w:tc><w:tc>${right.split('\n').map((line) => `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`).join('')}</w:tc></w:tr>`).join('')}</w:body></w:document>`);
    return zip.generateAsync({ type: 'nodebuffer' });
}
function escapeXml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
//# sourceMappingURL=m1DocumentExtractor.test.js.map