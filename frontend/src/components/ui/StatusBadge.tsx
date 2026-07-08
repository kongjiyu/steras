import { EventStatus } from '@shared/types';
import Badge from './Badge';

const STATUS_COLOR: Record<EventStatus, 'amber' | 'blue' | 'orange' | 'green' | 'red' | 'gray'> = {
  Pending: 'amber',
  UnderReview: 'blue',
  AmendmentRequested: 'orange',
  Approved: 'green',
  Rejected: 'red',
  Withdrawn: 'gray',
};

const STATUS_LABEL: Record<EventStatus, string> = {
  Pending: 'Pending',
  UnderReview: 'Under Review',
  AmendmentRequested: 'Amendment Requested',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Withdrawn: 'Withdrawn',
};

export default function StatusBadge({ status }: { status: EventStatus }) {
  return <Badge color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Badge>;
}
