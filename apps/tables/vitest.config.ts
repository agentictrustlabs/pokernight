import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        // Tables get random ids and lobby tests use their own circle, so shared storage is safe. The
        // pool's per-test storage stacking asserts on SQLite file names and races with DO WAL `-shm`
        // files left by objects created at the end of a test, so isolation is off.
        isolatedStorage: false,
        miniflare: {
          // Test-only secret so the auth round trip is deterministic without a .dev.vars file.
          bindings: { SESSION_SECRET: 'test-session-secret' },
        },
      },
    },
  },
});
