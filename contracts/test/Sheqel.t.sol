// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AppCurrency} from "../src/AppCurrency.sol";
import {Sheqel} from "../src/Sheqel.sol";

/**
 * Sheqel / AppCurrency tests.
 *
 * Dependency-free, like the contract: no forge-std, no cheatcodes, no submodule. A `Caller` proxy
 * stands in for "somebody else" wherever a test needs a second address, which is all the isolation
 * an ERC-20 of this size needs. `forge test --root contracts` runs them.
 */

/** A second address that can be told to act. Standing in for `vm.prank`. */
contract Caller {
    function mint(AppCurrency t, address to, uint256 amount) external {
        t.mint(to, amount);
    }

    function transfer(AppCurrency t, address to, uint256 amount) external returns (bool) {
        return t.transfer(to, amount);
    }

    function approve(AppCurrency t, address spender, uint256 amount) external returns (bool) {
        return t.approve(spender, amount);
    }

    function transferFrom(AppCurrency t, address from, address to, uint256 amount) external returns (bool) {
        return t.transferFrom(from, to, amount);
    }
}

contract SheqelTest {
    Sheqel internal shq;
    Caller internal stranger;

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    function setUp() public {
        shq = new Sheqel();
        stranger = new Caller();
    }

    function test_metadata_is_the_card_rooms_own_money() public view {
        require(keccak256(bytes(shq.name())) == keccak256("Sheqel"), "name");
        require(keccak256(bytes(shq.symbol())) == keccak256("SHQ"), "symbol");
        // Six, because every amount in the app is an integer of 6-decimal base units.
        require(shq.decimals() == 6, "decimals");
        require(shq.totalSupply() == 0, "supply starts empty");
    }

    /** The whole reason this asset exists: anyone can seed anyone, no key, no owner, no gate. */
    function test_mint_is_open_to_anyone() public {
        stranger.mint(shq, ALICE, 200_000_000);
        require(shq.balanceOf(ALICE) == 200_000_000, "stranger could not mint");
        require(shq.totalSupply() == 200_000_000, "supply");
        shq.mint(BOB, 1_000_000);
        require(shq.totalSupply() == 201_000_000, "supply after second mint");
    }

    function test_mint_refuses_the_zero_address() public {
        try shq.mint(address(0), 1) {
            revert("minting to the zero address should revert");
        } catch {}
    }

    function test_transfer_moves_and_refuses_an_overdraw() public {
        shq.mint(address(this), 10_000_000);
        require(shq.transfer(ALICE, 4_000_000), "transfer returns true");
        require(shq.balanceOf(ALICE) == 4_000_000, "payee credited");
        require(shq.balanceOf(address(this)) == 6_000_000, "payer debited");
        try shq.transfer(ALICE, 6_000_001) {
            revert("overdrawing should revert");
        } catch {}
        try shq.transfer(address(0), 1) {
            revert("transferring to the zero address should revert");
        } catch {}
    }

    function test_transferFrom_spends_an_allowance_once() public {
        shq.mint(address(stranger), 5_000_000);
        stranger.approve(shq, address(this), 3_000_000);
        require(shq.allowance(address(stranger), address(this)) == 3_000_000, "approved");
        require(shq.transferFrom(address(stranger), BOB, 2_000_000), "transferFrom");
        require(shq.balanceOf(BOB) == 2_000_000, "payee credited");
        require(shq.allowance(address(stranger), address(this)) == 1_000_000, "allowance decremented");
        try shq.transferFrom(address(stranger), BOB, 1_000_001) {
            revert("spending more than the allowance should revert");
        } catch {}
    }

    function test_infinite_allowance_is_not_decremented() public {
        shq.mint(address(stranger), 5_000_000);
        stranger.approve(shq, address(this), type(uint256).max);
        shq.transferFrom(address(stranger), BOB, 1_000_000);
        require(shq.allowance(address(stranger), address(this)) == type(uint256).max, "infinite stays infinite");
    }

    /** The parameterised half: another app deploys the same bytecode under its own name and scale. */
    function test_AppCurrency_is_reusable_under_another_name() public {
        AppCurrency arcade = new AppCurrency("Arcade Token", "ARC", 18);
        require(keccak256(bytes(arcade.name())) == keccak256("Arcade Token"), "name");
        require(keccak256(bytes(arcade.symbol())) == keccak256("ARC"), "symbol");
        require(arcade.decimals() == 18, "decimals");
        require(shq.decimals() == 6, "the two coins do not share a scale");
    }

    function testFuzz_mint_then_transfer_conserves_supply(uint128 minted, uint128 sent) public {
        shq.mint(address(this), minted);
        if (sent > minted) return;
        shq.transfer(ALICE, sent);
        require(shq.balanceOf(address(this)) + shq.balanceOf(ALICE) == shq.totalSupply(), "supply conserved");
    }
}
