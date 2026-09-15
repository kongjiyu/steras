import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  deleteUser,
  signOut as fbSignOut,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../config/firebase';
import { COLLECTIONS, UserProfile } from '@shared/types';
import { buildOrganizerProfile } from './authProfile';

interface AuthContextValue {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  profileError: string;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<UserProfile | null>;
  signUp: (params: {
    email: string;
    password: string;
    name: string;
    phone?: string;
    termsVersion?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const profileRequest = useRef(0);

  // Fetch user profile from Firestore `users/{uid}`.
  const fetchProfile = async (uid: string): Promise<UserProfile | null> => {
    if (!isFirebaseConfigured) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const snap = await Promise.race([
        getDoc(doc(db, COLLECTIONS.USERS, uid)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Profile request timed out')), 15000);
        }),
      ]);
      if (snap.exists()) {
        return snap.data() as UserProfile;
      }
    } catch (err) {
      console.error('[Auth] Failed to fetch profile:', err);
      throw new Error('Your workspace profile could not be loaded. Check your connection and try again.');
    } finally {
      clearTimeout(timer);
    }
    return null;
  };

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }

    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      const request = ++profileRequest.current;
      setUser(fbUser);
      setProfile(null);
      setProfileError('');
      try {
        const p = fbUser ? await fetchProfile(fbUser.uid) : null;
        if (active && request === profileRequest.current) setProfile(p);
      } catch (error) {
        if (active && request === profileRequest.current) setProfileError((error as Error).message);
      } finally {
        if (active && request === profileRequest.current) setLoading(false);
      }
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const signIn = async (email: string, password: string) => {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const request = ++profileRequest.current;
    try {
      const nextProfile = await fetchProfile(credential.user.uid);
      if (request === profileRequest.current) {
        setUser(credential.user);
        setProfile(nextProfile);
        setProfileError('');
      }
      return nextProfile;
    } catch (error) {
      if (request === profileRequest.current) {
        setProfile(null);
        setProfileError((error as Error).message);
      }
      throw error;
    } finally {
      if (request === profileRequest.current) setLoading(false);
    }
  };

  const signUp: AuthContextValue['signUp'] = async (params) => {
    const { email, password, name, phone } = params;
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    const now = Date.now();

    const newProfile = buildOrganizerProfile({
      uid,
      name,
      email,
      phone,
      now,
    });

    try {
      await setDoc(doc(db, COLLECTIONS.USERS, uid), {
        ...newProfile,
        ...(params.termsVersion ? { termsVersion: params.termsVersion, termsAcceptedAt: now } : {}),
        // Store serverTimestamp as well for server-side sorting consistency
        _serverCreatedAt: serverTimestamp(),
      });
    } catch (profileError) {
      // Authentication is created before the Firestore profile. Compensate on
      // failure so the email is not left occupied by an unusable account.
      try {
        await deleteUser(cred.user);
      } catch (cleanupError) {
        console.error('[Auth] Failed to remove incomplete account:', cleanupError);
      }
      throw profileError;
    }
    ++profileRequest.current;
    setUser(cred.user);
    setProfile(newProfile);
    setProfileError('');
    setLoading(false);
  };

  const signOut = async () => {
    await fbSignOut(auth);
    ++profileRequest.current;
    setUser(null);
    setProfile(null);
    setProfileError('');
    setLoading(false);
  };

  const refreshProfile = async () => {
    if (user) {
      const request = ++profileRequest.current;
      try {
        const p = await fetchProfile(user.uid);
        if (request === profileRequest.current) {
          setProfile(p);
          setProfileError('');
        }
      } catch (error) {
        if (request === profileRequest.current) setProfileError((error as Error).message);
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileError,
        configured: isFirebaseConfigured,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
