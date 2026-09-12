import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('../src/styles.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');
const tokensPath = fileURLToPath(new URL('../src/design-system/tokens.css', import.meta.url));
const tokens = readFileSync(tokensPath, 'utf8');
const componentsPath = fileURLToPath(new URL('../src/design-system/components.css', import.meta.url));
const components = readFileSync(componentsPath, 'utf8');
const localePath = fileURLToPath(new URL('../src/i18n/locale.tsx', import.meta.url));
const localeSource = readFileSync(localePath, 'utf8');
const appPath = fileURLToPath(new URL('../src/App.tsx', import.meta.url));
const appSource = readFileSync(appPath, 'utf8');
const viteConfigPath = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const viteConfig = readFileSync(viteConfigPath, 'utf8');
const manifestPath = fileURLToPath(new URL('../public/manifest.webmanifest', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
};
const indexPath = fileURLToPath(new URL('../index.html', import.meta.url));
const indexSource = readFileSync(indexPath, 'utf8');
const serviceWorkerPath = fileURLToPath(new URL('../public/sw.js', import.meta.url));
const serviceWorkerSource = readFileSync(serviceWorkerPath, 'utf8');

function pngDimensions(relativePath: string): readonly [number, number] {
  const data = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)));
  expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

function sha256(relativePath: string): string {
  return createHash('sha256').update(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)))).digest('hex');
}

describe('responsive layout contract', () => {
  it('starts from a mobile layout and defines tablet and desktop breakpoints', () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*768px\)/);
    expect(css).toMatch(/@media\s*\(min-width:\s*1100px\)/);
  });

  it('reserves at least a 44px touch target', () => {
    expect(tokens).toMatch(/--bds-touch-target:\s*44px/);
    expect(components).toMatch(/min-height:\s*var\(--bds-touch-target\)/);
  });

  it('separates primitive and semantic design tokens from product styles', () => {
    expect(tokens).toContain('--bds-color-berry-500');
    expect(tokens).toContain('--bds-color-action-primary');
    expect(tokens).toContain('--bds-space-4');
    expect(tokens).toContain('--bds-radius-md');
    expect(tokens).toContain('--bds-shadow-md');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(components).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('provides one persisted locale state for mobile, desktop and authentication', () => {
    expect(localeSource).toContain("APP_LOCALES = ['zh-TW', 'en']");
    expect(localeSource).toContain("'bini-pms-locale'");
    expect(localeSource).toContain('aria-pressed');
    expect(css).toContain('.mobile-language-switch');
    expect(appSource).toContain('desktop-language-switch');
    expect(css).toContain('.auth-language-switch');
  });

  it('reserves safe areas for iPhone browser and future native shell', () => {
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('env(safe-area-inset-top)');
  });

  it('uses dedicated mobile navigation and the v3-style desktop top navigation', () => {
    expect(css).toMatch(/\.mobile-nav\s*\{/);
    expect(css).toMatch(/\.desktop-topnav\s*\{/);
    expect(css).not.toMatch(/\.desktop-sidebar\s*\{/);
  });

  it('keeps the unauthenticated visual QA page out of the production build inputs', () => {
    expect(viteConfig).not.toContain('ui-preview.html');
    expect(viteConfig).not.toMatch(/rollupOptions\s*:/);
  });

  it('uses the supplied BINI brand assets for favicon, Apple and installable PWA icons', () => {
    expect(indexSource).toContain('href="/favicon.ico"');
    expect(indexSource).toContain('href="/apple-touch-icon.png"');
    expect(indexSource).not.toContain('bini-mark.svg');
    expect(manifest.icons).toEqual([
      { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    expect(pngDimensions('../public/pwa-192.png')).toEqual([192, 192]);
    expect(pngDimensions('../public/pwa-512.png')).toEqual([512, 512]);
    expect(pngDimensions('../public/pwa-512-maskable.png')).toEqual([512, 512]);
    expect(pngDimensions('../public/apple-touch-icon.png')).toEqual([180, 180]);
    expect(pngDimensions('../public/bini-app-icon-source.png')).toEqual([1254, 1254]);
    // The installed desktop shortcut and browser tab must remain the same supplied ICO asset.
    expect(sha256('../../../../icon.ico')).toBe(sha256('../public/favicon.ico'));
    expect(serviceWorkerSource).toContain("'/pwa-512-maskable.png'");
    expect(serviceWorkerSource).not.toContain('bini-mark.svg');
  });
});
