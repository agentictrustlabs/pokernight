/**
 * PROVISION THE MISSION REGISTRY — the operator agent, and the registry it controls, on faithchain.
 *
 * `docs/MISSION-REGISTRY.md` §2. Two things, both idempotent:
 *
 *   1. The REGISTRY OPERATOR Smart Agent (`missions.registry` by intent; addressed by address until its
 *      typed name is claimed) — deployed from the house custodian under a labelled salt, like the house
 *      service and treasury agents (`provision-house.mts`). It is the CONTROLLER of the registry: the
 *      account that created it, may swap its policy, and may suspend or revoke an entry. Receipts and the
 *      lifecycle log are signed as it, through a session wire (`mint-house-wire.mts --as registry`).
 *
 *   2. `AgentRegistryBase.createRegistry(registryId, policy)` — executed BY that agent (a paymaster-
 *      sponsored UserOp through `AgentAccount.execute`, so `msg.sender` is the agent and it becomes the
 *      controller), with `policy = address(0)`: an OPEN registry. Admission — the covenant, the presence,
 *      the derived type — is the operator's off-chain pipeline and the receipt, so the policy can grow
 *      without a redeploy; on chain, a mission registers itself (RB-01) and nobody else can register it.
 *
 * Writes `missionsRegistrySa` / `missionsRegistryId` / `agentRegistryBase` into `house.faithchain.json`.
 * The custodian key is read from `.house-key.json` and never printed.
 *
 *   npx tsx scripts/provision-missions-registry.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, encodeFunctionData, http, keccak256, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/faithchain';
import { urnToBytes32 } from '@agenticprimitives/registry-kit';
import { createTreasuryClient, type AgentAccountSpec } from '@pokernight/treasury';
import { MISSION_REGISTRY_ID } from '@pokernight/missions';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = process.env.HOUSE_KEY_FILE ?? resolve(REPO, '.house-key.json');
const HOUSE_FILE = resolve(REPO, 'house.faithchain.json');
const RPC_URL = process.env.FAITHCHAIN_RPC ?? 'https://a2a.faithnet.io/rpc';
const REGISTRY_SALT_LABEL = 'pokernight.missions.registry.v1';

/** The provisioning half of AgentRegistryBase — not in the kit's lifecycle ABI, by design. */
const REGISTRY_ADMIN_ABI = [
  { type: 'function', name: 'createRegistry', stateMutability: 'nonpayable', inputs: [{ name: 'registryId', type: 'bytes32' }, { name: 'policy', type: 'address' }], outputs: [] },
  { type: 'function', name: 'getRegistry', stateMutability: 'view', inputs: [{ name: 'registryId', type: 'bytes32' }], outputs: [{ type: 'tuple', components: [{ name: 'controller', type: 'address' }, { name: 'policy', type: 'address' }, { name: 'exists', type: 'bool' }] }] },
] as const;

