import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PublicEventDetail from './PublicEventDetail';

const { listener } = vi.hoisted(() => ({ listener: { mode: 'success' as 'success' | 'missing' | 'error' } }));

vi.mock('../../config/firebase', () => ({ db: {}, isFirebaseConfigured: true }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn((_reference, onNext: (value: unknown) => void, onError: () => void) => {
    if (listener.mode === 'error') onError();
    else onNext({
      exists: () => listener.mode === 'success',
      data: () => ({
        eventId: 'event-1', versionId: 'v1', eventName: 'Approved Forum', venueName: 'PICC', eventType: 'conference',
        startDatetime: Date.UTC(2026, 7, 20), endDatetime: Date.UTC(2026, 7, 20, 4), approvedBy: ['PDRM'], publicStatus: 'approved',
      }),
    });
    return vi.fn();
  }),
}));

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/events/event-1']}>
      <Routes><Route path="/events/:eventId" element={<PublicEventDetail />} /></Routes>
    </MemoryRouter>,
  );
}

describe('PublicEventDetail', () => {
  beforeEach(() => { listener.mode = 'success'; });

  it('renders sanitized approved event information', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Approved Forum' })).toBeInTheDocument();
    expect(screen.getByText('Approval confirmed')).toBeInTheDocument();
  });

  it('distinguishes a missing public listing from a service error', async () => {
    listener.mode = 'missing';
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Event not publicly listed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows a retryable error when Firestore fails', async () => {
    listener.mode = 'error';
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Event unavailable' })).toBeInTheDocument();
    listener.mode = 'success';
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Approved Forum' })).toBeInTheDocument());
  });
});
