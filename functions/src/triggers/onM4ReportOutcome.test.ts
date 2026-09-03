import { describe, expect, it } from 'vitest';
import type { EventControl, EventRecord, PublicReport, Stage2Doc } from '@shared/types';
import { isCurrentM4ReportBinding, isM4TerminalOutcome } from './onM4ReportOutcome';

describe('onM4ReportOutcome contract', () => {
  it('accepts only the two terminal M4 outcomes', () => {
    expect(isM4TerminalOutcome('confirmed_true')).toBe(true);
    expect(isM4TerminalOutcome('dismissed_fake')).toBe(true);
    expect(isM4TerminalOutcome('under_review')).toBe(false);
    expect(isM4TerminalOutcome(undefined)).toBe(false);
  });

  it('rejects stale or mismatched event-control report bindings', () => {
    const report = { ticketId: 'ticket-1', eventId: 'event-1', versionId: 'v1', controlId: 'control-1', docId: 'control-1-s2', stage2PublishedAt: 10 } as PublicReport;
    const event = { status: 'Approved', currentVersionId: 'v1' } as EventRecord;
    const control = { controlId: 'control-1', eventId: 'event-1', versionId: 'v1' } as EventControl;
    const stage2 = { docId: 'control-1-s2', m4TicketId: 'ticket-1', publishedAt: 10 } as Stage2Doc;
    expect(isCurrentM4ReportBinding(report, event, control, stage2)).toBe(true);
    expect(isCurrentM4ReportBinding(report, { ...event, status: 'Withdrawn' }, control, stage2)).toBe(false);
    expect(isCurrentM4ReportBinding(report, { ...event, currentVersionId: 'v2' }, control, stage2)).toBe(false);
    expect(isCurrentM4ReportBinding(report, event, control, { ...stage2, m4TicketId: 'other' })).toBe(false);
    expect(isCurrentM4ReportBinding(report, event, { ...control, eventId: 'other' }, stage2)).toBe(false);
  });
});
