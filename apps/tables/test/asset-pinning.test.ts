/**
 * The settlement ASSET is a property of the TABLE.
 *
 * The chip rate was pinned because moving `CHIP_VALUE` re-valued the stacks on every open table.
 * The asset is pinned for a stronger version of the same argument. A rate that moved under an open
 * table over- or under-paid a stack; an ASSET that moved under an open table would take the buy-ins
 * in one currency and pay the cash-outs in another. A table that collected MockUSDC and paid out
 * Sheqel would not have mispriced anything — it would have kept a different promise from the one it
 * made, in money that is not the money the player put in.
 *
 * So: the asset is stamped on the table when it is created, migrated onto older tables the first
 * time they load (to `LEGACY_ASSET`, the currency those tables have actually been settling in), and
 * never re-derived. These tests move the deployment default under a live table and assert that
 * nothing about that table's money changes — and that two tables in two currencies coexist.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { migrateAsset, migrateMeta, type TableMeta } from '../src/table-do.js';
import {
  defaultAsset,
  defaultAssetSymbol,
  legacyAsset,
  pinnedAsset,
  pinnedAssetSymbol,
  unstampedAsset,
  unstampedAssetSymbol,
} from '../src/treasury.js';
import type { Env } from '../src/env.js';
import { putSessionRecord } from '../src/auth.js';
import { createTableViaHttp } from './helpers.js';

/** The deployment default in the test config (wrangler.toml `[vars]`): the card room's own coin. */
const DEPLOYMENT_ASSET = '0x1111111111111111111111111111111111111111';
const DEPLOYMENT_SYMBOL = 'SHQ';
/** `LEGACY_ASSET`: what every table created before the asset was pinned has been settling in. */
const LEGACY = '0x2222222222222222222222222222222222222222';
const LEGACY_SYMBOL = 'USDC';
/** Somewhere else the operator might point the default, so a move is visibly a no-op. */
const MOVED_TO = '0x3333333333333333333333333333333333333333';

type AnyDo = { env: Env; meta: TableMeta | null; asset(): string | null; assetSymbol(): string | null };

function stubFor(tableId: string) {
  return env.TABLES.get(env.TABLES.idFromName(tableId));
}

async function summaryOf(tableId: string): Promise<{ asset?: string; assetSymbol?: string }> {
  const res = await stubFor(tableId).fetch('https://table/summary');
  return (await res.json()) as { asset?: string; assetSymbol?: string };
}

/** Throw the DO out of memory so the next request reconstructs it — the only way to exercise the
 *  "first load" migration, which runs in the constructor. */
async function evict(tableId: string): Promise<void> {
  const stub = stubFor(tableId);
  await runInDurableObject(stub, (_i, state) => {
    state.abort('test: evict so the table loads again');
  }).catch(() => {
    /* aborting is the point; the rejection is the abort reaching this side */
  });
}

