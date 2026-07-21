import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProtectedRoute from './ProtectedRoute';

const { authState, signOut } = vi.hoisted(() => ({
  authState: { user: null as { uid: string } | null, profile: null as { role: 'organizer' | 'authority' } | null },
  signOut: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ ...authState, loading: false, configured: true, signOut }),
}));

function LoginProbe() {
  const location = useLocation();
  return <div>Login from {(location.state as { from?: { pathname?: string } } | null)?.from?.pathname}</div>;
}

function renderProtected(path = '/organizer/events') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/organizer" element={<div>Organizer home</div>} />
        <Route path="/authority" element={<div>Authority home</div>} />
        <Route path="/organizer/events" element={<ProtectedRoute requiredRole="organizer"><div>Private events</div></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    authState.user = null;
    authState.profile = null;
    signOut.mockReset();
  });

  it('renders the protected content for the correct role', () => {
    authState.user = { uid: 'organizer-1' };
    authState.profile = { role: 'organizer' };
    renderProtected();
    expect(screen.getByText('Private events')).toBeInTheDocument();
  });

  it('sends guests to login while preserving the requested route', () => {
    renderProtected();
    expect(screen.getByText('Login from /organizer/events')).toBeInTheDocument();
  });

  it('prevents an authority from entering the organizer workspace', () => {
    authState.user = { uid: 'authority-1' };
    authState.profile = { role: 'authority' };
    renderProtected();
    expect(screen.getByText('Authority home')).toBeInTheDocument();
  });

  it('shows a recoverable error instead of a redirect loop when profile is missing', () => {
    authState.user = { uid: 'orphan-1' };
    renderProtected();
    expect(screen.getByRole('heading', { name: 'Workspace profile unavailable' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });
});
