import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Single-file build configuration.
 *
 * Produces ONE self-contained index.html with all JS/CSS (and the CV Web
 * Worker) inlined, so the whole app is a single portable file.
 *
 * Output goes to ./standalone/index.html
 *
 * NOTE: The camera (getUserMedia) and Web Workers require a secure context,
 * i.e. https:// or http://localhost. They do NOT work from file://, so this
 * file must be served over localhost (use RunPronatorDrift.bat).
 */
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  worker: {
    // Inline the worker as a blob so it lives inside the single HTML file.
    format: 'es',
    plugins: () => [viteSingleFile()],
  },
  build: {
    outDir: 'standalone/app',
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
