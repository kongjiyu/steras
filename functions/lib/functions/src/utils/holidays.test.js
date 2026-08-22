"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const holidays_1 = require("./holidays");
(0, vitest_1.describe)('Malaysian holiday context', () => {
    vitest_1.it.each([
        ['2026-02-16T04:00:00+08:00', 1],
        ['2026-02-17T04:00:00+08:00', 0],
        ['2026-02-19T04:00:00+08:00', -1],
    ])('marks %s as on or adjacent to Chinese New Year', (date, distanceDays) => {
        (0, vitest_1.expect)((0, holidays_1.getHolidayContext)(Date.parse(date))).toMatchObject({ isHolidayOrAdjacent: true, holidayName: 'Chinese New Year', distanceDays });
    });
    (0, vitest_1.it)('uses Malaysia local time at a UTC date boundary', () => {
        (0, vitest_1.expect)((0, holidays_1.getHolidayContext)(Date.parse('2026-08-30T16:30:00Z')).localDate).toBe('2026-08-31');
        (0, vitest_1.expect)((0, holidays_1.isWeekendDate)(Date.parse('2026-08-30T16:30:00Z'))).toBe(false);
    });
    (0, vitest_1.it)('rejects non-finite timestamps with a clear error', () => {
        (0, vitest_1.expect)(() => (0, holidays_1.getHolidayContext)(Number.NaN)).toThrow('Holiday timestamp must be finite.');
        (0, vitest_1.expect)(() => (0, holidays_1.isWeekendDate)(Number.POSITIVE_INFINITY)).toThrow('Holiday timestamp must be finite.');
    });
    (0, vitest_1.it)('marks years outside the versioned 2026 dataset as unsupported', () => {
        (0, vitest_1.expect)((0, holidays_1.getCalendarContext)(Date.parse('2027-08-31T12:00:00+08:00'))).toMatchObject({
            coverageStatus: 'unsupported_year',
            isHolidayOrAdjacent: false,
        });
    });
});
//# sourceMappingURL=holidays.test.js.map