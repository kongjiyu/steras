import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ProfilePage from './ProfilePage';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { name: 'Alya', email: 'alya@example.com', phone: '+60123456789' }, refreshProfile: vi.fn() }),
}));

vi.mock('../../config/firebase', () => ({ functions: {} }));

describe('ProfilePage', () => {
  it('returns to the organizer page that opened the profile', () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/organizer/profile', state: { returnTo: '/organizer/events/draft-1/edit' } }]}><Routes><Route path="/organizer/profile" element={<ProfilePage />} /><Route path="/organizer/events/:id/edit" element={<p>Draft application</p>} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Back to previous page' }));
    expect(screen.getByText('Draft application')).toBeInTheDocument();
  });

  it('uses the organizer dashboard for an unsafe return target', () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/organizer/profile', state: { returnTo: 'https://example.com' } }]}><Routes><Route path="/organizer/profile" element={<ProfilePage />} /><Route path="/organizer" element={<p>Organizer dashboard</p>} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Back to previous page' }));
    expect(screen.getByText('Organizer dashboard')).toBeInTheDocument();
  });
});
