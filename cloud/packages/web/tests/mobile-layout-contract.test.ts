import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('../src/styles.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

describe('responsive layout contract', () => {
  it('starts from a mobile layout and defines tablet and desktop breakpoints', () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*768px\)/);
    expect(css).toMatch(/@media\s*\(min-width:\s*1100px\)/);
  });

  it('reserves at least a 44px touch target', () => {
    expect(css).toMatch(/--touch-target:\s*44px/);
    expect(css).toMatch(/min-height:\s*var\(--touch-target\)/);
  });

  it('reserves safe areas for iPhone browser and future native shell', () => {
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('env(safe-area-inset-top)');
  });

  it('uses dedicated mobile and desktop navigation rather than scaling one table', () => {
    expect(css).toMatch(/\.mobile-nav\s*\{/);
    expect(css).toMatch(/\.desktop-sidebar\s*\{/);
  });
});
