import { getApp, getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from 'firebase/firestore';
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
  // Attach App Check before Auth/Firestore/Functions so every request carries a token.
  if (firstInit && siteKey) initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
  const auth = getAuth(app);
  // A persistent cache lets a returning device paint from disk instead of waiting for the first
  // round trip; Firestore still refreshes from the server, and security rules remain authoritative.
  const db = firstInit
    ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
    : getFirestore(app);
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
