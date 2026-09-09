#!/usr/bin/env -S npx tsx
/**
 * The whole money flow, for a real person at the live Home, on faithchain. No Worker, no mocking,
 * no stand-ins: every signature in this run comes from a key this script does not hold.
 *
 *   npx tsx scripts/settle-persona.mts [--handle elena] [--chips 200] [--fund 25] [--label <l>]
 *
 * In order:
 *   1. sign in as one of the Home's demo people for real (`POST /connect/demo-signin`);
 *   2. ask their Home which treasuries they have (`GET /connect/related-orgs`, `person-treasury`);
 *   3. if they have none, MAKE one — deployed at their Home under their own custodian, optionally
 *      named `<label>.treasury`, and recorded back in their agent tree so any app can find it;
 *   4. fund it from the test faucet (the Sheqel's open mint);
 *   5. have them sign a real buy-in mandate: the card room builds the delegation, their Home signs
 *      the EIP-712 digest with their custodian key (`POST /connect/persona-sign`);
 *   6. seat them at a settled table built from the real engine, and settle the BUY-IN by redeeming
 *      that mandate — player treasury → house treasury;
 *   7. stand them up and settle the CASH-OUT — house treasury → player treasury.
 *
 * Steps 6 and 7 run through `createTreasuryTransferAdapter`, the exact adapter the table Durable
 * Object builds, with `resolvePlayer` returning what `SessionDO` would return. The distinction from
 * `settle-demo.mts` is the one that matters: there, the script custodied the player's treasury and
 * signed the mandate itself. Here the player's Home signs, and the card room could not forge it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/faithchain';
import { createTable, sitDown, standUp } from '@pokernight/engine';
import {
  buyInMandateDigest,
  buyInMandateTerms,
  checkBuyInMandate,
  chipsToAsset,
  createTreasuryClient,
  createTreasuryTransferAdapter,
  describeBuyInMandate,
  formatAmount,
  parseAmount,
  unsignedBuyInMandate,
} from '@pokernight/treasury';
import {
  demoSignIn,
  listDemoPersonas,
  listRelatedAgents,
  personTreasuries,
  personaSignDigest,
  type HomeApiConfig,
} from '../apps/tables/src/home-api.js';
import { createTreasuryForPersona } from '../apps/tables/src/treasury-create.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = process.env.HOUSE_KEY_FILE ?? resolve(REPO, '.house-key.json');
const HOUSE_FILE = resolve(REPO, 'house.faithchain.json');
const RPC_URL = process.env.FAITHCHAIN_RPC ?? 'https://a2a.faithnet.io/rpc';
const HOME_ORIGIN = process.env.HOME_ORIGIN ?? 'https://www.faithnet.me';
const HOME_CLIENT_ID = process.env.HOME_CLIENT_ID ?? 'pokernight';

/**
 * The chip rate this demo settles at. It is self-contained — the same value prices the buy-in and
 * the cash-out below — so it is a demo parameter, not a deployment one. A real table's rate is
 * stamped on the table when it is created (`PokerTableDO` `meta.chipValue`) and is 1 000 000 by
 * default now; this default is left at the older 0.01 chip so the demo moves small amounts.
 */
const CHIP_VALUE = BigInt(process.env.CHIP_VALUE ?? '10000');

const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  const next = i === -1 ? undefined : args[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

const HANDLE = flag('handle', 'elena');
/**
 * The currency to settle in: the card room's OWN and only coin, Sheqel, recorded in
 * `house.faithchain.json` by `pnpm deploy:sheqel`. `--asset 0x…` overrides it for a one-off run
 * against another 6-decimal token; there is no automatic fallback, because a script that moves money
 * must not quietly move a different currency from the one it says it is moving.
 */
const ASSET_FLAG = flag('asset', '').trim();
const CHIPS = Number(flag('chips', '200'));
const FUND = parseAmount(flag('fund', '25'));
const LABEL = flag('label', '').trim();

const home: HomeApiConfig = { origin: HOME_ORIGIN, clientId: HOME_CLIENT_ID };

/** The `.treasury` PermissionlessSubregistry on this chain. Only the optional label needs it. */
const TREASURY_SUBREGISTRY = ((CONTRACTS.permissionlessSubregistries as unknown as Record<string, string>).treasury ??
  '0x0000000000000000000000000000000000000000') as Address;

/** The a2a relay fans out to read replicas: a read straight after a write can lag. Poll to settle. */
async function settled(read: () => Promise<bigint>, expected: (v: bigint) => boolean, tries = 25): Promise<bigint> {
  let value = await read();
  for (let i = 0; i < tries && !expected(value); i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    value = await read();
  }
  return value;
}

function loadHouse(): { houseTreasurySa: Address; houseServiceSa: Address; privateKey: Hex; asset: Address; assetName: string } {
  if (!existsSync(HOUSE_FILE)) throw new Error(`${HOUSE_FILE} does not exist — run \`pnpm provision:house\` first`);
  if (!existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} does not exist — run \`pnpm provision:house\` first`);
  const house = JSON.parse(readFileSync(HOUSE_FILE, 'utf8')) as {
    houseTreasurySa?: string;
    houseServiceSa?: string;
    contracts?: { sheqel?: string };
  };
  const key = JSON.parse(readFileSync(KEY_FILE, 'utf8')) as { privateKey?: string };
  if (!house.houseTreasurySa || !house.houseServiceSa) throw new Error(`${HOUSE_FILE} is missing the house Smart Agent addresses`);
  if (!key.privateKey) throw new Error(`${KEY_FILE} has no "privateKey"`);
  const sheqel = house.contracts?.sheqel ?? '';
  if (!ASSET_FLAG && !/^0x[0-9a-fA-F]{40}$/.test(sheqel)) {
    throw new Error(`${HOUSE_FILE} has no Sheqel address — run \`pnpm deploy:sheqel\` first, or pass --asset 0x…`);
  }
  const asset = (ASSET_FLAG || sheqel) as Address;
  return {
    houseTreasurySa: house.houseTreasurySa as Address,
    houseServiceSa: house.houseServiceSa as Address,
    privateKey: key.privateKey as Hex,
    asset,
    assetName: asset.toLowerCase() === (house.contracts?.sheqel ?? '').toLowerCase() ? 'SHQ' : asset,
  };
}

