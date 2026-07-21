import { describe, expect, it } from 'vitest';
import { EventRecord } from '@shared/types';
import { filterAndSortQueue, pageCount } from './reviewQueueData';

function event(eventId: string, name: string, status: EventRecord['status'], createdAt: number, attendance: number): EventRecord {
  return {
    eventId, organizerId: 'organizer', status, currentVersionNumber: 1, draftDocumentPaths: [], requiredAuthorities: ['PDRM'], createdAt, updatedAt: createdAt,
    eventDetails: {
      name, type: 'conference', venueName: 'PICC', venueAddress: 'Putrajaya', venueCapacity: 2_000, expectedAttendance: attendance,
      environment: 'indoor', coverage: 'covered', seating: 'seated', startDatetime: createdAt + 10_000, endDatetime: createdAt + 20_000,
      emergencyPlanSummary: 'Plan', organizerName: 'Organizer', organizerEmail: 'private@example.com', organizerPhone: '+601',
    },
  };
}

const events = [event('1', 'Tourism Forum', 'Pending', 10, 500), event('2', 'Culture Expo', 'UnderReview', 20, 1_500)];

describe('reviewQueueData', () => {
  it('filters status and searches event metadata without contacts', () => {
    expect(filterAndSortQueue(events, 'UnderReview', 'culture', 'newest').map((item) => item.eventId)).toEqual(['2']);
    expect(filterAndSortQueue(events, 'all', 'private@example.com', 'newest')).toEqual([]);
  });

  it('supports deterministic attendance sorting and page counts', () => {
    expect(filterAndSortQueue(events, 'all', '', 'attendance').map((item) => item.eventId)).toEqual(['2', '1']);
    expect(pageCount(21, 10)).toBe(3);
    expect(pageCount(0, 10)).toBe(1);
  });

  it('returns a safe page count for invalid totals and page sizes', () => {
    expect(pageCount(-10, 10)).toBe(1);
    expect(pageCount(10, 0)).toBe(1);
    expect(pageCount(Number.NaN, 10)).toBe(1);
  });
});
