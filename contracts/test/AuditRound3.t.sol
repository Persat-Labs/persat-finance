// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {PersatDealRegistry} from "../PersatDealRegistry.sol";
import {PersatEscrowVault} from "../PersatEscrowVault.sol";
import {MockFiatToken} from "../test-helpers/MockFiatToken.sol";
import {MockPriceFeed} from "../test-helpers/MockPriceFeed.sol";

/// Regression tests for the third review (November 2026).
contract AuditRound3Test is Test {
    PersatDealRegistry registry;
    PersatEscrowVault vault;
    MockFiatToken usdc;
    MockFiatToken cirBtc;
    MockPriceFeed feed;

    address owner = makeAddr("owner");
    address feeRecipient = makeAddr("fee");
    address borrower = makeAddr("borrower");
    address lender = makeAddr("lender");

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockFiatToken("USDC", "USDC", 6);
        cirBtc = new MockFiatToken("cirBTC", "cirBTC", 8);
        feed = new MockPriceFeed(8, 60_000e8, block.timestamp);
        registry = new PersatDealRegistry(address(usdc), address(cirBtc), owner);
        vault = new PersatEscrowVault(
            address(registry), address(usdc), address(cirBtc), address(feed), 93600, 8000, 6500, address(0), feeRecipient, 25, owner
        );
        vm.prank(owner);
        registry.setVault(address(vault));
        usdc.mint(lender, 1_000_000e6);
        cirBtc.mint(borrower, 10e8);
        vm.prank(lender);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(borrower);
        cirBtc.approve(address(vault), type(uint256).max);
    }

    function _confirm(string memory tag) internal returns (bytes16 id) {
        id = bytes16(bytes.concat(registry.dealIdPrefix(borrower), bytes8(keccak256(bytes(tag)))));
        bytes32 salt = keccak256(bytes(tag));
        vm.prank(borrower);
        registry.proposeDeal(id, true, lender, 10_000e6, 1e8, 1000, 6, PersatDealRegistry.Visibility.Private, salt);
        vm.prank(lender);
        registry.claimDeal(id, salt);
    }

    function test_R3_FrozenFeeRecipientDoesNotBlockActivations() public {
        usdc.blacklist(feeRecipient, true);
        bytes16 id = _confirm("r3-fee");

        vm.prank(borrower);
        vault.activateLoan(id);

        assertEq(uint8(registry.getDeal(id).state), uint8(PersatDealRegistry.DealState.Active));
        assertEq(usdc.balanceOf(borrower), 10_000e6 - 25e6, "borrower still receives principal minus fee");
        assertEq(vault.claimable(address(usdc), feeRecipient), 25e6, "fee held for the recipient");

        usdc.blacklist(feeRecipient, false);
        vm.prank(feeRecipient);
        vault.withdraw(address(usdc));
        assertEq(usdc.balanceOf(feeRecipient), 25e6);
    }

    function test_R3_FeeStillPaidDirectlyWhenRecipientIsFine() public {
        bytes16 id = _confirm("r3-fee-ok");
        vm.prank(borrower);
        vault.activateLoan(id);
        assertEq(usdc.balanceOf(feeRecipient), 25e6);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }
}
