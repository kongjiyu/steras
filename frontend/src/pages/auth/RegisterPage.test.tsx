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
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
}

describe('RegisterPage', () => {
  beforeEach(() => {
    signUp.mockReset();
    toastError.mockReset();
  });

  it('creates an organizer without an optional phone and navigates once', async () => {
    signUp.mockResolvedValue(undefined);
    renderPage();
    completeRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(screen.getByText('Organizer workspace')).toBeInTheDocument());
    expect(Object.keys(signUp.mock.calls[0][0])).not.toContain('phone');
    expect(signUp).toHaveBeenCalledOnce();
  });

  it('preserves input and re-enables submission when registration fails', async () => {
    signUp.mockRejectedValue({ code: 'auth/email-already-in-use' });
    renderPage();
    completeRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('already exists')));
    expect(screen.getByLabelText('Email address')).toHaveValue('test@example.com');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('prevents duplicate submissions while account creation is pending', async () => {
    signUp.mockImplementation(() => new Promise(() => undefined));
    renderPage();
    completeRequiredFields();
    const button = screen.getByRole('button', { name: 'Create account' });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Creating account…' })).toBeDisabled());
    expect(signUp).toHaveBeenCalledOnce();
  });
});
