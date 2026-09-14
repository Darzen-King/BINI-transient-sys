import { getApp, getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
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
  if (firstInit && siteKey) initializeAppCheck(app, { provider: new ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: true });
  const auth = getAuth(app);
  const db = getFirestore(app);
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
