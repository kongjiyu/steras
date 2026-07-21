import { describe, expect, it } from 'vitest';
import { AnalyticsRecord, analyticsCsv, analyticsSummary, buildMonthlyAnalytics, filterAnalyticsRecords } from './analyticsData';

const records: AnalyticsRecord[] = [
  { eventId: 'one', eventName: '=Unsafe name', eventType: 'conference', status: 'Approved', createdAt: Date.UTC(2026, 0, 2), submittedAt: Date.UTC(2026, 0, 3), updatedAt: Date.UTC(2026, 1, 3) },
  { eventId: 'two', eventName: 'Second', eventType: 'festival', status: 'Pending', createdAt: Date.UTC(2026, 1, 2), updatedAt: Date.UTC(2026, 1, 2) },
];

describe('analyticsData', () => {
  it('groups applications and approvals by their respective months', () => {
    expect(buildMonthlyAnalytics(records)).toMatchObject([
      { month: '2026-01', applications: 1, approvals: 0 },
      { month: '2026-02', applications: 1, approvals: 1 },
    ]);
  });

  it('filters inclusively by local calendar dates', () => {
    expect(filterAnalyticsRecords(records, '2026-02-01', '2026-02-28').map((record) => record.eventId)).toEqual(['two']);
  });

  it('keeps exports PII-free and neutralizes spreadsheet formulas', () => {
    const csv = analyticsCsv(records);
    expect(csv).toContain("'=Unsafe name");
    expect(csv).not.toContain('organizer_email');
    expect(csv).not.toContain('phone');
  });

  it('summarizes approval counts without dividing by zero', () => {
    expect(analyticsSummary(records)).toMatchObject({ applications: 2, approved: 1, averageAdjustment: 0, fallbackRate: 0 });
  });

  it('handles malformed timestamps without crashing CSV or monthly analytics', () => {
    const malformed = { ...records[0], eventId: 'broken', createdAt: Number.NaN, updatedAt: Number.NaN };
    expect(() => analyticsCsv([malformed])).not.toThrow();
    expect(buildMonthlyAnalytics([malformed])).toEqual([]);
  });

  it('rejects invalid and reversed date ranges predictably', () => {
    expect(filterAnalyticsRecords(records, 'not-a-date', '2026-02-28')).toEqual([]);
    expect(filterAnalyticsRecords(records, '2026-03-01', '2026-02-01')).toEqual([]);
  });
});
