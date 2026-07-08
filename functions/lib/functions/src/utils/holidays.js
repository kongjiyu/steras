"use strict";
/**
 * Malaysian public holiday detection.
 *
 * For prototype: hard-coded list of major holidays. For production, swap with
 * a maintained JSON file (e.g. sourced from gov.my) loaded at function init.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMalaysianPublicHoliday = isMalaysianPublicHoliday;
exports.isWeekendDate = isWeekendDate;
const HOLIDAYS_2026 = [
    '2026-01-01', // New Year's Day
    '2026-02-01', '2026-02-02', // Chinese New Year (placeholder dates — confirm with calendar)
    '2026-03-21', // Awal Ramadan (estimate)
    '2026-04-15', // Good Friday (estimate)
    '2026-05-01', // Labour Day
    '2026-05-31', // Wesak Day (estimate)
    '2026-06-01', // Agong's Birthday
    '2026-06-17', // Hari Raya Aidiladha (estimate)
    '2026-08-31', // Merdeka Day
    '2026-09-16', // Malaysia Day
    '2026-11-08', // Deepavali (estimate)
    '2026-12-25', // Christmas
];
const HOLIDAYS_2025 = [
    '2025-01-01', '2025-01-29', '2025-01-30', '2025-02-11',
    '2025-03-31', '2025-04-01', '2025-05-01', '2025-05-12',
    '2025-06-02', '2025-06-07', '2025-06-17', '2025-08-31',
    '2025-09-16', '2025-10-20', '2025-12-25',
];
const ALL_HOLIDAYS = new Set([...HOLIDAYS_2025, ...HOLIDAYS_2026]);
function isMalaysianPublicHoliday(epochMs) {
    const d = new Date(epochMs);
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    return ALL_HOLIDAYS.has(iso);
}
function isWeekendDate(epochMs) {
    const day = new Date(epochMs).getUTCDay();
    return day === 0 || day === 6;
}
//# sourceMappingURL=holidays.js.map