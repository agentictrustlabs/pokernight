// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AppCurrency} from "./AppCurrency.sol";

/**
 * @title Sheqel
 * @notice Poker Night's own money: the currency the card room's tables settle in.
 *
 *         "Sheqel" — a weight before it was ever a coin, which is what a chip is. Symbol SHQ,
 *         six decimals so it drops into money plumbing that has counted in 6-decimal base units
 *         since the first buy-in: chip rates, mandate caps, ledger rows and receipts are all
 *         integers of those units, and a coin with a different scale would re-value every one of
 *         them without changing a line of code.
 *
 * @dev    A named deployment of {AppCurrency}, so the parameterised contract is the thing that is
 *         reusable and this is only its Poker Night reading. The mint is OPEN — anyone may call it,
 *         for anything, to anyone — which is defensible ONLY because faithchain is a test chain and
 *         Sheqel is a test asset. It exists so the card room can seed a new player a stake without
 *         holding a minting key, and so the app's test-money faucet can be gated on a question
 *         about the token ("may anyone mint this?") rather than on a flag somebody could set wrong.
 *         Deployed anywhere the balances are meant to be worth something, this is not a currency.
 */
contract Sheqel is AppCurrency {
    constructor() AppCurrency("Sheqel", "SHQ", 6) {}
}
