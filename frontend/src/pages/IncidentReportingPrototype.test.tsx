import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import IncidentReportingPrototype from './IncidentReportingPrototype';

describe('IncidentReportingPrototype integration boundary', () => {
  it('stays visibly synthetic while all three role previews remain reachable', () => {
    render(<MemoryRouter><IncidentReportingPrototype /></MemoryRouter>);

    expect(screen.getByText(/Three role views use synthetic data and local interactions/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Report an incident' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Organizer view' }));
    expect(screen.getByRole('heading', { name: 'Incident action queue' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Authority view' }));
    expect(screen.getByRole('heading', { name: 'Incident investigation queue' })).toBeInTheDocument();
  });
});
