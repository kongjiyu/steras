import { describe, expect, it } from 'vitest';
import type { EventRecord } from '@shared/types';
import { assertEventReportableAt } from './eventWindow';

const DAY = 86_400_000;

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    status: 'Approved',
    eventDetails: { startDatetime: 1_000, endDatetime: 2_000 },
    ...overrides,
  } as EventRecord;
}

describe('assertEventReportableAt', () => {
  it('accepts an ongoing event and the seven-day post-event reporting window', () => {
    expect(() => assertEventReportableAt(event(), 1_500)).not.toThrow();
    expect(() => assertEventReportableAt(event(), 2_000 + 7 * DAY)).not.toThrow();
  });

  it('rejects pre-event, expired, and non-approved events', () => {
    expect(() => assertEventReportableAt(event(), 999)).toThrow(/ongoing events/i);
    expect(() => assertEventReportableAt(event(), 2_000 + 7 * DAY + 1)).toThrow(/ongoing events/i);
    expect(() => assertEventReportableAt(event({ status: 'Pending' }), 1_500)).toThrow(/ongoing events/i);
  });
});
