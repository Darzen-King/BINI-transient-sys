import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DEV_PROJECT_ID, TARGETS, parseTarget, readTargetEnvironment } from './deploy-target.mjs';

const target = parseTarget();
const { label, projectId } = TARGETS[target];
const distRoot = resolve(process.cwd(), 'packages/web/dist');
const assetRoot = resolve(distRoot, 'assets');
const localEnvironment = readTargetEnvironment(target, process.cwd());
const javascript = readdirSync(assetRoot)
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(resolve(assetRoot, name), 'utf8'))
  .join('\n');

const requiredKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

if (localEnvironment.VITE_FIREBASE_PROJECT_ID !== projectId) {
  throw new Error(`Hosting build environment is not the confirmed ${label} Firebase project.`);
}
if (localEnvironment.VITE_BINI_ENV !== target) {
  throw new Error(`Hosting build environment must set VITE_BINI_ENV=${target}.`);
}

for (const key of requiredKeys) {
  const value = localEnvironment[key];
  if (!value || value === 'REPLACE_ME' || !javascript.includes(value)) {
    throw new Error(`Hosting bundle is missing a configured Firebase field: ${key}.`);
  }
}

// A production bundle must never talk to the DEV project (e.g. a build that skipped --mode prod).
if (target === 'prod' && javascript.includes(DEV_PROJECT_ID)) {
  throw new Error('PROD hosting bundle still references the DEV Firebase project.');
}

// App Check must ship with the build; a missing site key would silently drop tokens from every request.
const siteKey = localEnvironment.VITE_RECAPTCHA_SITE_KEY;
if (!siteKey || siteKey === 'REPLACE_ME' || !javascript.includes(siteKey)) {
  throw new Error('Hosting bundle is missing the App Check reCAPTCHA site key.');
}

console.log(`Hosting deployment package contains the confirmed ${label} Firebase configuration and App Check site key.`);
