import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev proxy: the client talks to `/api/*`, which is forwarded to the tables
 * Worker on :8787 with the `/api` prefix stripped. `ws: true` also upgrades
 * WebSocket connections (`/api/tables/<id>/ws` → `/tables/<id>/ws`).
 *
 * In production `VITE_API_BASE` is baked in at build time (see wrangler.toml).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // VITE_PROXY_TARGET=https://games.faithnet.io points a local client at the live card room — the fast loop
        // for the room's graphics: sign in on the live site, copy the session into localhost, iterate with HMR.
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
