export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export function readFirebaseConfig(env: ImportMetaEnv): FirebaseWebConfig {
  const values = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  const missing = Object.entries(values).filter(([, value]) => !value || value === 'REPLACE_ME');
  if (missing.length > 0) throw new Error(`Missing Firebase config: ${missing.map(([key]) => key).join(', ')}`);
  if (env.VITE_BINI_ENV !== 'dev' && env.VITE_BINI_ENV !== 'prod') {
    throw new Error('VITE_BINI_ENV must be dev or prod.');
  }
  return values as FirebaseWebConfig;
}
