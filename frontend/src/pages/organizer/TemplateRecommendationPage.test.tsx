import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TemplateRecommendationPage from './TemplateRecommendationPage';

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
});
