import { EventStatus } from '@shared/types';
import type { ApplicationDisplayState } from '@shared/applicationState';
import Badge from './Badge';

const STATUS_COLOR: Record<EventStatus, 'amber' | 'blue' | 'orange' | 'green' | 'red' | 'gray'> = {
  Draft: 'gray',
  Pending: 'amber',
  UnderReview: 'blue',
  Approved: 'green',
  Rejected: 'red',
  Cancelled: 'gray',
  Withdrawn: 'gray',
  'Manual Review Required': 'orange',
};

const STATUS_LABEL: Record<EventStatus, string> = {
  Draft: 'Draft',
  Pending: 'Pending',
  UnderReview: 'Under Review',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Cancelled: 'Cancelled',
  Withdrawn: 'Withdrawn',
  'Manual Review Required': 'Manual Review Required',
};

const DISPLAY_COLOR: Record<ApplicationDisplayState, 'amber' | 'blue' | 'orange' | 'green' | 'red' | 'gray'> = {
  Draft: 'gray',
  Pending: 'amber',
  'Initial Review': 'blue',
  'Manual Review Required': 'orange',
  'Authority Selection': 'amber',
  'Under Review': 'blue',
  'Final Review': 'orange',
  Approved: 'green',
  'Documentation Required': 'orange',
  Rejected: 'red',
  Cancelled: 'gray',
  Withdrawn: 'gray',
};

export default function StatusBadge({ status }: { status: EventStatus }) {
  return <Badge color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function ApplicationDisplayBadge({ state }: { state: ApplicationDisplayState }) {
  return <Badge color={DISPLAY_COLOR[state]}>{state}</Badge>;
}
