import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PublicEventDetail from './PublicEventDetail';
import { formatEventDateRange } from './publicEventPresentation';

const { listener } = vi.hoisted(() => ({ listener: { controlsFail: false, mode: 'success' as 'success' | 'missing' | 'error' } }));

vi.mock('../../config/firebase', () => ({ auth: {}, db: {}, functions: {}, isFirebaseConfigured: true }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: null }) }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth: unknown, callback: (value: null) => void) => {
    callback(null);
    return vi.fn();
  }),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...args: unknown[]) => ({ kind: 'doc', args })),
  collection: vi.fn((...args: unknown[]) => ({ kind: 'collection', args })),
  query: vi.fn((reference: unknown) => ({ kind: 'query', reference })),
  onSnapshot: vi.fn((reference: { kind?: string }, onNext: (value: unknown) => void, onError: () => void) => {
    if (reference?.kind !== 'doc') {
      if (listener.controlsFail) { onError(); return vi.fn(); }
      onNext({ docs: [] });
      return vi.fn();
    }
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
  beforeEach(() => { listener.mode = 'success'; listener.controlsFail = false; });

  it('shows an evidence read failure instead of claiming nothing was published', async () => {
    listener.controlsFail = true;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Published event evidence could not be loaded');
    expect(screen.queryByTestId('public-stage2-empty')).not.toBeInTheDocument();
    listener.controlsFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('public-stage2-empty')).toBeInTheDocument();
  });

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

describe('formatEventDateRange', () => {
  it('shows both dates when an event crosses midnight', () => {
    const start = new Date(2026, 8, 3, 23, 30).getTime();
    const end = new Date(2026, 8, 4, 2, 30).getTime();
    const label = formatEventDateRange(start, end);
    expect(label).toContain('3 September 2026');
    expect(label).toContain('4 September 2026');
  });

  it('does not duplicate the date for a same-day event', () => {
    const start = new Date(2026, 8, 3, 10).getTime();
    const end = new Date(2026, 8, 3, 12).getTime();
    expect(formatEventDateRange(start, end).match(/September/g)).toHaveLength(1);
  });
});
