import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TemplateRecommendationPage, { TemplateRecommendationErrorModal, templateRecommendationErrorMessage } from './TemplateRecommendationPage';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'organizer-1' },
    profile: { name: 'Alya', email: 'alya@example.com', phone: '+60123456789' },
  }),
}));

vi.mock('../../config/firebase', () => ({
  db: {},
  isFirebaseConfigured: false,
}));

vi.mock('../../features/m1/TemplatePreview', () => ({
  default: ({ scenario }: { scenario: { title: string } }) => <div data-testid="template-preview">Preview: {scenario.title}</div>,
}));

describe('TemplateRecommendationPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires both answers before showing a recommendation', async () => {
    render(<MemoryRouter><TemplateRecommendationPage /></MemoryRouter>);
    expect(screen.getByText('Your recommendation will appear here')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Sports & recreation/ }));
    expect(screen.getByText('Your recommendation will appear here')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Outdoor route-based/ }));
    expect(screen.getByText('Complete these two documents')).toBeInTheDocument();
    expect(screen.getByText('Sports and Recreational Event - Outdoor Route-Based')).toBeInTheDocument();
    expect(await screen.findByTestId('template-preview')).toHaveTextContent('Sports and Recreational Event - Outdoor Route-Based');
  });

  it('shows category examples and risk information through the info control', () => {
    render(<MemoryRouter><TemplateRecommendationPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'More information about Entertainment and Performance Event' }));
    expect(screen.getByText('Concert, Theatre, Live performance, Fashion show')).toBeInTheDocument();
    expect(screen.getByText(/Crowd congestion, Stage safety/)).toBeInTheDocument();
  });

  it('keeps Start application disabled until the organizer confirms review', () => {
    render(<MemoryRouter><TemplateRecommendationPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('radio', { name: /Entertainment & performance/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Indoor/ }));
    const start = screen.getByRole('button', { name: /Start application/ });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(start).toBeEnabled();
  });

  it('lists core and scenario evidence vertically in two separate groups', () => {
    render(<MemoryRouter><TemplateRecommendationPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('radio', { name: /Sports & recreation/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Outdoor route-based/ }));
    const core = screen.getByRole('region', { name: 'Core supporting documents' });
    const scenario = screen.getByRole('region', { name: 'Scenario supporting documents' });
    expect(within(core).getAllByRole('listitem')).toHaveLength(9);
    expect(within(core).getByText('Total 9')).toBeInTheDocument();
    expect(within(scenario).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(within(scenario).getByText(/^Total \d+$/)).toBeInTheDocument();
    expect(screen.getByText(/evidence requirements rather than downloadable templates/i)).toBeInTheDocument();
  });

  it('ignores malformed draft and recommendation query parameters without crashing', () => {
    render(<MemoryRouter initialEntries={['/organizer/events/new?draft=a%2Fb&category=unknown&venue=indoor']}><TemplateRecommendationPage /></MemoryRouter>);
    expect(screen.getByText('Find the right application templates')).toBeInTheDocument();
    expect(screen.getByText('Your recommendation will appear here')).toBeInTheDocument();
  });

  it('turns Firebase update failures into an error type and a recovery action', () => {
    expect(templateRecommendationErrorMessage({ code: 'permission-denied' }, 'update')).toBe(
      'Permission check failed — Open My Events and confirm this Draft belongs to the signed-in organizer and is still editable, then try again.',
    );
    expect(templateRecommendationErrorMessage({ code: 'unavailable' }, 'update')).toBe(
      'Connection problem — Check your internet connection, keep this page open, and try again.',
    );
    expect(templateRecommendationErrorMessage({ code: 'aborted' }, 'update')).toBe(
      'Draft changed elsewhere — Reload this Draft from My Events before changing the templates again.',
    );
  });

  it('shows blocking template errors in a modal with recovery actions', () => {
    const close = vi.fn();
    const openMyEvents = vi.fn();
    render(<TemplateRecommendationErrorModal
      message="Permission check failed — Open My Events and confirm this Draft is editable."
      onClose={close}
      onOpenMyEvents={openMyEvents}
    />);
    expect(screen.getByRole('dialog', { name: 'We could not save this recommendation' })).toBeInTheDocument();
    expect(screen.getByText('Permission check failed')).toBeInTheDocument();
    expect(screen.getByText('Open My Events and confirm this Draft is editable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open My Events' }));
    expect(openMyEvents).toHaveBeenCalledOnce();
  });
});
