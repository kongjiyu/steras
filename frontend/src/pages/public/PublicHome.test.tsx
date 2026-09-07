import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import PublicHome from './PublicHome';

describe('PublicHome', () => {
  it('explains the connected STERAS journey and exposes the primary entry points', () => {
    render(<MemoryRouter><PublicHome /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Safer events start with clearer evidence.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How an application becomes approval' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Built for organizers. Accountable to authorities.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AI can advise. Evidence and accountable people decide.' })).toBeInTheDocument();
    expect(screen.queryByText('One shared record')).not.toBeInTheDocument();

    for (const phase of ['Prepare application', 'Evidence & risk assessment', 'Multi-agency review', 'Approved public record']) {
      expect(screen.getByText(phase)).toBeInTheDocument();
    }

    expect(screen.getAllByRole('link', { name: /Start an application/ })[0]).toHaveAttribute('href', '/register');
    expect(screen.getAllByRole('link', { name: /approved events/i })[0]).toHaveAttribute('href', '/calendar');
  });
});
