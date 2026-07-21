// Firebase JS SDK v11 modular imports
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

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
