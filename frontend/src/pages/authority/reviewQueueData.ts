import { Assignment, DecisionValue, EventRecord, EventStatus } from '@shared/types';

export type QueueSort = 'newest' | 'eventSoonest' | 'attendance';
export type QueueFilter = 'all' | 'pending' | 'decided' | 'documentation';

export interface AuthorityQueueRow {
  event: EventRecord;
  assignment?: Pick<Assignment, 'status' | 'decision' | 'versionId' | 'authorityType'>;
  stage1PendingCount?: number;
  action: 'review' | 'amend' | 'documentation' | 'view';
  decision?: DecisionValue;
}

export function authorityQueueAction(row: Pick<AuthorityQueueRow, 'event' | 'assignment'> & { stage1PendingCount?: number }): AuthorityQueueRow['action'] {
  if (row.event.status === 'Approved' && (row.stage1PendingCount ?? 0) > 0) return 'documentation';
  const amendmentWindow = row.event.status === 'UnderReview'
    && (row.event.reviewStage === 'authority' || row.event.reviewStage === 'second')
    && !row.event.secondReview;
  if (!amendmentWindow) return 'view';
  if (row.assignment?.status === 'completed' && row.assignment.decision) return 'amend';
  return 'review';
}

export function filterAndSortAuthorityQueue(
  rows: AuthorityQueueRow[],
  filter: QueueFilter,
  search: string,
  sort: QueueSort,
): AuthorityQueueRow[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return rows
    .filter((row) => filter === 'all'
      || (filter === 'decided' ? row.assignment?.status === 'completed'
        : filter === 'documentation' ? (row.stage1PendingCount ?? 0) > 0
          : row.assignment?.status !== 'completed'))
    .filter((row) => !normalizedSearch || [row.event.eventId, row.event.eventDetails.name, row.event.eventDetails.venueName, row.event.eventDetails.type]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch)))
    .sort((left, right) => {
      if (sort === 'eventSoonest') return left.event.eventDetails.startDatetime - right.event.eventDetails.startDatetime;
      if (sort === 'attendance') return right.event.eventDetails.expectedAttendance - left.event.eventDetails.expectedAttendance;
      return right.event.createdAt - left.event.createdAt;
    });
}

export function filterAndSortQueue(
  events: EventRecord[],
  status: EventStatus | 'all',
  search: string,
  sort: QueueSort,
): EventRecord[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return events
    .filter((event) => status === 'all' || event.status === status)
    .filter((event) => !normalizedSearch || [event.eventId, event.eventDetails.name, event.eventDetails.venueName, event.eventDetails.type]
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
