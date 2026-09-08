import { defineConfig } from 'vitest/config';

// jsdom is not installed in this workspace: only pure (non-DOM) modules are
// tested here — the socket reducer, the log formatter and the mock server.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
