/**
 * The chip rate is a property of the TABLE.
 *
 * The bug this file exists for: `chipValue(env)` was read at settlement time, so raising
 * `CHIP_VALUE` re-valued every stack already sitting on every open table. A player seated with 100
 * chips bought for 1.000000 would have cashed out at 100.000000 — a hundredfold overpay
 * of house funds, from a config change nobody thought touched live money.
 *
 * So: the rate is stamped on the table when it is created, migrated onto older tables the first
 * time they load, and never re-derived. These tests move the deployment default under a live table
 * and assert that nothing about that table's money changes.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { migrateChipValue, type TableMeta } from '../src/table-do.js';
import { defaultChipValue, legacyChipValue, pinnedChipValue, unstampedChipValue } from '../src/treasury.js';
import type { Env } from '../src/env.js';
import { createTableViaHttp, soloClub } from './helpers.js';

/** The deployment default in the test config (wrangler.toml `[vars]`): 1 chip = 1 Sheqel. */
const DEPLOYMENT_DEFAULT = '1000000';
/** `LEGACY_CHIP_VALUE`: what every table created before the rate was pinned has been settling at. */
const LEGACY = '10000';
/** Somewhere else the operator might move the default to, so a move is visibly a no-op. */
const MOVED_TO = '250000';

type AnyDo = { env: Env; meta: TableMeta | null; chipValue(): bigint | null };

function stubFor(tableId: string) {
  return env.TABLES.get(env.TABLES.idFromName(tableId));
}

async function summaryOf(tableId: string): Promise<{ chipValue?: string }> {
  const res = await stubFor(tableId).fetch('https://table/summary');
  return (await res.json()) as { chipValue?: string };
}

/**
 * Throw the DO out of memory so the next request reconstructs it — the only way to exercise the
 * "first load" migration, which runs in the constructor. `abort` breaks the stub that called it, so
 * every later call takes a fresh one.
 */
async function evict(tableId: string): Promise<void> {
  const stub = stubFor(tableId);
  await runInDurableObject(stub, (_i, state) => {
    state.abort('test: evict so the table loads again');
  }).catch(() => {
    /* aborting is the point; the rejection is the abort reaching this side */
  });
}

