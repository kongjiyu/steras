import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PublicHeader from './PublicHeader';

const signOut = vi.fn();
const authState: { user: object | null; profile: { role: 'public' } | null } = {
  user: null,
  profile: { role: 'public' },
};

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ ...authState, signOut }),
}));

describe('PublicHeader', () => {
  beforeEach(() => signOut.mockReset());

  it('shows participant account actions once the profile is available', () => {
    render(<MemoryRouter><PublicHeader /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'My reports' })).toHaveAttribute('href', '/incidents');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
