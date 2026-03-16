import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  base: '',
  plugins: [react(), tailwind()],
  logLevel: 'error',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        splash: 'splash.html',
        dashboard: 'dashboard.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
        sourcemapFileNames: '[name].js.map',
      },
    },
  },
});
