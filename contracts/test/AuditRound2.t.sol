// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {PersatDealRegistry} from "../PersatDealRegistry.sol";
import {PersatEscrowVault} from "../PersatEscrowVault.sol";
import {CirBtcPoolTwap} from "../CirBtcPoolTwap.sol";
import {MockFiatToken} from "../test-helpers/MockFiatToken.sol";
import {MockPriceFeed} from "../test-helpers/MockPriceFeed.sol";
import {MockUniswapV3Pool} from "../test-helpers/MockUniswapV3Pool.sol";

/// Regression tests for audit round 2 (N-03 … N-13) and the bridge analysis (B-1 … B-4).
/// Tokens mimic Circle's FiatToken controls (blacklist, pause).
contract AuditRound2Test is Test {
    PersatDealRegistry registry;
    PersatEscrowVault vault;
    MockFiatToken usdc;
    MockFiatToken cirBtc;
    MockPriceFeed feed;

    address owner = makeAddr("owner");
    address feeRecipient = makeAddr("fee");
    address borrower = makeAddr("borrower");
    address lender = makeAddr("lender");
    address keeper = makeAddr("keeper");
    address griefer = makeAddr("griefer");

    uint256 constant PRINCIPAL = 10_000e6;
    uint256 constant COLLATERAL = 1e8;
    uint256 constant RATE_BPS = 1200;
    uint8 constant DURATION = 6;
    uint256 constant FULL_INTEREST = 600e6;
    uint256 constant FEE_BPS = 25;
    int256 constant PRICE = 60_000e8;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockFiatToken("USDC", "USDC", 6);
        cirBtc = new MockFiatToken("cirBTC", "cirBTC", 8);
        feed = new MockPriceFeed(8, PRICE, block.timestamp);
        registry = new PersatDealRegistry(address(usdc), address(cirBtc), owner);
        vault = _deployVault(address(0));
        vm.prank(owner);
        registry.setVault(address(vault));

        usdc.mint(lender, 1_000_000e6);
        usdc.mint(borrower, 100_000e6);
        usdc.mint(keeper, 1_000_000e6);
        cirBtc.mint(borrower, 10e8);
        vm.prank(lender);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(keeper);
        usdc.approve(address(vault), type(uint256).max);
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        cirBtc.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _deployVault(address pegGuard) internal returns (PersatEscrowVault) {
        return new PersatEscrowVault(
            address(registry), address(usdc), address(cirBtc), address(feed), 93600, 8000, 6500, pegGuard, feeRecipient, FEE_BPS, owner
        );
    }

    function _id(address proposer, string memory tag) internal view returns (bytes16) {
        return bytes16(bytes.concat(registry.dealIdPrefix(proposer), bytes8(keccak256(bytes(tag)))));
    }

    function _confirm(string memory tag) internal returns (bytes16 id) {
        id = _id(borrower, tag);
        bytes32 salt = keccak256(bytes(tag));
        vm.prank(borrower);
        registry.proposeDeal(id, true, lender, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, salt);
        vm.prank(lender);
        registry.claimDeal(id, salt);
    }

    function _activate(string memory tag) internal returns (bytes16 id) {
        id = _confirm(tag);
        vm.prank(borrower);
        vault.activateLoan(id);
    }

    function _proposePublic(string memory tag) internal returns (bytes16 id) {
        id = _id(borrower, tag);
        vm.prank(borrower);
        registry.proposeDeal(id, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Public, bytes32(0));
    }

    // ── N-01: deals are discoverable without scanning event logs ──

    function test_N01_UserAndPublicDealIndex() public {
        bytes16 reserved = _confirm("n01a");
        bytes16 pub = _proposePublic("n01b");
        vm.prank(lender);
        registry.submitCounterOffer(pub, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
        vm.prank(borrower);
        registry.acceptCounterOffer(pub, 0);

        bytes16 lenderMade = _id(lender, "n01c");
        vm.prank(lender);
        registry.proposeDeal(lenderMade, false, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Public, bytes32(0));

        assertEq(registry.userDealCount(borrower), 2);
        assertEq(registry.userDealCount(lender), 3);
        bytes16[] memory lenderDeals = registry.getUserDeals(lender, 0, 10);
        assertEq(lenderDeals[0], reserved);
        assertEq(lenderDeals[1], pub);
        assertEq(lenderDeals[2], lenderMade);

        assertEq(registry.publicDealCount(), 2);
        bytes16[] memory page = registry.getPublicDeals(1, 10);
        assertEq(page.length, 1);
        assertEq(page[0], lenderMade);
        assertEq(registry.getPublicDeals(5, 10).length, 0);
    }

    // ── N-06 / B-1: a frozen party no longer blocks the others ──

    function test_B1_FrozenLenderDoesNotBlockRepayment() public {
        bytes16 id = _activate("b1a");
        usdc.blacklist(lender, true);

        uint256 borrowerBtcBefore = cirBtc.balanceOf(borrower);
        uint256 due = vault.amountDue(id);
        vm.prank(borrower);
        vault.repayLoan(id);

        assertEq(cirBtc.balanceOf(borrower) - borrowerBtcBefore, COLLATERAL, "borrower gets collateral back");
        assertEq(vault.claimable(address(usdc), lender), due, "lender repayment held for withdrawal");
        assertEq(uint8(registry.getDeal(id).state), uint8(PersatDealRegistry.DealState.Completed));

        vm.prank(lender);
        vm.expectRevert("Blacklistable: account is blacklisted");
        vault.withdraw(address(usdc));

        usdc.blacklist(lender, false);
        uint256 lenderBefore = usdc.balanceOf(lender);
        vm.prank(lender);
        vault.withdraw(address(usdc));
        assertEq(usdc.balanceOf(lender) - lenderBefore, due);
        assertEq(vault.totalClaimable(address(usdc)), 0);
    }

    function test_B1_FrozenBorrowerDoesNotBlockLiquidation() public {
        bytes16 id = _activate("b1b");
        cirBtc.blacklist(borrower, true);
        vm.warp(vault.liquidationOpensAt(id) + 1);
        feed.setFresh();

        uint256 lenderBefore = usdc.balanceOf(lender);
        uint256 due = vault.amountDue(id);
        vm.prank(keeper);
        vault.liquidate(id);

        assertEq(usdc.balanceOf(lender) - lenderBefore, due, "lender paid in full");
        assertGt(vault.claimable(address(cirBtc), borrower), 0, "borrower surplus held, not lost");
        assertEq(
            cirBtc.balanceOf(keeper) + vault.claimable(address(cirBtc), borrower), COLLATERAL, "all collateral accounted"
        );
    }

    function test_B1_FrozenLenderStillGetsPaidOnLiquidation() public {
        bytes16 id = _activate("b1c");
        usdc.blacklist(lender, true);
        cirBtc.blacklist(lender, true);
        feed.setAnswer(12_000e8);
        feed.setFresh();

        uint256 due = vault.amountDue(id);
        vm.prank(keeper);
        vault.liquidate(id);

        assertEq(vault.claimable(address(usdc), lender), due);
        assertEq(uint8(registry.getDeal(id).state), uint8(PersatDealRegistry.DealState.Liquidated));
    }

    function test_B1_OwnerCannotRescueCreditedUsdc() public {
        bytes16 id = _activate("b1d");
        usdc.blacklist(lender, true);
        vm.prank(borrower);
        vault.repayLoan(id);

        uint256 credited = vault.claimable(address(usdc), lender);
        vm.prank(owner);
        vm.expectRevert(PersatEscrowVault.RescueExceedsFreeBalance.selector);
        vault.rescueERC20(address(usdc), owner, credited);
    }

    function test_B1_WithdrawRevertsWhenNothingOwed() public {
        vm.expectRevert(PersatEscrowVault.NothingToWithdraw.selector);
        vault.withdraw(address(usdc));
    }

    // ── B-2: a token pause cannot cause an unfair liquidation ──

    function test_B2_CirBtcPauseDoesNotBlockRepayment() public {
        bytes16 id = _activate("b2a");
        cirBtc.setPaused(true);

        vm.prank(borrower);
        vault.repayLoan(id);

        assertEq(vault.claimable(address(cirBtc), borrower), COLLATERAL);
        assertEq(uint8(registry.getDeal(id).state), uint8(PersatDealRegistry.DealState.Completed));
    }

    function test_B2_NoLiquidationWhileTokenPaused() public {
        bytes16 id = _activate("b2b");
        vm.warp(vault.liquidationOpensAt(id) + 1);
        feed.setFresh();
        usdc.setPaused(true);

        vm.prank(keeper);
        vm.expectRevert(PersatEscrowVault.TokenPaused.selector);
        vault.liquidate(id);
    }

    function test_B2_CureWindowAndLateFeeWaiverAfterPause() public {
        bytes16 id = _activate("b2c");
        uint256 maturity = vault.maturityOf(id);

        vm.warp(maturity + 6 days);
        usdc.setPaused(true);
        vault.notePause();
        vm.warp(maturity + 7 days);
        vault.notePause();
        vm.warp(maturity + 8 days);
        vault.notePause();
        usdc.setPaused(false);

        vm.warp(maturity + 9 days);
        feed.setFresh();

        assertEq(vault.pauseEpisodeStart(), maturity + 6 days);
        assertEq(vault.liquidationOpensAt(id), maturity + 8 days + vault.PAUSE_CURE_PERIOD());
        vm.prank(keeper);
        vm.expectRevert(PersatEscrowVault.LTVHealthy.selector);
        vault.liquidate(id);

        assertEq(vault.amountDue(id), PRINCIPAL + FULL_INTEREST, "late fee waived");
        vm.prank(borrower);
        vault.repayLoan(id);
        assertEq(uint8(registry.getDeal(id).state), uint8(PersatDealRegistry.DealState.Completed));
    }

    function test_B2_NotePauseRequiresAPause() public {
        vm.expectRevert(PersatEscrowVault.TokensNotPaused.selector);
        vault.notePause();
    }

    // ── N-04: a dead oracle no longer freezes an overdue loan forever ──

    function test_N04_LenderRecoversCollateralWhenOracleIsDead() public {
        bytes16 id = _activate("n04");
        uint256 opensAt = vault.liquidationOpensAt(id);

        vm.warp(opensAt + 1);
        vm.prank(lender);
        vm.expectRevert(PersatEscrowVault.OracleStale.selector);
        vault.liquidate(id);

        vm.warp(opensAt + vault.ORACLE_FAILURE_DELAY() + 1);
        vm.prank(keeper);
        vm.expectRevert(PersatEscrowVault.NotLender.selector);
        vault.liquidate(id);

        vm.prank(lender);
        vault.liquidate(id);
        assertEq(cirBtc.balanceOf(lender), COLLATERAL);
        assertEq(uint8(registry.getDeal(id).state), uint8(PersatDealRegistry.DealState.Liquidated));
    }

    // ── N-05: offers and confirmed deals expire ──

    function test_N05_ProposalExpires() public {
        bytes16 id = _id(borrower, "n05a");
        vm.prank(borrower);
        registry.proposeDeal(id, true, lender, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, bytes32("s"));

        vm.warp(block.timestamp + registry.PROPOSAL_TTL() + 1);
        assertTrue(registry.isExpired(id));
        vm.prank(lender);
        vm.expectRevert(PersatDealRegistry.DealExpired.selector);
        registry.claimDeal(id, bytes32("s"));
    }

    function test_N05_ActivationWindowCloses() public {
        bytes16 id = _confirm("n05b");
        assertEq(registry.activationDeadline(id), block.timestamp + registry.ACTIVATION_WINDOW());

        vm.warp(block.timestamp + registry.ACTIVATION_WINDOW() + 1);
        feed.setFresh();
        vm.prank(borrower);
        vm.expectRevert(PersatDealRegistry.ActivationWindowClosed.selector);
        vault.activateLoan(id);
    }

    // ── N-03: counter-offer slots cannot be exhausted ──

    function test_N03_WithdrawnOffersDoNotCount() public {
        bytes16 id = _proposePublic("n03a");
        for (uint256 i = 0; i < 60; i++) {
            vm.startPrank(griefer);
            registry.submitCounterOffer(id, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
            registry.cancelCounterOffer(id, i);
            vm.stopPrank();
        }
        assertEq(registry.activeCounterOffers(id), 0);

        vm.prank(lender);
        registry.submitCounterOffer(id, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
        vm.prank(borrower);
        registry.acceptCounterOffer(id, 60);
        assertEq(registry.getDeal(id).lender, lender);
    }

    function test_N03_OneActiveOfferPerAddress() public {
        bytes16 id = _proposePublic("n03b");
        vm.startPrank(griefer);
        registry.submitCounterOffer(id, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
        vm.expectRevert(PersatDealRegistry.ActiveOfferExists.selector);
        registry.submitCounterOffer(id, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
        vm.stopPrank();
    }

    // ── N-11: interest is pro-rata with a one-month minimum ──

    function test_N11_EarlyRepaymentPaysProRataInterest() public {
        bytes16 id = _activate("n11a");
        skip(1 days);
        assertEq(vault.amountDue(id), PRINCIPAL + FULL_INTEREST / 6, "one month minimum");

        skip(90 days - 1 days);
        assertEq(vault.amountDue(id), PRINCIPAL + FULL_INTEREST / 2, "half the term");

        uint256 lenderBefore = usdc.balanceOf(lender);
        vm.prank(borrower);
        vault.repayLoan(id);
        assertEq(usdc.balanceOf(lender) - lenderBefore, PRINCIPAL + FULL_INTEREST / 2);
    }

    // ── N-10: a fee change cannot hit an already confirmed deal ──

    function test_N10_FeeChangeDoesNotApplyToConfirmedDeal() public {
        bytes16 id = _confirm("n10");
        vm.prank(owner);
        vault.setFeeBps(50);

        skip(registry.ACTIVATION_WINDOW());
        feed.setFresh();
        uint256 feeBefore = usdc.balanceOf(feeRecipient);
        vm.prank(borrower);
        vault.activateLoan(id);
        assertEq(usdc.balanceOf(feeRecipient) - feeBefore, PRINCIPAL * FEE_BPS / 10_000, "old fee applies");

        skip(vault.FEE_CHANGE_DELAY());
        assertEq(vault.currentFeeBps(), 50);
    }

    // ── B-3: new loans stop when cirBTC trades away from BTC ──

    function test_B3_ActivationBlockedWhenCirBtcDepegs() public {
        MockUniswapV3Pool pool = new MockUniswapV3Pool(address(cirBtc), address(usdc), 63972);
        CirBtcPoolTwap guard = new CirBtcPoolTwap(address(pool), address(cirBtc), address(usdc), 1800);

        vm.prank(owner);
        PersatDealRegistry reg2 = new PersatDealRegistry(address(usdc), address(cirBtc), owner);
        registry = reg2;
        vault = _deployVault(address(guard));
        vm.prank(owner);
        registry.setVault(address(vault));
        vm.prank(borrower);
        cirBtc.approve(address(vault), type(uint256).max);
        vm.prank(lender);
        usdc.approve(address(vault), type(uint256).max);

        bytes16 depegged = _confirm("b3a");
        pool.setAverageTick(63668);
        vm.prank(borrower);
        vm.expectPartialRevert(PersatEscrowVault.CirBtcDepegged.selector);
        vault.activateLoan(depegged);

        pool.setAverageTick(63872);
        vm.prank(borrower);
        vault.activateLoan(depegged);
        assertEq(uint8(registry.getDeal(depegged).state), uint8(PersatDealRegistry.DealState.Active));
    }

    function test_B3_TwapPriceBothTokenOrders() public {
        MockUniswapV3Pool poolA = new MockUniswapV3Pool(address(cirBtc), address(usdc), 63972);
        MockUniswapV3Pool poolB = new MockUniswapV3Pool(address(usdc), address(cirBtc), -63972);
        CirBtcPoolTwap a = new CirBtcPoolTwap(address(poolA), address(cirBtc), address(usdc), 1800);
        CirBtcPoolTwap b = new CirBtcPoolTwap(address(poolB), address(cirBtc), address(usdc), 1800);

        assertApproxEqRel(a.twapPriceE18(), 59_997.03e18, 1e13);
        assertApproxEqRel(b.twapPriceE18(), 59_997.03e18, 1e13);
    }

    function test_B3_TwapRejectsWrongPool() public {
        MockFiatToken other = new MockFiatToken("X", "X", 18);
        MockUniswapV3Pool pool = new MockUniswapV3Pool(address(other), address(usdc), 0);
        vm.expectRevert(CirBtcPoolTwap.InvalidPool.selector);
        new CirBtcPoolTwap(address(pool), address(cirBtc), address(usdc), 1800);
    }

    // ── B-4 / N-12: liquidation pays the lender in USDC ──

    function test_B4_LiquidationPaysLenderInUsdc() public {
        bytes16 id = _activate("b4");
        feed.setAnswer(12_000e8);
        feed.setFresh();

        uint256 due = vault.amountDue(id);
        uint256 lenderBefore = usdc.balanceOf(lender);
        vm.prank(keeper);
        vault.liquidate(id);

        assertEq(usdc.balanceOf(lender) - lenderBefore, due);
        assertEq(cirBtc.balanceOf(lender), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(cirBtc.balanceOf(address(vault)), 0);
    }

    function test_MaxDuration_ProposeAndCounterOffer() public {
        bytes16 tooLong = _id(borrower, "dur25");
        vm.prank(borrower);
        vm.expectRevert(PersatDealRegistry.InvalidTerms.selector);
        registry.proposeDeal(tooLong, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, 25, PersatDealRegistry.Visibility.Public, bytes32(0));

        bytes16 maxed = _id(borrower, "dur24");
        vm.prank(borrower);
        registry.proposeDeal(maxed, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, 24, PersatDealRegistry.Visibility.Public, bytes32(0));

        vm.prank(lender);
        vm.expectRevert(PersatDealRegistry.InvalidTerms.selector);
        registry.submitCounterOffer(maxed, PRINCIPAL, COLLATERAL, RATE_BPS, 25);

        vm.prank(lender);
        registry.submitCounterOffer(maxed, PRINCIPAL, COLLATERAL, RATE_BPS, 24);
        assertEq(registry.getCounterOffers(maxed)[0].durationMonths, 24);
    }
}

interface IChainlinkLike {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// Reads the real cirBTC/USDC pool on a local fork of Arc Mainnet. Runs only when ARC_FORK_RPC is set.
contract CirBtcPoolTwapForkTest is Test {
    address constant POOL = 0x82916bee18fCEF517B26C72d7Cb5F13694E1dB41;
    address constant CIRBTC = 0x171A4217b86A807A64eB94757Db6849fb4bDbAA0;
    address constant USDC = 0x3600000000000000000000000000000000000000;
    address constant BTC_USD = 0xa109B535C70C8Be9995be64Bb6751AcDB27e03De;

    function test_Fork_TwapMatchesChainlink() public {
        string memory rpc = vm.envOr("ARC_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        CirBtcPoolTwap guard = new CirBtcPoolTwap(POOL, CIRBTC, USDC, 1800);
        (, int256 answer,,,) = IChainlinkLike(BTC_USD).latestRoundData();
        uint256 feedE18 = uint256(answer) * 1e10;
        uint256 twap = guard.twapPriceE18();
        emit log_named_uint("twap cirBTC/USD (e18)", twap);
        emit log_named_uint("chainlink BTC/USD (e18)", feedE18);
        assertApproxEqRel(twap, feedE18, 0.02e18);
    }
}
