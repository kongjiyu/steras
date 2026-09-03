import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import IncidentReportingPrototype, { isEventReportable, isIncidentOccurrencePlausible } from './IncidentReportingPrototype';

describe('IncidentReportingPrototype integration boundary', () => {
  it('gates reporting by event eligibility while allowing an older occurrence for an ongoing event', () => {
    const now = Date.UTC(2026, 8, 3, 12);
    const ongoing = { name: 'Ongoing', status: 'ongoing' as const, startedAt: Date.UTC(2026, 6, 1) };
    const exactBoundary = { name: 'Recent', status: 'completed' as const, startedAt: Date.UTC(2026, 7, 26), endedAt: now - 7 * 24 * 60 * 60 * 1_000 };
    const expired = { name: 'Expired', status: 'completed' as const, startedAt: Date.UTC(2026, 7, 25), endedAt: now - 7 * 24 * 60 * 60 * 1_000 - 1 };
    expect(isEventReportable(exactBoundary, now)).toBe(true);
    expect(isEventReportable(expired, now)).toBe(false);
    expect(isIncidentOccurrencePlausible(ongoing, '2026-08-01T12:00:00.000Z', now)).toBe(true);
    expect(isIncidentOccurrencePlausible(expired, '2026-09-03T11:00:00.000Z', now)).toBe(false);
    expect(isIncidentOccurrencePlausible(ongoing, '2026-09-03T12:00:00.001Z', now)).toBe(false);
  });

  it('stays visibly synthetic while all three role previews remain reachable', () => {
    render(<MemoryRouter><IncidentReportingPrototype /></MemoryRouter>);

    expect(screen.getByText(/Three role views use synthetic data and local interactions/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Report an incident' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Organizer view' }));
    expect(screen.getByRole('heading', { name: 'Incident action queue' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Authority view' }));
    expect(screen.getByRole('heading', { name: 'Incident investigation queue' })).toBeInTheDocument();
  });

  it('shows reporters a privacy-safe progress trail and final resolution without internal action notes', () => {
    render(<MemoryRouter><IncidentReportingPrototype /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'My submitted reports' }));
    fireEvent.click(screen.getByText('Runner treated for heat exhaustion').closest('button')!);
    expect(screen.getByText('Progress milestones')).toBeInTheDocument();
    expect(screen.getAllByText('Final resolution').length).toBeGreaterThan(0);
    expect(screen.getByText(/participant recovered after on-site treatment and observation/i)).toBeInTheDocument();
    expect(screen.queryByText(/Cooling, hydration and observation were completed/i)).not.toBeInTheDocument();
  });

  it('rejects incomplete or future-dated prototype submissions', () => {
    render(<MemoryRouter><IncidentReportingPrototype /></MemoryRouter>);

    const submit = screen.getByRole('button', { name: 'Submit incident report' });
    expect(submit).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/at least 20 characters/i);

    fireEvent.change(screen.getByLabelText(/What happened/i), {
      target: { value: 'A barrier blocked the marked emergency access route.' },
    });
    expect(submit).toBeEnabled();

    fireEvent.change(screen.getByLabelText(/Occurrence date/i), {
      target: { value: '2999-01-01T12:00' },
    });
    expect(submit).toBeDisabled();
  });

  it('does not mark organizer review complete immediately after reporter submission', () => {
    render(<MemoryRouter><IncidentReportingPrototype /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText(/What happened/i), {
      target: { value: 'A barrier blocked the marked emergency access route.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit incident report' }));

    expect(screen.getByLabelText('Report submitted: Complete')).toBeInTheDocument();
    expect(screen.getByLabelText('Organizer review: Waiting')).toBeInTheDocument();
    expect(screen.getByLabelText('Response in progress: Waiting')).toBeInTheDocument();
  });

  it('returns authority findings to the organizer and reserves closure for the organizer', () => {
    render(<MemoryRouter><IncidentReportingPrototype /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Authority view' }));
    expect(screen.queryByRole('button', { name: /close with outcome/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the organizer records the final resolution/i)).toBeInTheDocument();

    const submitFinding = screen.getByRole('button', { name: 'Submit finding to organizer' });
    expect(submitFinding).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Investigation action/i), {
      target: { value: 'Lighting was restored and the route was inspected.' },
    });
    expect(submitFinding).toBeEnabled();
    fireEvent.click(submitFinding);
    expect(screen.getByText(/finding returned to the organizer/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Organizer view' }));
    const incidentTitle = screen.getAllByText('Lighting failure along riverside walkway')[0];
    fireEvent.click(incidentTitle.closest('button')!);

    const close = screen.getByRole('button', { name: 'Record final resolution and close' });
    expect(close).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Final resolution rationale'), {
      target: { value: 'Organizer reviewed the restored lighting and authority finding.' },
    });
    expect(close).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Dismissed as false'));
    expect(close).toBeEnabled();
    fireEvent.click(close);

    expect(screen.getAllByText('Organizer reviewed the restored lighting and authority finding.')).toHaveLength(2);
    expect(screen.getByText(/Event Control outcome:/i)).toHaveTextContent('Dismissed as False');
  });

  it('does not treat an internal assignment as a completed response', () => {
    render(<MemoryRouter><IncidentReportingPrototype /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Organizer view' }));

    fireEvent.click(screen.getByRole('button', { name: /Assign internal team/i }));
    const assignmentButton = screen.getAllByRole('button', { name: 'Assign internal team' }).at(-1)!;
    fireEvent.change(screen.getByLabelText(/Assignment instruction/i), {
      target: { value: 'Deploy crowd marshals to reopen the route.' },
    });
    fireEvent.click(assignmentButton);

    expect(screen.getByText(/Record a completed internal response/i)).toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Record final resolution and close' });
    expect(close).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Action taken and outcome/i), {
      target: { value: 'Crowd marshals reopened the route and verified safe access.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record incident action' }));
    fireEvent.change(screen.getByLabelText('Final resolution rationale'), {
      target: { value: 'Organizer verified the route was clear and safe to use.' },
    });
    fireEvent.click(screen.getByLabelText('Confirmed true'));
    expect(close).toBeEnabled();
  });
});
