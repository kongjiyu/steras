import { EventRecord, EventStatus } from '@shared/types';

export type QueueSort = 'newest' | 'eventSoonest' | 'attendance';

export function filterAndSortQueue(
  events: EventRecord[],
  status: EventStatus | 'all',
  search: string,
  sort: QueueSort,
): EventRecord[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return events
    .filter((event) => status === 'all' || event.status === status)
    .filter((event) => !normalizedSearch || [event.eventDetails.name, event.eventDetails.venueName, event.eventDetails.type]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch)))
    .sort((left, right) => {
      if (sort === 'eventSoonest') return left.eventDetails.startDatetime - right.eventDetails.startDatetime;
      if (sort === 'attendance') return right.eventDetails.expectedAttendance - left.eventDetails.expectedAttendance;
      return right.createdAt - left.createdAt;
    });
}

export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(pageSize) || total < 0 || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
