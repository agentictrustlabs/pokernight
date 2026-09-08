/**
 * Settlement adapter factory, keyed by the table's settlement mode.
 *
 * phase 1: play-money only (chips never leave the DO).
 * phase 3: 'mandate-transfer' — an adapter in this app that redeems the player's poker-buyin
 *          delegation through the chain RPC gateway (RPC_URL + RPC_TOKEN) and pays cash-outs
 *          from HOUSE_SA. Register it in `createSettlementAdapter` below.
 * phase 4: 'table-escrow'.
 */

import { PlayMoneyAdapter, type SettlementAdapter } from '@pokernight/ledger';
import type { SettlementMode } from '@pokernight/protocol';
import type { Env } from './env.js';

export function createSettlementAdapter(mode: SettlementMode, env: Env): SettlementAdapter {
  switch (mode) {
    case 'play-money':
      return new PlayMoneyAdapter();
    case 'mandate-transfer':
      // TODO(phase 3): return new MandateTransferAdapter(env)
      throw new Error(`settlement mode not available yet: ${mode} (CHAIN_ID=${env.CHAIN_ID})`);
    case 'table-escrow':
      // TODO(phase 4): return new TableEscrowAdapter(env)
      throw new Error(`settlement mode not available yet: ${mode}`);
  }
}
