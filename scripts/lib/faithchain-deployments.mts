/**
 * The faithchain deployment record the operator scripts use.
 *
 * Default: the record shipped in the pinned `@agenticprimitives/contracts`. `FAITHCHAIN_DEPLOYMENTS=<path to a
 * deployments-faithchain.json>` names a record explicitly — the case when the estate has moved to a contracts
 * generation the pinned package does not carry yet (spec 445: faithnet re-chartered on generation 4 before the
 * package that records it was published). One record per run, never a merge of two: a script that mixed two
 * generations' addresses would build mandates no enforcer of either recognises.
 */
import { readFileSync } from 'node:fs';
import { CONTRACTS as PINNED } from '@agenticprimitives/contracts/deployments/faithchain';

const override = process.env.FAITHCHAIN_DEPLOYMENTS;
export const CONTRACTS: typeof PINNED = override ? (JSON.parse(readFileSync(override, 'utf8')) as typeof PINNED) : PINNED;
if (override && CONTRACTS.chainId !== 34348) throw new Error(`${override} is chain ${CONTRACTS.chainId}, not faithchain (34348)`);
