import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import AdminAssignment, { hasCompleteOfficerSelection } from './AdminAssignment';

const state = vi.hoisted(() => ({ mode: 'missing' }));
vi.mock('../../config/firebase', () => ({ db: {}, functions: {}, isFirebaseConfigured: true }));
vi.mock('../../hooks/useDisplayIdentities', () => ({ useDisplayIdentities: () => ({}), displayIdentityName: () => 'Officer' }));
vi.mock('firebase/firestore', () => ({
  doc: () => 'event', collection: () => 'assignments',
  onSnapshot: (ref: string, next: (v: unknown) => void, error: () => void) => {
    if (ref === 'event') {
      if (state.mode === 'error') error();
      else next({ exists: () => false });
    } else next({ docs: [] });
    return vi.fn();
  },
}));
beforeEach(() => { state.mode = 'missing'; });
function mount() { render(<MemoryRouter initialEntries={['/admin/applications/missing/assign']}><Routes><Route path="/admin/applications/:eventId/assign" element={<AdminAssignment />} /></Routes></MemoryRouter>); }
it('ends loading for a missing event', () => {
  mount();
  expect(screen.getByText('Application not found')).toBeInTheDocument();
  expect(screen.queryByText('Loading application...')).not.toBeInTheDocument();
});
it('shows a retryable read failure and recovers', () => {
  state.mode = 'error'; mount();
  expect(screen.getByText('Assignment workspace unavailable')).toBeInTheDocument();
  state.mode = 'missing'; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Application not found')).toBeInTheDocument();
});

it('requires an eligible officer selection for every authority before assignment', () => {
  expect(hasCompleteOfficerSelection(['PDRM', 'BOMBA', 'KKM', 'DBKL'], {
    PDRM: 'pdrm-1', BOMBA: 'bomba-1', KKM: 'kkm-1',
  })).toBe(false);
  expect(hasCompleteOfficerSelection(['PDRM', 'BOMBA', 'KKM', 'DBKL'], {
    PDRM: 'pdrm-1', BOMBA: 'bomba-1', KKM: 'kkm-1', DBKL: 'dbkl-1',
  })).toBe(true);
});
