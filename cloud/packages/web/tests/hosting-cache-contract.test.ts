import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync(fileURLToPath(new URL('../../../firebase.json', import.meta.url)), 'utf8')) as {
  hosting: { headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
};

const serviceWorker = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');

const cacheControl = (source: string) => config.hosting.headers
  ?.find((rule) => rule.source === source)
  ?.headers.find((header) => header.key === 'Cache-Control')?.value;

describe('hosting cache contract', () => {
  /**
   * Firebase Hosting defaults index.html to `max-age=3600`, so without this rule a phone kept
   * running the previous deployment for up to an hour and a fix looked like it had not shipped.
   */
  it('never lets a browser hold the app shell after a deployment', () => {
    expect(cacheControl('**')).toBe('no-cache');
  });

  it('still lets content-hashed assets be cached forever, so a reload is not a re-download', () => {
    expect(cacheControl('/assets/**')).toBe('public, max-age=31536000, immutable');
  });

  it('keeps the asset rule after the catch-all, so the more specific rule is the one that applies', () => {
    const sources = (config.hosting.headers ?? []).map((rule) => rule.source);
    expect(sources.indexOf('/assets/**')).toBeGreaterThan(sources.indexOf('**'));
  });

  /** Clients that cached the shell before the header fix would otherwise stay on the old build. */
  it('makes the service worker revalidate the shell on every page load', () => {
    expect(serviceWorker).toMatch(/event\.request\.mode === 'navigate'/);
    expect(serviceWorker).toMatch(/cache: 'reload'/);
  });

  it('still serves content-hashed assets from the device cache first', () => {
    expect(serviceWorker).toContain("url.pathname.startsWith('/assets/')");
  });
});
