#!/usr/bin/env -S npx tsx
/**
 * Prove the money on faithchain, end to end, with no Worker and no mocking.
 *
 *   npx tsx scripts/settle-demo.mts [--chips <n>] [--fund <shq>] [--sign-mandate]
 *
 * What it does, in order:
 *   1. loads the house custodian from `.house-key.json` (gitignored, never printed);
 *   2. derives and deploys a PLAYER treasury Smart Agent this script custodies — a stand-in for a
 *      real player's own treasury, so both sides of the movement are visible;
 *   3. builds a REAL settled table with `@pokernight/engine` and seats the player for `--chips`,
 *      then stands them up, so the cash-out amount comes out of the engine rather than a constant;
 *   4. runs that cash-out through the EXACT adapter the table Durable Object uses
 *      (`createTreasuryTransferAdapter`), reading both balances either side;
 *   5. then tries the BUY-IN half and reports precisely where it stops.
 *
 * This script's player treasury is a STAND-IN that the script itself custodies, so what it proves is
 * the rail, not the ceremony: without `--sign-mandate` it runs the buy-in with no mandate and prints
 * the refusal verbatim, and with it the script signs the mandate as the stand-in's own custodian and
 * the house redeems it — proving the caveats, the enforcers and `redeemDelegation`.
 *
 * For the ceremony as a real person experiences it — a treasury discovered or created at their Home,
 * and a mandate signed there with a key this repo does not hold — run `pnpm settle:persona`
 * (scripts/settle-persona.mts). That is the one that proves the authority as well as the rail.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, keccak256, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/faithchain';
import { ROOT_AUTHORITY, hashDelegation, type Delegation } from '@agenticprimitives/delegation';
import { createTable, sitDown, standUp } from '@pokernight/engine';
import {
  buildBuyInMandateCaveats,
  chipsToAsset,
  createTreasuryClient,
  createTreasuryTransferAdapter,
  describeBuyInMandate,
  formatAmount,
  parseAmount,
  type AgentAccountSpec,
} from '@pokernight/treasury';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = process.env.HOUSE_KEY_FILE ?? resolve(REPO, '.house-key.json');
const HOUSE_FILE = resolve(REPO, 'house.faithchain.json');
const RPC_URL = process.env.FAITHCHAIN_RPC ?? 'https://a2a.faithnet.io/rpc';

/**
 * The chip rate this demo settles at. It is self-contained — the same value prices the buy-in and
 * the cash-out below — so it is a demo parameter, not a deployment one. A real table's rate is
 * stamped on the table when it is created (`PokerTableDO` `meta.chipValue`) and is 1 000 000 by
 * default now; this default is left at the older 0.01 chip so the demo moves small amounts.
 */
const CHIP_VALUE = BigInt(process.env.CHIP_VALUE ?? '10000');
/** A separate Smart Agent standing in for a player's own treasury. Stable across runs. */
const PLAYER_SALT_LABEL = 'pokernight.demo.player.v1';

/**
 * The card room's currency — the Sheqel, and nothing else. Read from `house.faithchain.json`, which
 * `pnpm deploy:sheqel` writes. No fallback: a demo that moves money must move the currency it says.
 */
const ASSET: Address = (() => {
  const house = JSON.parse(readFileSync(HOUSE_FILE, 'utf8')) as { contracts?: { sheqel?: string } };
  const sheqel = house.contracts?.sheqel ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(sheqel)) throw new Error(`${HOUSE_FILE} has no Sheqel address — run \`pnpm deploy:sheqel\` first`);
  return sheqel as Address;
})();

