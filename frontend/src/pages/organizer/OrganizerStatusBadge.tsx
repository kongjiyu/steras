import Badge from '../../components/ui/Badge';
import { applicationStatusLabel } from './organizerApplication';

type BadgeColor = 'green' | 'blue' | 'amber' | 'orange' | 'red' | 'gray' | 'slate';

const STATUS_COLOR: Record<string, BadgeColor> = {
  Draft: 'gray',
  Pending: 'amber',
  UnderReview: 'blue',
  Approved: 'green',
  Rejected: 'red',
  Cancelled: 'gray',
  Withdrawn: 'gray',
  'Manual Review Required': 'orange',
};

export default function OrganizerStatusBadge({ status }: { status: string }) {
  return <Badge color={STATUS_COLOR[status] ?? 'gray'}>{applicationStatusLabel(status)}</Badge>;
}
