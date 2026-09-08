/**
 * @pokernight/treasury — the house money layer.
 *
 * Reads and moves the settlement asset (6-decimal USDC) for Smart Agents the house
 * custodies. Every address, URL, chain id and key is INJECTED: this package names no
 * host, no chain and no contract, exactly like the rest of `packages/*`.
 *
 *   const treasury = createTreasuryClient({ rpcUrl, chainId, deployments, signer });
 *   await treasury.readUsdcBalance(houseTreasurySa);
 *   await treasury.transferUsdc({ from: houseTreasurySa, to: player, amount });
 */

export { createTreasuryClient, type TreasuryClient } from './client.js';

export {
  TreasuryError,
  type Address,
  type Hex,
  type TransactionReceipt,
  type ExecuteCallRequest,
  type TransferUsdcRequest,
  type TransferUsdcResult,
  type TreasuryClientOpts,
  type TreasuryDeployments,
  type TreasuryErrorCode,
  type TreasurySigner,
} from './types.js';

export {
  USDC_DECIMALS,
  USDC_UNIT,
  chipsToUsdc,
  formatMoney,
  formatUsdc,
  parseUsdc,
  usdcRemainder,
  usdcToChips,
} from './units.js';

export {
  ERC20_BALANCE_OF_ABI,
  TEST_ASSET_MINT_ABI,
  buildTestAssetMintData,
  buildUsdcTransferCallData,
  buildUsdcTransferPlan,
  type ContractCall,
  type TransferPlan,
} from './calls.js';

export {
  createTreasuryTransferAdapter,
  orderNonce,
  type PlayerFunding,
  type TreasuryTransferAdapterOpts,
} from './adapter.js';

export {
  DEFAULT_BUY_IN_POLICY,
  asBuyInMandate,
  buildBuyInMandateCaveats,
  buildBuyInRedemption,
  buyInMandateDigest,
  buyInMandateTerms,
  checkBuyInMandate,
  describeBuyInMandate,
  unsignedBuyInMandate,
  type BuyInMandateExpectation,
  type BuyInMandatePolicy,
  type BuyInMandateTerms,
  type BuyInMandateTermsInput,
  type BuyInRedemptionInput,
  type Caveat,
  type Delegation,
  type MandateEnforcers,
  type PaymentMandate,
  type UnsignedBuyInMandateInput,
} from './mandate.js';

export {
  TREASURY_SETTLEMENT_MODE,
  toSettlementReceipt,
  type BuyInRequest,
  type CashOutRequest,
  type SettlementAdapter,
  type SettlementReceipt,
} from './settlement.js';

export type { AgentAccountSpec } from '@agenticprimitives/agent-account';
