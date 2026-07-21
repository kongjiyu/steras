import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MyEvents from './MyEvents';

const { listener, authValue } = vi.hoisted(() => ({
  listener: { mode: 'success' as 'success' | 'error' },
  authValue: { user: { uid: 'organizer-1' } },
}));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => authValue }));
vi.mock('../../config/firebase', () => ({ db: {}, isFirebaseConfigured: true }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), where: vi.fn(),
  onSnapshot: vi.fn((_query, onNext: (value: unknown) => void, onError: (error: Error) => void) => {
    if (listener.mode === 'error') onError(new Error('offline'));
    else onNext({ docs: [{ id: 'event-1', data: () => ({
      organizerId: 'organizer-1', status: 'Draft', currentVersionNumber: 0, draftDocumentPaths: [], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
      eventDetails: { name: 'Draft Forum', type: 'conference', venueName: 'PICC', startDatetime: 0 },
    }) }] });
    return vi.fn();
  }),
}));

describe('MyEvents', () => {
  beforeEach(() => { listener.mode = 'success'; });

  it('renders owned applications and their edit route', async () => {
    render(<MemoryRouter><MyEvents /></MemoryRouter>);
    expect(await screen.findAllByText('Draft Forum')).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: /edit|continue application/i })[0]).toHaveAttribute('href', '/organizer/events/event-1/edit');
  });

  it('shows a retryable error when the event listener fails', async () => {
    listener.mode = 'error';
    render(<MemoryRouter><MyEvents /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Applications unavailable' })).toBeInTheDocument();
    listener.mode = 'success';
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByText('Draft Forum').length).toBeGreaterThan(0));
  });
});
