import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';

const { signIn, signOut, authState } = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  authState: {
    user: null as { uid: string } | null,
    profile: null as { role: 'organizer' | 'authority' } | null,
  },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ ...authState, signIn, signOut, configured: true }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    signIn.mockReset();
    signOut.mockReset();
    signOut.mockResolvedValue(undefined);
    authState.user = null;
    authState.profile = null;
  });

  it('redirects an existing session away from the sign-in page', async () => {
    authState.user = { uid: 'organizer-1' };
    authState.profile = { role: 'organizer' };
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/organizer" element={<div>Organizer workspace</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Organizer workspace')).toBeInTheDocument());
  });

  it('redirects a provisioned authority to the authority workspace', async () => {
    signIn.mockResolvedValue({ role: 'authority', authorityType: 'PDRM' });
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/authority" element={<div>Authority workspace</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'reviewer@steras.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temporary-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Authority workspace')).toBeInTheDocument());
  });

  it('restores a protected organizer route after sign-in', async () => {
    signIn.mockResolvedValue({ role: 'organizer' });
    render(
      <MemoryRouter initialEntries={[{
        pathname: '/login',
        state: { from: { pathname: '/organizer/events/evt-1', search: '?tab=evidence' } },
      }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/organizer/events/:eventId" element={<div>Organizer event evidence</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'organizer@steras.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temporary-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Organizer event evidence')).toBeInTheDocument());
  });

  it('uses the role home instead of returning to another role workspace', async () => {
    signIn.mockResolvedValue({ role: 'authority' });
    render(
      <MemoryRouter initialEntries={[{
        pathname: '/login',
        state: { from: { pathname: '/organizer/events/new' } },
      }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/authority" element={<div>Authority home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'reviewer@steras.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temporary-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Authority home')).toBeInTheDocument());
  });

  it('signs back out when Firebase Auth has no workspace profile', async () => {
    signIn.mockResolvedValue(null);
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'unprovisioned@steras.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temporary-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(screen.getByRole('heading', { name: 'Sign in to STERAS' })).toBeInTheDocument();
  });
});
