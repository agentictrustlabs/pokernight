#!/usr/bin/env -S npx tsx
/**
 * Provision the Poker Site's own on-chain identity on faithchain.
 *
 *   npx tsx scripts/provision-house.mts [--demo-transfer[=<usdc>]] [--mint <usdc>]
 *
 * Idempotent. Every run:
 *   1. loads (or creates) the house custodian EOA from `.house-key.json` — gitignored,
 *      mode 0600, and NEVER printed;
 *   2. derives the two house Smart Agents deterministically from that custodian +
 *      a labelled salt, and deploys whichever is missing;
 *   3. tops the treasury up to the mint target using MockUSDC's permissionless mint;
 *   4. writes the addresses (no secrets) to `house.faithchain.json`;
 *   5. prints the wrangler lines needed to wire `apps/tables`.
 *
 * `--demo-transfer` additionally moves a small amount treasury -> service agent through
 * the real UserOp path, so a run can prove the money rail end to end. It is OPT-IN
 * because it spends: a bare run must not move funds.
 *
 * Why the a2a relay and not rpc.faithnet.io: the latter requires a chain-rpc-gateway app
 * token this repo does not hold. Override with FAITHCHAIN_RPC if you have one.
 *
 * Why a UserOp and not a direct call: `AgentAccount.execute` is gated to
 * EntryPoint / self / DelegationManager (`_requireForExecute`), so a custodian EOA
 * cannot call it. The custodian signs the userOpHash; the EntryPoint executes.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, keccak256, toHex, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/faithchain';
import {
  createTreasuryClient,
  formatUsdc,
  parseUsdc,
  type AgentAccountSpec,
} from '@pokernight/treasury';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = process.env.HOUSE_KEY_FILE ?? resolve(REPO, '.house-key.json');
const OUT_FILE = resolve(REPO, 'house.faithchain.json');
const RPC_URL = process.env.FAITHCHAIN_RPC ?? 'https://a2a.faithnet.io/rpc';

/** Labelled salts — distinct addresses from one custodian, stable across runs. */
const SERVICE_SALT_LABEL = 'pokernight.house.service.v1';
const TREASURY_SALT_LABEL = 'pokernight.house.treasury.v1';

