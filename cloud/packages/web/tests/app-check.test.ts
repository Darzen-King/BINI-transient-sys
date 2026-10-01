import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { appCheckSiteKey } from '../src/app-check.js';

describe('App Check site key', () => {
  it('enables App Check with the configured key outside the emulator', () => {
    expect(appCheckSiteKey({ VITE_RECAPTCHA_SITE_KEY: ' site-key ', VITE_USE_EMULATORS: '' })).toBe('site-key');
  });

  it('stays off for emulators and for missing or placeholder keys', () => {
    expect(appCheckSiteKey({ VITE_RECAPTCHA_SITE_KEY: 'site-key', VITE_USE_EMULATORS: '1' })).toBeNull();
    expect(appCheckSiteKey({ VITE_RECAPTCHA_SITE_KEY: undefined, VITE_USE_EMULATORS: '' })).toBeNull();
    expect(appCheckSiteKey({ VITE_RECAPTCHA_SITE_KEY: 'REPLACE_ME', VITE_USE_EMULATORS: '' })).toBeNull();
  });
});

describe('App Check start-up cost', () => {
  it('loads after the app is interactive, not as part of the first bundle', () => {
    // reCAPTCHA is ~350 KB and holds every request until it answers; on a phone that was seconds of
    // waiting on the sign-in check. A static import would put it back on the critical path.
    const source = readFileSync(fileURLToPath(new URL('../src/firebase-client.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/^import .*'firebase\/app-check'/mu);
    expect(source).toMatch(/import\('firebase\/app-check'\)/u);
    expect(source).toMatch(/requestIdleCallback/u);
  });
});
