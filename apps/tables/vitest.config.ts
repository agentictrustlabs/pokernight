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
          bindings: {
            // Test-only secret so the auth round trip is deterministic without a .dev.vars file.
            SESSION_SECRET: 'test-session-secret',
            // Operator authority for the seat-clearing route. A real value here (rather than nothing)
            // is what lets the tests prove BOTH halves: that a wrong token is refused, and that the
            // right one still cannot clear a seat whose player is connected, in a hand, or active.
            OPERATOR_TOKEN: 'test-operator-token',
            // A minute of silence. Long enough that a seat taken during a test is never idle by
            // accident — the success case has to age the seat deliberately, which is the point.
            SEAT_IDLE_MS: '60000',
          },
        },
      },
    },
  },
});
