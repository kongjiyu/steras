"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const controlListProposer_1 = require("./controlListProposer");
const fallback = [{
        controlName: 'PDRM compliance',
        authority: 'PDRM',
        stageRequirement: 'stage1_and_stage2',
        stage1Requirements: [{ docType: 'application', label: 'Acknowledgement', required: true }],
        stage2Requirement: { kind: 'image', label: 'PDRM venue photo' },
    }];
const event = {
    eventId: 'evt-1',
    organizerId: 'private-organizer-uid',
    eventDetails: {
        name: 'Private event name',
        organizerEmail: 'private@example.com',
        type: 'cultural',
        venueName: 'Venue',
        venueAddress: 'Address',
        venueLocation: { lat: 3.1, lng: 101.7 },
        venueCapacity: 1000,
        expectedAttendance: 500,
        environment: 'outdoor',
        coverage: 'uncovered',
        seating: 'mixed',
        startDatetime: 1,
        endDatetime: 3_601,
        emergencyPlanSummary: 'Plan',
        organizerName: 'Private organizer',
        organizerPhone: 'private-phone',
    },
};
(0, vitest_1.describe)('control-list MiniMax contract', () => {
    (0, vitest_1.it)('keeps the proposal input free of organizer identity fields', () => {
        const input = (0, controlListProposer_1.buildAllowedControlListInput)({ event, requiredAuthorities: ['PDRM'] });
        (0, vitest_1.expect)(input).not.toContain('private@example.com');
        (0, vitest_1.expect)(input).not.toContain('private-organizer-uid');
        (0, vitest_1.expect)(input).not.toContain('Private organizer');
        (0, vitest_1.expect)(input).toContain('PDRM');
    });
    (0, vitest_1.it)('validates a complete one-control-per-authority response', () => {
        const items = (0, controlListProposer_1.parseControlListProposal)(JSON.stringify({ controls: [{
                    controlName: 'PDRM compliance',
                    authority: 'PDRM',
                    stageRequirement: 'stage1_and_stage2',
                    stage1Requirements: [{ docType: 'application', label: 'Acknowledgement', required: true }],
                    stage2Requirement: { kind: 'image', label: 'PDRM venue photo' },
                }] }), ['PDRM']);
        (0, vitest_1.expect)(items).toEqual(fallback);
    });
    (0, vitest_1.it)('rejects unknown authorities and duplicate authorities', () => {
        const item = { controlName: 'x', authority: 'KKM', stageRequirement: 'stage1_only', stage1Requirements: [], stage2Requirement: null };
        (0, vitest_1.expect)(() => (0, controlListProposer_1.parseControlListProposal)(JSON.stringify({ controls: [item] }), ['PDRM'])).toThrow(/unrequired authority/i);
        (0, vitest_1.expect)(() => (0, controlListProposer_1.parseControlListProposal)(JSON.stringify({ controls: [
                { ...item, authority: 'PDRM' },
                { ...item, authority: 'PDRM' },
            ] }), ['PDRM', 'BOMBA'])).toThrow(/duplicate authority/i);
    });
    (0, vitest_1.it)('returns an explicit deterministic fallback when MiniMax is unavailable', async () => {
        const result = await (0, controlListProposer_1.proposeControlListWithMiniMax)('', { event, requiredAuthorities: ['PDRM'] }, fallback, { now: 10 });
        (0, vitest_1.expect)(result).toMatchObject({ source: 'deterministic_fallback', generatedAt: 10, items: fallback });
    });
    (0, vitest_1.it)('uses and validates a mocked MiniMax response', async () => {
        const result = await (0, controlListProposer_1.proposeControlListWithMiniMax)('secret', { event, requiredAuthorities: ['PDRM'] }, fallback, {
            now: 20,
            request: async () => JSON.stringify({ controls: [{
                        controlName: 'AI PDRM compliance',
                        authority: 'PDRM',
                        stageRequirement: 'stage1_and_stage2',
                        stage1Requirements: [{ docType: 'license', label: 'Licence', required: true }],
                        stage2Requirement: { kind: 'image', label: 'On-site photo' },
                    }] }),
        });
        (0, vitest_1.expect)(result).toMatchObject({ source: 'minimax', generatedAt: 20 });
        (0, vitest_1.expect)(result.items[0].controlName).toBe('AI PDRM compliance');
    });
});
//# sourceMappingURL=controlListProposer.test.js.map