// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {PersatDealRegistry} from "../PersatDealRegistry.sol";
import {PersatEscrowVault} from "../PersatEscrowVault.sol";
import {MockFiatToken} from "../test-helpers/MockFiatToken.sol";
import {MockPriceFeed} from "../test-helpers/MockPriceFeed.sol";

/// Drives random activations, repayments, liquidations, Circle freezes and pauses, price moves,
/// time jumps and withdrawals, then checks that the vault's books always balance.
contract AccountingHandler is Test {
    PersatDealRegistry public registry;
    PersatEscrowVault public vault;
    MockFiatToken public usdc;
    MockFiatToken public cirBtc;
    MockPriceFeed public feed;

    address[] public actors;
    bytes16[] public dealIds;
    mapping(address => bool) internal isActor;
    uint256 internal nonce;
    uint256 public opened;
    uint256 public repaid;
    uint256 public liquidated;
    uint256 public withdrawn;

    constructor(PersatDealRegistry r, PersatEscrowVault v, MockFiatToken u, MockFiatToken c, MockPriceFeed f) {
        registry = r;
        vault = v;
        usdc = u;
        cirBtc = c;
        feed = f;
        for (uint256 i = 1; i <= 6; i++) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            isActor[a] = true;
            usdc.mint(a, 10_000_000e6);
            cirBtc.mint(a, 1_000e8);
            vm.startPrank(a);
            usdc.approve(address(vault), type(uint256).max);
            cirBtc.approve(address(vault), type(uint256).max);
            vm.stopPrank();
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function dealCount() external view returns (uint256) {
        return dealIds.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function openLoan(uint256 bSeed, uint256 lSeed, uint256 principal, uint256 ltvPct, uint256 rate, uint8 months) external {
        address b = _actor(bSeed);
        address l = _actor(lSeed);
        if (b == l) return;
        if (usdc.paused()) usdc.setPaused(false);
        if (cirBtc.paused()) cirBtc.setPaused(false);
        if (usdc.isBlacklisted(b) || usdc.isBlacklisted(l) || cirBtc.isBlacklisted(b)) return;
        principal = bound(principal, 100e6, 200_000e6);
        rate = bound(rate, 1, 3_000);
        months = uint8(bound(months, 1, 12));
        feed.setFresh();
        (, int256 price,,,) = feed.latestRoundData();
        uint256 owed = principal + principal * rate * months / 120_000;
        uint256 collateral = owed * 1e8 * 100 / (uint256(price) * bound(ltvPct, 30, 60) / 100) + 1;
        if (collateral > cirBtc.balanceOf(b)) return;

        nonce++;
        bytes16 id = bytes16(bytes.concat(registry.dealIdPrefix(b), bytes8(keccak256(abi.encode(nonce)))));
        bytes32 salt = keccak256(abi.encode("s", nonce));
        vm.prank(b);
        registry.proposeDeal(id, true, l, principal, collateral, rate, months, PersatDealRegistry.Visibility.Private, salt);
        vm.prank(l);
        registry.claimDeal(id, salt);
        vm.prank(b);
        try vault.activateLoan(id) {
            dealIds.push(id);
            opened++;
        } catch {}
    }

    function repay(uint256 dSeed) external {
        if (dealIds.length == 0) return;
        bytes16 id = dealIds[dSeed % dealIds.length];
        PersatDealRegistry.Deal memory d = registry.getDeal(id);
        vm.prank(d.borrower);
        try vault.repayLoan(id) {
            repaid++;
        } catch {}
    }

    function liquidate(uint256 dSeed, uint256 who) external {
        if (dealIds.length == 0) return;
        bytes16 id = dealIds[dSeed % dealIds.length];
        address caller = who % 3 == 0 ? registry.getDeal(id).lender : _actor(who);
        if (who % 4 != 0) feed.setFresh();
        if (who % 5 == 0) {
            usdc.setPaused(false);
            cirBtc.setPaused(false);
        }
        vm.prank(caller);
        try vault.liquidate(id) {
            liquidated++;
        } catch {}
    }

    function markDefault(uint256 dSeed) external {
        if (dealIds.length == 0) return;
        try vault.markDefault(dealIds[dSeed % dealIds.length]) {} catch {}
    }

    function movePrice(uint256 price) external {
        feed.setAnswer(int256(bound(price, 15_000e8, 120_000e8)));
        feed.setFresh();
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 hours, 90 days));
        if (secs % 4 != 0) feed.setFresh();
    }

    function freeze(uint256 aSeed, bool onUsdc, bool frozen) external {
        (onUsdc ? usdc : cirBtc).blacklist(_actor(aSeed), frozen);
    }

    function pauseToken(bool onUsdc, bool paused) external {
        (onUsdc ? usdc : cirBtc).setPaused(paused);
        if (paused) try vault.notePause() {} catch {}
    }

    function withdraw(uint256 aSeed, bool onUsdc) external {
        vm.prank(_actor(aSeed));
        try vault.withdraw(onUsdc ? address(usdc) : address(cirBtc)) {
            withdrawn++;
        } catch {}
    }
}

