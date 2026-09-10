"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const onM4ReportOutcome_1 = require("./onM4ReportOutcome");
(0, vitest_1.describe)('onM4ReportOutcome contract', () => {
    (0, vitest_1.it)('accepts only the two terminal M4 outcomes', () => {
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isM4TerminalOutcome)('confirmed_true')).toBe(true);
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isM4TerminalOutcome)('dismissed_fake')).toBe(true);
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isM4TerminalOutcome)('under_review')).toBe(false);
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isM4TerminalOutcome)(undefined)).toBe(false);
    });
    (0, vitest_1.it)('rejects stale or mismatched event-control report bindings', () => {
        const report = { ticketId: 'ticket-1', eventId: 'event-1', versionId: 'v1', controlId: 'control-1', docId: 'control-1-s2', stage2PublishedAt: 10 };
        const event = { status: 'Approved', currentVersionId: 'v1' };
        const control = { controlId: 'control-1', eventId: 'event-1', versionId: 'v1' };
        const stage2 = { docId: 'control-1-s2', m4TicketId: 'ticket-1', publishedAt: 10 };
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isCurrentM4ReportBinding)(report, event, control, stage2)).toBe(true);
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isCurrentM4ReportBinding)(report, { ...event, status: 'Withdrawn' }, control, stage2)).toBe(false);
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isCurrentM4ReportBinding)(report, { ...event, currentVersionId: 'v2' }, control, stage2)).toBe(false);
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isCurrentM4ReportBinding)(report, event, control, { ...stage2, m4TicketId: 'other' })).toBe(false);
        (0, vitest_1.expect)((0, onM4ReportOutcome_1.isCurrentM4ReportBinding)(report, event, { ...control, eventId: 'other' }, stage2)).toBe(false);
    });
});
//# sourceMappingURL=onM4ReportOutcome.test.js.map