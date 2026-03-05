import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

export default defineConfig({
  ssr: {
    noExternal: true,
  },
  logLevel: 'error',
  build: {
    ssr: 'index.ts',
    outDir: '../../dist/server',
    emptyOutDir: false,
    target: 'node22',
    minify: true,
    sourcemap: false,
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress eval warnings from @protobufjs
        if (warning.code === 'EVAL') return;
        warn(warning);
      },
      external: [...builtinModules],

      output: {
        format: 'cjs',
        entryFileNames: 'index.cjs',
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
});