contract InvariantAccountingTest is Test {
    PersatDealRegistry registry;
    PersatEscrowVault vault;
    MockFiatToken usdc;
    MockFiatToken cirBtc;
    MockPriceFeed feed;
    AccountingHandler handler;
    address feeRecipient = address(0xFEE);

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockFiatToken("USDC", "USDC", 6);
        cirBtc = new MockFiatToken("cirBTC", "cirBTC", 8);
        feed = new MockPriceFeed(8, 60_000e8, block.timestamp);
        registry = new PersatDealRegistry(address(usdc), address(cirBtc), address(this));
        vault = new PersatEscrowVault(
            address(registry), address(usdc), address(cirBtc), address(feed), 93600, 8000, 6500, address(0), feeRecipient, 25, address(this)
        );
        registry.setVault(address(vault));
        handler = new AccountingHandler(registry, vault, usdc, cirBtc, feed);
        targetContract(address(handler));
    }

    function afterInvariant() public {
        emit log_named_uint("loans opened", handler.opened());
        emit log_named_uint("loans repaid", handler.repaid());
        emit log_named_uint("loans liquidated", handler.liquidated());
        emit log_named_uint("credits withdrawn", handler.withdrawn());
        emit log_named_uint("USDC credited now", vault.totalClaimable(address(usdc)));
        emit log_named_uint("cirBTC credited now", vault.totalClaimable(address(cirBtc)));
    }

    function _sumLocked() internal view returns (uint256 total) {
        uint256 n = handler.dealCount();
        for (uint256 i = 0; i < n; i++) {
            total += vault.lockedCollateral(handler.dealIds(i));
        }
    }

    function _sumClaimable(address token) internal view returns (uint256 total) {
        uint256 n = handler.actorCount();
        for (uint256 i = 0; i < n; i++) {
            total += vault.claimable(token, handler.actors(i));
        }
        total += vault.claimable(token, feeRecipient);
    }

    /// forge-config: default.invariant.runs = 200
    /// forge-config: default.invariant.depth = 100
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_cirBtcBooksBalance() public view {
        assertEq(cirBtc.balanceOf(address(vault)), _sumLocked() + vault.totalClaimable(address(cirBtc)), "cirBTC: balance != locked + credited");
    }

    /// forge-config: default.invariant.runs = 200
    /// forge-config: default.invariant.depth = 100
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_usdcOnlyCreditsHeld() public view {
        assertEq(usdc.balanceOf(address(vault)), vault.totalClaimable(address(usdc)), "USDC: vault holds more or less than credited");
    }

    /// forge-config: default.invariant.runs = 200
    /// forge-config: default.invariant.depth = 100
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_creditsSumToTotal() public view {
        assertEq(_sumClaimable(address(usdc)), vault.totalClaimable(address(usdc)), "USDC credits");
        assertEq(_sumClaimable(address(cirBtc)), vault.totalClaimable(address(cirBtc)), "cirBTC credits");
    }

    /// forge-config: default.invariant.runs = 200
    /// forge-config: default.invariant.depth = 100
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_closedLoansHoldNothing() public view {
        uint256 n = handler.dealCount();
        for (uint256 i = 0; i < n; i++) {
            bytes16 id = handler.dealIds(i);
            PersatDealRegistry.DealState s = registry.getDeal(id).state;
            if (s == PersatDealRegistry.DealState.Completed || s == PersatDealRegistry.DealState.Liquidated) {
                assertEq(vault.lockedCollateral(id), 0, "closed loan still holds collateral");
            }
        }
    }
}
