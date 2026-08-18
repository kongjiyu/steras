// Firebase JS SDK v11 modular imports
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, collection, type Firestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';

// Public Firebase config — these values are safe to expose in client code.
// Real security is enforced by Firestore Security Rules, not API key hiding.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Validate that required env vars are present.
// We don't hard-fail in dev — pages can still render with a "configure Firebase" warning.
function validateConfig() {
  const required = ['apiKey', 'projectId', 'authDomain', 'appId'] as const;
  const missing = required.filter((k) => !firebaseConfig[k]);
  if (missing.length > 0) {
    console.warn(
      `[Firebase] Missing env vars: ${missing.join(', ')}. ` +
      `Copy frontend/.env.example to frontend/.env and fill in.`,
    );
  }
  return missing.length === 0;
}

export const isFirebaseConfigured = validateConfig();

// Service instances — only initialized when Firebase is configured.
// This lets prototype / preview routes render without real .env credentials.
let app: FirebaseApp | null = null;
let authInst: Auth | null = null;
let dbInst: Firestore | null = null;
let storageInst: FirebaseStorage | null = null;
let functionsInst: Functions | null = null;

if (isFirebaseConfigured) {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  authInst = getAuth(app);
  dbInst = getFirestore(app);
  storageInst = getStorage(app);
  functionsInst = getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION ?? 'asia-southeast1');

  // Connect to local emulators if enabled.
  const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';
  if (useEmulator) {
    try {
      connectAuthEmulator(authInst, 'http://localhost:9099', { disableWarnings: true });
      connectFirestoreEmulator(dbInst, 'localhost', 8080);
      connectStorageEmulator(storageInst, 'localhost', 9199);
      connectFunctionsEmulator(functionsInst, 'localhost', 5001);
      console.info('[Firebase] Connected to local emulators.');
    } catch (err) {
      console.warn('[Firebase] Failed to connect emulators:', err);
    }
  }
}

// Re-exports — typed as non-null when configured; consumers must check
// `isFirebaseConfigured` before use (AuthContext already does this).
export const auth = authInst as Auth;
export const db = dbInst as Firestore;
export const storage = storageInst as FirebaseStorage;
export const functions = functionsInst as Functions;

export default app;

// Expose high-level helpers on `window` so E2E tests (Playwright) can call
// Cloud Functions and read/write Firestore using the signed-in auth session.
// The SDKs cannot cross the page-eval boundary as bare function references
// (they need their full module context), so we expose self-contained helper
// closures here. See tests/m3/fixtures.ts.
if (typeof window !== 'undefined' && isFirebaseConfigured) {
  (window as unknown as { __sterasFirebase?: {
    auth: Auth;
    db: Firestore;
    callable: <TReq, TRes>(name: string, data: TReq) => Promise<TRes>;
    getDoc: <T = Record<string, unknown>>(path: string) => Promise<T | null>;
    setDoc: (path: string, data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
    deleteDoc: (path: string) => Promise<void>;
    getCollection: <T = Record<string, unknown>>(path: string) => Promise<Array<{ id: string } & T>>;
    signInWithEmail: (email: string, password: string) => Promise<{ uid: string }>;
    signOutCurrent: () => Promise<void>;
  } }).__sterasFirebase = {
    auth: authInst as Auth,
    db: dbInst as Firestore,
    callable: async <TReq, TRes>(name: string, data: TReq) => {
      if (!functionsInst) throw new Error('Firebase Functions not configured.');
      const fn = httpsCallable(functionsInst, name);
      const result = await fn(data);
      return result.data as TRes;
    },
    getDoc: async <T,>(path: string) => {
      const snap = await (await import('firebase/firestore')).getDoc(doc(dbInst as Firestore, path));
      return snap.exists() ? (snap.data() as T) : null;
    },
    setDoc: async (path: string, data: Record<string, unknown>, opts = { merge: true }) => {
      const fs = await import('firebase/firestore');
      await fs.setDoc(doc(dbInst as Firestore, path), data, { merge: opts.merge ?? true });
    },
    deleteDoc: async (path: string) => {
      const fs = await import('firebase/firestore');
      await fs.deleteDoc(doc(dbInst as Firestore, path));
    },
    getCollection: async <T,>(path: string) => {
      const fs = await import('firebase/firestore');
      const snap = await fs.getDocs(collection(dbInst as Firestore, path));
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
    },
    // Test-only auth helpers. The bare Auth instance imported into this
    // file doesn't always carry signInWithEmailAndPassword after Vite
    // tree-shaking. Use the dynamic import + the same auth instance
    // to guarantee the method is present at call time.
    signInWithEmail: async (email: string, password: string) => {
      const authMod = await import('firebase/auth');
      const cred = await authMod.signInWithEmailAndPassword(authInst as Auth, email, password);
      return { uid: cred.user.uid };
    },
    signOutCurrent: async () => {
      const authMod = await import('firebase/auth');
      await authMod.signOut(authInst as Auth);
    },
  };
}
