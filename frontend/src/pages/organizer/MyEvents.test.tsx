import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MyEvents from './MyEvents';
import { assessmentLabel } from './organizerApplication';

const { listener, authValue, deleteCallable } = vi.hoisted(() => ({
  listener: { mode: 'success' as 'success' | 'error' },
  authValue: { user: { uid: 'organizer-1' } },
  deleteCallable: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => authValue }));
vi.mock('../../config/firebase', () => ({ db: {}, functions: {}, isFirebaseConfigured: true }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => deleteCallable) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
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
      { id: 'event-3', data: () => ({
        organizerId: 'organizer-1', status: 'Approved', currentVersionId: 'v1', currentVersionNumber: 1, draftDocumentPaths: [], requiredAuthorities: [], createdAt: 3, updatedAt: 3,
        initialReview: { decision: 'Approved', reason: 'Complete', reviewerUid: 'admin-1', reviewedAt: 2 },
        eventDetails: { name: 'Approved Forum', type: 'conference', venueName: 'PICC', startDatetime: 0 },
      }) },
    ] });
    return vi.fn();
  }),
}));

describe('MyEvents', () => {
  beforeEach(() => {
    listener.mode = 'success';
    deleteCallable.mockReset();
    deleteCallable.mockResolvedValue({ data: { eventId: 'event-1', deleted: true, alreadyDeleted: false } });
  });

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

  it('shows Delete only for Draft applications and requires the exact confirmation text', async () => {
    render(<MemoryRouter><MyEvents /></MemoryRouter>);
    expect((await screen.findAllByRole('button', { name: 'Delete Draft Forum' })).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: 'Delete Approved Forum' })).toHaveLength(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Draft Forum' })[0]);
    const dialog = screen.getByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete draft' });
    const confirmationInput = within(dialog).getByRole('textbox', { name: 'Type DELETE to confirm' });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(confirmationInput, { target: { value: 'delete' } });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(confirmationInput, { target: { value: 'DELETE' } });
    expect(confirmButton).not.toBeDisabled();
  });

  it('allows a Draft deletion to be cancelled without calling the backend', async () => {
    render(<MemoryRouter><MyEvents /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Delete Draft Forum' }))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteCallable).not.toHaveBeenCalled();
  });

  it('warns that a revision Draft also removes prior history and deletes the item after success', async () => {
    render(<MemoryRouter><MyEvents /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Delete Revision Forum' }))[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/previous submitted version, revision data, and review history/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type DELETE to confirm' }), { target: { value: 'DELETE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(deleteCallable).toHaveBeenCalledWith({ eventId: 'event-2' }));
    await waitFor(() => expect(screen.queryAllByText('Revision Forum')).toHaveLength(0));
  });

  it('keeps the dialog and Draft visible when deletion fails', async () => {
    deleteCallable.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'functions/unavailable' }));
    render(<MemoryRouter><MyEvents /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Delete Draft Forum' }))[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type DELETE to confirm' }), { target: { value: 'DELETE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('could not be fully deleted');
    expect(screen.getAllByText('Draft Forum').length).toBeGreaterThan(0);
  });
});

describe('assessmentLabel', () => {
  const base = {
    eventId: 'event-1', organizerId: 'organizer-1', currentVersionNumber: 1,
    draftDocumentPaths: [], requiredAuthorities: [], createdAt: 1, updatedAt: 1,
    eventDetails: { name: 'Forum', type: 'conference' as const, venueName: 'PICC', expectedAttendance: 100, startDatetime: 1, endDatetime: 2, environment: 'indoor' as const, coverage: 'covered' as const, seating: 'seated' as const, riskProfile: {} },
  };

  it('shows manual intervention before the existence of an assessment pointer', () => {
    expect(assessmentLabel({ ...base, status: 'Manual Review Required', currentAssessmentId: 'assessment-1' })).toBe('Manual assessment required');
  });

  it('uses user-facing availability language instead of database record language', () => {
    expect(assessmentLabel({ ...base, status: 'UnderReview', currentAssessmentId: 'assessment-1' })).toBe('Risk assessment available');
  });
});
