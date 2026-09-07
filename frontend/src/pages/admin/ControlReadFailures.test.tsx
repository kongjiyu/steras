import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import AdminStage2Review from './AdminStage2Review';
import OrganizerEventControls from '../organizer/OrganizerEventControls';

const state = vi.hoisted(() => ({ failed: true }));
vi.mock('../../config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({
  doc: () => 'event', collection: () => 'controls', query: (ref: string) => ref, where: vi.fn(),
  onSnapshot: (ref: string, next: (value: unknown) => void, error: (error: Error) => void) => {
    if (ref === 'event') next({ exists: () => state.failed, id: 'event-1', data: () => ({ currentVersionId: 'v1', status: 'Approved', eventDetails: { venueName: 'Venue' } }) });
    else if (state.failed) error(new Error('permission-denied'));
    else next({ docs: [] });
    return vi.fn();
  },
}));
beforeEach(() => { state.failed = true; });
it.each([['admin', AdminStage2Review], ['organizer', OrganizerEventControls]] as const)('%s evidence failures cannot masquerade as missing submissions', (_, Page) => {
  render(<MemoryRouter initialEntries={['/events/event-1']}><Routes><Route path="/events/:eventId" element={<Page />} /></Routes></MemoryRouter>);
  expect(screen.getByText('Event unavailable')).toBeInTheDocument();
  expect(screen.getByText(/Control requirements or evidence could not be loaded/)).toBeInTheDocument();
  state.failed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Event not found')).toBeInTheDocument();
});
