/**
 * Event daily operating hours + activity timeline.
 *
 * Per `template content.md` §A.5 + §C.1, the organiser must specify
 * (a) daily operating hours and (b) a complete event programme. M1
 * collects this on the form; M3 sees it during review.
 *
 * Local type — promote to `@shared/types.ts` when the contract is locked.
 */

import { EVENT_IDS, daysAhead } from './ids';

export interface DailyOperatingHours {
  /** ISO date string YYYY-MM-DD (local). */
  date: string;
  /** HH:MM (24h, local). */
  opensAt: string;
  /** HH:MM (24h, local). */
  closesAt: string;
  /** Optional note (e.g. "Public access from 18:00", "VIP only 14:00-16:00"). */
  note?: string;
}

export interface ScheduleActivity {
  /** Sort order within the day (1 = opening). */
  order: number;
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
  activity: string;
  location: string;
  estimatedAttendance: number;
  responsiblePerson: string;
}

export interface EventSchedule {
  eventId: string;
  versionId: string;
  dailyHours: DailyOperatingHours[];
  activities: ScheduleActivity[];
}

const toLocalDate = (timestamp: number): string => {
  const d = new Date(timestamp);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const mkSchedule = (eventId: string, versionId: string, startTs: number, endTs: number, hours: { open: string; close: string; note?: string }[], activities: Omit<ScheduleActivity, 'order'>[]): EventSchedule => {
  // Compute per-day hours by distributing hours[] across the date range.
  const dayCount = Math.max(1, Math.round((endTs - startTs) / (24 * 60 * 60 * 1000)) + 1);
  const dailyHours: DailyOperatingHours[] = [];
  for (let i = 0; i < dayCount; i++) {
    const ts = startTs + i * 24 * 60 * 60 * 1000;
    const h = hours[i] ?? hours[hours.length - 1];
    dailyHours.push({ date: toLocalDate(ts), opensAt: h.open, closesAt: h.close, note: h.note });
  }
  return {
    eventId, versionId,
    dailyHours,
    activities: activities.map((a, i) => ({ ...a, order: i + 1 })),
  };
};

// ---------------------------------------------------------------------------
// Per-event schedules
// ---------------------------------------------------------------------------
export const mockEventSchedules: EventSchedule[] = [
  // E001 - Music Festival - 2 days, 16:00-00:00
  mkSchedule(EVENT_IDS.E001, 'v1',
    daysAhead(75), daysAhead(75) + 8 * 60 * 60 * 1000,
    [
      { open: '14:00', close: '23:00', note: 'Doors open 14:00. Headline act 21:00-23:00.' },
      { open: '14:00', close: '23:00', note: 'Doors open 14:00. Headline act 21:00-23:00.' },
    ],
    [
      { startTime: '14:00', endTime: '15:00', activity: 'Doors open + security screening',     location: 'Main gate (A)', estimatedAttendance: 1500, responsiblePerson: 'Steward Lead' },
      { startTime: '15:00', endTime: '17:00', activity: 'Opening act 1',                       location: 'Main stage',     estimatedAttendance: 5000, responsiblePerson: 'Stage Manager' },
      { startTime: '17:00', endTime: '18:00', activity: 'Food & beverage service',            location: 'F&B zone',       estimatedAttendance: 4000, responsiblePerson: 'F&B Coordinator' },
      { startTime: '18:00', endTime: '20:00', activity: 'Opening act 2',                       location: 'Main stage',     estimatedAttendance: 9000, responsiblePerson: 'Stage Manager' },
      { startTime: '20:00', endTime: '21:00', activity: 'Stage changeover + safety sweep',    location: 'Main stage',     estimatedAttendance: 12000, responsiblePerson: 'Safety Coordinator' },
      { startTime: '21:00', endTime: '23:00', activity: 'Headline act',                       location: 'Main stage',     estimatedAttendance: 15000, responsiblePerson: 'Stage Manager' },
      { startTime: '23:00', endTime: '23:30', activity: 'Crowd dispersal',                    location: 'All exits',      estimatedAttendance: 15000, responsiblePerson: 'PDRM + Stewards' },
    ]
  ),

  // E002 - PJ Food Fair - 1 day, 10:00-22:00
  mkSchedule(EVENT_IDS.E002, 'v1',
    daysAhead(45), daysAhead(45) + 6 * 60 * 60 * 1000,
    [{ open: '10:00', close: '22:00', note: 'Public access all day. Last food orders 21:30.' }],
    [
      { startTime: '08:00', endTime: '10:00', activity: 'Vendor setup + health inspection',    location: 'F&B zone',  estimatedAttendance: 200,  responsiblePerson: 'F&B Coordinator' },
      { startTime: '10:00', endTime: '13:00', activity: 'Lunch service (Phase 1)',             location: 'F&B zone',  estimatedAttendance: 3000, responsiblePerson: 'F&B Coordinator' },
      { startTime: '13:00', endTime: '15:00', activity: 'Cooking demonstration',               location: 'Demo stage', estimatedAttendance: 800,  responsiblePerson: 'Programme Lead' },
      { startTime: '15:00', endTime: '18:00', activity: 'Afternoon service + cultural show',   location: 'Both zones', estimatedAttendance: 2500, responsiblePerson: 'Programme Lead' },
      { startTime: '18:00', endTime: '21:00', activity: 'Dinner service (Phase 2)',            location: 'F&B zone',  estimatedAttendance: 4500, responsiblePerson: 'F&B Coordinator' },
      { startTime: '21:00', endTime: '22:00', activity: 'Cleanup + breakdown',                 location: 'All zones',  estimatedAttendance: 80,   responsiblePerson: 'Cleaning Lead' },
    ]
  ),

  // E003 - KLCC Skyrun - 1 day, staggered start
  mkSchedule(EVENT_IDS.E003, 'v1',
    daysAhead(60), daysAhead(60) + 4 * 60 * 60 * 1000,
    [{ open: '06:00', close: '12:00', note: 'Staggered wave start 06:30. Awards 11:00.' }],
    [
      { startTime: '05:00', endTime: '06:00', activity: 'Registration + warm-up',            location: 'Lobby',       estimatedAttendance: 800, responsiblePerson: 'Race Director' },
      { startTime: '06:00', endTime: '06:30', activity: 'Safety briefing',                   location: 'Lobby',       estimatedAttendance: 800, responsiblePerson: 'Safety Coordinator' },
      { startTime: '06:30', endTime: '08:30', activity: 'Wave starts (staggered)',            location: 'Stairwell',   estimatedAttendance: 800, responsiblePerson: 'Race Director' },
      { startTime: '08:30', endTime: '11:00', activity: 'Awards + medical check-out',         location: 'Lobby',       estimatedAttendance: 800, responsiblePerson: 'Race Director' },
      { startTime: '11:00', endTime: '12:00', activity: 'Venue reset + handover',            location: 'KLCC',        estimatedAttendance: 50,  responsiblePerson: 'Venue Coordinator' },
    ]
  ),

  // E004 - KL Marathon - 1 day, 05:00-12:00
  mkSchedule(EVENT_IDS.E004, 'v1',
    daysAhead(50), daysAhead(50) + 7 * 60 * 60 * 1000,
    [{ open: '05:00', close: '12:00', note: 'Multiple road closures 04:30-13:00. 25,000 participants across waves.' }],
    [
      { startTime: '04:00', endTime: '05:00', activity: 'Road closure deployment',          location: '42km route', estimatedAttendance: 0,    responsiblePerson: 'PDRM traffic' },
      { startTime: '05:00', endTime: '06:00', activity: 'Elite wave start',                 location: 'Start line', estimatedAttendance: 500,  responsiblePerson: 'Race Director' },
      { startTime: '06:00', endTime: '08:00', activity: 'Mass start waves',                  location: 'Start line', estimatedAttendance: 24500, responsiblePerson: 'Race Director' },
      { startTime: '08:00', endTime: '10:00', activity: 'Mid-route medical stations open',  location: '5 checkpoints', estimatedAttendance: 20000, responsiblePerson: 'KKM Lead' },
      { startTime: '10:00', endTime: '12:00', activity: 'Finish line + recovery',           location: 'Finish line', estimatedAttendance: 8000, responsiblePerson: 'Race Director' },
      { startTime: '12:00', endTime: '13:00', activity: 'Road reopening',                    location: '42km route', estimatedAttendance: 0,    responsiblePerson: 'PDRM traffic' },
    ]
  ),

  // E005 - Shah Alam Beach Carnival - 1 day
  mkSchedule(EVENT_IDS.E005, 'v1',
    daysAhead(90), daysAhead(90) + 6 * 60 * 60 * 1000,
    [{ open: '10:00', close: '22:00', note: 'Family-friendly daytime; live acts evening.' }],
    [
      { startTime: '08:00', endTime: '10:00', activity: 'Vendor + ride setup',               location: 'Carnival grounds', estimatedAttendance: 100, responsiblePerson: 'Site Manager' },
      { startTime: '10:00', endTime: '14:00', activity: 'Daytime family activities',          location: 'Family zone',  estimatedAttendance: 5000, responsiblePerson: 'Programme Lead' },
      { startTime: '14:00', endTime: '17:00', activity: 'Water activities + beach games',     location: 'Beach area',  estimatedAttendance: 3000, responsiblePerson: 'Activities Lead' },
      { startTime: '17:00', endTime: '19:00', activity: 'Live band + food service',           location: 'Stage zone',  estimatedAttendance: 6000, responsiblePerson: 'Stage Manager' },
      { startTime: '19:00', endTime: '21:00', activity: 'Headline act',                       location: 'Main stage',  estimatedAttendance: 8000, responsiblePerson: 'Stage Manager' },
      { startTime: '21:00', endTime: '22:00', activity: 'Crowd dispersal + cleanup',          location: 'All zones',   estimatedAttendance: 8000, responsiblePerson: 'Site Manager' },
    ]
  ),

  // E006 - KL Tech Conference - 2 days, 09:00-18:00
  mkSchedule(EVENT_IDS.E006, 'v1',
    daysAhead(20), daysAhead(20) + 8 * 60 * 60 * 1000,
    [
      { open: '09:00', close: '18:00', note: 'Registration 08:30.' },
      { open: '09:00', close: '17:00', note: 'Closing 17:00.' },
    ],
    [
      { startTime: '08:30', endTime: '09:00', activity: 'Registration + coffee',              location: 'Lobby',      estimatedAttendance: 1500, responsiblePerson: 'Conference Lead' },
      { startTime: '09:00', endTime: '10:00', activity: 'Keynote address',                     location: 'Hall A',     estimatedAttendance: 3000, responsiblePerson: 'Conference Lead' },
      { startTime: '10:00', endTime: '12:00', activity: 'Parallel sessions + expo open',      location: 'Halls A-C',  estimatedAttendance: 2500, responsiblePerson: 'Programme Lead' },
      { startTime: '12:00', endTime: '13:00', activity: 'Lunch + networking',                  location: 'F&B + Expo', estimatedAttendance: 3000, responsiblePerson: 'F&B Lead' },
      { startTime: '13:00', endTime: '17:00', activity: 'Workshops + panel discussions',      location: 'Halls A-C',  estimatedAttendance: 1500, responsiblePerson: 'Programme Lead' },
      { startTime: '17:00', endTime: '18:00', activity: 'Networking reception',                location: 'Foyer',      estimatedAttendance: 1500, responsiblePerson: 'Conference Lead' },
    ]
  ),

  // E007 - KL Cultural Night - 1 day, 19:00-22:00
  mkSchedule(EVENT_IDS.E007, 'v1',
    daysAhead(30), daysAhead(30) + 3 * 60 * 60 * 1000,
    [{ open: '19:00', close: '22:00', note: 'Gates open 18:30. Cultural showcase.' }],
    [
      { startTime: '17:00', endTime: '18:30', activity: 'Backstage setup + sound check',  location: 'Main stage', estimatedAttendance: 50,  responsiblePerson: 'Stage Manager' },
      { startTime: '18:30', endTime: '19:00', activity: 'Doors open + security screening', location: 'Main lobby', estimatedAttendance: 200, responsiblePerson: 'Steward Lead' },
      { startTime: '19:00', endTime: '20:00', activity: 'Malay traditional dance',         location: 'Main stage', estimatedAttendance: 1500, responsiblePerson: 'Programme Lead' },
      { startTime: '20:00', endTime: '21:00', activity: 'Chinese cultural showcase',        location: 'Main stage', estimatedAttendance: 1800, responsiblePerson: 'Programme Lead' },
      { startTime: '21:00', endTime: '22:00', activity: 'Indian classical performance',     location: 'Main stage', estimatedAttendance: 2000, responsiblePerson: 'Programme Lead' },
      { startTime: '22:00', endTime: '22:30', activity: 'Crowd dispersal + cleanup',       location: 'All areas',  estimatedAttendance: 2000, responsiblePerson: 'Steward Lead' },
    ]
  ),

  // E008 - Shah Alam Adventure Race - 1 day, multi-discipline
  mkSchedule(EVENT_IDS.E008, 'v1',
    daysAhead(40), daysAhead(40) + 5 * 60 * 60 * 1000,
    [{ open: '07:00', close: '15:00', note: '3 staggered waves; 5 disciplines.' }],
    [
      { startTime: '06:00', endTime: '07:00', activity: 'Check-in + equipment inspection', location: 'Start area',  estimatedAttendance: 1200, responsiblePerson: 'Race Director' },
      { startTime: '07:00', endTime: '07:30', activity: 'Wave 1 start (trail run)',         location: 'Trail start', estimatedAttendance: 400,  responsiblePerson: 'Race Director' },
      { startTime: '08:00', endTime: '08:30', activity: 'Wave 2 start (trail run)',         location: 'Trail start', estimatedAttendance: 400,  responsiblePerson: 'Race Director' },
      { startTime: '09:00', endTime: '09:30', activity: 'Wave 3 start (trail run)',         location: 'Trail start', estimatedAttendance: 400,  responsiblePerson: 'Race Director' },
      { startTime: '10:00', endTime: '12:00', activity: 'Kayak + cycling stages',           location: 'Multi-route', estimatedAttendance: 1000, responsiblePerson: 'Race Director' },
      { startTime: '12:00', endTime: '14:00', activity: 'Obstacle + final stage',           location: 'Obstacle course', estimatedAttendance: 800, responsiblePerson: 'Race Director' },
      { startTime: '14:00', endTime: '15:00', activity: 'Awards + medical check-out',       location: 'Finish area', estimatedAttendance: 1100, responsiblePerson: 'Race Director' },
    ]
  ),

  // E009 - PJ Community Fair - 1 day
  mkSchedule(EVENT_IDS.E009, 'v1',
    daysAhead(25), daysAhead(25) + 5 * 60 * 60 * 1000,
    [{ open: '10:00', close: '17:00', note: 'Family-friendly daytime event.' }],
    [
      { startTime: '08:00', endTime: '10:00', activity: 'Vendor setup + council inspection', location: 'F&B + Booth zones', estimatedAttendance: 80,  responsiblePerson: 'Community Lead' },
      { startTime: '10:00', endTime: '12:00', activity: 'Free health screening',              location: 'Health zone',  estimatedAttendance: 400, responsiblePerson: 'Health Coordinator' },
      { startTime: '12:00', endTime: '14:00', activity: 'Family activities + lunch',          location: 'Activity zone', estimatedAttendance: 1200, responsiblePerson: 'Programme Lead' },
      { startTime: '14:00', endTime: '16:00', activity: 'Government services showcase',       location: 'Booth zone',  estimatedAttendance: 800, responsiblePerson: 'Council Lead' },
      { startTime: '16:00', endTime: '17:00', activity: 'Closing + cleanup',                   location: 'All zones',   estimatedAttendance: 200, responsiblePerson: 'Cleaning Lead' },
    ]
  ),

  // E010 - KL Night Market - 1 day
  mkSchedule(EVENT_IDS.E010, 'v2',
    daysAhead(65), daysAhead(65) + 4 * 60 * 60 * 1000,
    [{ open: '18:00', close: '22:00', note: 'Evening night market. Free entry.' }],
    [
      { startTime: '14:00', endTime: '17:00', activity: 'Vendor setup + power check',        location: 'Market zone', estimatedAttendance: 80,  responsiblePerson: 'Market Manager' },
      { startTime: '17:00', endTime: '18:00', activity: 'Steward briefing + final safety walk', location: 'Market zone', estimatedAttendance: 30, responsiblePerson: 'Safety Coordinator' },
      { startTime: '18:00', endTime: '20:00', activity: 'Market open (early)',                 location: 'Market zone', estimatedAttendance: 2000, responsiblePerson: 'Market Manager' },
      { startTime: '20:00', endTime: '22:00', activity: 'Market open (peak) + live music',    location: 'Market zone', estimatedAttendance: 4000, responsiblePerson: 'Programme Lead' },
      { startTime: '22:00', endTime: '23:00', activity: 'Cleanup + vendor breakdown',         location: 'Market zone', estimatedAttendance: 80,  responsiblePerson: 'Cleaning Lead' },
    ]
  ),

  // E011 - KL Corporate Run - 1 day
  mkSchedule(EVENT_IDS.E011, 'v1',
    daysAhead(35), daysAhead(35) + 4 * 60 * 60 * 1000,
    [{ open: '06:30', close: '11:00', note: 'Parliament session at 10:00 - road closures coordinated.' }],
    [
      { startTime: '05:00', endTime: '06:00', activity: 'Road closure deployment',          location: '5km route',   estimatedAttendance: 0,    responsiblePerson: 'PDRM traffic' },
      { startTime: '06:00', endTime: '06:30', activity: 'Registration + warm-up',           location: 'Start line',  estimatedAttendance: 5000, responsiblePerson: 'Race Director' },
      { startTime: '06:30', endTime: '07:00', activity: 'Elite + corporate wave start',     location: 'Start line',  estimatedAttendance: 1000, responsiblePerson: 'Race Director' },
      { startTime: '07:00', endTime: '08:30', activity: 'Open wave start',                   location: 'Start line',  estimatedAttendance: 4000, responsiblePerson: 'Race Director' },
      { startTime: '08:30', endTime: '10:30', activity: 'Finish + awards',                    location: 'Finish line', estimatedAttendance: 4500, responsiblePerson: 'Race Director' },
      { startTime: '10:30', endTime: '11:00', activity: 'Road reopening',                     location: '5km route',   estimatedAttendance: 0,    responsiblePerson: 'PDRM traffic' },
    ]
  ),

  // E012 - KL World Tour Concert - 1 day, 18:00-23:00
  mkSchedule(EVENT_IDS.E012, 'v1',
    daysAhead(80), daysAhead(80) + 5 * 60 * 60 * 1000,
    [{ open: '18:00', close: '23:00', note: 'Pyrotechnics 21:00-21:15. High-density event.' }],
    [
      { startTime: '12:00', endTime: '15:00', activity: 'Stage build + sound check',         location: 'Main stage',  estimatedAttendance: 200, responsiblePerson: 'Stage Manager' },
      { startTime: '15:00', endTime: '17:00', activity: 'Steward briefing + safety walk',   location: 'Bowl + F&B', estimatedAttendance: 100, responsiblePerson: 'Safety Coordinator' },
      { startTime: '17:00', endTime: '18:00', activity: 'Doors open + security screening',  location: 'All gates',  estimatedAttendance: 8000, responsiblePerson: 'Steward Lead' },
      { startTime: '18:00', endTime: '20:00', activity: 'Opening act + pre-show',             location: 'Main stage', estimatedAttendance: 18000, responsiblePerson: 'Stage Manager' },
      { startTime: '20:00', endTime: '20:45', activity: 'Stage changeover + safety sweep',   location: 'Main stage', estimatedAttendance: 20000, responsiblePerson: 'Safety Coordinator' },
      { startTime: '20:45', endTime: '21:00', activity: 'Pyrotechnic safety countdown',      location: 'Main stage', estimatedAttendance: 20000, responsiblePerson: 'Pyrotechnics Officer' },
      { startTime: '21:00', endTime: '21:15', activity: 'Pyrotechnics display',                location: 'Main stage', estimatedAttendance: 20000, responsiblePerson: 'Pyrotechnics Officer' },
      { startTime: '21:15', endTime: '23:00', activity: 'Headline act',                       location: 'Main stage', estimatedAttendance: 20000, responsiblePerson: 'Stage Manager' },
      { startTime: '23:00', endTime: '00:00', activity: 'Crowd dispersal + cleanup',          location: 'All areas',  estimatedAttendance: 20000, responsiblePerson: 'Steward Lead' },
    ]
  ),

  // E013 - KL Coastal Cleanup - 1 day
  mkSchedule(EVENT_IDS.E013, 'v1',
    daysAhead(-5), daysAhead(-5) + 3 * 60 * 60 * 1000,
    [{ open: '08:00', close: '17:00', note: 'Past event - reporting for M4 incident flow.' }],
    [
      { startTime: '07:00', endTime: '08:00', activity: 'Registration + briefing',           location: 'Booth area',  estimatedAttendance: 100, responsiblePerson: 'Community Lead' },
      { startTime: '08:00', endTime: '12:00', activity: 'Cleanup activity (morning)',         location: 'Beach area',  estimatedAttendance: 500, responsiblePerson: 'Activities Lead' },
      { startTime: '12:00', endTime: '13:00', activity: 'Lunch + briefing',                    location: 'Booth area',  estimatedAttendance: 600, responsiblePerson: 'F&B Coordinator' },
      { startTime: '13:00', endTime: '16:00', activity: 'Recycling + sorting station',         location: 'Sorting zone', estimatedAttendance: 400, responsiblePerson: 'Recycling Lead' },
      { startTime: '16:00', endTime: '17:00', activity: 'Closing + group photo',               location: 'Booth area',  estimatedAttendance: 600, responsiblePerson: 'Community Lead' },
    ]
  ),

  // E014 - Shah Alam Music Fest - 2 days
  mkSchedule(EVENT_IDS.E014, 'v1',
    daysAhead(-15), daysAhead(-15) + 6 * 60 * 60 * 1000,
    [
      { open: '15:00', close: '23:00', note: 'Public access from 15:00. Last entry 22:00.' },
      { open: '14:00', close: '22:00', note: 'Earlier close on day 2.' },
    ],
    [
      { startTime: '12:00', endTime: '14:00', activity: 'Stage + F&B setup',                   location: 'Festival grounds', estimatedAttendance: 200, responsiblePerson: 'Site Manager' },
      { startTime: '14:00', endTime: '15:00', activity: 'Final safety walk + steward briefing', location: 'Festival grounds', estimatedAttendance: 100, responsiblePerson: 'Safety Coordinator' },
      { startTime: '15:00', endTime: '17:00', activity: 'Opening + local bands',                location: 'Main stage',  estimatedAttendance: 6000, responsiblePerson: 'Stage Manager' },
      { startTime: '17:00', endTime: '19:00', activity: 'Dinner + supporting acts',            location: 'F&B zone',   estimatedAttendance: 8000, responsiblePerson: 'F&B Lead' },
      { startTime: '19:00', endTime: '21:00', activity: 'Headline act (day 1)',                 location: 'Main stage',  estimatedAttendance: 10000, responsiblePerson: 'Stage Manager' },
      { startTime: '21:00', endTime: '22:00', activity: 'Crowd dispersal (day 1)',              location: 'All exits',  estimatedAttendance: 10000, responsiblePerson: 'PDRM + Stewards' },
      { startTime: '14:00', endTime: '16:00', activity: 'Day 2 opening + family zone',          location: 'Family zone', estimatedAttendance: 4000, responsiblePerson: 'Programme Lead' },
      { startTime: '16:00', endTime: '19:00', activity: 'Day 2 evening build-up',               location: 'Main stage',  estimatedAttendance: 7000, responsiblePerson: 'Stage Manager' },
      { startTime: '19:00', endTime: '22:00', activity: 'Day 2 headline + closing',             location: 'Main stage',  estimatedAttendance: 9000, responsiblePerson: 'Stage Manager' },
    ]
  ),

  // E015 - KL Charity Run - 1 day
  mkSchedule(EVENT_IDS.E015, 'v1',
    daysAhead(-20), daysAhead(-20) + 4 * 60 * 60 * 1000,
    [{ open: '06:00', close: '11:00', note: 'Fundraiser for local hospital.' }],
    [
      { startTime: '05:00', endTime: '06:00', activity: 'Road closure deployment',          location: '5km route',   estimatedAttendance: 0,    responsiblePerson: 'PDRM traffic' },
      { startTime: '06:00', endTime: '06:30', activity: 'Registration + warm-up',           location: 'Start line',  estimatedAttendance: 3000, responsiblePerson: 'Race Director' },
      { startTime: '06:30', endTime: '07:30', activity: 'Wave start',                        location: 'Start line',  estimatedAttendance: 3000, responsiblePerson: 'Race Director' },
      { startTime: '07:30', endTime: '10:30', activity: 'Finish + awards + fund draw',      location: 'Finish line', estimatedAttendance: 2500, responsiblePerson: 'Race Director' },
      { startTime: '10:30', endTime: '11:00', activity: 'Road reopening',                     location: '5km route',   estimatedAttendance: 0,    responsiblePerson: 'PDRM traffic' },
    ]
  ),

  // E016 - Axiata Music Fest - 1 day, indoor
  mkSchedule(EVENT_IDS.E016, 'v1',
    daysAhead(55), daysAhead(55) + 4 * 60 * 60 * 1000,
    [{ open: '18:00', close: '22:00', note: 'Indoor arena. Multiple genres.' }],
    [
      { startTime: '14:00', endTime: '16:00', activity: 'Stage + sound check',                location: 'Main stage',  estimatedAttendance: 50,  responsiblePerson: 'Stage Manager' },
      { startTime: '16:00', endTime: '17:00', activity: 'Doors open + security screening',  location: 'Main lobby',  estimatedAttendance: 1500, responsiblePerson: 'Steward Lead' },
      { startTime: '17:00', endTime: '18:00', activity: 'Opening act 1',                       location: 'Main stage',  estimatedAttendance: 2500, responsiblePerson: 'Stage Manager' },
      { startTime: '18:00', endTime: '19:00', activity: 'Opening act 2',                       location: 'Main stage',  estimatedAttendance: 3000, responsiblePerson: 'Stage Manager' },
      { startTime: '19:00', endTime: '20:00', activity: 'Intermission + food service',         location: 'F&B + arena', estimatedAttendance: 3500, responsiblePerson: 'F&B Lead' },
      { startTime: '20:00', endTime: '22:00', activity: 'Headline act',                        location: 'Main stage',  estimatedAttendance: 4000, responsiblePerson: 'Stage Manager' },
      { startTime: '22:00', endTime: '22:30', activity: 'Crowd dispersal',                     location: 'All exits',   estimatedAttendance: 4000, responsiblePerson: 'Steward Lead' },
    ]
  ),

  // E017 - PJ Wedding Expo - 2 days, indoor
  mkSchedule(EVENT_IDS.E017, 'v1',
    daysAhead(120), daysAhead(120) + 6 * 60 * 60 * 1000,
    [
      { open: '10:00', close: '20:00', note: 'Trade show + fashion show.' },
      { open: '10:00', close: '18:00', note: 'Final day.' },
    ],
    [
      { startTime: '08:00', endTime: '10:00', activity: 'Vendor booth setup',                  location: 'Booth area',  estimatedAttendance: 100, responsiblePerson: 'Expo Lead' },
      { startTime: '10:00', endTime: '12:00', activity: 'Doors open + vendor showcase',         location: 'Booth area',  estimatedAttendance: 800, responsiblePerson: 'Expo Lead' },
      { startTime: '12:00', endTime: '14:00', activity: 'Lunch + networking',                    location: 'F&B + booths', estimatedAttendance: 1000, responsiblePerson: 'F&B Lead' },
      { startTime: '14:00', endTime: '16:00', activity: 'Fashion show (runway)',                 location: 'Runway stage', estimatedAttendance: 1500, responsiblePerson: 'Programme Lead' },
      { startTime: '16:00', endTime: '18:00', activity: 'Vendor showcase + cake tasting',        location: 'Booth area',  estimatedAttendance: 1200, responsiblePerson: 'Programme Lead' },
      { startTime: '18:00', endTime: '20:00', activity: 'Evening networking + lucky draw',       location: 'Booth area',  estimatedAttendance: 1500, responsiblePerson: 'Expo Lead' },
    ]
  ),
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const findScheduleForEvent = (eventId: string, versionId: string = 'v1'): EventSchedule | undefined =>
  mockEventSchedules.find((s) => s.eventId === eventId && s.versionId === versionId);

export const totalActivitiesForEvent = (eventId: string, versionId: string = 'v1'): number =>
  findScheduleForEvent(eventId, versionId)?.activities.length ?? 0;
