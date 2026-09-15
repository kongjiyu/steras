import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ApplicationJourney from './ApplicationJourney';

describe('ApplicationJourney', () => {
  it('keeps all nine steps visible and identifies the current step in sticky mode', () => {
    render(<ApplicationJourney activeStep={8} sticky />);
    const journey = screen.getByRole('region', { name: 'Nine clear steps, from event idea to review' });
    expect(journey).toHaveClass('sticky');
    expect(screen.getAllByRole('listitem')).toHaveLength(9);
    expect(screen.getByText('Review information').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Submit for review')).toBeInTheDocument();
  });
});
