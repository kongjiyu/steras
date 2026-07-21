import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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
  configured: boolean;
  signIn: (email: string, password: string) => Promise<UserProfile | null>;
  signUp: (params: {
    email: string;
    password: string;
    name: string;
    phone?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch user profile from Firestore `users/{uid}`.
  const fetchProfile = async (uid: string): Promise<UserProfile | null> => {
    if (!isFirebaseConfigured) return null;
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
      if (snap.exists()) {
        return snap.data() as UserProfile;
      }
    } catch (err) {
      console.error('[Auth] Failed to fetch profile:', err);
    }
    return null;
  };

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser);
      if (fbUser) {
        const p = await fetchProfile(fbUser.uid);
        setProfile(p);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const nextProfile = await fetchProfile(credential.user.uid);
    setUser(credential.user);
    setProfile(nextProfile);
    return nextProfile;
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
    setProfile(newProfile);
  };

  const signOut = async () => {
    await fbSignOut(auth);
    setProfile(null);
  };

  const refreshProfile = async () => {
    if (user) {
      const p = await fetchProfile(user.uid);
      setProfile(p);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
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
