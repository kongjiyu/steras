export const HOLIDAY_DATA_VERSION = 'bkpp-2026-v1';
export const HOLIDAY_SOURCE_URL = 'https://www.kabinet.gov.my/storage/2025/08/HKA-2026.pdf';
export const HOLIDAY_DATA_UPDATED_AT = Date.UTC(2026, 6, 13);

const HOLIDAYS = new Map<string, string>([
  ['2026-02-17', 'Chinese New Year'],
  ['2026-02-18', 'Chinese New Year'],
  ['2026-03-21', 'Hari Raya Aidilfitri'],
  ['2026-03-22', 'Hari Raya Aidilfitri'],
  ['2026-05-01', 'Labour Day'],
  ['2026-05-27', 'Hari Raya Qurban'],
  ['2026-05-31', 'Wesak Day'],
  ['2026-06-01', "Yang di-Pertuan Agong's Birthday"],
  ['2026-06-02', 'Replacement public holiday'],
  ['2026-06-17', 'Awal Muharam'],
  ['2026-08-25', 'Maulidur Rasul'],
  ['2026-08-31', 'National Day'],
  ['2026-09-16', 'Malaysia Day'],
  ['2026-11-08', 'Deepavali'],
  ['2026-12-25', 'Christmas Day'],
]);

export interface HolidayContext {
  isHolidayOrAdjacent: boolean;
  holidayName?: string;
  distanceDays?: -1 | 0 | 1;
  localDate: string;
  sourceVersion: string;
  sourceTimestamp: number;
}

export function getHolidayContext(epochMs: number): HolidayContext {
  validateTimestamp(epochMs);
  const localDate = malaysiaDate(epochMs);
  for (const distance of [0, -1, 1] as const) {
    const candidate = shiftIsoDate(localDate, distance);
    const holidayName = HOLIDAYS.get(candidate);
    if (holidayName) {
      return {
        isHolidayOrAdjacent: true,
        holidayName,
        distanceDays: distance,
        localDate,
        sourceVersion: HOLIDAY_DATA_VERSION,
        sourceTimestamp: HOLIDAY_DATA_UPDATED_AT,
      };
    }
  }
  return { isHolidayOrAdjacent: false, localDate, sourceVersion: HOLIDAY_DATA_VERSION, sourceTimestamp: HOLIDAY_DATA_UPDATED_AT };
}

export function isMalaysianPublicHoliday(epochMs: number): boolean {
  return getHolidayContext(epochMs).isHolidayOrAdjacent;
}

export function isWeekendDate(epochMs: number): boolean {
  validateTimestamp(epochMs);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kuala_Lumpur', weekday: 'short' }).format(epochMs);
  return weekday === 'Sat' || weekday === 'Sun';
}

function validateTimestamp(epochMs: number): void {
  if (!Number.isFinite(epochMs)) throw new Error('Holiday timestamp must be finite.');
}

function malaysiaDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(epochMs);
}

function shiftIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
