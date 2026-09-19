import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminControlListEditor from './AdminControlListEditor';

const state = vi.hoisted(() => ({ mode: 'malformed-control' as 'malformed-control' | 'malformed-proposal' | 'legacy' | 'read-error' | 'loading' }));
vi.mock('../../config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('./AdminStage2Review', () => ({ default: () => <div>Documentation workspace</div> }));
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => args[0] === 'event' ? 'proposal' : 'event',
  collection: () => 'controls',
  onSnapshot: (ref: string, next: (snapshot: unknown) => void, error: () => void) => {
    const validControl = {
      eventId: 'event-1', versionId: 'v1', controlName: 'PDRM control', authority: 'PDRM',
      stageRequirement: 'stage1_and_stage2', controlItemVersion: 1,
      stage1Requirements: [{ docType: 'receipt', label: 'Receipt', required: true }],
      stage2Requirement: { kind: 'image', label: 'Venue photo' },
    };
    if (ref === 'event') next({ exists: () => true, id: 'event-1', data: () => ({
      eventId: 'event-1', currentVersionId: 'v1', status: 'Approved',
      eventDetails: { name: 'Event', venueName: 'Venue' }, requiredAuthorities: ['PDRM'],
      controlListGenerated: true,
      controlListSnapshot: [{ controlId: 'control-1', controlName: 'PDRM control', authority: 'PDRM', stageRequirement: 'stage1_and_stage2', controlItemVersion: 1 }],
    }) });
    else if (state.mode !== 'loading' && ref === 'controls') next({ docs: [{ id: 'control-1', data: () => ({ ...validControl, ...(state.mode === 'malformed-control' ? { stage1Requirements: [null] } : {}) }) }] });
    else if (state.mode === 'read-error') error();
    else if (state.mode !== 'loading') next({ exists: () => state.mode !== 'legacy', data: () => state.mode === 'malformed-proposal'
      ? { status: 'confirmed', eventId: 'event-1', versionId: 'v1', revision: 1, items: [null] }
      : { status: 'confirmed', eventId: 'event-1', versionId: 'v1', revision: 1,
        items: [{ ...validControl, stage1Requirements: validControl.stage1Requirements }] } });
    return vi.fn();
  },
}));

function mount() {
  render(<MemoryRouter initialEntries={['/admin/applications/event-1/controls']}>
    <Routes><Route path="/admin/applications/:eventId/controls" element={<AdminControlListEditor />} /></Routes>
  </MemoryRouter>);
}

beforeEach(() => { state.mode = 'malformed-control'; });

describe('Admin control-list integrity rendering', () => {
  it('does not crash when a confirmed control has a null requirement', () => {
    mount();
    expect(screen.getByTestId('control-list-integrity-error')).toHaveTextContent('inconsistent');
    expect(screen.queryByTestId('confirmed-control-cards')).not.toBeInTheDocument();
  });

  it('locks a damaged proposal without crashing the Controls tab', () => {
    state.mode = 'malformed-proposal'; mount();
    expect(screen.getByTestId('control-list-integrity-error')).toHaveTextContent('unreadable');
  });

  it('opens a matching legacy confirmed list as read-only', () => {
    state.mode = 'legacy'; mount();
    expect(screen.getByTestId('control-list-legacy-confirmed')).toBeVisible();
    expect(screen.getByTestId('confirmed-control-cards')).toBeVisible();
    expect(screen.queryByTestId('commit-changes-button')).not.toBeInTheDocument();
  });

  it('distinguishes a proposal read error from a missing legacy proposal', () => {
    state.mode = 'read-error'; mount();
    expect(screen.getByTestId('control-list-integrity-error')).toHaveTextContent('unreadable');
    expect(screen.queryByTestId('control-list-legacy-confirmed')).not.toBeInTheDocument();
  });

  it('waits for controls and proposal before showing an integrity verdict', () => {
    state.mode = 'loading'; mount();
    expect(screen.getByTestId('control-list-integrity-loading')).toBeVisible();
    expect(screen.queryByText('Control list: inconsistent')).not.toBeInTheDocument();
  });
});