describe('a table settles in the currency it was created with', () => {
  it('stamps the deployment default onto a new table, with its name', async () => {
    const t = await createTableViaHttp('asset stamped', {}, crypto.randomUUID());
    expect(t.asset).toBe(DEPLOYMENT_ASSET);
    expect(t.assetSymbol).toBe(DEPLOYMENT_SYMBOL);
    const s = await summaryOf(t.tableId);
    expect(s.asset).toBe(DEPLOYMENT_ASSET);
    expect(s.assetSymbol).toBe(DEPLOYMENT_SYMBOL);
  });

  it('keeps that currency when the deployment default moves under it', async () => {
    const t = await createTableViaHttp('asset pinned', {}, crypto.randomUUID());
    expect(t.asset).toBe(DEPLOYMENT_ASSET);

    // The operator points ASSET at a different coin. This table is already open, with stacks on it.
    await runInDurableObject(stubFor(t.tableId), (inst) => {
      (inst as unknown as AnyDo).env.ASSET = MOVED_TO;
      (inst as unknown as AnyDo).env.ASSET_SYMBOL = 'OTHER';
    });

    expect((await summaryOf(t.tableId)).asset).toBe(DEPLOYMENT_ASSET);
    await runInDurableObject(stubFor(t.tableId), (inst) => {
      // The one function every buy-in, cash-out, balance check and mandate check goes through.
      expect((inst as unknown as AnyDo).asset()).toBe(DEPLOYMENT_ASSET);
      expect((inst as unknown as AnyDo).assetSymbol()).toBe(DEPLOYMENT_SYMBOL);
      expect((inst as unknown as AnyDo).env.ASSET).toBe(MOVED_TO);
    });

    // And it survives the table being reloaded, because it is on the record, not in memory.
    await evict(t.tableId);
    expect((await summaryOf(t.tableId)).asset).toBe(DEPLOYMENT_ASSET);
    expect((await summaryOf(t.tableId)).assetSymbol).toBe(DEPLOYMENT_SYMBOL);
  });

  it('opens a NEW table in the new currency while the old one keeps the old — two coins, one estate', async () => {
    const old = await createTableViaHttp('opened in Sheqel', {}, crypto.randomUUID());

    // A table created after the operator moved ASSET. Its DO is touched first so the change is in
    // place before `/init` reads it — which is exactly the moment the currency is captured.
    const tableId = crypto.randomUUID();
    const fresh = stubFor(tableId);
    await runInDurableObject(fresh, (inst) => {
      (inst as unknown as AnyDo).env.ASSET = MOVED_TO;
      (inst as unknown as AnyDo).env.ASSET_SYMBOL = 'OTHER';
    });
    const res = await fresh.fetch('https://table/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, name: 'opened in something else', settlement: 'play-money' }),
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as { asset?: string; assetSymbol?: string };
    expect(created.asset).toBe(MOVED_TO);
    expect(created.assetSymbol).toBe('OTHER');

    // Two tables, two currencies, both correct, at the same instant. That is the whole point.
    expect((await summaryOf(old.tableId)).asset).toBe(DEPLOYMENT_ASSET);
    expect((await summaryOf(old.tableId)).assetSymbol).toBe(DEPLOYMENT_SYMBOL);
    expect((await summaryOf(tableId)).asset).toBe(MOVED_TO);
    expect(old.asset).not.toBe(created.asset);
  });

  it('says which currency it settles in on the settlement view a player reads', async () => {
    const t = await createTableViaHttp('ledger names the coin', {}, crypto.randomUUID());
    const res = await stubFor(t.tableId).fetch('https://table/ledger?playerId=nobody');
    const body = (await res.json()) as { asset: string | null; assetSymbol: string | null };
    expect(body.asset).toBe(DEPLOYMENT_ASSET);
    expect(body.assetSymbol).toBe(DEPLOYMENT_SYMBOL);
  });
});

describe('a table created before the currency was pinned', () => {
  /** Rewind a table to how it was written before `asset` existed on the meta. */
  async function unpin(tableId: string): Promise<void> {
    await runInDurableObject(stubFor(tableId), async (inst, state) => {
      const meta = (await state.storage.get('meta')) as TableMeta;
      delete (meta as { asset?: string }).asset;
      delete (meta as { assetSymbol?: string }).assetSymbol;
      await state.storage.put('meta', meta);
      (inst as unknown as AnyDo).meta = meta;
    });
    await evict(tableId);
  }

  /**
   * The trap this guards: the deploy that introduces asset pinning is the same deploy that points
   * `ASSET` at the card room's own coin, so stamping "today's asset" onto an old table would change
   * the currency the money already on it is owed in. The value written is `LEGACY_ASSET`, which is
   * what those tables have actually been settling in.
   */
  it('is stamped with the currency it HAS been settling in, not with the new default', async () => {
    const t = await createTableViaHttp('legacy currency', {}, crypto.randomUUID());
    await unpin(t.tableId);

    expect((await summaryOf(t.tableId)).asset).toBe(LEGACY);
    expect((await summaryOf(t.tableId)).assetSymbol).toBe(LEGACY_SYMBOL);
    expect(LEGACY).not.toBe(DEPLOYMENT_ASSET);
    // …and PERSISTED, so it is a pin from here on and not a fresh read of the variable.
    await runInDurableObject(stubFor(t.tableId), async (_i, state) => {
      const meta = (await state.storage.get('meta')) as TableMeta;
      expect(meta.asset).toBe(LEGACY);
      expect(meta.assetSymbol).toBe(LEGACY_SYMBOL);
    });
  });

  it('is immune to the default moving once it has been migrated', async () => {
    const t = await createTableViaHttp('legacy then frozen', {}, crypto.randomUUID());
    await unpin(t.tableId);
    expect((await summaryOf(t.tableId)).asset).toBe(LEGACY);

    await runInDurableObject(stubFor(t.tableId), (inst) => {
      (inst as unknown as AnyDo).env.ASSET = MOVED_TO;
      (inst as unknown as AnyDo).env.LEGACY_ASSET = MOVED_TO;
      expect((inst as unknown as AnyDo).asset()).toBe(LEGACY);
    });
    expect((await summaryOf(t.tableId)).asset).toBe(LEGACY);
  });

  it('migrates the rate and the currency in the same first load', async () => {
    const t = await createTableViaHttp('legacy everything', {}, crypto.randomUUID());
    await runInDurableObject(stubFor(t.tableId), async (inst, state) => {
      const meta = (await state.storage.get('meta')) as TableMeta;
      delete (meta as { asset?: string }).asset;
      delete (meta as { assetSymbol?: string }).assetSymbol;
      delete (meta as { chipValue?: string }).chipValue;
      await state.storage.put('meta', meta);
      (inst as unknown as AnyDo).meta = meta;
    });
    await evict(t.tableId);
    const s = (await summaryOf(t.tableId)) as { asset?: string; chipValue?: string };
    expect(s.asset).toBe(LEGACY);
    expect(s.chipValue).toBe('10000');
  });
});

describe('a mandate is an authority over ONE currency', () => {
  /**
   * The mandate half of the same rule. A player's Home signs an authority to move a named asset out
   * of a named treasury. Carrying that to a table settling in a DIFFERENT coin would read their
   * signature as consent to something it never mentioned — so the table refuses to hand the adapter
   * a mandate whose currency is not its own, and says so before any redemption is attempted.
   */
  it('is offered to a table settling in that currency, and withheld from one that is not', async () => {
    const t = await createTableViaHttp('currency-bound mandate', {}, crypto.randomUUID());
    const playerId = `home:0x${'ab'.repeat(20)}`;
    const treasury = `0x${'cd'.repeat(20)}`;
    await putSessionRecord(env as unknown as Env, {
      playerId,
      name: 'Bound',
      address: `0x${'ab'.repeat(20)}`,
      homeOrigin: 'https://home.test',
      idToken: 'x',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 600_000,
      treasury,
      buyInMandate: { delegator: treasury },
      mandateTreasury: treasury,
      mandateAsset: DEPLOYMENT_ASSET,
    });

    // The table settles in the currency the mandate names: the authority travels with the player.
    await runInDurableObject(stubFor(t.tableId), async (inst) => {
      const funding = await (inst as unknown as { playerFunding(id: string): Promise<{ treasury?: string; mandate?: unknown } | null> }).playerFunding(playerId);
      expect(funding?.mandate).toBeTruthy();
    });

    // Re-pin the same table to a different coin. Nothing else about the player has changed; the
    // mandate simply is not about this table's money any more.
    await runInDurableObject(stubFor(t.tableId), async (inst, state) => {
      const meta = (await state.storage.get('meta')) as TableMeta;
      meta.asset = LEGACY;
      meta.assetSymbol = LEGACY_SYMBOL;
      await state.storage.put('meta', meta);
      (inst as unknown as AnyDo).meta = meta;
      const funding = await (
        inst as unknown as { playerFunding(id: string): Promise<{ treasury?: string; mandate?: unknown; mandateProblem?: string } | null> }
      ).playerFunding(playerId);
      expect(funding?.treasury).toBe(treasury);
      expect(funding?.mandate).toBeUndefined();
      // And it says WHICH of the two it is. "You have not authorised anything" would be false for a
      // player who just did, and would send them back to their Home to repeat a ceremony that would
      // change nothing.
      expect(funding?.mandateProblem).toMatch(/denominated in/);
      expect(funding?.mandateProblem).toContain(DEPLOYMENT_ASSET);
      expect(funding?.mandateProblem).toContain(LEGACY);
    });
  });
});

/**
 * The pure functions the DO leans on. Worth their own tests because they encode the rule that
 * matters — a stamped currency always wins over the environment — in three lines each.
 */
describe('the pinning rules themselves', () => {
  const meta = (asset?: string, assetSymbol?: string): TableMeta => ({
    tableId: 't',
    name: 'n',
    settlement: 'play-money',
    createdAt: 1,
    ...(asset === undefined ? {} : { asset }),
    ...(assetSymbol === undefined ? {} : { assetSymbol }),
  });
  const withVar = (ASSET: string, LEGACY_ASSET?: string): Env =>
    ({
      ASSET,
      ASSET_SYMBOL: 'SHQ',
      ...(LEGACY_ASSET === undefined ? {} : { LEGACY_ASSET, LEGACY_ASSET_SYMBOL: 'USDC' }),
    }) as unknown as Env;

  it('prefers the stamped currency over the environment, always', () => {
    expect(pinnedAsset(meta(LEGACY), withVar(DEPLOYMENT_ASSET))).toBe(LEGACY);
    expect(pinnedAsset(meta(DEPLOYMENT_ASSET), withVar(LEGACY))).toBe(DEPLOYMENT_ASSET);
  });

  it('falls back for an unstamped table to the LEGACY currency, and only then to the default', () => {
    expect(pinnedAsset(meta(), withVar(DEPLOYMENT_ASSET, LEGACY))).toBe(LEGACY);
    expect(pinnedAsset(null, withVar(DEPLOYMENT_ASSET, LEGACY))).toBe(LEGACY);
    expect(unstampedAssetSymbol(withVar(DEPLOYMENT_ASSET, LEGACY))).toBe(LEGACY_SYMBOL);
    // No legacy currency configured means no table can predate the pin: the default is then right.
    expect(pinnedAsset(meta(), withVar(DEPLOYMENT_ASSET))).toBe(DEPLOYMENT_ASSET);
    expect(unstampedAssetSymbol(withVar(DEPLOYMENT_ASSET))).toBe(DEPLOYMENT_SYMBOL);
    // Nonsense is not an address; the fallback answers instead of a crash or a half-address.
    expect(pinnedAsset(meta('0xnope'), withVar(DEPLOYMENT_ASSET))).toBe(DEPLOYMENT_ASSET);
    expect(legacyAsset(withVar(DEPLOYMENT_ASSET, 'not-an-address'))).toBeNull();
    expect(unstampedAsset(withVar(DEPLOYMENT_ASSET, 'not-an-address'))).toBe(DEPLOYMENT_ASSET);
  });

  it('never labels a table with a symbol for a currency it does not pay in', () => {
    // A stamped table with no symbol of its own is UNNAMED, not named after today's coin.
    expect(pinnedAssetSymbol(meta(LEGACY), withVar(DEPLOYMENT_ASSET))).toBeNull();
    expect(pinnedAssetSymbol(meta(LEGACY, LEGACY_SYMBOL), withVar(DEPLOYMENT_ASSET))).toBe(LEGACY_SYMBOL);
  });

  it('has no currency at all where the deployment configures none', () => {
    expect(defaultAsset(withVar(''))).toBeNull();
    expect(defaultAssetSymbol({ ASSET_SYMBOL: '' } as unknown as Env)).toBeNull();
    expect(pinnedAsset(meta(), withVar(''))).toBeNull();
    // …but a stamped table still knows its own, whatever the deployment has forgotten.
    expect(pinnedAsset(meta(LEGACY), withVar(''))).toBe(LEGACY);
  });

  it('migrates a table once, to the legacy currency, and never touches one already stamped', () => {
    expect(migrateAsset(meta(), withVar(DEPLOYMENT_ASSET, LEGACY))?.asset).toBe(LEGACY);
    expect(migrateAsset(meta(), withVar(DEPLOYMENT_ASSET, LEGACY))?.assetSymbol).toBe(LEGACY_SYMBOL);
    expect(migrateAsset(meta(), withVar(DEPLOYMENT_ASSET))?.asset).toBe(DEPLOYMENT_ASSET);
    expect(migrateAsset(meta(LEGACY), withVar(DEPLOYMENT_ASSET, LEGACY))).toBeNull();
    expect(migrateAsset(null, withVar(DEPLOYMENT_ASSET))).toBeNull();
    // Nothing to write when the deployment names no currency: leave the record alone.
    expect(migrateAsset(meta(), withVar(''))).toBeNull();
  });

  it('composes both migrations, and reports "nothing to do" only when both are done', () => {
    const bare = { tableId: 't', name: 'n', settlement: 'play-money' as const, createdAt: 1 };
    const e = { CHIP_VALUE: '1000000', LEGACY_CHIP_VALUE: '10000', ASSET: DEPLOYMENT_ASSET, LEGACY_ASSET: LEGACY, LEGACY_ASSET_SYMBOL: 'USDC' } as unknown as Env;
    const both = migrateMeta(bare, e);
    expect(both?.chipValue).toBe('10000');
    expect(both?.asset).toBe(LEGACY);
    // Rate already stamped, currency not: only the currency is added, and the rate is left alone.
    const rateOnly = migrateMeta({ ...bare, chipValue: '5' }, e);
    expect(rateOnly?.chipValue).toBe('5');
    expect(rateOnly?.asset).toBe(LEGACY);
    // Currency already stamped, rate not.
    const assetOnly = migrateMeta({ ...bare, asset: DEPLOYMENT_ASSET }, e);
    expect(assetOnly?.chipValue).toBe('10000');
    expect(assetOnly?.asset).toBe(DEPLOYMENT_ASSET);
    // Both stamped: nothing to write.
    expect(migrateMeta({ ...bare, chipValue: '5', asset: LEGACY }, e)).toBeNull();
  });
});
