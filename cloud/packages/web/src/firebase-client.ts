import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

import { readFirebaseConfig } from './firebase-config.js';

export interface FirebaseClient {
  auth: Auth;
  db: Firestore;
  functions: Functions;
  propertyId: string;
}

export function createFirebaseClient(env: ImportMetaEnv): FirebaseClient {
  const app = getApps().length > 0 ? getApp() : initializeApp(readFirebaseConfig(env));
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
