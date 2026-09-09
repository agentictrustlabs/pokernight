#!/usr/bin/env -S npx tsx
/**
 * Deploy Sheqel — the card room's own money — to faithchain, and seed the house treasury.
 *
 *   pnpm deploy:sheqel [--seed <sheqel>] [--only-seed]
 *
 * Idempotent in the way that matters: it will not deploy a second Sheqel if
 * `house.faithchain.json` already names one (pass `--redeploy` to mean it), and a seed run tops the
 * house treasury UP TO the target rather than adding to it.
 *
 * The custodian key comes from `.house-key.json` (gitignored, mode 0600). It is read, used to sign,
 * and never printed — the same rule `scripts/provision-house.mts` follows.
 *
 * faithchain is a Besu chain with zero gas price, so the custodian needs no funding to deploy; the
 * gas price is stated explicitly (`gasPrice: 0n`) rather than estimated, because the relay
 * intermittently answers `eth_gasPrice` / `eth_estimateGas` with an empty 200 body.
 *
 * The bytecode is read from `contracts/out/Sheqel.sol/Sheqel.json`, so `forge build` must have run
 * (this script runs it).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = process.env.HOUSE_KEY_FILE ?? resolve(REPO, '.house-key.json');
const OUT_FILE = resolve(REPO, 'house.faithchain.json');
const ARTIFACT = resolve(REPO, 'contracts/out/Sheqel.sol/Sheqel.json');
const RPC_URL = process.env.FAITHCHAIN_RPC ?? 'https://a2a.faithnet.io/rpc';
const CHAIN_ID = 34348;

/** 6 decimals, like every other amount in this app. */
const UNIT = 1_000_000n;

const args = process.argv.slice(2);
function flag(name: string): string | boolean {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  if (i === -1) return false;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

/** How much Sheqel the house treasury should hold. Large: it pays out every winner at every table. */
const SEED_TARGET = (() => {
  const v = flag('seed');
  return BigInt(typeof v === 'string' ? v : '100000000') * UNIT;
})();

const ERC20 = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [] },
] as const;

function fmt(v: bigint): string {
  const whole = (v / UNIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${whole}.${(v % UNIT).toString().padStart(6, '0')}`;
}

/** The custodian key. Read here, used here, never logged. */
function custodianKey(): Hex {
  if (!existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} does not exist — run \`pnpm provision:house\` first`);
  const raw = JSON.parse(readFileSync(KEY_FILE, 'utf8')) as { privateKey?: string };
  if (!raw.privateKey) throw new Error(`${KEY_FILE} exists but has no "privateKey"`);
  return raw.privateKey as Hex;
}

interface HouseFile {
  contracts: Record<string, string>;
  [k: string]: unknown;
}

async function main(): Promise<void> {
  const account = privateKeyToAccount(custodianKey());
  const house = JSON.parse(readFileSync(OUT_FILE, 'utf8')) as HouseFile;
  const treasury = house.houseTreasurySa as Address;

  console.log('Sheqel — Poker Night’s own money, on faithchain');
  console.log(`  rpc         ${RPC_URL}`);
  console.log(`  deployer    ${account.address} (the house custodian)`);
  console.log(`  treasury    ${treasury}`);

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const onChainId = await publicClient.getChainId();
  if (onChainId !== CHAIN_ID) throw new Error(`RPC is chain ${onChainId}, expected ${CHAIN_ID}`);
  // Zero-gas chain: stated, never estimated. `chain: null` keeps viem from asking for a chain object.
  const wallet = createWalletClient({ account, transport: http(RPC_URL) });

  let sheqel = house.contracts.sheqel as Address | undefined;
  if (sheqel && !flag('redeploy')) {
    console.log(`  sheqel      ${sheqel} (already deployed; --redeploy to make another)`);
  } else if (!flag('only-seed')) {
    execFileSync('forge', ['build', '--root', resolve(REPO, 'contracts')], { stdio: 'inherit' });
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { bytecode: { object: Hex } };
    const hash = await wallet.deployContract({
      abi: ERC20,
      bytecode: artifact.bytecode.object,
      account,
      chain: null,
      gas: 1_500_000n,
      gasPrice: 0n,
    });
    console.log(`  deploy tx   ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 2_000 });
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`deploy reverted in ${hash}`);
    sheqel = receipt.contractAddress;
    console.log(`  sheqel      ${sheqel}`);
    house.contracts.sheqel = sheqel;
    house.sheqelDeployTx = hash;
    house.sheqelDeployedAt = new Date().toISOString();
    writeFileSync(OUT_FILE, `${JSON.stringify(house, null, 2)}\n`);
  }
  if (!sheqel) throw new Error('no Sheqel address to seed');

  const read = <T,>(functionName: 'name' | 'symbol' | 'decimals' | 'totalSupply') =>
    publicClient.readContract({ address: sheqel as Address, abi: ERC20, functionName }) as Promise<T>;
  console.log(`  name        ${await read<string>('name')} (${await read<string>('symbol')}), ${await read<number>('decimals')} decimals`);

  const balance = (await publicClient.readContract({
    address: sheqel,
    abi: ERC20,
    functionName: 'balanceOf',
    args: [treasury],
  })) as bigint;
  console.log(`  house holds ${fmt(balance)} SHQ`);

  if (balance >= SEED_TARGET) {
    console.log(`  seed        already at or above the ${fmt(SEED_TARGET)} SHQ target — nothing minted`);
  } else {
    const shortfall = SEED_TARGET - balance;
    const hash = await wallet.writeContract({
      address: sheqel,
      abi: ERC20,
      functionName: 'mint',
      args: [treasury, shortfall],
      account,
      chain: null,
      gas: 120_000n,
      gasPrice: 0n,
    });
    console.log(`  seed tx     ${hash} (+${fmt(shortfall)} SHQ)`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 2_000 });
    if (receipt.status !== 'success') throw new Error(`the seed mint reverted in ${hash}`);
    house.sheqelSeedTx = hash;
    writeFileSync(OUT_FILE, `${JSON.stringify(house, null, 2)}\n`);
    // The relay fans out to read replicas; poll until the new balance shows up.
    let after = 0n;
    for (let i = 0; i < 20; i++) {
      after = (await publicClient.readContract({ address: sheqel, abi: ERC20, functionName: 'balanceOf', args: [treasury] })) as bigint;
      if (after >= SEED_TARGET) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    console.log(`  house holds ${fmt(after)} SHQ`);
  }

  console.log('');
  console.log('  wrangler.toml [env.faithnet.vars]:');
  console.log(`    ASSET = "${sheqel}"`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
