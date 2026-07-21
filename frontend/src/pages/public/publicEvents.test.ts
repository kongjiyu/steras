import { describe, expect, it } from 'vitest';
import { PublicEvent } from '@shared/types';
import { filterPublicEvents, groupPublicEventsByMonth } from './publicEvents';

const events: PublicEvent[] = [
  { eventId: 'b', versionId: 'v1', eventName: 'Penang Culture Week', venueName: 'George Town', eventType: 'cultural', startDatetime: new Date(2026, 7, 2).getTime(), endDatetime: new Date(2026, 7, 3).getTime(), approvedBy: ['PDRM'], publicStatus: 'approved' },
  { eventId: 'a', versionId: 'v1', eventName: 'Putrajaya Forum', venueName: 'PICC', eventType: 'conference', startDatetime: new Date(2026, 6, 2).getTime(), endDatetime: new Date(2026, 6, 2).getTime(), approvedBy: ['PDRM'], publicStatus: 'approved' },
];

describe('publicEvents', () => {
  it('searches names and venues, filters type, and sorts by start date', () => {
    expect(filterPublicEvents(events, { search: '', eventType: 'all', month: '' }).map((event) => event.eventId)).toEqual(['a', 'b']);
    expect(filterPublicEvents(events, { search: 'george', eventType: 'cultural', month: '' }).map((event) => event.eventId)).toEqual(['b']);
  });

  it('filters and groups by local calendar month', () => {
    const july = filterPublicEvents(events, { search: '', eventType: 'all', month: '2026-07' });
    expect(july.map((event) => event.eventId)).toEqual(['a']);
    expect(groupPublicEventsByMonth(filterPublicEvents(events, { search: '', eventType: 'all', month: '' })).map((group) => group.month)).toEqual(['2026-07', '2026-08']);
  });

  it('drops malformed dates instead of rendering an invalid public event', () => {
    const malformed = { ...events[0], eventId: 'broken', startDatetime: Number.NaN };
    expect(filterPublicEvents([...events, malformed], { search: '', eventType: 'all', month: '' })
      .map((event) => event.eventId)).toEqual(['a', 'b']);
    expect(groupPublicEventsByMonth([malformed])).toEqual([]);
  });
});
