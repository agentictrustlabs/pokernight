/**
 * The settlement adapter, without a chain.
 *
 * Everything that decides whether money moves is here: who is paying, whether they can, and what is
 * said when they cannot. The chain itself is a fake `TreasuryClient` — the point of these tests is
 * the DECISIONS, and a decision that only holds against a live RPC is not a decision anyone can rely
 * on. The on-chain half is proven separately by `scripts/settle-demo.mts`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import { ROOT_AUTHORITY } from '@agenticprimitives/delegation';
import { receiptStatus } from '@pokernight/ledger';
import {
  buildBuyInMandateCaveats,
  createTreasuryTransferAdapter,
  orderNonce,
  TreasuryError,
  type Delegation,
  type PlayerFunding,
  type TreasuryClient,
} from '../src/index.js';

const ASSET = '0x00000000000000000000000000000000000000a5' as Address;
const HOUSE = '0x00000000000000000000000000000000000000a0' as Address;
const HOUSE_DELEGATE = '0x00000000000000000000000000000000000000de' as Address;
const PLAYER = '0x00000000000000000000000000000000000000b1' as Address;
const DELEGATION_MANAGER = '0x00000000000000000000000000000000000000dd' as Address;
const PAYMENT_ENFORCER = '0x00000000000000000000000000000000000000ee' as Address;
const TIMESTAMP_ENFORCER = '0x00000000000000000000000000000000000000e1' as Address;
const TARGETS_ENFORCER = '0x00000000000000000000000000000000000000e2' as Address;
const METHODS_ENFORCER = '0x00000000000000000000000000000000000000e3' as Address;
const TX = ('0x' + '22'.repeat(32)) as Hex;
const CHIP_VALUE = 10_000n; // 0.01 USDC per chip

function fakeClient(balances: Record<string, bigint>): TreasuryClient & {
  transfers: Array<{ from: Address; to: Address; amount: bigint }>;
  calls: Array<{ from: Address; to: Address; data: Hex }>;
} {
  const transfers: Array<{ from: Address; to: Address; amount: bigint }> = [];
  const calls: Array<{ from: Address; to: Address; data: Hex }> = [];
  const receipt = { status: 'success', transactionHash: TX } as never;
  return {
    transfers,
    calls,
    deployments: { asset: ASSET, entryPoint: ASSET, agentAccountFactory: ASSET, paymaster: ASSET },
    custodian: HOUSE_DELEGATE,
    async readUsdcBalance(address) {
      return balances[address.toLowerCase()] ?? 0n;
    },
    async transferUsdc(req) {
      transfers.push({ from: req.from, to: req.to, amount: req.amount });
      return { txHash: TX, receipt };
    },
    async executeCall(req) {
      calls.push({ from: req.from, to: req.to, data: req.data });
      return { txHash: TX, receipt };
    },
    async deriveAgentAccount() {
      return PLAYER;
    },
    async deployAgentAccount() {
      return PLAYER;
    },
    async isDeployed() {
      return true;
    },
    async isCustodian() {
      return true;
    },
    async mintTestAsset() {
      return TX;
    },
  };
}

function adapterFor(funding: PlayerFunding | null, balances: Record<string, bigint> = {}) {
  const client = fakeClient(balances);
  const adapter = createTreasuryTransferAdapter({
    client,
    houseTreasury: HOUSE,
    houseDelegate: HOUSE_DELEGATE,
    chipValue: CHIP_VALUE,
    chainId: 34348,
    delegationManager: DELEGATION_MANAGER,
    enforcers: { payment: PAYMENT_ENFORCER },
    resolvePlayer: async () => funding,
  });
  return { adapter, client };
}

function signedMandate(over: Partial<Delegation> = {}): Delegation {
  return {
    delegator: PLAYER,
    delegate: HOUSE_DELEGATE,
    authority: ROOT_AUTHORITY,
    caveats: buildBuyInMandateCaveats({
      payee: HOUSE,
      asset: ASSET,
      enforcers: {
        payment: PAYMENT_ENFORCER,
        timestamp: TIMESTAMP_ENFORCER,
        allowedTargets: TARGETS_ENFORCER,
        allowedMethods: METHODS_ENFORCER,
      },
      maxAmountPerCharge: 2_000_000n,
      maxAggregate: 8_000_000n,
      maxRedemptionsPerWindow: 4,
      windowSeconds: 86_400,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
    }),
    salt: 1n,
    signature: ('0x' + '33'.repeat(65)) as Hex,
    ...over,
  };
}

const buyIn = { tableId: 't1', seat: 0, playerId: 'home:0xabc', chips: 200, orderId: 'o1' };
const cashOut = { ...buyIn, historyDigest: 'hands:0:last:0', chips: 200 };

describe('cash-out — the house paying its own funds', () => {
  it('transfers chips × chipValue from the house treasury to the player treasury', async () => {
    const { adapter, client } = adapterFor(null, { [HOUSE.toLowerCase()]: 10_000_000n });
    const receipt = await adapter.settleCashOut({ ...cashOut, playerAddress: PLAYER });
    expect(client.transfers).toEqual([{ from: HOUSE, to: PLAYER, amount: 2_000_000n }]);
    expect(receipt).toMatchObject({ mode: 'mandate-transfer', amount: '2000000', asset: ASSET, ref: TX });
    expect(receiptStatus(receipt)).toBe('settled');
  });

  it('refuses to pay a seat with no recorded treasury, and says which seat', async () => {
    const { adapter, client } = adapterFor(null, { [HOUSE.toLowerCase()]: 10_000_000n });
    await expect(adapter.settleCashOut(cashOut)).rejects.toThrow(/seat 0 at t1 has no payout treasury/);
    expect(client.transfers).toHaveLength(0);
  });

  it('names the shortfall when the house cannot cover the payout', async () => {
    const { adapter, client } = adapterFor(null, { [HOUSE.toLowerCase()]: 1_000_000n });
    await expect(adapter.settleCashOut({ ...cashOut, playerAddress: PLAYER })).rejects.toThrow(
      /holds 1.000000 USDC, which does not cover the 2.000000 USDC cash-out/,
    );
    expect(client.transfers).toHaveLength(0);
  });

  it('settles a zero-chip stand-up locally instead of writing a zero-value transaction', async () => {
    const { adapter, client } = adapterFor(null, { [HOUSE.toLowerCase()]: 10_000_000n });
    const receipt = await adapter.settleCashOut({ ...cashOut, chips: 0, playerAddress: PLAYER });
    expect(client.transfers).toHaveLength(0);
    expect(receipt.amount).toBe('0');
    expect(receiptStatus(receipt)).toBe('settled');
  });
});

describe('buy-in — money that is not the house’s', () => {
  it('refuses before a seat is credited when no treasury has been chosen', async () => {
    const { adapter } = adapterFor(null);
    const auth = await adapter.authorizeBuyIn(buyIn);
    expect(auth.ok).toBe(false);
    expect(auth.ok === false && auth.reason).toMatch(/no treasury is selected/);
  });

  it('refuses when the player treasury cannot cover the buy-in, quoting both numbers', async () => {
    const { adapter } = adapterFor({ treasury: PLAYER, mandate: signedMandate() }, { [PLAYER.toLowerCase()]: 500_000n });
    const auth = await adapter.authorizeBuyIn(buyIn);
    expect(auth.ok).toBe(false);
    expect(auth.ok === false && auth.reason).toMatch(/holds 0.500000 USDC; a 200-chip buy-in costs 2.000000 USDC/);
  });

  it('refuses, by name, while the player has no signed mandate — and never falls back to play money', async () => {
    const { adapter, client } = adapterFor({ treasury: PLAYER }, { [PLAYER.toLowerCase()]: 10_000_000n });
    const auth = await adapter.authorizeBuyIn(buyIn);
    expect(auth.ok).toBe(false);
    expect(auth.ok === false && auth.reason).toMatch(/has not signed a buy-in mandate/);
    expect(auth.ok === false && auth.reason).toMatch(/has not signed a buy-in mandate/);
    // The refusal must not claim anything about the Home's configuration — this code cannot see it.
    expect(auth.ok === false && auth.reason).not.toMatch(/curated/);

    await expect(adapter.settleBuyIn(buyIn)).rejects.toMatchObject({ name: 'TreasuryError', code: 'no-mandate' });
    expect(client.calls).toHaveLength(0);
    expect(client.transfers).toHaveLength(0);
  });

  it('refuses a mandate signed by a DIFFERENT treasury, naming both accounts', async () => {
    const other = '0x00000000000000000000000000000000000000b2' as Address;
    const { adapter, client } = adapterFor(
      { treasury: PLAYER, mandate: signedMandate({ delegator: other }) },
      { [PLAYER.toLowerCase()]: 10_000_000n },
    );
    const auth = await adapter.authorizeBuyIn(buyIn);
    expect(auth.ok).toBe(false);
    expect(auth.ok === false && auth.reason).toContain(other);
    expect(auth.ok === false && auth.reason).toContain(PLAYER);
    await expect(adapter.settleBuyIn(buyIn)).rejects.toMatchObject({ name: 'TreasuryError' });
    expect(client.calls).toHaveLength(0);
  });

  it('refuses a buy-in larger than the mandate\u2019s per-charge cap, before anything is credited', async () => {
    const { adapter, client } = adapterFor({ treasury: PLAYER, mandate: signedMandate() }, { [PLAYER.toLowerCase()]: 1_000_000_000n });
    const big = { ...buyIn, chips: 1_000 }; // 10 USDC, against a 2 USDC cap
    const auth = await adapter.authorizeBuyIn(big);
    expect(auth.ok).toBe(false);
    expect(auth.ok === false && auth.reason).toMatch(/allows at most 2.000000 USDC per buy-in/);
    expect(client.calls).toHaveLength(0);
  });

  it('redeems the mandate through the DelegationManager as the house delegate', async () => {
    const { adapter, client } = adapterFor({ treasury: PLAYER, mandate: signedMandate() }, { [PLAYER.toLowerCase()]: 10_000_000n });
    expect(await adapter.authorizeBuyIn(buyIn)).toEqual({ ok: true });
    const receipt = await adapter.settleBuyIn(buyIn);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.from).toBe(HOUSE_DELEGATE);
    expect(client.calls[0]?.to).toBe(DELEGATION_MANAGER);
    // The redemption carries the payee and the amount inside its calldata.
    expect(client.calls[0]?.data).toContain(HOUSE.slice(2).toLowerCase());
    expect(receipt).toMatchObject({ mode: 'mandate-transfer', amount: '2000000', ref: TX });
  });

  it('refuses a mandate delegated to someone other than this card room', async () => {
    const other = '0x00000000000000000000000000000000000000ff' as Address;
    const { adapter, client } = adapterFor(
      { treasury: PLAYER, mandate: signedMandate({ delegate: other }) },
      { [PLAYER.toLowerCase()]: 10_000_000n },
    );
    await expect(adapter.settleBuyIn(buyIn)).rejects.toThrow(/is delegated to 0x00000000000000000000000000000000000000ff/);
    expect(client.calls).toHaveLength(0);
  });

  it('refuses when the deployment has no DelegationManager to redeem against', async () => {
    const client = fakeClient({ [PLAYER.toLowerCase()]: 10_000_000n });
    const adapter = createTreasuryTransferAdapter({
      client,
      houseTreasury: HOUSE,
      houseDelegate: HOUSE_DELEGATE,
      chipValue: CHIP_VALUE,
      chainId: 34348,
      enforcers: { payment: PAYMENT_ENFORCER },
      resolvePlayer: async () => ({ treasury: PLAYER, mandate: signedMandate() }),
    });
    const auth = await adapter.authorizeBuyIn(buyIn);
    expect(auth.ok === false && auth.reason).toMatch(/DELEGATION_MANAGER is not configured/);
  });

  it('reports a failed treasury lookup rather than silently treating it as "no treasury"', async () => {
    const client = fakeClient({});
    const adapter = createTreasuryTransferAdapter({
      client,
      houseTreasury: HOUSE,
      chipValue: CHIP_VALUE,
      chainId: 34348,
      resolvePlayer: vi.fn().mockRejectedValue(new Error('session store unreachable')),
    });
    const auth = await adapter.authorizeBuyIn(buyIn);
    expect(auth.ok === false && auth.reason).toMatch(/could not read the treasury for home:0xabc: session store unreachable/);
  });
});

describe('construction', () => {
  it('refuses a house treasury that is not an address', () => {
    expect(() =>
      createTreasuryTransferAdapter({
        client: fakeClient({}),
        houseTreasury: 'nope' as Address,
        chipValue: CHIP_VALUE,
        chainId: 1,
        resolvePlayer: async () => null,
      }),
    ).toThrow(TreasuryError);
  });

  it('refuses a non-positive chip value', () => {
    expect(() =>
      createTreasuryTransferAdapter({
        client: fakeClient({}),
        houseTreasury: HOUSE,
        chipValue: 0n,
        chainId: 1,
        resolvePlayer: async () => null,
      }),
    ).toThrow(/chipValue must be > 0/);
  });
});

describe('orderNonce', () => {
  it('is stable for one order and different across orders', () => {
    expect(orderNonce('t1:p:0:1700000000000')).toBe(orderNonce('t1:p:0:1700000000000'));
    expect(orderNonce('t1:p:0:1700000000000')).not.toBe(orderNonce('t1:p:0:1700000000001'));
    expect(orderNonce('x')).toBeGreaterThan(0n);
  });
});
