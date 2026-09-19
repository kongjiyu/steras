import { act, fireEvent, render as renderScreen, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { m4EventDayDate, type M4IncidentCategory, type M4IncidentStatus } from '@shared/m4';
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
async function openSubmissionForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Submit Incident Report' }));
  await screen.findByLabelText('Eligible event *');
}
function renderIncidents(initialEntry = '/incidents') {
  return renderScreen(<MemoryRouter initialEntries={[initialEntry]}><Incidents /></MemoryRouter>);
}
const render = (ui: Parameters<typeof renderScreen>[0]) => renderScreen(<MemoryRouter initialEntries={['/incidents']}>{ui}</MemoryRouter>);
function fillReport() {
  fireEvent.change(screen.getByLabelText('Eligible event *'), { target: { value: 'event-1' } });
  fireEvent.change(screen.getByLabelText('Incident category *'), { target: { value: 'crowd' } });
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
  it('opens on My reports and redirects to a separate submission page only when requested', async () => {
    renderIncidents();
    expect(await screen.findByRole('heading', { name: 'My reports' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Eligible event *')).not.toBeInTheDocument();
    await openSubmissionForm();
    expect(await screen.findByRole('heading', { name: 'Submit Incident Report' })).toBeInTheDocument();
    expect(screen.queryByText('Submitted reports')).not.toBeInTheDocument();
    await screen.findByRole('option', { name: 'QA Event' });

    expect(screen.getByLabelText('Eligible event *')).toHaveValue('');
    expect((screen.getByRole('option', { name: 'Select an ongoing or recent event' }) as HTMLOptionElement).selected).toBe(true);
    expect(screen.getByLabelText('Incident category *')).toHaveValue('');
    expect((screen.getByRole('option', { name: 'Select category' }) as HTMLOptionElement).selected).toBe(true);
    const occurrenceDate = screen.getByLabelText('Occurrence date (D-Day)') as HTMLInputElement;
    expect(occurrenceDate).toHaveValue('');
    expect(occurrenceDate).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Occurrence time *')).toBeEnabled();
    expect(screen.queryByText(/eligible events available/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/description of at least 20 characters/i)).not.toBeInTheDocument();
  });

  it('shows participant summary counts and filters incident history by search, category and status', async () => {
    mocks.list.mockResolvedValue({ data: { incidents: [
      incident('resolved', 'Resolved medical event', 'medical_safety'),
      incident('responding', 'Open crowd event', 'crowd'),
    ], reportableEvents: [event] } });
    renderIncidents();
    expect(await screen.findByRole('heading', { name: 'Incident history' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'In progress (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Resolved (1)' })).toBeInTheDocument();
    expect(screen.getByText('Resolved medical event')).toBeInTheDocument();
    expect(screen.getByText('Open crowd event')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search incident history'), { target: { value: 'Open crowd' } });
    expect(screen.queryByText('Resolved medical event')).not.toBeInTheDocument();
    expect(screen.getByText('Open crowd event')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search incident history'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Incident category filter'), { target: { value: 'medical_safety' } });
    expect(screen.getByText('Resolved medical event')).toBeInTheDocument();
    expect(screen.queryByText('Open crowd event')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Resolved (1)' }));
    expect(screen.getByText('Resolved medical event')).toBeInTheDocument();
  });

  it('renders the submission form directly at its own URL and returns to My reports', async () => {
    renderIncidents('/incidents/submit');

    expect(await screen.findByRole('heading', { name: 'Submit Incident Report' })).toBeInTheDocument();
    expect(screen.getByLabelText('Eligible event *')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'My reports' })).not.toBeInTheDocument();
    expect(screen.queryByText('Submitted reports')).not.toBeInTheDocument();
  });

  it('accepts a required description without imposing a 20-character minimum', async () => {
    render(<Incidents />);
    await openSubmissionForm();
    await screen.findByRole('option', { name: 'QA Event' });
    fillReport();
    fireEvent.change(screen.getByLabelText('Description *'), { target: { value: 'X' } });
    expect(screen.getByRole('button', { name: 'Submit Incident Report' })).toBeEnabled();
  });

  it('fixes a recently completed event to its D-Day and keeps evidence optional', async () => {
    const endDatetime = Date.now() - 24 * 60 * 60_000;
    const startDatetime = endDatetime - 2 * 60 * 60_000;
    mocks.list.mockResolvedValue({ data: { incidents: [], reportableEvents: [{
      eventId: 'recent-event', name: 'Recently completed event', startDatetime, endDatetime,
    }] } });
    render(<Incidents />);
    await openSubmissionForm();
    await screen.findByRole('option', { name: 'Recently completed event' });

    fireEvent.change(screen.getByLabelText('Eligible event *'), { target: { value: 'recent-event' } });
    expect(screen.getByLabelText('Occurrence date (D-Day)')).toHaveValue(m4EventDayDate(startDatetime));
    const occurrence = screen.getByLabelText('Occurrence time *') as HTMLInputElement;
    expect(occurrence).toHaveAttribute('max', '23:59');
    fireEvent.change(occurrence, { target: { value: '23:59' } });
    fireEvent.change(screen.getByLabelText('Incident category *'), { target: { value: 'crowd' } });
    fireEvent.change(screen.getByLabelText('Location *'), { target: { value: 'Main entrance' } });
    fireEvent.change(screen.getByLabelText('Description *'), { target: { value: 'Crowd movement slowed near the entrance.' } });

    expect(screen.getByRole('button', { name: 'Submit Incident Report' })).toBeEnabled();
    expect(screen.getByText('All required information is complete. Supporting evidence is optional.')).toBeInTheDocument();
  });

  it('shows loading rather than a false zero and recovers from a failed read', async () => {
    let fail!: (reason: Error) => void;
    mocks.list.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    render(<Incidents />);
    expect(screen.getByText('Loading incident records...')).toBeInTheDocument();
    expect(screen.queryByText('0 submitted reports')).not.toBeInTheDocument();
    await openSubmissionForm();
    await act(async () => fail(new Error('offline')));
    expect(await screen.findByText('Record count unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Incident Report' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('0 submitted reports')).toBeInTheDocument();
    expect(screen.queryByText(/could not be refreshed/)).not.toBeInTheDocument();
  });

  it('retains the same request key after a lost response and changes it after an edit', async () => {
    mocks.submit.mockRejectedValue(new Error('Response lost'));
    render(<Incidents />);
    await openSubmissionForm();
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

  it('shows a submission loading state and prevents duplicate clicks while Firebase is pending', async () => {
    let resolveSubmit!: (value: { data: Record<string, unknown> }) => void;
    mocks.submit.mockImplementationOnce(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    render(<Incidents />);
    await openSubmissionForm();
    await screen.findByRole('option', { name: 'QA Event' });
    fillReport();

    const button = screen.getByRole('button', { name: 'Submit Incident Report' });
    fireEvent.click(button);

    expect(await screen.findByRole('button', { name: 'Submitting incident report' })).toBeDisabled();
    expect(screen.getByText('Submitting incident report… Please keep this page open.')).toBeInTheDocument();
    expect(mocks.submit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Submitting incident report' }));
    expect(mocks.submit).toHaveBeenCalledOnce();

    await act(async () => resolveSubmit({ data: {} }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Submitting incident report' })).not.toBeInTheDocument());
  });

  it('does not turn a successful submission into a failed submission when refresh fails', async () => {
    render(<Incidents />);
    await openSubmissionForm();
    await screen.findByRole('option', { name: 'QA Event' });
    fillReport();
    mocks.list.mockRejectedValue(new Error('refresh offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Incident Report' }));
    await screen.findByText(/could not be refreshed/);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('heading', { name: 'Submit Incident Report' })).not.toBeInTheDocument();
    expect(screen.getByText('Incident report submitted. It is now available in My reports.')).toBeInTheDocument();
    expect(screen.queryByText('Submission failed.')).not.toBeInTheDocument();
  });

  it('locks the occurrence date to D-Day and sends the selected time to the backend', async () => {
    render(<Incidents />);
    await openSubmissionForm();
    await screen.findByRole('option', { name: 'QA Event' });
    fillReport();
    const occurrenceDate = screen.getByLabelText('Occurrence date (D-Day)') as HTMLInputElement;
    const occurrenceTime = screen.getByLabelText('Occurrence time *') as HTMLInputElement;
    expect(occurrenceDate).toHaveValue(m4EventDayDate(event.startDatetime));
    expect(occurrenceDate).toHaveAttribute('readonly');
    expect(occurrenceTime).toHaveAttribute('type', 'time');
    expect(occurrenceTime).toHaveAttribute('min', '00:00');
    expect(occurrenceTime).toHaveAttribute('max', '23:59');
    fireEvent.change(occurrenceTime, { target: { value: '10:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Incident Report' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit.mock.calls[0][0].occurredAt).toBe(Date.parse('2020-01-01T10:15:00+08:00'));
  });

  it('lists uploaded evidence names and removes only the selected file', async () => {
    render(<Incidents />);
    await openSubmissionForm();
    const first = new File(['first'], 'crowd-photo.jpg', { type: 'image/jpeg' });
    const second = new File(['second'], 'access-map.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Supporting evidence (optional)'), { target: { files: [first, second] } });
    expect(screen.getByText('crowd-photo.jpg')).toBeInTheDocument();
    expect(screen.getByText('access-map.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove crowd-photo.jpg' }));
    expect(screen.queryByText('crowd-photo.jpg')).not.toBeInTheDocument();
    expect(screen.getByText('access-map.pdf')).toBeInTheDocument();
  });

  it.each(['organizer', 'authority'])('does not expose submission to %s accounts', async (role) => {
    mocks.role = role;
    render(<Incidents />);
    if (role === 'organizer') {
      await screen.findByRole('tab', { name: 'Action required (0)' });
    } else {
      await screen.findByText('0 accessible records');
    }
    expect(screen.queryByRole('heading', { name: 'Submit Incident Report' })).not.toBeInTheDocument();
    expect(screen.getByText(/can review and act/)).toBeInTheDocument();
  });

  it('gives organizers focused indicators and separates active work from closed records', async () => {
    mocks.role = 'organizer';
    mocks.list.mockResolvedValue({ data: { incidents: [
      { ...incident('submitted', 'Action needed'), severity: 'high' as const },
      { ...incident('awaiting_resolution', 'Resolution ready'), severity: 'high' as const },
      incident('responding', 'Team responding'),
      incident('resolved', 'Closed case'),
    ], reportableEvents: [] } });
    renderIncidents('/organizer/incidents');

    expect(await screen.findByText('Action Required')).toBeInTheDocument();
    expect(screen.getByText('High Severity')).toBeInTheDocument();
    expect(screen.getByText('Resolution Review')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Action required (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Resolution review (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'In progress (1)' })).toBeInTheDocument();
    const selectedAction = screen.getByRole('button', { name: /Action needed/ });
    expect(selectedAction).toHaveAttribute('aria-current', 'true');
    expect(selectedAction).toHaveTextContent('Action needed');
    expect(selectedAction).not.toHaveTextContent('Selected incident');
    expect(selectedAction.textContent).not.toContain('Action required');
    expect(screen.queryByText('Resolution ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Closed case')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Resolution review (1)' }));
    const resolutionReady = await screen.findByRole('button', { name: /Resolution ready/ });
    expect(resolutionReady).toHaveTextContent('Resolution ready');
    expect(resolutionReady.textContent).not.toContain('Review for resolution');
    expect(screen.queryByText('Action needed')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'In progress (1)' }));
    const teamResponding = await screen.findByRole('button', { name: /Team responding/ });
    expect(teamResponding).toHaveTextContent('Team responding');
    expect(teamResponding.textContent).toContain('In progress');
  });

  it('keeps the selected authority incident name visible', async () => {
    mocks.role = 'authority';
    mocks.list.mockResolvedValue({ data: { incidents: [
      { ...incident('authority_investigation', 'Authority case'), severity: 'high' as const },
    ], reportableEvents: [] } });
    renderIncidents('/authority/incidents');

    const selectedIncident = await screen.findByRole('button', { name: /Authority case/ });
    expect(selectedIncident).toHaveAttribute('aria-current', 'true');
    expect(selectedIncident).toHaveTextContent('Authority case');
    expect(selectedIncident).not.toHaveTextContent('Selected incident');
  });

  it('opens a searchable full organizer incident list with status tabs', async () => {
    mocks.role = 'organizer';
    mocks.list.mockResolvedValue({ data: { incidents: [
      { ...incident('submitted', 'Pending report'), severity: 'high' as const },
      incident('responding', 'Ongoing report'),
      incident('resolved', 'Closed report'),
    ], reportableEvents: [] } });
    renderIncidents('/organizer/incidents/list');

    expect(await screen.findByRole('heading', { name: 'Incident list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Incident queue' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Organizer report list' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All (3)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ongoing (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pending action (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Closed (1)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search incident reports')).toBeInTheDocument();
    expect(screen.getByLabelText('Organizer incident category filter')).toBeInTheDocument();
    expect(screen.getByText('Pending report')).toBeInTheDocument();
    expect(screen.getByText('Closed report')).toBeInTheDocument();
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
    await openSubmissionForm();
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
    await screen.findByRole('heading', { name: 'Crowd Congestion or Overcrowding' });
    expect(screen.getByText('submitted-incident')).toBeInTheDocument();
    for (const label of ['Location', 'Occurred', 'Description']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('Evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('AI assessment')).not.toBeInTheDocument();
    expect(screen.queryByText('Severity')).not.toBeInTheDocument();
    expect(screen.queryByText('Progress')).not.toBeInTheDocument();
    expect(screen.queryByText('Event discrepancy control')).not.toBeInTheDocument();
  });

  it('shows the Event discrepancy control only for that category', async () => {
    mocks.list.mockResolvedValue({ data: { incidents: [incident('submitted', 'Discrepancy Event', 'event_control_discrepancy', 'control-123')], reportableEvents: [event] } });
    render(<Incidents />);
    await screen.findByRole('heading', { name: 'Published Event Control Discrepancy' });
    expect(screen.getByText('Event discrepancy control')).toBeInTheDocument();
    expect(screen.getByText('control-123')).toBeInTheDocument();
  });

  it('prioritizes a new incident and enables both organizer assignment paths after a response note', async () => {
    mocks.role = 'organizer';
    mocks.list.mockResolvedValue({ data: { incidents: [
      incident('awaiting_resolution', 'Awaiting incident'),
      { ...incident('submitted', 'New incident'), immediateActionRequired: true, aiAssessment: { ...incident('submitted', 'New incident').aiAssessment, immediateActionRequired: true } },
    ], reportableEvents: [] } });
    mocks.directory.mockResolvedValue({ data: { authorities: [{
      authorityId: 'pdrm-kuala-lumpur-demo', name: 'PDRM Kuala Lumpur', authorityType: 'PDRM',
      serviceCategories: ['crowd'], coverageAreas: ['Kuala Lumpur'], contactName: 'Duty officer',
      contactPhone: '999', active: true, createdAt: 1, updatedAt: 1,
    }] } });
    render(<Incidents />);
    expect(await screen.findByRole('heading', { name: 'New incident' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open assignment/ }));
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
    fireEvent.click(await screen.findByRole('tab', { name: 'Resolution review (1)' }));
    await screen.findByRole('heading', { name: 'Awaiting incident' });
    expect(screen.queryByRole('button', { name: 'Assign internal team' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request external authority' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Final resolution and close' })).toBeInTheDocument();
    expect(screen.getByText(/response is complete/i)).toBeInTheDocument();
  });
});

function incident(status: M4IncidentStatus, eventName: string, category: M4IncidentCategory = 'crowd', linkedControlId?: string) {
  return {
    schemaVersion: '2026-09-03-m4-v1', incidentId: `${status}-incident`, eventId: 'event-1', eventVersionId: 'v1',
    venueId: 'venue-1', eventType: 'festival', eventName, organizerId: 'owner', reporterUid: 'participant', reporterRole: 'public',
    category, incidentType: category, description: 'Crowd reported near the entrance.', location: 'Main entrance',
    occurredAt: Date.now() - 1000, evidence: [], aiAssessment: { status: 'success', model: 'test', promptVersion: '2026-09-03-incident-triage-v1', severity: 'medium', immediateActionRequired: false, rationale: 'Review required.', assessedAt: Date.now() },
    severity: 'medium', immediateActionRequired: false, status, assessmentEligible: false, synthetic: true, date: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), history: [], linkedControlId,
  };
}
