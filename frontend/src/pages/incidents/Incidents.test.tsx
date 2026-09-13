import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Incidents from './Incidents';

const mocks = vi.hoisted(() => ({ list: vi.fn(), directory: vi.fn(), submit: vi.fn(), manage: vi.fn(), role: 'public' }));
vi.mock('../../config/firebase', () => ({ functions: {}, storage: {} }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'owner' }, profile: { uid: 'owner', name: 'Owner', role: mocks.role } }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_: unknown, name: string) => name === 'listIncidents' ? mocks.list : name === 'listAuthorityDirectory' ? mocks.directory : name === 'manageIncident' ? mocks.manage : mocks.submit }));
vi.mock('../../components/layout/Sidebar', () => ({ WorkspaceTopBar: () => null }));
vi.mock('../../components/layout/PublicHeader', () => ({ default: () => null }));
vi.mock('./IncidentEvidenceGallery', () => ({ IncidentEvidenceGallery: () => null }));

const event = { eventId: 'event-1', name: 'QA Event', startDatetime: new Date('2020-01-01').getTime(), endDatetime: Date.now() + 86400000 };
const result = { data: { incidents: [], reportableEvents: [event] } };
function fillReport() {
  fireEvent.change(screen.getByLabelText('Eligible event *'), { target: { value: 'event-1' } });
  fireEvent.change(screen.getByLabelText('Incident category *'), { target: { value: 'crowd' } });
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
  mocks.manage.mockResolvedValue({ data: {} });
});

describe('live incident workspace resilience', () => {
  it('starts with empty selections, the current time, and no instruction line', async () => {
    const beforeRender = Date.now();
    render(<Incidents />);
    await screen.findByRole('option', { name: 'QA Event' });

    expect(screen.getByLabelText('Eligible event *')).toHaveValue('');
    expect((screen.getByRole('option', { name: 'Select an ongoing or recent event' }) as HTMLOptionElement).selected).toBe(true);
    expect(screen.getByLabelText('Incident category *')).toHaveValue('');
    expect((screen.getByRole('option', { name: 'Select category' }) as HTMLOptionElement).selected).toBe(true);
    const occurrence = screen.getByLabelText('Occurrence date and time *') as HTMLInputElement;
    expect(new Date(occurrence.value).getTime()).toBeGreaterThanOrEqual(beforeRender - 60_000);
    expect(new Date(occurrence.value).getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(screen.queryByText(/eligible events available/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/description of at least 20 characters/i)).not.toBeInTheDocument();
  });

  it('accepts a required description without imposing a 20-character minimum', async () => {
    render(<Incidents />);
    await screen.findByRole('option', { name: 'QA Event' });
    fillReport();
    fireEvent.change(screen.getByLabelText('Description *'), { target: { value: 'X' } });
    expect(screen.getByRole('button', { name: 'Submit Incident Report' })).toBeEnabled();
  });

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

  it('shows only the approved participant incident detail fields and no AI result', async () => {
    mocks.list.mockResolvedValue({ data: { incidents: [incident('submitted', 'Participant Event')], reportableEvents: [event] } });
    render(<Incidents />);
    await screen.findByRole('heading', { name: 'Incident details' });
    for (const label of ['Event name', 'Incident ID', 'Status', 'Category', 'Location', 'Occurrence time', 'Description', 'Evidence']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('AI assessment')).not.toBeInTheDocument();
    expect(screen.queryByText('Severity')).not.toBeInTheDocument();
    expect(screen.queryByText('Progress')).not.toBeInTheDocument();
    expect(screen.queryByText('Event discrepancy control')).not.toBeInTheDocument();
  });

  it('shows the Event discrepancy control only for that category', async () => {
    mocks.list.mockResolvedValue({ data: { incidents: [incident('submitted', 'Discrepancy Event', 'event_control_discrepancy', 'control-123')], reportableEvents: [event] } });
    render(<Incidents />);
    await screen.findByRole('heading', { name: 'Incident details' });
    expect(screen.getByText('Event discrepancy control')).toBeInTheDocument();
    expect(screen.getByText('control-123')).toBeInTheDocument();
  });

  it('prioritizes a new incident and enables both organizer assignment paths after a response note', async () => {
    mocks.role = 'organizer';
    mocks.list.mockResolvedValue({ data: { incidents: [
      incident('awaiting_resolution', 'Awaiting incident'),
      incident('submitted', 'New incident'),
    ], reportableEvents: [] } });
    mocks.directory.mockResolvedValue({ data: { authorities: [{
      authorityId: 'pdrm-kuala-lumpur-demo', name: 'PDRM Kuala Lumpur', authorityType: 'PDRM',
      serviceCategories: ['crowd'], coverageAreas: ['Kuala Lumpur'], contactName: 'Duty officer',
      contactPhone: '999', active: true, createdAt: 1, updatedAt: 1,
    }] } });
    render(<Incidents />);
    expect(await screen.findByRole('heading', { name: 'New incident' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign internal team' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Request external authority' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Response note'), { target: { value: 'Venue team notified.' } });
    expect(screen.getByRole('button', { name: 'Assign internal team' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Request external authority' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Assign internal team' }));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledWith(expect.objectContaining({ action: 'assign_internal', team: 'Venue operations' })));
  });

  it('shows only actions that are valid for the current organizer workflow stage', async () => {
    mocks.role = 'organizer';
    mocks.list.mockResolvedValue({ data: { incidents: [incident('awaiting_resolution', 'Awaiting incident')], reportableEvents: [] } });
    render(<Incidents />);
    await screen.findByRole('heading', { name: 'Awaiting incident' });
    expect(screen.queryByRole('button', { name: 'Assign internal team' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request external authority' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Final resolution and close' })).toBeInTheDocument();
    expect(screen.getByText(/response is complete/i)).toBeInTheDocument();
  });
});

function incident(status: 'submitted' | 'awaiting_resolution', eventName: string, category: 'crowd' | 'event_control_discrepancy' = 'crowd', linkedControlId?: string) {
  return {
    schemaVersion: '2026-09-03-m4-v1', incidentId: `${status}-incident`, eventId: 'event-1', eventVersionId: 'v1',
    venueId: 'venue-1', eventType: 'festival', eventName, organizerId: 'owner', reporterUid: 'participant', reporterRole: 'public',
    category, incidentType: category, description: 'Crowd reported near the entrance.', location: 'Main entrance',
    occurredAt: Date.now() - 1000, evidence: [], aiAssessment: { status: 'success', model: 'test', promptVersion: '2026-09-03-incident-triage-v1', severity: 'medium', immediateActionRequired: false, rationale: 'Review required.', assessedAt: Date.now() },
    severity: 'medium', immediateActionRequired: false, status, assessmentEligible: false, synthetic: true, date: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), history: [], linkedControlId,
  };
}
