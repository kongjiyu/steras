import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  setDoc: vi.fn(),
}));

vi.mock('../config/firebase', () => ({ auth: {}, db: {}, isFirebaseConfigured: true }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => vi.fn()),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: mocks.createUser,
  deleteUser: mocks.deleteUser,
  signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: mocks.setDoc,
  serverTimestamp: vi.fn(() => 'server-time'),
}));

let authApi: ReturnType<typeof useAuth>;
function Probe() {
  authApi = useAuth();
  return <div>{authApi.profile?.email ?? 'No profile'}</div>;
}

describe('AuthProvider sign-up consistency', () => {
  beforeEach(() => {
    mocks.createUser.mockReset();
    mocks.deleteUser.mockReset();
    mocks.setDoc.mockReset();
    mocks.createUser.mockResolvedValue({ user: { uid: 'new-user' } });
    mocks.deleteUser.mockResolvedValue(undefined);
  });

  it('creates the Firestore organizer profile after Authentication succeeds', async () => {
    mocks.setDoc.mockResolvedValue(undefined);
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(() => authApi.signUp({ email: 'new@example.com', password: 'password123', name: 'New User' }));
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it('deletes the new Authentication user when profile creation fails', async () => {
    const firestoreError = new Error('Firestore unavailable');
    mocks.setDoc.mockRejectedValue(firestoreError);
    render(<AuthProvider><Probe /></AuthProvider>);
    await expect(act(() => authApi.signUp({ email: 'orphan@example.com', password: 'password123', name: 'Orphan' })))
      .rejects.toThrow('Firestore unavailable');
    expect(mocks.deleteUser).toHaveBeenCalledWith({ uid: 'new-user' });
    expect(screen.getByText('No profile')).toBeInTheDocument();
  });
});
