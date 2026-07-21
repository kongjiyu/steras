import { PublicEvent } from '@shared/types';

export interface PublicEventFilters {
  search: string;
  eventType: string;
  month: string;
}

export function filterPublicEvents(events: PublicEvent[], filters: PublicEventFilters): PublicEvent[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return [...events]
    .filter(hasValidSchedule)
    .filter((event) => filters.eventType === 'all' || event.eventType === filters.eventType)
    .filter((event) => !filters.month || localMonth(event.startDatetime) === filters.month)
    .filter((event) => !search || `${event.eventName} ${event.venueName}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => a.startDatetime - b.startDatetime || a.eventName.localeCompare(b.eventName));
}

export function groupPublicEventsByMonth(events: PublicEvent[]): { month: string; events: PublicEvent[] }[] {
  const groups = new Map<string, PublicEvent[]>();
  events.filter(hasValidSchedule).forEach((event) => {
    const month = localMonth(event.startDatetime);
    groups.set(month, [...(groups.get(month) ?? []), event]);
  });
  return [...groups].map(([month, groupedEvents]) => ({ month, events: groupedEvents }));
}

function hasValidSchedule(event: PublicEvent): boolean {
  return Number.isFinite(event.startDatetime)
    && Number.isFinite(event.endDatetime)
    && event.endDatetime >= event.startDatetime;
}

function localMonth(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
