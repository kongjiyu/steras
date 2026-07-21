import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PublicCalendar from './PublicCalendar';

const { snapshotState } = vi.hoisted(() => ({
  snapshotState: { mode: 'success' as 'success' | 'error' },
}));

vi.mock('../../config/firebase', () => ({ db: {}, isFirebaseConfigured: true }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn((_query, onNext: (value: unknown) => void, onError: () => void) => {
    if (snapshotState.mode === 'error') onError();
    else onNext({ docs: [{ data: () => ({
      eventId: 'event-1', versionId: 'v1', eventName: 'Tourism Forum', venueName: 'PICC', eventType: 'conference',
      startDatetime: Date.UTC(2026, 7, 20), endDatetime: Date.UTC(2026, 7, 20, 4), approvedBy: ['PDRM'], publicStatus: 'approved',
    }) }] });
    return vi.fn();
  }),
}));

describe('PublicCalendar', () => {
  beforeEach(() => { snapshotState.mode = 'success'; });

  it('renders approved events from the public collection', async () => {
    render(<MemoryRouter><PublicCalendar /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Tourism Forum' })).toBeInTheDocument();
    expect(screen.getByText('1 approved event')).toBeInTheDocument();
  });

  it('shows an error and recovers when the listener succeeds on retry', async () => {
    snapshotState.mode = 'error';
    render(<MemoryRouter><PublicCalendar /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Events unavailable' })).toBeInTheDocument();

    snapshotState.mode = 'success';
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tourism Forum' })).toBeInTheDocument());
  });
});
