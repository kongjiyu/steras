import { EventStatus } from '@shared/types';
import Badge from './Badge';

const STATUS_COLOR: Record<EventStatus, 'amber' | 'blue' | 'orange' | 'green' | 'red' | 'gray'> = {
  Draft: 'gray',
  Pending: 'amber',
  UnderReview: 'blue',
  Approved: 'green',
  Rejected: 'red',
  Withdrawn: 'gray',
  'Manual Review Required': 'orange',
};

const STATUS_LABEL: Record<EventStatus, string> = {
  Draft: 'Draft',
  Pending: 'Pending',
  UnderReview: 'Under Review',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Withdrawn: 'Withdrawn',
  'Manual Review Required': 'Manual review required',
};

export default function StatusBadge({ status }: { status: EventStatus }) {
  return <Badge color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Badge>;
}
