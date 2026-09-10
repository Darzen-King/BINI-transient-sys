import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // npm workspaces runs Vite from packages/web; Firebase DEV configuration is
  // intentionally kept once at cloud/.env.local (git-ignored).
  envDir: '../..',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
