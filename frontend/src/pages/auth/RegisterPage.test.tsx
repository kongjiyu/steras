import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RegisterPage from './RegisterPage';

const { signUp, toastError } = vi.hoisted(() => ({ signUp: vi.fn(), toastError: vi.fn() }));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, profile: null, signUp, configured: true }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: toastError },
}));

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/organizer" element={<div>Organizer workspace</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function completeRequiredFields() {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Test Organizer' } });
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123!' } });
  fireEvent.change(screen.getByLabelText('Phone number *'), { target: { value: '0123456789' } });
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('RegisterPage', () => {
  beforeEach(() => {
    signUp.mockReset();
    toastError.mockReset();
  });

  it('creates an organizer with a normalized phone and consent then navigates once', async () => {
    signUp.mockResolvedValue(undefined);
    renderPage();
    completeRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Create organiser account' }));

    await waitFor(() => expect(screen.getByText('Organizer workspace')).toBeInTheDocument());
    expect(signUp.mock.calls[0][0]).toMatchObject({ phone: '+60123456789', termsVersion: '2026-09-07' });
    expect(Object.keys(signUp.mock.calls[0][0])).not.toContain('role');
    expect(signUp).toHaveBeenCalledOnce();
  });

  it('blocks invalid names, weak passwords, invalid phones and missing consent without calling Auth', async () => {
    renderPage(); completeRequiredFields();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '12345' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'abcdefgh' } });
    fireEvent.change(screen.getByLabelText('Phone number *'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(screen.getByRole('button', { name: 'Create organiser account' }).closest('form')!);
    expect(signUp).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert')).toHaveLength(4);
  });

  it('does not offer public, authority, or admin self-registration choices', () => {
    renderPage();
    expect(screen.getByText('Event organiser')).toBeInTheDocument();
    expect(screen.queryByText('Public viewer')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Account type' })).not.toBeInTheDocument();
  });

  it('preserves input and re-enables submission when registration fails', async () => {
    signUp.mockRejectedValue({ code: 'auth/email-already-in-use' });
    renderPage();
    completeRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Create organiser account' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('already exists'));
    expect(screen.getByLabelText('Email address')).toHaveValue('test@example.com');
    expect(screen.getByRole('button', { name: 'Create organiser account' })).toBeEnabled();
  });

  it('prevents duplicate submissions while account creation is pending', async () => {
    signUp.mockImplementation(() => new Promise(() => undefined));
    renderPage();
    completeRequiredFields();
    const button = screen.getByRole('button', { name: 'Create organiser account' });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Creating account…' })).toBeDisabled());
    expect(signUp).toHaveBeenCalledOnce();
  });
});
