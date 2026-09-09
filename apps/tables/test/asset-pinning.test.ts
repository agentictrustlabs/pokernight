/**
 * The settlement ASSET is a property of the TABLE.
 *
 * The card room settles in exactly one currency — Sheqel — so this stamp can never disagree with
 * `ASSET`. It is kept anyway, and these tests say why: one field on the table recording which coin
 * it settles in makes "which currency is this table?" a question about the table's own data rather
 * than about a deployment variable somebody could repoint, and it costs a few bytes.
 *
 * What was DELETED when the second currency went is the `LEGACY_ASSET` fallback and the first-load
 * migration that stamped an old coin onto older tables. There is nothing to migrate to and nothing
 * to convert; a table that cannot be opened in Sheqel is not opened. Do not reinstate either.
 *
 * The mandate-currency CHECK is kept too, and for a different reason: a mandate must be denominated
 * in the asset the table settles in. That is a safety property, not a mixed-currency feature. With
 * one currency it should never fire — which is exactly when a check earns its keep.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { TableMeta } from '../src/table-do.js';
import { defaultAsset, defaultAssetSymbol, pinnedAsset, pinnedAssetSymbol } from '../src/treasury.js';
import type { Env } from '../src/env.js';
import { putSessionRecord } from '../src/auth.js';
import { createTableViaHttp } from './helpers.js';

/** The deployment default in the test config (wrangler.toml `[vars]`): the card room's own coin. */
const DEPLOYMENT_ASSET = '0x1111111111111111111111111111111111111111';
const DEPLOYMENT_SYMBOL = 'SHQ';
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

/** Throw the DO out of memory so the next request reconstructs it from storage. */
async function evict(tableId: string): Promise<void> {
  const stub = stubFor(tableId);
  await runInDurableObject(stub, (_i, state) => {
    state.abort('test: evict so the table loads again');
  }).catch(() => {
    /* aborting is the point; the rejection is the abort reaching this side */
  });
}

describe('a table records the currency it settles in', () => {
  it('stamps the deployment default onto a new table, with its name', async () => {
    const t = await createTableViaHttp('asset stamped', {}, crypto.randomUUID());
    expect(t.asset).toBe(DEPLOYMENT_ASSET);
    expect(t.assetSymbol).toBe(DEPLOYMENT_SYMBOL);
    const s = await summaryOf(t.tableId);
    expect(s.asset).toBe(DEPLOYMENT_ASSET);
    expect(s.assetSymbol).toBe(DEPLOYMENT_SYMBOL);
  });

  /**
   * The whole value of keeping the stamp: the table's own record is what every settlement reads, so
   * repointing `ASSET` under an open table changes nothing about the money already on it.
   */
  it('keeps that currency when the deployment default moves under it', async () => {
    const t = await createTableViaHttp('asset pinned', {}, crypto.randomUUID());
    expect(t.asset).toBe(DEPLOYMENT_ASSET);

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

  it('says which currency it settles in on the settlement view a player reads', async () => {
    const t = await createTableViaHttp('ledger names the coin', {}, crypto.randomUUID());
    const res = await stubFor(t.tableId).fetch('https://table/ledger?playerId=nobody');
    const body = (await res.json()) as { asset: string | null; assetSymbol: string | null };
    expect(body.asset).toBe(DEPLOYMENT_ASSET);
    expect(body.assetSymbol).toBe(DEPLOYMENT_SYMBOL);
  });

  /** No migration any more: a table with no stamp reads today's currency, because there is only one. */
  it('reads the deployment currency for a table written before the field existed', async () => {
    const t = await createTableViaHttp('unstamped', {}, crypto.randomUUID());
    await runInDurableObject(stubFor(t.tableId), async (inst, state) => {
      const meta = (await state.storage.get('meta')) as TableMeta;
      delete (meta as { asset?: string }).asset;
      delete (meta as { assetSymbol?: string }).assetSymbol;
      await state.storage.put('meta', meta);
      (inst as unknown as AnyDo).meta = meta;
      expect((inst as unknown as AnyDo).asset()).toBe(DEPLOYMENT_ASSET);
      expect((inst as unknown as AnyDo).assetSymbol()).toBe(DEPLOYMENT_SYMBOL);
    });
  });
});

describe('a mandate is an authority over ONE currency', () => {
  /**
   * A player's Home signs an authority to move a NAMED asset out of a named treasury. Carrying that
   * to a table settling in a different coin would read their signature as consent to something it
   * never mentioned. With one currency this can only happen if something upstream has gone wrong —
   * which is precisely why the check stays.
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

    // Re-pin the same table to a different coin — the only way this can now happen at all. The
    // mandate simply is not about this table's money, and the table says so instead of spending.
    await runInDurableObject(stubFor(t.tableId), async (inst, state) => {
      const meta = (await state.storage.get('meta')) as TableMeta;
      meta.asset = MOVED_TO;
      meta.assetSymbol = 'OTHER';
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
      expect(funding?.mandateProblem).toContain(MOVED_TO);
    });
  });
});

/**
 * The pure functions the DO leans on. They encode the one rule left — a stamped currency always
 * wins over the environment — and there is no legacy branch under them any more.
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
  const withVar = (ASSET: string): Env => ({ ASSET, ASSET_SYMBOL: 'SHQ' }) as unknown as Env;

  it('prefers the stamped currency over the environment, always', () => {
    expect(pinnedAsset(meta(MOVED_TO), withVar(DEPLOYMENT_ASSET))).toBe(MOVED_TO);
    expect(pinnedAsset(meta(DEPLOYMENT_ASSET), withVar(MOVED_TO))).toBe(DEPLOYMENT_ASSET);
  });

  it('falls back to the deployment currency for an unstamped table — there is only one', () => {
    expect(pinnedAsset(meta(), withVar(DEPLOYMENT_ASSET))).toBe(DEPLOYMENT_ASSET);
    expect(pinnedAsset(null, withVar(DEPLOYMENT_ASSET))).toBe(DEPLOYMENT_ASSET);
    expect(pinnedAssetSymbol(meta(), withVar(DEPLOYMENT_ASSET))).toBe(DEPLOYMENT_SYMBOL);
    // Nonsense is not an address; the fallback answers instead of a crash or a half-address.
    expect(pinnedAsset(meta('0xnope'), withVar(DEPLOYMENT_ASSET))).toBe(DEPLOYMENT_ASSET);
  });

  it('never labels a table with a symbol for a currency it does not pay in', () => {
    // A stamped table with no symbol of its own is UNNAMED, not named after today's coin.
    expect(pinnedAssetSymbol(meta(MOVED_TO), withVar(DEPLOYMENT_ASSET))).toBeNull();
    expect(pinnedAssetSymbol(meta(MOVED_TO, 'OTHER'), withVar(DEPLOYMENT_ASSET))).toBe('OTHER');
  });

  it('has no currency at all where the deployment configures none', () => {
    expect(defaultAsset(withVar(''))).toBeNull();
    expect(defaultAssetSymbol({ ASSET_SYMBOL: '' } as unknown as Env)).toBeNull();
    expect(pinnedAsset(meta(), withVar(''))).toBeNull();
    // …but a stamped table still knows its own, whatever the deployment has forgotten.
    expect(pinnedAsset(meta(MOVED_TO), withVar(''))).toBe(MOVED_TO);
  });
});
