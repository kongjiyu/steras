import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import PublicHome from './PublicHome';

describe('PublicHome', () => {
  it('explains the connected STERAS journey and exposes the primary entry points', () => {
    render(<MemoryRouter><PublicHome /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Safer events start with clearer evidence.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'From idea to public confidence' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Every role sees the detail it needs—and no more.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AI can advise. Evidence and accountable people decide.' })).toBeInTheDocument();

    for (const module of ['M1', 'M2', 'M3', 'M4', 'M5']) {
      expect(screen.getByText(module)).toBeInTheDocument();
    }

    expect(screen.getAllByRole('link', { name: /Start an application/ })[0]).toHaveAttribute('href', '/register');
    expect(screen.getAllByRole('link', { name: /approved events/i })[0]).toHaveAttribute('href', '/calendar');
  });
});
