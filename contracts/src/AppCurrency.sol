// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AppCurrency
 * @notice A parameterised ERC-20 for an app that wants its own named money on a test chain.
 *
 *         Name, symbol and decimals are constructor arguments, so one contract serves every app
 *         that needs a coin of its own: Poker Night deploys it as "Sheqel"/SHQ at 6 decimals
 *         (see {Sheqel}), and the next card room, shop or arcade deploys the same bytecode under
 *         its own name. The coin belongs to the APP — it is not a platform primitive, which is why
 *         it lives in the app's repo rather than in the substrate's contract set.
 *
 *         Six decimals is not baked in, but it is what Poker Night uses: every amount in this
 *         codebase — chip rates, mandate caps, ledger rows, receipts — is an integer of 6-decimal
 *         base units, and a currency with a different scale would silently re-value all of them.
 *
 * @dev    OPEN MINT. {mint} may be called by ANYONE, for any amount, to any address. That is only
 *         defensible for a TEST asset on a test chain, and this contract is nothing else: on a
 *         chain whose money is real, an unrestricted mint means the supply is whatever the last
 *         caller felt like, so every balance is worthless and every settlement is theatre. It is
 *         here because the card room seeds new players a stake so they can sit down, and because a
 *         faucet gated on the token itself ("can anyone mint this?") is a more honest test than a
 *         configuration flag an operator could set wrongly. Do not deploy this to a chain where the
 *         balances are supposed to mean something.
 *
 *         Written against no dependencies on purpose: the full ERC-20 surface is short enough to
 *         read in one sitting, and a currency contract is exactly the thing that should be readable
 *         end to end rather than assembled out of inherited layers.
 */
contract AppCurrency {
    /* -------------------------------------------------------------- ERC-20 metadata */

    string public name;
    string public symbol;
    uint8 public immutable decimals;

    /* ----------------------------------------------------------------- ERC-20 state */

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /* ---------------------------------------------------------------------- events */

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /* ---------------------------------------------------------------------- errors */

    error TransferToZero();
    error MintToZero();
    /// @param needed What the transfer required. @param held What the account actually has.
    error InsufficientBalance(uint256 needed, uint256 held);
    /// @param needed What the transferFrom required. @param approved What the spender was allowed.
    error InsufficientAllowance(uint256 needed, uint256 approved);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    /* ------------------------------------------------------------------ the open mint */

    /**
     * @notice Create `amount` units and give them to `to`. Anyone may call this.
     * @dev    See the contract-level note: this is defensible for a TEST asset and nothing else.
     *         It is deliberately NOT `onlyOwner` — a faucet with an owner is a faucet the app has to
     *         hold a key for, and the point of a test currency is that seeding a new player costs
     *         nobody a secret. Minting to the zero address is refused because burning-by-typo is
     *         not a feature.
     */
    function mint(address to, uint256 amount) external {
        if (to == address(0)) revert MintToZero();
        totalSupply += amount;
        unchecked {
            // Cannot overflow: the sum of all balances is `totalSupply`, checked just above.
            balanceOf[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }

    /* -------------------------------------------------------------------- ERC-20 core */

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Move `amount` from `from` to `to`, spending the caller's allowance.
     * @dev    `type(uint256).max` is treated as an infinite allowance and is not decremented — the
     *         convention every wallet and router already expects.
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance(amount, allowed);
            unchecked {
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert TransferToZero();
        uint256 held = balanceOf[from];
        if (held < amount) revert InsufficientBalance(amount, held);
        unchecked {
            balanceOf[from] = held - amount;
            // Cannot overflow: `amount` was just subtracted from another balance, and the sum of all
            // balances is `totalSupply`, which is a uint256.
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
