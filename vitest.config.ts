import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts because that file roots Vite in src/client.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
