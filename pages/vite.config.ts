import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_API_BASE points at the worker (default local wrangler dev on :8787).
// PAGES_BASE sets the public base path (e.g. "/Active_Rating/" for GitHub Pages
// project sites); defaults to "/" for local dev and Cloudflare Pages.
export default defineConfig({
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    // globe.gl / three are large; raise the warn limit to keep build output clean.
    chunkSizeWarningLimit: 2000,
  },
});