const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  const next = i === -1 ? undefined : args[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

const CHIPS = Number(flag('chips', '200'));
const FUND_PLAYER = parseAmount(flag('fund', '0'));
const SIGN_MANDATE = args.includes('--sign-mandate');

/** The a2a relay fans out to read replicas: a read straight after a write can lag. Poll to settle. */
async function settled(read: () => Promise<bigint>, expected: (v: bigint) => boolean, tries = 20): Promise<bigint> {
  let value = await read();
  for (let i = 0; i < tries && !expected(value); i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    value = await read();
  }
  return value;
}

function loadCustodian(): { privateKey: Hex; address: Address } {
  if (!existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} does not exist — run \`pnpm provision:house\` first`);
  const raw = JSON.parse(readFileSync(KEY_FILE, 'utf8')) as { privateKey?: string };
  if (!raw.privateKey) throw new Error(`${KEY_FILE} has no "privateKey"`);
  const privateKey = raw.privateKey as Hex;
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

function loadHouse(): { houseTreasurySa: Address; houseServiceSa: Address } {
  if (!existsSync(HOUSE_FILE)) throw new Error(`${HOUSE_FILE} does not exist — run \`pnpm provision:house\` first`);
  const raw = JSON.parse(readFileSync(HOUSE_FILE, 'utf8')) as { houseTreasurySa?: string; houseServiceSa?: string };
  if (!raw.houseTreasurySa || !raw.houseServiceSa) throw new Error(`${HOUSE_FILE} is missing the house Smart Agent addresses`);
  return { houseTreasurySa: raw.houseTreasurySa as Address, houseServiceSa: raw.houseServiceSa as Address };
}

async function main(): Promise<void> {
  if (!Number.isInteger(CHIPS) || CHIPS <= 0) throw new Error(`--chips must be a positive integer, got ${CHIPS}`);

  const custodian = loadCustodian();
  const house = loadHouse();
  const account = privateKeyToAccount(custodian.privateKey);

  console.log('Pokernight settlement demo — faithchain');
  console.log(`  rpc            ${RPC_URL}`);
  console.log(`  chainId        ${CONTRACTS.chainId}`);
  console.log(`  custodian      ${custodian.address}  (key read from ${KEY_FILE}, never printed)`);
  console.log(`  house treasury ${house.houseTreasurySa}`);
  console.log(`  asset          ${ASSET}  (6 decimals)`);
  console.log(`  chip value     ${CHIP_VALUE} base units = ${formatAmount(CHIP_VALUE)} SHQ per chip`);

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const onChainId = await publicClient.getChainId();
  if (onChainId !== CONTRACTS.chainId) throw new Error(`RPC is chain ${onChainId}, expected ${CONTRACTS.chainId}`);

  const treasury = createTreasuryClient({
    rpcUrl: RPC_URL,
    chainId: CONTRACTS.chainId,
    deployments: {
      asset: ASSET,
      entryPoint: CONTRACTS.entryPoint,
      agentAccountFactory: CONTRACTS.agentAccountFactory,
      paymaster: CONTRACTS.smartAgentPaymaster,
      delegationManager: CONTRACTS.delegationManager,
      paymentEnforcer: CONTRACTS.paymentEnforcer,
    },
    signer: account,
  });

  /* ---------------------------------------------------------- player treasury */

  console.log('\nPlayer treasury (a Smart Agent this script custodies, standing in for a real player)');
  const spec: AgentAccountSpec = { mode: 0, custodians: [custodian.address], salt: BigInt(keccak256(toHex(PLAYER_SALT_LABEL))) };
  const playerSa = await treasury.deriveAgentAccount(spec);
  if (await treasury.isDeployed(playerSa)) {
    console.log(`  ${playerSa}  already deployed`);
  } else {
    console.log(`  ${playerSa}  deploying…`);
    await treasury.deployAgentAccount(spec, account);
    if (!(await treasury.isDeployed(playerSa))) throw new Error('player treasury deploy did not land');
    console.log(`  ${playerSa}  deployed`);
  }
  if (FUND_PLAYER > 0n) {
    console.log(`  minting ${formatAmount(FUND_PLAYER)} test Sheqels into the player treasury…`);
    const hash = await treasury.mintTestAsset(playerSa, FUND_PLAYER, account);
    console.log(`  mint tx ${hash}`);
    await settled(() => treasury.readBalance(playerSa), (v) => v >= FUND_PLAYER);
  }

  /* ------------------------------------------------------------ settled table */

  console.log('\nA settled table (the real engine, settlement mode "mandate-transfer")');
  const config = { seats: 6, smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 20_000 };
  let state = createTable(config);
  state = sitDown(state, 0, 'demo:player', CHIPS);
  const stood = standUp(state, 0);
  const cashOutChips = stood.cashOut;
  console.log(`  seat 0 bought in for ${CHIPS} chips and stood up with ${cashOutChips}`);
  console.log(`  ${cashOutChips} chips × ${CHIP_VALUE} = ${formatAmount(chipsToAsset(cashOutChips, CHIP_VALUE))} SHQ`);

  /* ------------------------------------------------------------ the mandate */

  let mandate: Delegation | undefined;
  if (SIGN_MANDATE) {
    console.log('\nBuy-in mandate — signed HERE, standing in for the player\'s Home');
    const maxPerCharge = chipsToAsset(CHIPS, CHIP_VALUE);
    const terms = {
      payee: house.houseTreasurySa,
      asset: ASSET,
      enforcers: {
        payment: CONTRACTS.paymentEnforcer,
        timestamp: CONTRACTS.timestampEnforcer,
        allowedTargets: CONTRACTS.allowedTargetsEnforcer,
        allowedMethods: CONTRACTS.allowedMethodsEnforcer,
      },
      maxAmountPerCharge: maxPerCharge,
      maxAggregate: maxPerCharge * 4n,
      maxRedemptionsPerWindow: 4,
      windowSeconds: 24 * 60 * 60,
      validUntil: Math.floor(Date.now() / 1000) + 60 * 60,
    };
    const consent = describeBuyInMandate(terms);
    console.log(`  what the player would be shown: pay up to ${formatAmount(consent.maxAmountPerCharge)} SHQ per buy-in,`);
    console.log(`  ${formatAmount(consent.sessionBudget)} SHQ in total, at most ${consent.maxRedemptionsPerWindow} times a day, to ${consent.recipient}`);

    const unsigned = {
      delegator: playerSa,
      delegate: house.houseServiceSa,
      authority: ROOT_AUTHORITY,
      caveats: buildBuyInMandateCaveats(terms),
      salt: BigInt(Date.now()),
      signature: '0x' as Hex,
    } satisfies Delegation;
    const digest = hashDelegation(unsigned, CONTRACTS.chainId, CONTRACTS.delegationManager);
    // ERC-1271 through the player's Smart Agent: the custodian signs the EIP-712 digest, and the
    // account validates it. Here the script IS that custodian; for a real player their Home is.
    mandate = { ...unsigned, signature: await account.signMessage({ message: { raw: digest } }) };
    console.log(`  signed by ${custodian.address} as a custodian of ${playerSa} (NOT by a Home)`);
  }

  // The exact adapter the Durable Object builds. `resolvePlayer` is what the DO fills from SessionDO.
  const adapter = createTreasuryTransferAdapter({
    client: treasury,
    houseTreasury: house.houseTreasurySa,
    houseDelegate: house.houseServiceSa,
    chipValue: CHIP_VALUE,
    chainId: CONTRACTS.chainId,
    delegationManager: CONTRACTS.delegationManager,
    enforcers: { payment: CONTRACTS.paymentEnforcer },
    // What the Durable Object reads out of SessionDO. `mandate` is undefined unless this run signed
    // one itself: for a real player it comes from their Home, and their Home cannot issue it yet.
    resolvePlayer: async () => (mandate ? { treasury: playerSa, mandate } : { treasury: playerSa }),
  });

  /* ------------------------------------------------------------- the cash-out */

  console.log('\nCash-out — house treasury → player treasury');
  const houseBefore = await treasury.readBalance(house.houseTreasurySa);
  const playerBefore = await treasury.readBalance(playerSa);
  const amount = chipsToAsset(cashOutChips, CHIP_VALUE);
  console.log(`  before   house ${formatAmount(houseBefore)}   player ${formatAmount(playerBefore)}`);

  const receipt = await adapter.settleCashOut({
    tableId: 'settle-demo',
    seat: 0,
    playerId: 'demo:player',
    playerAddress: playerSa,
    chips: cashOutChips,
    historyDigest: 'hands:0:last:0',
    orderId: `settle-demo:${Date.now()}`,
  });

  const playerAfter = await settled(() => treasury.readBalance(playerSa), (v) => v === playerBefore + amount);
  const houseAfter = await treasury.readBalance(house.houseTreasurySa);
  console.log(`  tx       ${receipt.ref}`);
  console.log(`  receipt  mode=${receipt.mode} amount=${receipt.amount} asset=${receipt.asset}`);
  console.log(`  after    house ${formatAmount(houseAfter)}   player ${formatAmount(playerAfter)}`);
  if (playerAfter - playerBefore !== amount || houseBefore - houseAfter !== amount) {
    throw new Error(
      `balances did not move by exactly ${formatAmount(amount)} SHQ ` +
        `(house ${formatAmount(houseBefore - houseAfter)}, player ${formatAmount(playerAfter - playerBefore)})`,
    );
  }
  console.log(`  both balances moved by exactly ${formatAmount(amount)} SHQ ✓`);

  /* --------------------------------------------------------------- the buy-in */

  console.log('\nBuy-in — player treasury → house treasury (the half that needs the player\'s authority)');
  const buyInReq = {
    tableId: 'settle-demo',
    seat: 0,
    playerId: 'demo:player',
    playerAddress: playerSa,
    chips: CHIPS,
    orderId: `settle-demo-buyin:${Date.now()}`,
  };
  const buyInAmount = chipsToAsset(CHIPS, CHIP_VALUE);
  const houseBeforeBuyIn = await treasury.readBalance(house.houseTreasurySa);
  const playerBeforeBuyIn = await treasury.readBalance(playerSa);
  console.log(`  before   house ${formatAmount(houseBeforeBuyIn)}   player ${formatAmount(playerBeforeBuyIn)}`);
  const auth = await adapter.authorizeBuyIn(buyInReq);
  console.log(`  authorizeBuyIn → ${auth.ok ? 'ok' : 'REFUSED'}`);
  if (!auth.ok) console.log(`    ${auth.reason}`);
  let buyInTx: string | null = null;
  try {
    const buyIn = await adapter.settleBuyIn(buyInReq);
    buyInTx = buyIn.ref;
    const playerAfterBuyIn = await settled(() => treasury.readBalance(playerSa), (v) => v === playerBeforeBuyIn - buyInAmount);
    const houseAfterBuyIn = await treasury.readBalance(house.houseTreasurySa);
    console.log(`  tx       ${buyIn.ref}`);
    console.log(`  after    house ${formatAmount(houseAfterBuyIn)}   player ${formatAmount(playerAfterBuyIn)}`);
    if (playerBeforeBuyIn - playerAfterBuyIn !== buyInAmount || houseAfterBuyIn - houseBeforeBuyIn !== buyInAmount) {
      throw new Error(`buy-in balances did not move by exactly ${formatAmount(buyInAmount)} SHQ`);
    }
    console.log(`  both balances moved by exactly ${formatAmount(buyInAmount)} SHQ ✓`);
  } catch (e) {
    console.log('  settleBuyIn → REFUSED (fail-closed, no play-money fallback)');
    console.log(`    ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log('\nSummary');
  console.log(`  cash-out settled on chain      ${receipt.ref}`);
  console.log(`  house treasury                 ${formatAmount(houseBefore)} → ${formatAmount(houseAfter)} SHQ`);
  console.log(`  player treasury ${playerSa}  ${formatAmount(playerBefore)} → ${formatAmount(playerAfter)} SHQ`);
  if (buyInTx) {
    console.log(`  buy-in settled on chain        ${buyInTx}`);
    console.log('                                 against a mandate THIS SCRIPT signed as the test treasury\'s');
    console.log('                                 custodian. The rail is proven; a real player still needs their');
    console.log('                                 Home to issue the mandate (docs/HOME-SETUP.md §1).');
  } else {
    console.log('  buy-in                         refused: no mandate was signed for the stand-in treasury');
    console.log('                                 (re-run with --sign-mandate, or `pnpm settle:persona` for the real ceremony)');
  }
}

main().catch((err) => {
  console.error(`\nsettle-demo FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
