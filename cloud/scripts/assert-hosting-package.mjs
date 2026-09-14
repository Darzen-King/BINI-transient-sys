import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const distRoot = resolve(process.cwd(), 'packages/web/dist');
const assetRoot = resolve(distRoot, 'assets');
const localEnvironment = Object.fromEntries(readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
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

if (localEnvironment.VITE_FIREBASE_PROJECT_ID !== 'bini-transient-dev') {
  throw new Error('Hosting build environment is not the confirmed DEV Firebase project.');
}

for (const key of requiredKeys) {
  const value = localEnvironment[key];
  if (!value || value === 'REPLACE_ME' || !javascript.includes(value)) {
    throw new Error(`Hosting bundle is missing a configured Firebase field: ${key}.`);
  }
}

// App Check must ship with the build; a missing site key would silently drop tokens from every request.
const siteKey = localEnvironment.VITE_RECAPTCHA_SITE_KEY;
if (!siteKey || siteKey === 'REPLACE_ME' || !javascript.includes(siteKey)) {
  throw new Error('Hosting bundle is missing the App Check reCAPTCHA site key.');
}

console.log('Hosting deployment package contains the confirmed DEV Firebase configuration and App Check site key.');
