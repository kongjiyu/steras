import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AdminAudit from './AdminAudit';

const snapshots = vi.hoisted(() => ({
  events: [{
    id: 'event-1',
    ref: 'event-1',
    data: () => ({ eventDetails: { name: 'Tourism Showcase' }, status: 'Approved', updatedAt: 20 }),
  }],
  venues: [{ id: 'venue-1', ref: 'venue-1', data: () => ({ name: 'Civic Hall' }) }],
  users: [{ id: 'admin-1', data: () => ({ uid: 'admin-1', name: 'Admin Reviewer', role: 'admin' }) }],
}));

vi.mock('../../config/firebase', () => ({ db: {}, isFirebaseConfigured: true }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { uid: 'admin-1', name: 'Admin Reviewer', role: 'admin' } }),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_parent: unknown, path: string) => path === 'audit_logs'
    ? `${String(_parent)}-audit_logs`
    : path,
  query: (reference: string) => reference,
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: async (reference: string) => {
    if (reference === 'events') return { docs: snapshots.events };
    if (reference === 'venues') return { docs: snapshots.venues };
    if (reference === 'users') return { docs: snapshots.users };
    if (reference === 'admin_audit_logs') return { docs: [{ id: 'account-1', data: () => ({ action: 'password_reset', actorId: 'admin-1', targetId: 'admin-1', timestamp: 30 }) }] };
    if (reference === 'event-1-audit_logs') return { docs: [{ id: 'event-audit-1', data: () => ({ action: 'application_approved', actorId: 'admin-1', timestamp: 20 }) }] };
    if (reference === 'venue-1-audit_logs') return { docs: [{ id: 'venue-audit-1', data: () => ({ action: 'venue_verified', actorId: 'admin-1', timestamp: 10 }) }] };
    return { docs: [] };
  },
}));

describe('AdminAudit', () => {
  it('aggregates application, venue and account history and filters it', async () => {
    render(<MemoryRouter><AdminAudit /></MemoryRouter>);

    expect(await screen.findByText('Application approved')).toBeInTheDocument();
    expect(screen.getByText('Venue verified')).toBeInTheDocument();
    expect(screen.getByText('Password reset')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tourism Showcase' })).toHaveAttribute('href', '/admin/applications/event-1');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search audit trail' }), { target: { value: 'Civic Hall' } });
    expect(screen.getByText('Venue verified')).toBeInTheDocument();
    expect(screen.queryByText('Application approved')).not.toBeInTheDocument();
  });
});