describe('a table settles at the rate it was created with', () => {
  it('stamps the deployment default onto a new table', async () => {
    const t = await createTableViaHttp('rate stamped', {}, await soloClub());
    expect(t.chipValue).toBe(DEPLOYMENT_DEFAULT);
    expect((await summaryOf(t.tableId)).chipValue).toBe(DEPLOYMENT_DEFAULT);
  });

  it('keeps that rate when the deployment default moves under it', async () => {
    const t = await createTableViaHttp('rate pinned', {}, await soloClub());
    expect(t.chipValue).toBe(DEPLOYMENT_DEFAULT);

    // The operator changes CHIP_VALUE. This table is already open, with stacks on it.
    await runInDurableObject(stubFor(t.tableId), (inst) => {
      (inst as unknown as AnyDo).env.CHIP_VALUE = MOVED_TO;
    });

    // Everything the table says about money still uses the rate it was created with…
    expect((await summaryOf(t.tableId)).chipValue).toBe(DEPLOYMENT_DEFAULT);
    await runInDurableObject(stubFor(t.tableId), (inst) => {
      // …including the one function every buy-in, cash-out, ledger row and receipt goes through.
      expect((inst as unknown as AnyDo).chipValue()).toBe(BigInt(DEPLOYMENT_DEFAULT));
      expect((inst as unknown as AnyDo).env.CHIP_VALUE).toBe(MOVED_TO);
    });

    // And it survives the table being reloaded, because it is on the record, not in memory.
    await evict(t.tableId);
    expect((await summaryOf(t.tableId)).chipValue).toBe(DEPLOYMENT_DEFAULT);
  });

  it('opens a NEW table at the new default while the old one keeps the old', async () => {
    const old = await createTableViaHttp('opened before', {}, await soloClub());

    // A table created after the operator moved CHIP_VALUE. Its DO is touched first so the change is
    // in place before `/init` reads it — which is exactly the moment the rate is captured.
    const tableId = crypto.randomUUID();
    const fresh = stubFor(tableId);
    await runInDurableObject(fresh, (inst) => {
      (inst as unknown as AnyDo).env.CHIP_VALUE = MOVED_TO;
    });
    const res = await fresh.fetch('https://table/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, name: 'opened after', settlement: 'play-money' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { chipValue?: string }).chipValue).toBe(MOVED_TO);

    // Two tables, two rates, both correct. That is the whole point of pinning.
    expect((await summaryOf(old.tableId)).chipValue).toBe(DEPLOYMENT_DEFAULT);
  });
});

describe('a table created before the rate was pinned', () => {
  /** Rewind a table to how it was written before `chipValue` existed on the meta. */
  async function unpin(tableId: string): Promise<void> {
    await runInDurableObject(stubFor(tableId), async (inst, state) => {
      const meta = (await state.storage.get('meta')) as TableMeta;
      delete (meta as { chipValue?: string }).chipValue;
      await state.storage.put('meta', meta);
      (inst as unknown as AnyDo).meta = meta;
    });
    await evict(tableId);
  }

  /**
   * The trap this guards: the deploy that introduces pinning is the same deploy that raises
   * `CHIP_VALUE`, so stamping "today's default" onto an old table would re-value the stacks already
   * sitting on it — the hundredfold overpay, arriving through the fix instead of the bug. The value
   * written is `LEGACY_CHIP_VALUE`, which is what those tables have actually been settling at.
   */
  it('is stamped with the rate it HAS been settling at, not with the new default', async () => {
    const t = await createTableViaHttp('legacy table', {}, await soloClub());
    await unpin(t.tableId);

    expect((await summaryOf(t.tableId)).chipValue).toBe(LEGACY);
    expect(LEGACY).not.toBe(DEPLOYMENT_DEFAULT);
    // …and PERSISTED, so it is a pin from here on and not a fresh read of the variable.
    await runInDurableObject(stubFor(t.tableId), async (_i, state) => {
      expect(((await state.storage.get('meta')) as TableMeta).chipValue).toBe(LEGACY);
    });
  });

  it('is immune to the default moving once it has been migrated', async () => {
    const t = await createTableViaHttp('legacy then frozen', {}, await soloClub());
    await unpin(t.tableId);
    expect((await summaryOf(t.tableId)).chipValue).toBe(LEGACY);

    await runInDurableObject(stubFor(t.tableId), (inst) => {
      (inst as unknown as AnyDo).env.CHIP_VALUE = MOVED_TO;
      (inst as unknown as AnyDo).env.LEGACY_CHIP_VALUE = MOVED_TO;
      expect((inst as unknown as AnyDo).chipValue()).toBe(BigInt(LEGACY));
    });
    expect((await summaryOf(t.tableId)).chipValue).toBe(LEGACY);
  });
});

/**
 * The two pure functions the DO leans on. Worth their own tests because they encode the rule that
 * matters — a stamped rate always wins over the environment — in three lines each.
 */
describe('the pinning rules themselves', () => {
  const meta = (chipValue?: string): TableMeta => ({
    tableId: 't',
    name: 'n',
    settlement: 'play-money',
    createdAt: 1,
    ...(chipValue === undefined ? {} : { chipValue }),
  });
  const withVar = (CHIP_VALUE: string, LEGACY_CHIP_VALUE?: string): Env =>
    ({ CHIP_VALUE, ...(LEGACY_CHIP_VALUE === undefined ? {} : { LEGACY_CHIP_VALUE }) }) as unknown as Env;

  it('prefers the stamped rate over the environment, always', () => {
    expect(pinnedChipValue(meta('10000'), withVar('1000000'))).toBe(10_000n);
    expect(pinnedChipValue(meta('1000000'), withVar('10000'))).toBe(1_000_000n);
  });

  it('falls back for an unstamped table to the LEGACY rate, and only then to the default', () => {
    expect(pinnedChipValue(meta(), withVar('1000000', '10000'))).toBe(10_000n);
    expect(pinnedChipValue(null, withVar('1000000', '10000'))).toBe(10_000n);
    // No legacy rate configured means no table can predate the pin: the default is then correct.
    expect(pinnedChipValue(meta(), withVar('1000000'))).toBe(1_000_000n);
    // A nonsense stamp is not a rate; the fallback answers instead of a crash or a zero.
    expect(pinnedChipValue(meta('0'), withVar('1000000'))).toBe(1_000_000n);
    expect(pinnedChipValue(meta('lots'), withVar('1000000'))).toBe(1_000_000n);
    // A nonsense legacy value is ignored rather than treated as a rate of zero.
    expect(legacyChipValue(withVar('1000000', '0'))).toBeNull();
    expect(unstampedChipValue(withVar('1000000', 'nope'))).toBe(1_000_000n);
  });

  it('has no rate at all where the deployment configures none', () => {
    expect(defaultChipValue(withVar(''))).toBeNull();
    expect(pinnedChipValue(meta(), withVar(''))).toBeNull();
    // …but a stamped table still knows its own, whatever the deployment has forgotten.
    expect(pinnedChipValue(meta('10000'), withVar(''))).toBe(10_000n);
  });

  it('migrates a table once, to the legacy rate, and never touches one already stamped', () => {
    expect(migrateChipValue(meta(), withVar('1000000', '10000'))?.chipValue).toBe('10000');
    expect(migrateChipValue(meta(), withVar('1000000'))?.chipValue).toBe('1000000');
    expect(migrateChipValue(meta('10000'), withVar('1000000', '10000'))).toBeNull();
    expect(migrateChipValue(null, withVar('1000000'))).toBeNull();
    // Nothing to write when the deployment has no rate at all: leave the record alone.
    expect(migrateChipValue(meta(), withVar(''))).toBeNull();
  });
});
