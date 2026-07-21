import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RiskMeter from './RiskMeter';

describe('RiskMeter', () => {
  it.each([
    ['Low', 1],
    ['Medium', 2],
    ['High', 3],
  ] as const)('renders %s with %i active ticks', (level, strength) => {
    const { container } = render(<RiskMeter level={level} />);
    expect(within(container).getByText(`${level} Risk`)).toBeInTheDocument();
    expect(container.querySelector('.risk-meter')).toHaveClass(`risk-meter--${level.toLowerCase()}`);
    expect(container.querySelectorAll('.risk-meter__tick.is-active')).toHaveLength(strength);
  });

  it('supports compact inverse presentation without changing its semantics', () => {
    const { container } = render(<RiskMeter level="High" size="compact" tone="inverse" />);
    expect(container.querySelector('.risk-meter')).toHaveClass('risk-meter--compact', 'risk-meter--inverse');
    expect(within(container).getByText('High Risk')).toBeInTheDocument();
  });
});
