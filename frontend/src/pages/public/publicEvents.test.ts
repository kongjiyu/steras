import { describe, expect, it } from 'vitest';
import { PublicEvent } from '@shared/types';
import { filterPublicEvents, groupPublicEventsByMonth, groupPublicEventsByPeriod } from './publicEvents';

const events: PublicEvent[] = [
  { eventId: 'b', versionId: 'v1', eventName: 'Penang Culture Week', venueName: 'George Town', eventType: 'cultural', startDatetime: new Date(2026, 7, 2).getTime(), endDatetime: new Date(2026, 7, 3).getTime(), approvedBy: ['PDRM'], publicStatus: 'approved' },
  { eventId: 'a', versionId: 'v1', eventName: 'Putrajaya Forum', venueName: 'PICC', eventType: 'conference', startDatetime: new Date(2026, 6, 2).getTime(), endDatetime: new Date(2026, 6, 2).getTime(), approvedBy: ['PDRM'], publicStatus: 'approved' },
];

describe('publicEvents', () => {
  it('searches names and venues, filters type, and sorts by start date', () => {
    expect(filterPublicEvents(events, { search: '', eventType: 'all', month: '' }).map((event) => event.eventId)).toEqual(['b', 'a']);
    expect(filterPublicEvents(events, { search: 'george', eventType: 'cultural', month: '' }).map((event) => event.eventId)).toEqual(['b']);
  });

  it('filters and groups by local calendar month', () => {
    const july = filterPublicEvents(events, { search: '', eventType: 'all', month: '2026-07' });
    expect(july.map((event) => event.eventId)).toEqual(['a']);
    expect(groupPublicEventsByMonth(filterPublicEvents(events, { search: '', eventType: 'all', month: '' })).map((group) => group.month)).toEqual(['2026-08', '2026-07']);
  });

  it('drops malformed dates instead of rendering an invalid public event', () => {
    const malformed = { ...events[0], eventId: 'broken', startDatetime: Number.NaN };
    expect(filterPublicEvents([...events, malformed], { search: '', eventType: 'all', month: '' })
      .map((event) => event.eventId)).toEqual(['b', 'a']);
    expect(groupPublicEventsByMonth([malformed])).toEqual([]);
  });

  it('separates present, future, and past events in that display order', () => {
    const now = new Date(2026, 6, 15, 12).getTime();
    const present = { ...events[0], eventId: 'present', startDatetime: now - 1_000, endDatetime: now + 1_000 };
    const future = { ...events[0], eventId: 'future', startDatetime: now + 2_000, endDatetime: now + 3_000 };
    const past = { ...events[0], eventId: 'past', startDatetime: now - 3_000, endDatetime: now - 2_000 };
    const periods = groupPublicEventsByPeriod([past, future, present], now);
    expect(periods.map((period) => period.id)).toEqual(['present', 'future', 'past']);
    expect(periods.map((period) => period.events.map((event) => event.eventId))).toEqual([['present'], ['future'], ['past']]);
  });
});
