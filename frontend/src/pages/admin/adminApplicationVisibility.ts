import type { EventRecord, EventStatus } from '@shared/types';

/** Admin workflows begin only after the organizer submits the application. */
export const ADMIN_VISIBLE_EVENT_STATUSES = [
  'Pending',
  'UnderReview',
  'Approved',
  'Rejected',
  'Withdrawn',
  'Manual Review Required',
] as const satisfies readonly EventStatus[];

export type AdminVisibleEventStatus = (typeof ADMIN_VISIBLE_EVENT_STATUSES)[number];

export function isAdminVisibleEvent(event: Pick<EventRecord, 'status'>): boolean {
  return (ADMIN_VISIBLE_EVENT_STATUSES as readonly EventStatus[]).includes(event.status);
}

export function adminStatusFromQuery(value: string | null): AdminVisibleEventStatus | 'all' {
  return value && (ADMIN_VISIBLE_EVENT_STATUSES as readonly string[]).includes(value)
    ? value as AdminVisibleEventStatus
    : 'all';
}
