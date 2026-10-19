import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5191 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
});