async function main(): Promise<void> {
  const house = JSON.parse(readFileSync(HOUSE_FILE, 'utf8')) as Record<string, unknown> & { houseCustodian: Address; contracts: Record<string, string> };
  const custodian = privateKeyToAccount((JSON.parse(readFileSync(KEY_FILE, 'utf8')) as { privateKey: Hex }).privateKey);
  if (custodian.address.toLowerCase() !== house.houseCustodian.toLowerCase()) {
    throw new Error(`${KEY_FILE} is ${custodian.address}, but house.faithchain.json says the custodian is ${house.houseCustodian}`);
  }
  const registryBase = CONTRACTS.agentRegistryBase as Address;
  if (!registryBase) throw new Error('the faithchain deployment names no agentRegistryBase');

  console.log('Game Night mission registry — faithchain');
  console.log(`  rpc          ${RPC_URL}`);
  console.log(`  custodian    ${custodian.address}`);
  console.log(`  registry     ${MISSION_REGISTRY_ID}`);
  console.log(`  contract     ${registryBase}`);

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  if ((await publicClient.getChainId()) !== CONTRACTS.chainId) throw new Error('RPC is not faithchain');

  const treasury = createTreasuryClient({
    rpcUrl: RPC_URL,
    chainId: CONTRACTS.chainId,
    deployments: { asset: house.contracts.sheqel as Address, entryPoint: CONTRACTS.entryPoint, agentAccountFactory: CONTRACTS.agentAccountFactory, paymaster: CONTRACTS.smartAgentPaymaster },
    signer: custodian,
  });

  // 1. The operator agent.
  const spec: AgentAccountSpec = { mode: 0, custodians: [custodian.address], salt: BigInt(keccak256(toHex(REGISTRY_SALT_LABEL))) };
  const registrySa = await treasury.deriveAgentAccount(spec);
  if (await treasury.isDeployed(registrySa)) console.log(`  operator     ${registrySa}  already deployed`);
  else {
    console.log(`  operator     ${registrySa}  deploying…`);
    await treasury.deployAgentAccount(spec, custodian);
    // The relay fans reads out to replicas that lag a write by a few seconds (provision-house.mts saw the
    // same on a balance), so the deploy is polled for rather than read once.
    let landed = false;
    for (let i = 0; i < 30 && !landed; i++) { landed = await treasury.isDeployed(registrySa); if (!landed) await new Promise((r) => setTimeout(r, 1_000)); }
    if (!landed) throw new Error('the operator deploy did not land');
    console.log(`  operator     ${registrySa}  deployed`);
  }
  if (!(await treasury.isCustodian(registrySa, custodian.address))) throw new Error('the custodian is not a custodian of the operator agent');

  // 2. The registry, created by the operator so the operator is its controller.
  const registryKey = urnToBytes32(MISSION_REGISTRY_ID);
  // `getRegistry` REVERTS (`RegistryNotFound`) for a registry that does not exist — that is its "no".
  const read = () => publicClient.readContract({ address: registryBase, abi: REGISTRY_ADMIN_ABI, functionName: 'getRegistry', args: [registryKey] })
    .catch(() => ({ controller: '0x0000000000000000000000000000000000000000' as Address, policy: '0x0000000000000000000000000000000000000000' as Address, exists: false }));
  let reg = await read();
  if (reg.exists) {
    console.log(`  on chain     exists — controller ${reg.controller}, policy ${reg.policy}`);
    if (reg.controller.toLowerCase() !== registrySa.toLowerCase()) throw new Error(`the registry exists but its controller is ${reg.controller}, not the operator ${registrySa}`);
  } else {
    console.log('  on chain     creating…');
    const data = encodeFunctionData({ abi: REGISTRY_ADMIN_ABI, functionName: 'createRegistry', args: [registryKey, '0x0000000000000000000000000000000000000000'] });
    const { txHash } = await treasury.executeCall({ from: registrySa, to: registryBase, data });
    console.log(`  tx           ${txHash}`);
    for (let i = 0; i < 30 && !reg.exists; i++) { await new Promise((r) => setTimeout(r, 1_000)); reg = await read(); }
    if (!reg.exists) throw new Error('createRegistry landed but the registry does not read as existing');
    console.log(`  on chain     created — controller ${reg.controller}`);
  }

  writeFileSync(HOUSE_FILE, `${JSON.stringify({
    ...house,
    missionsRegistrySa: registrySa,
    missionsRegistryId: MISSION_REGISTRY_ID,
    salts: { ...(house.salts as Record<string, string>), missionsRegistry: REGISTRY_SALT_LABEL },
    contracts: { ...house.contracts, agentRegistryBase: registryBase },
    missionsRegistryProvisionedAt: new Date().toISOString(),
    _missionsRegistry: 'The registry operator (controller of urn:ap:registry:gamenight-missions on AgentRegistryBase), custodied by the house custodian. docs/MISSION-REGISTRY.md.',
  }, null, 2)}\n`);
  console.log(`\nwrote ${HOUSE_FILE}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
