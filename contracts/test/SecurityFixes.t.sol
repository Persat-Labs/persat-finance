// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {PersatDealRegistry} from "../PersatDealRegistry.sol";
import {PersatEscrowVault} from "../PersatEscrowVault.sol";
import {PythPriceFeedAdapter, IPythMinimal} from "../PythPriceFeedAdapter.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {MockPriceFeed} from "../test-helpers/MockPriceFeed.sol";

/// Regression tests for the November 2026 security review (findings F-02 … F-10).
/// Each test reproduces the original attack / failure and asserts it is now prevented.
contract SecurityFixesTest is Test {
    PersatDealRegistry registry;
    PersatEscrowVault vault;
    MockERC20 usdc;
    MockERC20 cirBtc;
    MockPriceFeed feed;

    address owner = makeAddr("owner");
    address feeRecipient = makeAddr("fee");
    address borrower = makeAddr("borrower");
    address lender = makeAddr("lender");
    address attacker = makeAddr("attacker");
    address keeper = makeAddr("keeper");

    uint256 constant PRINCIPAL = 10_000e6; // 10k USDC
    uint256 constant COLLATERAL = 1e8; // 1 BTC
    uint256 constant RATE_BPS = 1200; // 12% pa
    uint8 constant DURATION = 6; // 6 months -> interest 600 USDC
    uint256 constant OWED = 10_600e6;
    uint256 constant FEE_BPS = 25;
    int256 constant PRICE = 60_000e8;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockERC20("USDC", "USDC", 6);
        cirBtc = new MockERC20("cirBTC", "cirBTC", 8);
        feed = new MockPriceFeed(8, PRICE, block.timestamp);
        registry = new PersatDealRegistry(address(usdc), address(cirBtc), owner);
        vault = new PersatEscrowVault(
            address(registry), address(usdc), address(cirBtc), address(feed), 86400, 8000, 6500, address(0), feeRecipient, FEE_BPS, owner
        );
        vm.prank(owner);
        registry.setVault(address(vault));

        usdc.mint(lender, 1_000_000e6);
        usdc.mint(borrower, 100_000e6);
        cirBtc.mint(borrower, 10e8);
        vm.prank(lender);
        usdc.approve(address(vault), type(uint256).max);
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        cirBtc.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        usdc.mint(keeper, 1_000_000e6);
        vm.prank(keeper);
        usdc.approve(address(vault), type(uint256).max);
        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _id(address proposer, string memory tag) internal view returns (bytes16) {
        return bytes16(bytes.concat(registry.dealIdPrefix(proposer), bytes8(keccak256(bytes(tag)))));
    }

    function _activate(string memory tag, uint256 principal, uint256 collateral) internal returns (bytes16 id) {
        id = _id(borrower, tag);
        bytes32 salt = keccak256(bytes(tag));
        vm.prank(borrower);
        registry.proposeDeal(id, true, lender, principal, collateral, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, salt);
        vm.prank(lender);
        registry.claimDeal(id, salt);
        vm.prank(borrower);
        vault.activateLoan(id);
    }

    function _signClaim(uint256 signerKey, bytes16 id, address claimer) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(registry.claimDigest(id, claimer));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ── F-02: default now gives the lender a remedy, and late repayment costs a fee ──

    function test_F02_OverdueLoanLiquidatableEvenWithHealthyLtv() public {
        bytes16 id = _activate("f02", PRINCIPAL, COLLATERAL); // LTV ~17.7%
        uint256 maturity = vault.maturityOf(id);

        // Still inside the grace period: healthy LTV -> cannot liquidate
        vm.warp(maturity + 1 days);
        feed.setFresh();
        vault.markDefault(id);
        vm.expectRevert(PersatEscrowVault.LTVHealthy.selector);
        vault.liquidate(id);

        // After the grace period the lender (or a keeper) can recover what is owed
        vm.warp(maturity + vault.GRACE_PERIOD() + 1);
        feed.setFresh();
        uint256 lenderBefore = usdc.balanceOf(lender);
        vm.prank(keeper);
        vault.liquidate(id);

        uint256 owedWithLateFee = OWED + PRINCIPAL * vault.LATE_FEE_BPS() / 10_000;
        uint256 seized = owedWithLateFee * 10_300 / 10_000 * 1e8 * 100 / uint256(PRICE);
        assertEq(usdc.balanceOf(lender) - lenderBefore, owedWithLateFee, "lender repaid debt + late fee in USDC");
        assertEq(cirBtc.balanceOf(keeper), seized, "keeper takes debt + bonus in cirBTC");
        assertEq(cirBtc.balanceOf(keeper) + (cirBtc.balanceOf(borrower) - 9e8), COLLATERAL, "all collateral distributed");
        assertEq(uint8(registry.getDeal(id).state), uint8(PersatDealRegistry.DealState.Liquidated));
    }

    function test_F02_LateRepaymentPaysLateFee() public {
        bytes16 id = _activate("f02b", PRINCIPAL, COLLATERAL);
        vm.warp(vault.maturityOf(id));
        assertEq(vault.amountDue(id), OWED);
        vm.warp(vault.maturityOf(id) + 1);
        uint256 lateFee = PRINCIPAL * vault.LATE_FEE_BPS() / 10_000;
        assertEq(vault.amountDue(id), OWED + lateFee);

        uint256 before = usdc.balanceOf(lender);
        vm.prank(borrower);
        vault.repayLoan(id);
        assertEq(usdc.balanceOf(lender) - before, OWED + lateFee);
    }

    function test_F02_OnTimeRepaymentHasNoLateFee() public {
        bytes16 id = _activate("f02c", PRINCIPAL, COLLATERAL);
        vm.warp(vault.maturityOf(id)); // exactly at maturity: not late
        uint256 before = usdc.balanceOf(lender);
        vm.prank(borrower);
        vault.repayLoan(id);
        assertEq(usdc.balanceOf(lender) - before, OWED);
    }

    // ── F-03 / F-04: no user USDC is ever held by the vault ──

    function test_F03_F04_PrincipalPaidAtActivation_NothingToDrain() public {
        uint256 before = usdc.balanceOf(borrower);
        bytes16 id = _activate("f03", PRINCIPAL, COLLATERAL);
        uint256 fee = PRINCIPAL * FEE_BPS / 10_000;
        assertEq(usdc.balanceOf(borrower) - before, PRINCIPAL - fee);
        assertEq(usdc.balanceOf(feeRecipient), fee);
        assertEq(usdc.balanceOf(address(vault)), 0);

        // Liquidation afterwards leaves nothing stuck either
        feed.setAnswer(12_000e8);
        feed.setFresh();
        vault.liquidate(id);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(cirBtc.balanceOf(address(vault)), 0);
    }

    function test_F03_OwnerStillCannotTouchCollateral() public {
        _activate("f03b", PRINCIPAL, COLLATERAL);
        vm.prank(owner);
        vm.expectRevert(PersatEscrowVault.CircBTCRescueBlocked.selector);
        vault.rescueERC20(address(cirBtc), owner, COLLATERAL);
    }

    // ── F-05: no loan can start above the max initial LTV ──

    function test_F05_ActivationRejectedAboveMaxInitialLtv() public {
        bytes16 id = _id(borrower, "f05");
        vm.prank(borrower);
        registry.proposeDeal(id, true, lender, 55_000e6, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, bytes32("s"));
        vm.prank(lender);
        registry.claimDeal(id, bytes32("s"));

        // (55,000 + 3,300 interest) / 60,000 = 97.1%
        vm.expectRevert(abi.encodeWithSelector(PersatEscrowVault.InitialLtvTooHigh.selector, 9716, 6500));
        vm.prank(borrower);
        vault.activateLoan(id);
    }

    function test_F05_ActivationRequiresFreshOracle() public {
        bytes16 id = _id(borrower, "f05b");
        vm.prank(borrower);
        registry.proposeDeal(id, true, lender, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, bytes32("s"));
        vm.prank(lender);
        registry.claimDeal(id, bytes32("s"));

        vm.warp(block.timestamp + 86400 + 1);
        vm.expectRevert(PersatEscrowVault.OracleStale.selector);
        vm.prank(borrower);
        vault.activateLoan(id);
    }

    function test_F05_ConstructorRejectsMaxLtvAboveThreshold() public {
        vm.expectRevert(PersatEscrowVault.InvalidParameter.selector);
        new PersatEscrowVault(
            address(registry), address(usdc), address(cirBtc), address(feed), 86400, 8000, 8000, address(0), feeRecipient, FEE_BPS, owner
        );
    }

    // ── F-06: liquidation covers interest and rewards the caller ──

    function test_F06_LiquidationCoversInterestAndPaysBonus() public {
        bytes16 id = _activate("f06", PRINCIPAL, COLLATERAL);
        feed.setAnswer(12_000e8); // LTV = 10,600 / 12,000 = 88%
        feed.setFresh();

        uint256 debt = vault.amountDue(id);
        uint256 lenderBefore = usdc.balanceOf(lender);
        vm.prank(keeper);
        vault.liquidate(id);

        assertEq(usdc.balanceOf(lender) - lenderBefore, debt, "lender gets the full debt in USDC");
        assertEq(cirBtc.balanceOf(keeper), debt * 10_300 / 10_000 * 1e8 / 12_000e6, "keeper gets debt + 3%");
    }

    function test_F06_UnderwaterKeeperRepaysCollateralValue() public {
        bytes16 id = _activate("f06b", PRINCIPAL, COLLATERAL);
        feed.setAnswer(8_000e8);
        feed.setFresh();
        uint256 lenderBefore = usdc.balanceOf(lender);
        vm.prank(keeper);
        vault.liquidate(id);
        assertEq(usdc.balanceOf(lender) - lenderBefore, uint256(8_000e6) * 10_000 / 10_300);
        assertEq(cirBtc.balanceOf(keeper), COLLATERAL);
    }

    // ── F-07: open private links can no longer be claimed by copying the secret ──

    function test_F07_OpenLinkRequiresSignature() public {
        (address signer, uint256 signerKey) = makeAddrAndKey("ephemeral-link-key");
        bytes16 id = _id(borrower, "f07");
        bytes32 onchainSalt = bytes32(uint256(uint160(signer)));
        vm.prank(borrower);
        registry.proposeDeal(id, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, onchainSalt);

        // The calldata value is public, but the salt path is closed for open links
        vm.prank(attacker);
        vm.expectRevert(PersatDealRegistry.SignatureRequired.selector);
        registry.claimDeal(id, onchainSalt);

        // Front-running the real claim: the signature is bound to the intended claimer
        bytes memory sig = _signClaim(signerKey, id, lender);
        vm.prank(attacker);
        vm.expectRevert(PersatDealRegistry.InvalidSignature.selector);
        registry.claimDealWithSignature(id, sig);

        vm.prank(lender);
        registry.claimDealWithSignature(id, sig);
        PersatDealRegistry.Deal memory d = registry.getDeal(id);
        assertEq(d.lender, lender);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Confirmed));
        assertEq(registry.claimSigner(id), address(0));
    }

    function test_F07_SignatureFromWrongKeyRejected() public {
        (address signer,) = makeAddrAndKey("ephemeral-link-key");
        (, uint256 otherKey) = makeAddrAndKey("someone-else");
        bytes16 id = _id(borrower, "f07b");
        vm.prank(borrower);
        registry.proposeDeal(id, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, bytes32(uint256(uint160(signer))));

        bytes memory sig = _signClaim(otherKey, id, attacker);
        vm.prank(attacker);
        vm.expectRevert(PersatDealRegistry.InvalidSignature.selector);
        registry.claimDealWithSignature(id, sig);
    }

    function test_F07_OpenLinkSaltMustBeAnAddress() public {
        bytes16 id = _id(borrower, "f07c");
        vm.prank(borrower);
        vm.expectRevert(PersatDealRegistry.InvalidClaimToken.selector);
        registry.proposeDeal(id, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, keccak256("random"));
    }

    function test_F07_ReservedLinkStillWorksWithSalt() public {
        bytes16 id = _id(borrower, "f07d");
        vm.prank(borrower);
        registry.proposeDeal(id, true, lender, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, bytes32("salt"));
        vm.prank(attacker);
        vm.expectRevert(PersatDealRegistry.Unauthorized.selector);
        registry.claimDeal(id, bytes32("salt"));
        vm.prank(lender);
        registry.claimDeal(id, bytes32("salt"));
        assertEq(registry.getDeal(id).lender, lender);
    }

    // ── F-08: deal IDs are bound to their proposer ──

    function test_F08_CannotSquatAnotherUsersDealId() public {
        bytes16 victimId = _id(borrower, "f08");
        vm.prank(attacker);
        vm.expectRevert(PersatDealRegistry.InvalidDealId.selector);
        registry.proposeDeal(victimId, true, address(0), 1, 1, 1, 1, PersatDealRegistry.Visibility.Public, bytes32(0));

        vm.prank(borrower);
        registry.proposeDeal(victimId, true, lender, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, bytes32("s"));
        assertEq(registry.getDeal(victimId).borrower, borrower);
    }

    // ── F-09: no self-matching; counter-offers can be withdrawn ──

    function test_F09_InitiatorCannotCounterOwnOrder() public {
        bytes16 id = _id(borrower, "f09");
        vm.prank(borrower);
        registry.proposeDeal(id, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Public, bytes32(0));
        vm.prank(borrower);
        vm.expectRevert(PersatDealRegistry.SelfMatch.selector);
        registry.submitCounterOffer(id, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
    }

    function test_F09_ProposerCannotClaimOwnPrivateLink() public {
        (address signer, uint256 key) = makeAddrAndKey("k");
        bytes16 id = _id(borrower, "f09b");
        vm.prank(borrower);
        registry.proposeDeal(id, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, bytes32(uint256(uint160(signer))));
        bytes memory sig = _signClaim(key, id, borrower);
        vm.prank(borrower);
        vm.expectRevert(PersatDealRegistry.SelfMatch.selector);
        registry.claimDealWithSignature(id, sig);
    }

    function test_F09_CannotReservePrivateDealForSelf() public {
        bytes16 id = _id(borrower, "f09c");
        vm.prank(borrower);
        vm.expectRevert(PersatDealRegistry.SelfMatch.selector);
        registry.proposeDeal(id, true, borrower, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, bytes32("s"));
    }

    function test_F09_CounterOfferCanBeWithdrawn() public {
        bytes16 id = _id(borrower, "f09d");
        vm.prank(borrower);
        registry.proposeDeal(id, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Public, bytes32(0));
        vm.prank(lender);
        registry.submitCounterOffer(id, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);

        vm.prank(attacker);
        vm.expectRevert(PersatDealRegistry.Unauthorized.selector);
        registry.cancelCounterOffer(id, 0);

        vm.prank(lender);
        registry.cancelCounterOffer(id, 0);
        assertFalse(registry.getCounterOffers(id)[0].active);

        vm.prank(borrower);
        vm.expectRevert(PersatDealRegistry.OfferNotFound.selector);
        registry.acceptCounterOffer(id, 0);
    }
}

