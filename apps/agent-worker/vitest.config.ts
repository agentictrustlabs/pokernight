import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        // Nothing here is stateful: no Durable Objects, no KV, and the A2A task store is built and
        // dropped per request. Per-test storage isolation would only add cost.
        isolatedStorage: false,
        miniflare: {
          // ANTHROPIC_API_KEY is pinned EMPTY, not merely omitted: wrangler loads `.dev.vars`, so a
          // developer with a real key would otherwise make the claude personas call the live API
          // during tests — slow, costly, and non-deterministic. The suite runs on the rules baseline.
          bindings: {
            AGENT_CARD_ZONE: 'faithnet.ai',
            PUBLIC_ORIGIN: 'https://agents.faithnet.io',
            ANTHROPIC_API_KEY: '',
          },
        },
      },
    },
  },
});
