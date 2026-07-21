import { describe, expect, it } from 'vitest';
import { getHolidayContext, isWeekendDate } from './holidays';

describe('Malaysian holiday context', () => {
  it.each([
    ['2026-02-16T04:00:00+08:00', 1],
    ['2026-02-17T04:00:00+08:00', 0],
    ['2026-02-19T04:00:00+08:00', -1],
  ])('marks %s as on or adjacent to Chinese New Year', (date, distanceDays) => {
    expect(getHolidayContext(Date.parse(date))).toMatchObject({ isHolidayOrAdjacent: true, holidayName: 'Chinese New Year', distanceDays });
  });

  it('uses Malaysia local time at a UTC date boundary', () => {
    expect(getHolidayContext(Date.parse('2026-08-30T16:30:00Z')).localDate).toBe('2026-08-31');
    expect(isWeekendDate(Date.parse('2026-08-30T16:30:00Z'))).toBe(false);
  });

  it('rejects non-finite timestamps with a clear error', () => {
    expect(() => getHolidayContext(Number.NaN)).toThrow('Holiday timestamp must be finite.');
    expect(() => isWeekendDate(Number.POSITIVE_INFINITY)).toThrow('Holiday timestamp must be finite.');
  });
});
