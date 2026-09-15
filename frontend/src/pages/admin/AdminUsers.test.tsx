import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminUsers from './AdminUsers';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  user: {
    uid: 'organizer-1',
    name: 'Organizer One',
    email: 'organizer1@steras.test',
    role: 'organizer' as const,
    createdAt: 1,
    updatedAt: 1,
  },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn((_query, next: (snapshot: { docs: Array<{ data: () => typeof mocks.user }> }) => void) => {
    next({ docs: [{ data: () => mocks.user }] });
    return vi.fn();
  }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mocks.callable),
}));

vi.mock('../../config/firebase', () => ({
  db: {},
  functions: {},
  isFirebaseConfigured: true,
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { name: 'STERAS Admin', role: 'admin' } }),
}));

vi.mock('../../components/layout/Sidebar', () => ({
  WorkspaceTopBar: ({ title, subtitle }: { title: string; subtitle: string }) => <header><h1>{title}</h1><p>{subtitle}</p></header>,
}));

describe('AdminUsers password reset', () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.callable.mockResolvedValue({ data: { uid: mocks.user.uid, idempotent: false } });
  });

  it('requires confirmation and sends only the target uid plus an idempotency key', async () => {
    render(<AdminUsers />);

    fireEvent.click(await screen.findByRole('button', { name: 'Reset password' }));
    expect(screen.getByText('Steras@Reset2026!')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Reset password for Organizer One' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm reset' }));

    await waitFor(() => expect(mocks.callable).toHaveBeenCalledOnce());
    expect(mocks.callable).toHaveBeenCalledWith({
      uid: 'organizer-1',
      idempotencyKey: expect.any(String),
    });
  });
});
