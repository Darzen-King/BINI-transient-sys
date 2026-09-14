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
