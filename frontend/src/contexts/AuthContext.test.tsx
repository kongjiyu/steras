import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  onAuth: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('../config/firebase', () => ({ auth: {}, db: {}, isFirebaseConfigured: true }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mocks.onAuth,
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: mocks.createUser,
  deleteUser: mocks.deleteUser,
  signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: mocks.getDoc,
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

  it('defaults signUp to the organizer role when no role is provided', async () => {
    mocks.setDoc.mockResolvedValue(undefined);
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(() => authApi.signUp({ email: 'organizer-default@example.com', password: 'password123', name: 'Default Organizer' }));
    const write = mocks.setDoc.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(write?.role).toBe('organizer');
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


describe('AuthProvider profile recovery', () => {
  it('distinguishes a failed profile read from a missing profile and supports retry', async () => {
    let callback!: (user: unknown) => Promise<void>;
    mocks.onAuth.mockImplementation((_: unknown, next: typeof callback) => { callback = next; return vi.fn(); });
    mocks.getDoc.mockRejectedValueOnce(new Error('offline'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(() => callback({ uid: 'existing-user' }));
    expect(authApi.loading).toBe(false);
    expect(authApi.profileError).toMatch(/could not be loaded/);
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ uid: 'existing-user', email: 'existing@example.com', role: 'organizer' }) });
    await act(() => authApi.refreshProfile());
    expect(authApi.profileError).toBe('');
    expect(screen.getByText('existing@example.com')).toBeInTheDocument();
  });

  it('does not restore a stale profile after sign-out while a read was pending', async () => {
    let callback!: (user: unknown) => Promise<void>;
    let resolve!: (value: unknown) => void;
    mocks.onAuth.mockImplementation((_: unknown, next: typeof callback) => { callback = next; return vi.fn(); });
    mocks.getDoc.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<AuthProvider><Probe /></AuthProvider>);
    let pending!: Promise<void>;
    act(() => { pending = callback({ uid: 'old-user' }); });
    await act(() => callback(null));
    await act(async () => { resolve({ exists: () => true, data: () => ({ uid: 'old-user', email: 'stale@example.com' }) }); await pending; });
    expect(authApi.user).toBeNull();
    expect(authApi.profile).toBeNull();
  });

  it('ends the loading screen when the profile service never responds', async () => {
    vi.useFakeTimers();
    try {
      let callback!: (user: unknown) => Promise<void>;
      mocks.onAuth.mockImplementation((_: unknown, next: typeof callback) => { callback = next; return vi.fn(); });
      mocks.getDoc.mockImplementationOnce(() => new Promise(() => {}));
      render(<AuthProvider><Probe /></AuthProvider>);
      let pending!: Promise<void>;
      act(() => { pending = callback({ uid: 'slow-user' }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); await pending; });
      expect(authApi.loading).toBe(false);
      expect(authApi.profileError).toMatch(/could not be loaded/);
    } finally { vi.useRealTimers(); }
  });
});
