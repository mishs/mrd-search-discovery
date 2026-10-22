import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const API_PORT = process.env.PORT ?? '3000';

// Vite serves and builds the Svelte client; the Express API is a separate process.
// Development: Vite proxies /api to Express, so the browser sees one origin (no CORS needed).
// Production: `npm run build` writes the client to dist/client and Express serves it
// next to the API (see src/server/index.ts), so it is still one origin.
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
