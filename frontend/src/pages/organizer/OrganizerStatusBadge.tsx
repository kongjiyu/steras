import Badge from '../../components/ui/Badge';
import { applicationStatusLabel } from './organizerApplication';
import type { ApplicationDisplayState } from '@shared/applicationState';

type BadgeColor = 'green' | 'blue' | 'amber' | 'orange' | 'red' | 'gray' | 'slate';

const STATUS_COLOR: Record<string, BadgeColor> = {
  Draft: 'gray',
  Pending: 'amber',
  UnderReview: 'blue',
  'Initial Review': 'blue',
  'Authority Selection': 'amber',
  'Under Review': 'blue',
  'Final Review': 'orange',
  Approved: 'green',
  'Documentation Required': 'orange',
  Rejected: 'red',
  Cancelled: 'gray',
  Withdrawn: 'gray',
  'Manual Review Required': 'orange',
};

export default function OrganizerStatusBadge({ status, state }: { status: string; state?: ApplicationDisplayState }) {
  const label = state ?? applicationStatusLabel(status);
  return <Badge color={STATUS_COLOR[state ?? status] ?? 'gray'}>{label}</Badge>;
}
