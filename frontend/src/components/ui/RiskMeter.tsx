import { RiskLevel } from '@shared/types';

const LEVEL_CLASS: Record<RiskLevel, string> = {
  Low: 'risk-meter--low',
  Medium: 'risk-meter--medium',
  High: 'risk-meter--high',
};

const LEVEL_STRENGTH: Record<RiskLevel, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
};

const SIZE_CLASS = {
  compact: 'risk-meter--compact',
  default: 'risk-meter--default',
} as const;

const TONE_CLASS = {
  surface: 'risk-meter--surface',
  inverse: 'risk-meter--inverse',
} as const;

export interface RiskMeterProps {
  level: RiskLevel;
  size?: keyof typeof SIZE_CLASS;
  tone?: keyof typeof TONE_CLASS;
  className?: string;
}

/**
 * Canonical STERAS risk-level indicator.
 * Low, Medium, and High activate one, two, or three ascending ticks while
 * retaining a visible text label so risk is never communicated by color alone.
 */
export default function RiskMeter({
  level,
  size = 'default',
  tone = 'surface',
  className = '',
}: RiskMeterProps) {
  return (
    <span className={`risk-meter ${LEVEL_CLASS[level]} ${SIZE_CLASS[size]} ${TONE_CLASS[tone]} ${className}`.trim()}>
      <span className="risk-meter__ticks" aria-hidden="true">
        {[1, 2, 3].map((tick) => (
          <span key={tick} className={`risk-meter__tick ${tick <= LEVEL_STRENGTH[level] ? 'is-active' : ''}`} />
        ))}
      </span>
      <span>{level} Risk</span>
    </span>
  );
}
