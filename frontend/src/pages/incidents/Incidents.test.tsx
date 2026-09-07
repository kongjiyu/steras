import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Incidents from './Incidents';

const mocks = vi.hoisted(() => ({ list: vi.fn(), directory: vi.fn(), submit: vi.fn(), role: 'public' }));
vi.mock('../../config/firebase', () => ({ functions: {}, storage: {} }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'owner' }, profile: { uid: 'owner', name: 'Owner', role: mocks.role } }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_: unknown, name: string) => name === 'listIncidents' ? mocks.list : name === 'listAuthorityDirectory' ? mocks.directory : mocks.submit }));
vi.mock('../../components/layout/Sidebar', () => ({ WorkspaceTopBar: () => null }));
vi.mock('../../components/layout/PublicHeader', () => ({ default: () => null }));
vi.mock('./IncidentEvidenceGallery', () => ({ IncidentEvidenceGallery: () => null }));

const event = { eventId: 'event-1', name: 'QA Event', startDatetime: new Date('2020-01-01').getTime(), endDatetime: Date.now() + 86400000 };
const result = { data: { incidents: [], reportableEvents: [event] } };
function fillReport() {
  fireEvent.change(screen.getByLabelText('Occurrence date and time *'), { target: { value: '2026-01-01T12:00' } });
  fireEvent.change(screen.getByLabelText('Location *'), { target: { value: 'Main entrance' } });
  fireEvent.change(screen.getByLabelText('Description *'), { target: { value: 'A temporary barrier is blocking the main entrance.' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'public';
  mocks.list.mockResolvedValue(result);
  mocks.directory.mockResolvedValue({ data: { authorities: [] } });
  mocks.submit.mockResolvedValue({ data: {} });
});

describe('live incident workspace resilience', () => {
  it('shows loading rather than a false zero and recovers from a failed read', async () => {
    let fail!: (reason: Error) => void;
    mocks.list.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    render(<Incidents />);
    expect(screen.getByText('Loading incident records...')).toBeInTheDocument();
    expect(screen.queryByText('0 accessible records')).not.toBeInTheDocument();
    await act(async () => fail(new Error('offline')));
    expect(await screen.findByText('Record count unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Incident Report' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('0 accessible records')).toBeInTheDocument();
    expect(screen.queryByText(/could not be refreshed/)).not.toBeInTheDocument();
  });

  it('retains the same request key after a lost response and changes it after an edit', async () => {
    mocks.submit.mockRejectedValue(new Error('Response lost'));
    render(<Incidents />);
    await screen.findByRole('option', { name: 'QA Event' });
    fillReport();
    const button = screen.getByRole('button', { name: 'Submit Incident Report' });
    fireEvent.click(button);
    await screen.findByText('Response lost');
    fireEvent.click(button);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[1][0].idempotencyKey).toBe(mocks.submit.mock.calls[0][0].idempotencyKey);
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Location *'), { target: { value: 'South entrance' } });
    fireEvent.click(button);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(3));
    expect(mocks.submit.mock.calls[2][0].idempotencyKey).not.toBe(mocks.submit.mock.calls[0][0].idempotencyKey);
  });

  it('does not turn a successful submission into a failed submission when refresh fails', async () => {
    render(<Incidents />);
    await screen.findByRole('option', { name: 'QA Event' });
    fillReport();
    mocks.list.mockRejectedValue(new Error('refresh offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Incident Report' }));
    await screen.findByText(/could not be refreshed/);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Description *')).toHaveValue('');
    expect(screen.queryByText('Submission failed.')).not.toBeInTheDocument();
  });

  it('blocks future and pre-event dates before uploading or calling the backend', async () => {
    render(<Incidents />);
    await screen.findByRole('option', { name: 'QA Event' });
    fillReport();
    for (const date of ['2999-01-01T12:00', '2019-01-01T12:00']) {
      fireEvent.change(screen.getByLabelText('Occurrence date and time *'), { target: { value: date } });
      expect(screen.getByRole('button', { name: 'Submit Incident Report' })).toBeDisabled();
      expect(screen.getByText(/Choose a time during/)).toBeInTheDocument();
    }
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each(['organizer', 'authority'])('does not expose submission to %s accounts', async (role) => {
    mocks.role = role;
    render(<Incidents />);
    await screen.findByText('0 accessible records');
    expect(screen.queryByRole('heading', { name: 'Submit Incident Report' })).not.toBeInTheDocument();
    expect(screen.getByText(/can review and act/)).toBeInTheDocument();
  });

  it('keeps admin on directory management without participant submission or incident review', async () => {
    mocks.role = 'admin';
    render(<Incidents />);
    await screen.findByText('Authority directory');
    expect(screen.queryByRole('heading', { name: 'Submit Incident Report' })).not.toBeInTheDocument();
    expect(screen.queryByText('Incident queue')).not.toBeInTheDocument();
  });

  it('shows the exact ten participant incident category labels', async () => {
    render(<Incidents />);
    await screen.findByRole('option', { name: 'QA Event' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(expect.arrayContaining([
      'Crowd Congestion or Overcrowding', 'Missing Person', 'Lost and Found',
      'Medical or Safety Incident', 'Security Concern', 'Property or Facility Damage',
      'Suspicious Activity', 'Access or Traffic Issue',
      'Published Event Control Discrepancy', 'Other Incident',
    ]));
  });
});
