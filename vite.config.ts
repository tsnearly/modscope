import { devvit } from '@devvit/start/vite';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Devvit build currently uses inline dynamic imports, so Rollup manual chunk
    // splitting is not available. Raise the warning threshold to reduce noise.
    chunkSizeWarningLimit: 2000,
  },
  plugins: [react(), tailwind(), devvit()],
});