// ── F-10: Pyth adapter exposes a Chainlink-compatible feed ──

contract MockPyth is IPythMinimal {
    Price internal _p;

    function set(int64 price, int32 expo, uint256 publishTime) external {
        _p = Price({price: price, conf: 0, expo: expo, publishTime: publishTime});
    }

    function getPriceUnsafe(bytes32) external view returns (Price memory) {
        return _p;
    }
}

contract PythAdapterTest is Test {
    MockPyth pyth;
    PythPriceFeedAdapter adapter;

    function setUp() public {
        vm.warp(1_800_000_000);
        pyth = new MockPyth();
        adapter = new PythPriceFeedAdapter(address(pyth), bytes32(uint256(1)), "BTC / USD");
    }

    function test_ScalesExpoMinus8() public {
        pyth.set(73_330_12345678, -8, block.timestamp);
        (uint80 r, int256 a, uint256 s, uint256 u, uint80 ar) = adapter.latestRoundData();
        assertEq(a, 73_330_12345678);
        assertEq(u, block.timestamp);
        assertEq(s, block.timestamp);
        assertEq(r, ar);
        assertEq(adapter.decimals(), 8);
    }

    function test_ScalesOtherExponents() public {
        pyth.set(7_333_012_300, -5, block.timestamp); // $73,330.123
        (, int256 a,,,) = adapter.latestRoundData();
        assertEq(a, 73_330_12300000);

        pyth.set(7_333_012_345_678_901, -11, block.timestamp);
        (, a,,,) = adapter.latestRoundData();
        assertEq(a, 73_330_12345678);
    }

    function test_RevertsOnNonPositivePrice() public {
        pyth.set(0, -8, block.timestamp);
        vm.expectRevert(PythPriceFeedAdapter.InvalidPythPrice.selector);
        adapter.latestRoundData();
    }

    function test_WorksAsVaultOracle() public {
        pyth.set(60_000e8, -8, block.timestamp);
        MockERC20 usdc = new MockERC20("USDC", "USDC", 6);
        MockERC20 btc = new MockERC20("cirBTC", "cirBTC", 8);
        PersatDealRegistry reg = new PersatDealRegistry(address(usdc), address(btc), address(this));
        PersatEscrowVault v = new PersatEscrowVault(
            address(reg), address(usdc), address(btc), address(adapter), 3600, 8000, 6500, address(0), address(1), 0, address(this)
        );
        assertEq(v.priceFeedDecimals(), 8);
    }
}
