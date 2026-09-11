/**
 * VERIFY THE HOUSE WIRE THE WAY A HOME WILL — shape, the house agent's ERC-1271 over it, revocation.
 *
 *   npx tsx scripts/verify-house-wire.mts <wire.json>
 *
 * Three reads, all on chain, none of them this repo's opinion: `checkSessionWireShape` is the estate's
 * own check, `isValidSig` is the UniversalSignatureValidator asking the house service agent whether it
 * accepts its custodian's signature, and `isRevoked` is the DelegationManager. A wire that passes here
 * is admitted by every Home agent's standard surface; one that fails here fails there, by the same leg.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { hashDelegation } from '@agenticprimitives/delegation';
import { wireToDelegation, checkSessionWireShape } from '@agenticprimitives/a2a';
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/faithchain';
const wire = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const house = JSON.parse(readFileSync('/home/barb/pokernight/house.faithchain.json', 'utf8'));
const d = wireToDelegation(wire);
const c = CONTRACTS as unknown as Record<string, string>;
const digest = hashDelegation(d, house.chainId, house.contracts.delegationManager);
const client = createPublicClient({ transport: http(house.rpcUrl) });
const abi = [{ type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes' }], outputs: [{ type: 'bool' }] }] as const;
const ok = await client.readContract({ address: c.universalSignatureValidator as Address, abi, functionName: 'isValidSig', args: [d.delegator as Address, digest as Hex, d.signature as Hex] });
const revokedAbi = [{ type: 'function', name: 'isRevoked', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] }] as const;
const revoked = await client.readContract({ address: house.contracts.delegationManager as Address, abi: revokedAbi, functionName: 'isRevoked', args: [digest as Hex] }).catch((e) => `read failed: ${(e as Error).message.slice(0, 80)}`);
console.log('shape   :', checkSessionWireShape(wire, { timestamp: c.timestampEnforcer!, allowedMethods: c.allowedMethodsEnforcer! }, Math.floor(Date.now() / 1000), { skill: 'harness.ask' }) ?? 'ok');
console.log('isValidSig (house SA accepts the custodian’s signature):', ok);
console.log('isRevoked:', revoked);
