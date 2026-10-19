import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { host: true, port: 5180 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
