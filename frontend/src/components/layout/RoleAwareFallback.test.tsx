import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RoleAwareFallback from './RoleAwareFallback';

const { authState } = vi.hoisted(() => ({
  authState: {
    user: null as { uid: string } | null,
    profile: null as { role: 'organizer' | 'authority' } | null,
  },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

describe('RoleAwareFallback', () => {
  beforeEach(() => {
    authState.user = null;
    authState.profile = null;
  });

  it('returns a signed-in authority to the authority workspace', () => {
    authState.user = { uid: 'authority-1' };
    authState.profile = { role: 'authority' };
    render(
      <MemoryRouter initialEntries={['/unknown']}>
        <Routes>
          <Route path="/unknown" element={<RoleAwareFallback />} />
          <Route path="/authority" element={<div>Authority workspace</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Authority workspace')).toBeInTheDocument();
  });

  it('returns a guest to the public home page', () => {
    render(
      <MemoryRouter initialEntries={['/unknown']}>
        <Routes>
          <Route path="/unknown" element={<RoleAwareFallback />} />
          <Route path="/" element={<div>Public home</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Public home')).toBeInTheDocument();
  });
});
