import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sharedSrc = fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@bini/cloud-shared': sharedSrc,
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.{ts,tsx}'],
    // Firestore rules tests need the emulator; they run via `npm run test:rules`.
    exclude: ['**/node_modules/**', 'packages/*/tests/**/*.rules.test.{ts,tsx}'],
    environment: 'node',
  },
});