async function main(): Promise<void> {
  if (!Number.isInteger(CHIPS) || CHIPS <= 0) throw new Error(`--chips must be a positive integer, got ${CHIPS}`);
  const house = loadHouse();
  const account = privateKeyToAccount(house.privateKey);

  console.log('Pokernight — the whole money flow, live');
  console.log(`  home           ${HOME_ORIGIN}  (client_id ${HOME_CLIENT_ID})`);
  console.log(`  rpc            ${RPC_URL}`);
  console.log(`  chainId        ${CONTRACTS.chainId}`);
  console.log(`  house treasury ${house.houseTreasurySa}   house delegate ${house.houseServiceSa}`);
  console.log(`  asset          ${house.asset}  ${house.assetName}, 6 decimals`);
  console.log(`  chip value     ${CHIP_VALUE} base units = ${formatAmount(CHIP_VALUE)} ${house.assetName} per chip`);

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const onChainId = await publicClient.getChainId();
  if (onChainId !== CONTRACTS.chainId) throw new Error(`RPC is chain ${onChainId}, expected ${CONTRACTS.chainId}`);

  const treasury = createTreasuryClient({
    rpcUrl: RPC_URL,
    chainId: CONTRACTS.chainId,
    deployments: {
      asset: house.asset,
      entryPoint: CONTRACTS.entryPoint,
      agentAccountFactory: CONTRACTS.agentAccountFactory,
      paymaster: CONTRACTS.smartAgentPaymaster,
      delegationManager: CONTRACTS.delegationManager,
      paymentEnforcer: CONTRACTS.paymentEnforcer,
    },
    signer: account,
  });

  /* ------------------------------------------------------------------ 1. sign in */

  console.log('\n1. Sign in at the Home, as a person');
  const persona = (await listDemoPersonas(home)).find((p) => p.handle === HANDLE);
  if (!persona) throw new Error(`the Home lists no demo person called "${HANDLE}"`);
  const signIn = await demoSignIn(home, persona.handle);
  console.log(`  ${persona.name} (${persona.handle})`);
  console.log(`  person agent   ${signIn.agent}`);
  console.log(`  custodian EOA  ${persona.custodian}  (their Home holds this key, not us)`);

  /* --------------------------------------------------------------- 2. discovery */

  console.log('\n2. Ask their Home which treasuries they have');
  let mine = personTreasuries(await listRelatedAgents(home, signIn.idToken));
  console.log(`  ${mine.length} treasury/treasuries: ${mine.map((t) => `${t.orgName || '(nameless)'} ${t.orgAgent}`).join(', ') || '(none)'}`);
  console.log(`  their PERSON agent ${signIn.agent} is not on that list, and never is — it is an identity`);

  /* ----------------------------------------------------------------- 3. create */

  if (mine.length === 0) {
    console.log('\n3. Create one — deployed at their Home, custodied by them');
    const created = await createTreasuryForPersona(
      { home, nameRegistry: CONTRACTS.agentNameRegistry as Address, treasurySubregistry: TREASURY_SUBREGISTRY },
      { persona, homeSession: signIn.homeSession, ...(LABEL ? { label: LABEL } : {}) },
    );
    console.log(`  address        ${created.address}`);
    console.log(`  name           ${created.name || '(nameless — the address is the id)'}`);
    console.log(`  deploy tx      ${created.txHash ?? '(not reported)'}`);
    console.log('  recorded at the Home, so discovery finds it from any app');
    mine = personTreasuries(await listRelatedAgents(home, signIn.idToken));
    if (!mine.some((t) => t.orgAgent === created.address.toLowerCase())) {
      throw new Error('the treasury was created but the Home did not list it back');
    }
  } else {
    console.log('\n3. Create one — skipped, they already have one');
  }

  const player = mine[0]!.orgAgent as Address;
  const playerName = mine[0]!.orgName || '(nameless)';
  if (!(await treasury.isDeployed(player))) throw new Error(`${player} has no code on chain ${CONTRACTS.chainId}`);
  if (!(await treasury.isCustodian(player, persona.custodian as Address))) {
    throw new Error(`${persona.custodian} is not a custodian of ${player} — their Home could not sign for it`);
  }
  console.log(`  using          ${playerName} ${player}`);
  console.log(`  custody check  ${persona.custodian} IS a custodian of it ✓`);

  /* ------------------------------------------------------------------- 4. fund */

  console.log(`\n4. Fund it (${house.assetName} has an open mint; this is test money)`);
  const need = chipsToAsset(CHIPS, CHIP_VALUE);
  let held = await treasury.readBalance(player);
  console.log(`  balance        ${formatAmount(held)} ${house.assetName}, buy-in costs ${formatAmount(need)} ${house.assetName}`);
  if (held < need || FUND > 0n) {
    const top = held < need ? (need - held > FUND ? need - held : FUND) : FUND;
    const before = held;
    const hash = await treasury.mintTestAsset(player, top, account);
    console.log(`  mint ${formatAmount(top)} ${house.assetName}  tx ${hash}`);
    // Wait for the MINT itself to be visible, not merely for "enough": a read replica that is still
    // behind will otherwise deliver the new balance in the middle of the buy-in and make an exact
    // before/after comparison lie about what moved.
    held = await settled(() => treasury.readBalance(player), (v) => v >= before + top);
    console.log(`  balance        ${formatAmount(held)} ${house.assetName}`);
  }
  if (held < need) throw new Error(`the treasury still holds ${formatAmount(held)} ${house.assetName}, under the ${formatAmount(need)} ${house.assetName} buy-in`);

  /* ---------------------------------------------------------------- 5. mandate */

  console.log('\n5. The buy-in mandate — signed by their Home, with their key');
  const terms = buyInMandateTerms({
    payee: house.houseTreasurySa,
    asset: house.asset,
    enforcers: {
      payment: CONTRACTS.paymentEnforcer as Address,
      timestamp: CONTRACTS.timestampEnforcer as Address,
      allowedTargets: CONTRACTS.allowedTargetsEnforcer as Address,
      allowedMethods: CONTRACTS.allowedMethodsEnforcer as Address,
    },
    chipValue: CHIP_VALUE,
    policy: { maxBuyInChips: Math.max(CHIPS, 20_000), maxBuyIns: 5, windowSeconds: 43_200, validForSeconds: 43_200 },
    now: Date.now(),
  });
  const consent = describeBuyInMandate(terms);
  console.log(`  what they are shown: up to ${formatAmount(consent.maxAmountPerCharge)} ${house.assetName} per buy-in,`);
  console.log(`  ${formatAmount(consent.sessionBudget)} ${house.assetName} in total, at most ${consent.maxRedemptionsPerWindow} times,`);
  console.log(`  payable only to ${consent.recipient}, until ${new Date(consent.expiresAt * 1000).toISOString()}`);

  const unsigned = unsignedBuyInMandate({
    treasury: player,
    houseDelegate: house.houseServiceSa,
    terms,
    salt: BigInt(Date.now()),
  });
  const digest = buyInMandateDigest(unsigned, CONTRACTS.chainId, CONTRACTS.delegationManager as Address);
  const signature = await personaSignDigest(home, signIn.homeSession, digest);
  const mandate = { ...unsigned, salt: unsigned.salt.toString(), signature };
  console.log(`  digest         ${digest}`);
  console.log(`  signed by      their Home, as ${persona.custodian} — this script holds no key that could`);

  const problem = checkBuyInMandate(mandate, {
    treasury: player,
    houseDelegate: house.houseServiceSa,
    payee: house.houseTreasurySa,
    asset: house.asset,
    paymentEnforcer: CONTRACTS.paymentEnforcer as Address,
    amount: need,
    now: Date.now(),
  });
  if (problem) throw new Error(`the mandate does not authorise this buy-in: ${problem}`);
  console.log('  checks against this table, this treasury, this amount ✓');

  /* ------------------------------------------------------- 6/7. the table + money */

  const adapter = createTreasuryTransferAdapter({
    client: treasury,
    houseTreasury: house.houseTreasurySa,
    houseDelegate: house.houseServiceSa,
    chipValue: CHIP_VALUE,
    chainId: CONTRACTS.chainId,
    delegationManager: CONTRACTS.delegationManager as Address,
    enforcers: { payment: CONTRACTS.paymentEnforcer as Address },
    // Exactly what the Durable Object's `playerFunding` hands it, out of `SessionDO`.
    resolvePlayer: async () => ({ treasury: player, mandate: mandate as never }),
  });

  console.log('\n6. Take a seat at a settled table, and settle the buy-in');
  const config = { seats: 6, smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 20_000 };
  let state = createTable(config);
  state = sitDown(state, 0, `home:${signIn.agent}`, CHIPS);
  console.log(`  seat 0 buys in for ${CHIPS} chips = ${formatAmount(need)} ${house.assetName}`);

  const buyInReq = {
    tableId: 'settle-persona',
    seat: 0,
    playerId: `home:${signIn.agent}`,
    playerAddress: player,
    chips: CHIPS,
    orderId: `settle-persona-buyin:${Date.now()}`,
  };
  const houseBeforeBuyIn = await treasury.readBalance(house.houseTreasurySa);
  const playerBeforeBuyIn = await treasury.readBalance(player);
  console.log(`  before   house ${formatAmount(houseBeforeBuyIn)}   player ${formatAmount(playerBeforeBuyIn)}`);
  const auth = await adapter.authorizeBuyIn(buyInReq);
  if (!auth.ok) throw new Error(`authorizeBuyIn refused: ${auth.reason}`);
  console.log('  authorizeBuyIn → ok');
  const buyIn = await adapter.settleBuyIn(buyInReq);
  const playerAfterBuyIn = await settled(() => treasury.readBalance(player), (v) => v === playerBeforeBuyIn - need);
  const houseAfterBuyIn = await settled(() => treasury.readBalance(house.houseTreasurySa), (v) => v === houseBeforeBuyIn + need);
  console.log(`  tx       ${buyIn.ref}`);
  console.log(`  after    house ${formatAmount(houseAfterBuyIn)}   player ${formatAmount(playerAfterBuyIn)}`);
  if (playerBeforeBuyIn - playerAfterBuyIn !== need || houseAfterBuyIn - houseBeforeBuyIn !== need) {
    throw new Error(`buy-in balances did not move by exactly ${formatAmount(need)} ${house.assetName}`);
  }
  console.log(`  both balances moved by exactly ${formatAmount(need)} ${house.assetName} ✓`);

  console.log('\n7. Stand up, and settle the cash-out');
  const stood = standUp(state, 0);
  const cashOutChips = stood.cashOut;
  const back = chipsToAsset(cashOutChips, CHIP_VALUE);
  console.log(`  seat 0 stands up with ${cashOutChips} chips = ${formatAmount(back)} ${house.assetName}`);
  const houseBeforeOut = await treasury.readBalance(house.houseTreasurySa);
  const playerBeforeOut = await treasury.readBalance(player);
  const cashOut = await adapter.settleCashOut({
    tableId: 'settle-persona',
    seat: 0,
    playerId: `home:${signIn.agent}`,
    playerAddress: player,
    chips: cashOutChips,
    historyDigest: 'hands:0:last:0',
    orderId: `settle-persona-cashout:${Date.now()}`,
  });
  const playerAfterOut = await settled(() => treasury.readBalance(player), (v) => v === playerBeforeOut + back);
  const houseAfterOut = await settled(() => treasury.readBalance(house.houseTreasurySa), (v) => v === houseBeforeOut - back);
  console.log(`  tx       ${cashOut.ref}`);
  console.log(`  after    house ${formatAmount(houseAfterOut)}   player ${formatAmount(playerAfterOut)}`);
  if (playerAfterOut - playerBeforeOut !== back || houseBeforeOut - houseAfterOut !== back) {
    throw new Error(`cash-out balances did not move by exactly ${formatAmount(back)} ${house.assetName}`);
  }
  console.log(`  both balances moved by exactly ${formatAmount(back)} ${house.assetName} ✓`);

  console.log('\nSummary');
  console.log(`  person agent      ${signIn.agent}          (identity — never spent from)`);
  console.log(`  treasury          ${player}  ${playerName}`);
  console.log(`  house treasury    ${house.houseTreasurySa}`);
  console.log(`  buy-in  tx        ${buyIn.ref}   ${formatAmount(need)} ${house.assetName}  player → house`);
  console.log(`  cash-out tx       ${cashOut.ref}   ${formatAmount(back)} ${house.assetName}  house → player`);
  console.log('  the buy-in moved under a mandate signed at the player\'s Home with a key this card room');
  console.log('  does not hold. That is the whole difference from scripts/settle-demo.mts.');
}

main().catch((err) => {
  console.error(`\nsettle-persona FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