const args = process.argv.slice(2);
function flag(name: string): string | boolean {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  if (i === -1) return false;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const MINT_TARGET = (() => {
  const v = flag('mint');
  return typeof v === 'string' ? parseUsdc(v) : parseUsdc(process.env.HOUSE_MINT_USDC ?? '1000000');
})();
const DEMO = flag('demo-transfer');
const DEMO_AMOUNT = typeof DEMO === 'string' ? parseUsdc(DEMO) : parseUsdc('25');

/**
 * The a2a relay fans out to read replicas, so a read taken immediately after a write
 * can still show the pre-write state (observed: the balance right after the mint tx
 * read 0). Poll until the value settles rather than reporting a stale number.
 */
async function readBalanceSettled(
  read: () => Promise<bigint>,
  expected: (v: bigint) => boolean,
  tries = 20,
): Promise<bigint> {
  let value = await read();
  for (let i = 0; i < tries && !expected(value); i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    value = await read();
  }
  return value;
}

function saltFor(label: string): bigint {
  return BigInt(keccak256(toHex(label)));
}

/** Load the custodian key, or mint one. The key never leaves this file or this process. */
function loadOrCreateCustodian(): { privateKey: Hex; address: Address; created: boolean } {
  if (existsSync(KEY_FILE)) {
    const raw = JSON.parse(readFileSync(KEY_FILE, 'utf8')) as { privateKey?: string };
    if (!raw.privateKey) throw new Error(`${KEY_FILE} exists but has no "privateKey"`);
    const privateKey = raw.privateKey as Hex;
    return { privateKey, address: privateKeyToAccount(privateKey).address, created: false };
  }
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  mkdirSync(dirname(KEY_FILE), { recursive: true });
  writeFileSync(
    KEY_FILE,
    `${JSON.stringify(
      {
        _warning: 'SECRET. Never commit. Never paste. This is the Pokernight house custodian key.',
        chainId: CONTRACTS.chainId,
        address,
        privateKey,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  chmodSync(KEY_FILE, 0o600);
  return { privateKey, address, created: true };
}

async function main(): Promise<void> {
  const custodian = loadOrCreateCustodian();
  const account = privateKeyToAccount(custodian.privateKey);

  console.log('Pokernight house provisioning — faithchain');
  console.log(`  rpc         ${RPC_URL}`);
  console.log(`  chainId     ${CONTRACTS.chainId}`);
  console.log(`  key file    ${KEY_FILE} ${custodian.created ? '(created, mode 0600)' : '(reused)'}`);
  console.log(`  custodian   ${custodian.address}`);

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const onChainId = await publicClient.getChainId();
  if (onChainId !== CONTRACTS.chainId) {
    throw new Error(`RPC is chain ${onChainId}, expected ${CONTRACTS.chainId}`);
  }

  const treasury = createTreasuryClient({
    rpcUrl: RPC_URL,
    chainId: CONTRACTS.chainId,
    deployments: {
      asset: CONTRACTS.mockUsdc,
      entryPoint: CONTRACTS.entryPoint,
      agentAccountFactory: CONTRACTS.agentAccountFactory,
      paymaster: CONTRACTS.smartAgentPaymaster,
    },
    signer: account,
  });

  const specs: Record<'service' | 'treasury', AgentAccountSpec> = {
    service: { mode: 0, custodians: [custodian.address], salt: saltFor(SERVICE_SALT_LABEL) },
    treasury: { mode: 0, custodians: [custodian.address], salt: saltFor(TREASURY_SALT_LABEL) },
  };

  console.log('\nSmart Agents');
  const addresses: Record<'service' | 'treasury', Address> = { service: '0x', treasury: '0x' };
  for (const role of ['service', 'treasury'] as const) {
    const spec = specs[role];
    const predicted = await treasury.deriveAgentAccount(spec);
    const already = await treasury.isDeployed(predicted);
    if (already) {
      console.log(`  ${role.padEnd(8)} ${predicted}  already deployed`);
    } else {
      console.log(`  ${role.padEnd(8)} ${predicted}  deploying…`);
      await treasury.deployAgentAccount(spec, account);
      if (!(await treasury.isDeployed(predicted))) throw new Error(`${role} deploy did not land`);
      console.log(`  ${role.padEnd(8)} ${predicted}  deployed`);
    }
    if (!(await treasury.isCustodian(predicted, custodian.address))) {
      throw new Error(`${custodian.address} is not a custodian of the ${role} account ${predicted}`);
    }
    addresses[role] = predicted;
  }

  console.log('\nFunding');
  let treasuryBalance = await treasury.readUsdcBalance(addresses.treasury);
  console.log(`  treasury balance ${formatUsdc(treasuryBalance)} USDC`);
  if (treasuryBalance < MINT_TARGET) {
    const top = MINT_TARGET - treasuryBalance;
    console.log(`  minting ${formatUsdc(top)} USDC to the treasury…`);
    const hash = await treasury.mintTestAsset(addresses.treasury, top, account);
    console.log(`  mint tx ${hash}`);
    treasuryBalance = await readBalanceSettled(
      () => treasury.readUsdcBalance(addresses.treasury),
      (v) => v >= MINT_TARGET,
    );
    console.log(`  treasury balance ${formatUsdc(treasuryBalance)} USDC`);
    if (treasuryBalance < MINT_TARGET) {
      throw new Error(`mint ${hash} landed but the treasury still reads ${formatUsdc(treasuryBalance)} USDC`);
    }
  } else {
    console.log(`  at or above the ${formatUsdc(MINT_TARGET)} USDC target — nothing minted`);
  }
  const serviceBalance = await treasury.readUsdcBalance(addresses.service);
  console.log(`  service  balance ${formatUsdc(serviceBalance)} USDC`);

  if (DEMO) {
    console.log(`\nDemo transfer — treasury -> service, ${formatUsdc(DEMO_AMOUNT)} USDC`);
    const beforeT = await treasury.readUsdcBalance(addresses.treasury);
    const beforeS = await treasury.readUsdcBalance(addresses.service);
    console.log(`  before  treasury ${formatUsdc(beforeT)}  service ${formatUsdc(beforeS)}`);
    const { txHash } = await treasury.transferUsdc({
      from: addresses.treasury,
      to: addresses.service,
      amount: DEMO_AMOUNT,
    });
    const afterS = await readBalanceSettled(
      () => treasury.readUsdcBalance(addresses.service),
      (v) => v === beforeS + DEMO_AMOUNT,
    );
    const afterT = await treasury.readUsdcBalance(addresses.treasury);
    console.log(`  tx      ${txHash}`);
    console.log(`  after   treasury ${formatUsdc(afterT)}  service ${formatUsdc(afterS)}`);
    if (beforeT - afterT !== DEMO_AMOUNT || afterS - beforeS !== DEMO_AMOUNT) {
      throw new Error('balances did not move by exactly the transferred amount');
    }
    console.log('  balances moved by exactly the transferred amount ✓');
  }

  writeFileSync(
    OUT_FILE,
    `${JSON.stringify(
      {
        _note: 'Addresses only — safe to commit. The custodian KEY lives in .house-key.json (gitignored).',
        network: 'faithchain',
        chainId: CONTRACTS.chainId,
        rpcUrl: RPC_URL,
        houseCustodian: custodian.address,
        houseServiceSa: addresses.service,
        houseTreasurySa: addresses.treasury,
        salts: { service: SERVICE_SALT_LABEL, treasury: TREASURY_SALT_LABEL },
        contracts: {
          asset: CONTRACTS.mockUsdc,
          entryPoint: CONTRACTS.entryPoint,
          agentAccountFactory: CONTRACTS.agentAccountFactory,
          paymaster: CONTRACTS.smartAgentPaymaster,
          delegationManager: CONTRACTS.delegationManager,
          paymentReceiptRegistry: CONTRACTS.paymentReceiptRegistry,
        },
        provisionedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  console.log('\nSummary');
  console.log(`  custodian (EOA)      ${custodian.address}`);
  console.log(`  service agent (SA)   ${addresses.service}`);
  console.log(`  treasury (SA)        ${addresses.treasury}`);
  console.log(`  treasury USDC        ${formatUsdc(await treasury.readUsdcBalance(addresses.treasury))}`);
  console.log(`  written              ${OUT_FILE}`);

  console.log('\nWire apps/tables — wrangler.toml [env.faithnet.vars]');
  console.log(`  HOUSE_SERVICE_SA = "${addresses.service}"`);
  console.log(`  HOUSE_TREASURY_SA = "${addresses.treasury}"`);
  console.log('\nWire the custodian key as a secret (never a var, never in git):');
  console.log('  pnpm --filter pokernight-tables exec wrangler secret put HOUSE_CUSTODIAN_KEY --env faithnet');
  console.log('  # paste the "privateKey" field of .house-key.json at the prompt');
}

main().catch((err) => {
  console.error(`\nprovision-house FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
