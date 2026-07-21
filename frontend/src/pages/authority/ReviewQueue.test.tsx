import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReviewQueue from './ReviewQueue';

const { listener, authValue } = vi.hoisted(() => ({
  listener: { mode: 'success' as 'success' | 'error' },
  authValue: { profile: { authorityType: 'PDRM' } },
}));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => authValue }));
vi.mock('../../config/firebase', () => ({ db: {}, isFirebaseConfigured: true }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), limit: vi.fn(), orderBy: vi.fn(), query: vi.fn(), where: vi.fn(),
  onSnapshot: vi.fn((_query, onNext: (value: unknown) => void, onError: () => void) => {
    if (listener.mode === 'error') onError();
    else onNext({ docs: [{ id: 'event-1', data: () => ({
      organizerId: 'organizer-1', status: 'Pending', currentVersionNumber: 1, draftDocumentPaths: [], requiredAuthorities: ['PDRM'], createdAt: 1, updatedAt: 1,
      eventDetails: { name: 'Safety Forum', type: 'conference', venueName: 'PICC', expectedAttendance: 500, startDatetime: Date.UTC(2026, 7, 20) },
    }) }] });
    return vi.fn();
  }),
}));

describe('ReviewQueue', () => {
  beforeEach(() => { listener.mode = 'success'; });

  it('renders assigned active applications', async () => {
    render(<MemoryRouter><ReviewQueue /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Safety Forum' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Safety Forum/ })).toHaveAttribute('href', '/authority/events/event-1');
  });

  it('shows a retryable queue error and recovers', async () => {
    listener.mode = 'error';
    render(<MemoryRouter><ReviewQueue /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Queue unavailable' })).toBeInTheDocument();
    listener.mode = 'success';
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Safety Forum' })).toBeInTheDocument());
  });
});
