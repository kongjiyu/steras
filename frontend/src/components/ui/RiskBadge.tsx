import { RiskLevel } from '@shared/types';
import Badge from './Badge';

const COLOR: Record<RiskLevel, 'green' | 'amber' | 'red'> = {
  Low: 'green',
  Medium: 'amber',
  High: 'red',
};

export default function RiskBadge({ level }: { level: RiskLevel }) {
  return <Badge color={COLOR[level]}>{level} Risk</Badge>;
}
