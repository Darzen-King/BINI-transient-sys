import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, initializeFirestore, persistentLocalCache, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

import { appCheckSiteKey } from './app-check.js';
import { readFirebaseConfig } from './firebase-config.js';

export interface FirebaseClient {
  auth: Auth;
  db: Firestore;
  functions: Functions;
  propertyId: string;
}

export function createFirebaseClient(env: ImportMetaEnv): FirebaseClient {
  const firstInit = getApps().length === 0;
  const app = firstInit ? initializeApp(readFirebaseConfig(env)) : getApp();
  const siteKey = appCheckSiteKey(env);
  // App Check pulls in Google's reCAPTCHA script (~350 KB) and holds every request until it has a
  // token, which on a phone is seconds of staring at the sign-in check. Start it after the app is
  // interactive instead: App Check is in monitor mode, so the few early requests simply carry no
  // token. Turning enforcement on means attaching it before the first request again.
  if (firstInit && siteKey) startAppCheckWhenIdle(app, siteKey);
  const auth = getAuth(app);
  // A persistent cache lets a returning device paint from disk instead of waiting for the first
  // round trip; Firestore still refreshes from the server, and security rules remain authoritative.
  // Single-tab cache: an installed app is one window, and multi-tab coordination costs an extra
  // round of IndexedDB work on every start, which is exactly what mobile start-up cannot spare.
  const db = firstInit ? initializeFirestore(app, { localCache: persistentLocalCache() }) : getFirestore(app);
  const functions = getFunctions(app, 'asia-east1');

  if (env.VITE_USE_EMULATORS === '1') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }

  return {
    auth,
    db,
    functions,
    propertyId: env.VITE_BINI_PROPERTY_ID || 'property-main',
  };
}

function startAppCheckWhenIdle(app: FirebaseApp, siteKey: string): void {
  const start = () => void import('firebase/app-check')
    .then(({ ReCaptchaEnterpriseProvider, initializeAppCheck }) => {
      initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
    })
    .catch(() => undefined);
  if (typeof window === 'undefined') { start(); return; }
  const idle = (window as unknown as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(start, { timeout: 4_000 });
  else window.setTimeout(start, 1_500);
}

