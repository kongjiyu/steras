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
  collection: vi.fn((_db, path: string) => ({ path })), query: vi.fn((source) => source), where: vi.fn(),
  onSnapshot: vi.fn((source: { path: string }, onNext: (value: unknown) => void, onError: (error: Error) => void) => {
    if (listener.mode === 'error') onError(new Error('offline'));
    else if (source.path === 'public_events') onNext({ docs: [{ id: 'event-2', data: () => ({ eventId: 'event-2', versionId: 'v1', publicStatus: 'approved' }) }] });
    else onNext({ docs: [
      { id: 'event-1', data: () => ({
        organizerId: 'organizer-1', status: 'Draft', currentVersionNumber: 0, draftDocumentPaths: [], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
        eventDetails: { name: 'Draft Forum', type: 'conference', venueName: 'PICC', startDatetime: 0 },
      }) },
      { id: 'event-2', data: () => ({
        organizerId: 'organizer-1', status: 'Draft', currentVersionId: 'v1', currentVersionNumber: 1, editableVersionId: 'v2', activeRevision: { kind: 'rejected_revision', sourceVersionId: 'v1', startedAt: 2 }, currentAssessmentId: 'v1', draftDocumentPaths: [], requiredAuthorities: ['PDRM'], createdAt: 2, updatedAt: 2,
        initialReview: { decision: 'Approved', reason: 'Complete', reviewerUid: 'admin-1', reviewedAt: 1 },
        eventDetails: { name: 'Revision Forum', type: 'conference', venueName: 'PICC', startDatetime: 0 },
      }) },
    ] });
    return vi.fn();
  }),
}));

describe('MyEvents', () => {
  beforeEach(() => { listener.mode = 'success'; });

  it('renders owned applications and their edit route', async () => {
    render(<MemoryRouter><MyEvents /></MemoryRouter>);
    expect(await screen.findAllByText('Draft Forum')).not.toHaveLength(0);
    const draftLink = screen.getAllByRole('link').find((link) => link.getAttribute('href') === '/organizer/events/event-1/edit');
    expect(draftLink).toBeTruthy();
  });

  it('routes revision requested applications to the editable version', async () => {
    render(<MemoryRouter><MyEvents /></MemoryRouter>);
    expect(await screen.findAllByText('Revision Forum')).not.toHaveLength(0);
    const revisionLink = screen.getAllByRole('link').find((link) => link.getAttribute('href') === '/organizer/events/event-2/edit');
    expect(revisionLink).toBeTruthy();
  });

  it('shows Admin decisions and publication from the public projection', async () => {
    render(<MemoryRouter><MyEvents /></MemoryRouter>);
    expect((await screen.findAllByText(/Initial Admin review approved - Published in public calendar/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/No Admin decision recorded - Not published/).length).toBeGreaterThan(0);
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
