import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  // Set base to repo name for GitHub Pages (change 'pronator-drift-app' to your repo name)
  base: '/pronator-drift-app/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
