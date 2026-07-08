// Firebase JS SDK v11 modular imports
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

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
    // eslint-disable-next-line no-console
    console.warn(
      `[Firebase] Missing env vars: ${missing.join(', ')}. ` +
      `Copy frontend/.env.example to frontend/.env and fill in.`,
    );
  }
  return missing.length === 0;
}

export const isFirebaseConfigured = validateConfig();

// Initialize Firebase (singleton — getApps() check prevents double init in HMR).
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Service instances.
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Connect to local emulators if enabled.
const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';
if (useEmulator && isFirebaseConfigured) {
  try {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectStorageEmulator(storage, 'localhost', 9199);
    // eslint-disable-next-line no-console
    console.info('[Firebase] Connected to local emulators.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[Firebase] Failed to connect emulators:', err);
  }
}

export default app;
