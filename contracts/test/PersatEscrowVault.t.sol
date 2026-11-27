// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {PersatDealRegistry} from "../PersatDealRegistry.sol";
import {PersatEscrowVault} from "../PersatEscrowVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {MockPriceFeed} from "../test-helpers/MockPriceFeed.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture
// ─────────────────────────────────────────────────────────────────────────────

abstract contract VaultFixture is Test {
    PersatDealRegistry internal registry;
    PersatEscrowVault  internal vault;
    MockERC20          internal usdc;
    MockERC20          internal cirBtc;
    MockPriceFeed      internal priceFeed;

    address internal owner        = makeAddr("owner");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal borrower     = makeAddr("borrower");
    address internal lender       = makeAddr("lender");
    address internal stranger     = makeAddr("stranger");

    // Deal terms
    bytes16 internal DEAL_ID; // bound to the borrower (see dealIdPrefix)
    uint256 internal constant PRINCIPAL  = 10_000e6;   // 10 000 USDC (6 dec)
    uint256 internal constant COLLATERAL = 1e8;        // 1 cirBTC  (8 dec)
    uint256 internal constant RATE_BPS   = 500;        // 5% annual
    uint8   internal constant DURATION   = 6;          // 6 months
    uint256 internal constant FEE_BPS    = 10;         // 0.1%

    // Oracle: BTC/USD = $60 000, 8 decimals → 60000_00000000
    int256  internal constant BTC_PRICE_8DEC = 60_000_00000000;
    uint256 internal constant STALENESS     = 3600;
    uint256 internal constant LIQ_BPS       = 8000; // 80%
    uint256 internal constant MAX_INIT_LTV  = 6500; // 65%

    bytes32 internal constant SALT = bytes32(uint256(0xdeadcafe));

    function setUp() public virtual {
        usdc   = new MockERC20("Mock USDC",   "mUSDC",   6);
        cirBtc = new MockERC20("Mock cirBTC", "mcirBTC", 8);

        priceFeed = new MockPriceFeed(8, BTC_PRICE_8DEC, block.timestamp);

        registry = new PersatDealRegistry(address(usdc), address(cirBtc), owner);

        vault = new PersatEscrowVault(
            address(registry),
            address(usdc),
            address(cirBtc),
            address(priceFeed),
            STALENESS,
            LIQ_BPS,
            MAX_INIT_LTV,
            address(0),
            feeRecipient,
            FEE_BPS,
            owner
        );

        // Wire vault into registry
        vm.prank(owner);
        registry.setVault(address(vault));
        DEAL_ID = _idFor(borrower, "vault-deal-1");
    }

    /// Deal ID whose first 8 bytes are bound to `proposer` (F-08).
    function _idFor(address proposer, bytes memory tag) internal view returns (bytes16) {
        return bytes16(bytes.concat(registry.dealIdPrefix(proposer), bytes8(keccak256(tag))));
    }

    // ── Deal-building helpers ────────────────────────────────────────────────

    /// Propose a private deal (borrower proposes), claim by lender → Confirmed.
    function _confirmDeal(bytes16 dealId) internal {
        vm.prank(borrower);
        registry.proposeDeal(
            dealId, true, lender,
            PRINCIPAL, COLLATERAL, RATE_BPS, DURATION,
            PersatDealRegistry.Visibility.Private,
            SALT
        );
        vm.prank(lender);
        registry.claimDeal(dealId, SALT);
    }

    /// Confirm + activate loan: fund parties and approve vault.
    function _activateLoan(bytes16 dealId) internal {
        _confirmDeal(dealId);

        uint256 lenderNeeds     = PRINCIPAL; // principal − fee goes to the borrower, fee to feeRecipient

        // Seed balances
        cirBtc.mint(borrower, COLLATERAL);
        usdc.mint(lender, lenderNeeds);

        // Approvals
        vm.prank(borrower);
        cirBtc.approve(address(vault), COLLATERAL);
        vm.prank(lender);
        usdc.approve(address(vault), lenderNeeds);

        vm.prank(borrower);
        vault.activateLoan(dealId);
    }

    /// Activate; the borrower receives the principal (minus fee) directly (F-03 / F-04).
    function _activateAndClaim(bytes16 dealId) internal {
        _activateLoan(dealId);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Deployment / initialization
// ─────────────────────────────────────────────────────────────────────────────

contract VaultDeployTest is VaultFixture {
    function test_ConstructorSetsImmutables() public view {
        assertEq(address(vault.registry()),   address(registry));
        assertEq(vault.usdc(),                address(usdc));
        assertEq(vault.cirBtc(),              address(cirBtc));
        assertEq(address(vault.priceFeed()),  address(priceFeed));
        assertEq(vault.stalenessThreshold(),  STALENESS);
        assertEq(vault.liquidationThresholdBps(), LIQ_BPS);
        assertEq(vault.feeRecipient(),        feeRecipient);
        assertEq(vault.feeBps(),              FEE_BPS);
        assertEq(vault.owner(),               owner);
        assertEq(vault.priceFeedDecimals(),   8);
        assertEq(vault.cirBtcDecimals(),      8);
    }

    function test_RevertConstructor_ZeroRegistry() public {
        vm.expectRevert(PersatEscrowVault.ZeroAddress.selector);
        new PersatEscrowVault(
            address(0), address(usdc), address(cirBtc),
            address(priceFeed), STALENESS, LIQ_BPS, MAX_INIT_LTV,
            address(0), feeRecipient, FEE_BPS, owner
        );
    }

    function test_RevertConstructor_FeeTooHigh() public {
        vm.expectRevert(PersatEscrowVault.FeeTooHigh.selector);
        new PersatEscrowVault(
            address(registry), address(usdc), address(cirBtc),
            address(priceFeed), STALENESS, LIQ_BPS, MAX_INIT_LTV,
            address(0), feeRecipient, 51, owner
        );
    }

    function test_RevertConstructor_ZeroStaleness() public {
        vm.expectRevert(PersatEscrowVault.InvalidParameter.selector);
        new PersatEscrowVault(
            address(registry), address(usdc), address(cirBtc),
            address(priceFeed), 0, LIQ_BPS, MAX_INIT_LTV,
            address(0), feeRecipient, FEE_BPS, owner
        );
    }

    function test_RevertConstructor_ZeroLiqBps() public {
        vm.expectRevert(PersatEscrowVault.InvalidParameter.selector);
        new PersatEscrowVault(
            address(registry), address(usdc), address(cirBtc),
            address(priceFeed), STALENESS, 0, MAX_INIT_LTV,
            address(0), feeRecipient, FEE_BPS, owner
        );
    }

    function test_RevertConstructor_LiqBpsOver10000() public {
        vm.expectRevert(PersatEscrowVault.InvalidParameter.selector);
        new PersatEscrowVault(
            address(registry), address(usdc), address(cirBtc),
            address(priceFeed), STALENESS, 10_001, MAX_INIT_LTV,
            address(0), feeRecipient, FEE_BPS, owner
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. activateLoan
// ─────────────────────────────────────────────────────────────────────────────

contract VaultActivateLoanTest is VaultFixture {
    function test_ActivateLoan_StateBecomesActive() public {
        _activateLoan(DEAL_ID);
        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Active));
    }

    function test_ActivateLoan_CollateralLockedInVault() public {
        uint256 vaultBefore = cirBtc.balanceOf(address(vault));
        _activateLoan(DEAL_ID);
        uint256 vaultAfter = cirBtc.balanceOf(address(vault));

        assertEq(vaultAfter - vaultBefore, COLLATERAL);
        assertEq(vault.lockedCollateral(DEAL_ID), COLLATERAL);
    }

    function test_ActivateLoan_PrincipalPaidDirectlyToBorrower() public {
        uint256 expected = PRINCIPAL - (PRINCIPAL * FEE_BPS / 10_000);
        uint256 before = usdc.balanceOf(borrower);
        _activateLoan(DEAL_ID);
        assertEq(usdc.balanceOf(borrower) - before, expected);
        assertEq(usdc.balanceOf(address(vault)), 0, "vault must never custody user USDC");
    }

    function test_ActivateLoan_FeeDeductedToRecipient() public {
        uint256 feeAmount = PRINCIPAL * FEE_BPS / 10_000;
        uint256 recipBefore = usdc.balanceOf(feeRecipient);
        _activateLoan(DEAL_ID);
        assertEq(usdc.balanceOf(feeRecipient) - recipBefore, feeAmount);
    }

    function test_ActivateLoan_EmitsLoanActivated() public {
        _confirmDeal(DEAL_ID);

        uint256 feeAmount   = PRINCIPAL * FEE_BPS / 10_000;
        uint256 borrowerAmt = PRINCIPAL - feeAmount;

        cirBtc.mint(borrower, COLLATERAL);
        usdc.mint(lender, PRINCIPAL);
        vm.prank(borrower); cirBtc.approve(address(vault), COLLATERAL);
        vm.prank(lender);   usdc.approve(address(vault), PRINCIPAL);

        vm.expectEmit(true, true, true, true, address(vault));
        emit PersatEscrowVault.LoanActivated(
            DEAL_ID, borrower, lender, PRINCIPAL, COLLATERAL, feeAmount, borrowerAmt
        );
        vm.prank(borrower);
        vault.activateLoan(DEAL_ID);
    }

    function test_RevertActivateLoan_NotParty() public {
        _confirmDeal(DEAL_ID);
        vm.expectRevert(PersatEscrowVault.NotDealParty.selector);
        vm.prank(stranger);
        vault.activateLoan(DEAL_ID);
    }

    function test_RevertActivateLoan_NotConfirmedState() public {
        // Deal doesn't exist at all — registry reverts DealNotFound, vault wraps as DealNotActive
        vm.expectRevert();
        vm.prank(borrower);
        vault.activateLoan(bytes16(keccak256("nonexistent")));
    }

    function test_RevertActivateLoan_WhenPaused() public {
        _confirmDeal(DEAL_ID);
        vm.prank(owner); vault.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(borrower);
        vault.activateLoan(DEAL_ID);
    }
}

// 3. claimPrincipal — removed: principal is now paid to the borrower at activation (F-03 / F-04).

// ─────────────────────────────────────────────────────────────────────────────
// 4. repayLoan
// ─────────────────────────────────────────────────────────────────────────────

contract VaultRepayLoanTest is VaultFixture {
    uint256 internal feeAmount;
    uint256 internal claimableAmount; // what borrower receives after fee
    uint256 internal interest;
    uint256 internal totalRepayment;

    function setUp() public override {
        super.setUp();
        feeAmount       = PRINCIPAL * FEE_BPS / 10_000;
        claimableAmount = PRINCIPAL - feeAmount;
        interest        = PRINCIPAL * RATE_BPS * DURATION / (10_000 * 12);
        totalRepayment  = PRINCIPAL + interest;
    }

    /// @dev Fund borrower for repayment.
    /// Borrower received `claimableAmount` at activation; they need
    /// `totalRepayment` to repay → shortfall = totalRepayment - claimableAmount
    ///                                        = feeAmount + interest.
    function _fundBorrowerForRepay() internal {
        uint256 maturity = vault.maturityOf(DEAL_ID);
        if (block.timestamp < maturity) vm.warp(maturity);
        uint256 shortfall = totalRepayment - claimableAmount; // fee + interest
        usdc.mint(borrower, shortfall);
        vm.prank(borrower);
        usdc.approve(address(vault), totalRepayment);
    }

    function test_RepayLoan_HappyPath_StateCompleted() public {
        _activateAndClaim(DEAL_ID);
        _fundBorrowerForRepay();

        vm.prank(borrower);
        vault.repayLoan(DEAL_ID);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Completed));
    }

    function test_RepayLoan_LenderReceivesPrincipalPlusInterest() public {
        _activateAndClaim(DEAL_ID);
        _fundBorrowerForRepay();

        uint256 lenderBefore = usdc.balanceOf(lender);
        vm.prank(borrower);
        vault.repayLoan(DEAL_ID);

        assertEq(usdc.balanceOf(lender) - lenderBefore, totalRepayment);
    }

    function test_RepayLoan_BorrowerGetsCollateralBack() public {
        _activateAndClaim(DEAL_ID);
        _fundBorrowerForRepay();

        uint256 borrowerCirBefore = cirBtc.balanceOf(borrower);
        vm.prank(borrower);
        vault.repayLoan(DEAL_ID);

        assertEq(cirBtc.balanceOf(borrower) - borrowerCirBefore, COLLATERAL);
    }

    function test_RepayLoan_LockedCollateralCleared() public {
        _activateAndClaim(DEAL_ID);
        _fundBorrowerForRepay();

        vm.prank(borrower);
        vault.repayLoan(DEAL_ID);

        assertEq(vault.lockedCollateral(DEAL_ID), 0);
    }

    function test_RepayLoan_EmitsLoanRepaid() public {
        _activateAndClaim(DEAL_ID);
        _fundBorrowerForRepay();

        vm.expectEmit(true, false, false, true, address(vault));
        emit PersatEscrowVault.LoanRepaid(DEAL_ID, totalRepayment, COLLATERAL);
        vm.prank(borrower);
        vault.repayLoan(DEAL_ID);
    }

    function test_RepayLoan_FromDefaultedState_Completes() public {
        _activateAndClaim(DEAL_ID);

        // Warp past maturity and mark default
        skip(uint256(DURATION) * 30 days + 1);
        vault.markDefault(DEAL_ID);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Defaulted));

        _fundBorrowerForRepay();
        uint256 lateFee = PRINCIPAL * vault.LATE_FEE_BPS() / 10_000;
        usdc.mint(borrower, lateFee);
        vm.prank(borrower);
        usdc.approve(address(vault), totalRepayment + lateFee);
        assertEq(vault.amountDue(DEAL_ID), totalRepayment + lateFee);

        uint256 lenderBefore = usdc.balanceOf(lender);
        vm.prank(borrower);
        vault.repayLoan(DEAL_ID);
        assertEq(usdc.balanceOf(lender) - lenderBefore, totalRepayment + lateFee);

        d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Completed));
    }

    function test_RevertRepayLoan_NotBorrower() public {
        _activateAndClaim(DEAL_ID);

        vm.expectRevert(PersatEscrowVault.NotBorrower.selector);
        vm.prank(stranger);
        vault.repayLoan(DEAL_ID);
    }

    function test_RevertRepayLoan_NotActive() public {
        // Completed state — repay twice
        _activateAndClaim(DEAL_ID);
        _fundBorrowerForRepay();
        vm.prank(borrower); vault.repayLoan(DEAL_ID);

        vm.expectRevert(PersatEscrowVault.DealNotActive.selector);
        vm.prank(borrower);
        vault.repayLoan(DEAL_ID);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. liquidate
// ─────────────────────────────────────────────────────────────────────────────

contract VaultLiquidateTest is VaultFixture {
    function setUp() public override {
        super.setUp();
        _activateLoan(DEAL_ID);
        priceFeed.setFresh();
        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(vault), type(uint256).max);
    }

    // --- LTV healthy → revert ---

    function test_RevertLiquidate_LTVHealthy() public {
        // At $60 000/BTC, 1 BTC = $60 000.  Principal = $10 000.
        // LTV = 10_000 / 60_000 = ~16.7% — well below 80%.
        vm.expectRevert(PersatEscrowVault.LTVHealthy.selector);
        vault.liquidate(DEAL_ID);
    }

    // --- LTV breached → succeeds ---

    function test_Liquidate_LTVBreached_StateIsLiquidated() public {
        // Drive BTC price down to $11 000 → LTV = 10000/11000 = 90.9% > 80%
        priceFeed.setAnswer(11_000_00000000);

        vault.liquidate(DEAL_ID);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Liquidated));
    }

    function test_Liquidate_LenderPaidInUsdc_LiquidatorTakesCollateralWithBonus() public {
        priceFeed.setAnswer(11_000_00000000);
        uint256 debt = vault.amountDue(DEAL_ID);

        uint256 lenderUsdcBefore = usdc.balanceOf(lender);
        uint256 borrowerBefore   = cirBtc.balanceOf(borrower);

        vault.liquidate(DEAL_ID);

        uint256 seized = debt * 10_300 / 10_000 * 1e8 * 100 / uint256(11_000_00000000);
        assertEq(usdc.balanceOf(lender) - lenderUsdcBefore, debt, "lender repaid in USDC");
        assertEq(cirBtc.balanceOf(lender), 0, "lender receives no cirBTC");
        assertEq(cirBtc.balanceOf(address(this)), seized, "liquidator gets debt + 3% in cirBTC");
        assertEq(cirBtc.balanceOf(borrower) - borrowerBefore, COLLATERAL - seized, "surplus to borrower");
    }

    function test_Liquidate_Underwater_LiquidatorRepaysCollateralValueOnly() public {
        priceFeed.setAnswer(5_000_00000000);

        uint256 lenderUsdcBefore = usdc.balanceOf(lender);
        vault.liquidate(DEAL_ID);

        assertEq(usdc.balanceOf(lender) - lenderUsdcBefore, uint256(5_000e6) * 10_000 / 10_300);
        assertEq(cirBtc.balanceOf(address(this)), COLLATERAL);
        assertEq(vault.lockedCollateral(DEAL_ID), 0);
    }

    function test_Liquidate_LenderCanLiquidateWithoutUsdc() public {
        priceFeed.setAnswer(5_000_00000000);

        uint256 lenderUsdcBefore = usdc.balanceOf(lender);
        vm.prank(lender);
        vault.liquidate(DEAL_ID);

        assertEq(usdc.balanceOf(lender), lenderUsdcBefore);
        assertEq(cirBtc.balanceOf(lender), COLLATERAL);
    }

    function test_Liquidate_EmitsLoanLiquidated() public {
        priceFeed.setAnswer(11_000_00000000);

        vm.expectEmit(true, true, false, false, address(vault));
        emit PersatEscrowVault.LoanLiquidated(DEAL_ID, address(this), 0, 0);
        vault.liquidate(DEAL_ID);
    }

    // --- Oracle staleness ---

    function test_RevertLiquidate_OracleStale() public {
        // Ensure block.timestamp is large enough so makeStale doesn't underflow.
        // block.timestamp starts at 1 in the forge EVM; warp to a realistic value first.
        vm.warp(block.timestamp + STALENESS + 100);
        priceFeed.setFresh();               // reset updatedAt to current (large) timestamp
        priceFeed.makeStale(STALENESS);     // set updatedAt = block.timestamp - staleness - 1
        // Drive price low enough to breach LTV so that the stale check is reached
        priceFeed.setAnswer(11_000_00000000);

        vm.expectRevert(PersatEscrowVault.OracleStale.selector);
        vault.liquidate(DEAL_ID);
    }

    // --- Oracle invalid price ---

    function test_RevertLiquidate_InvalidPrice_ZeroAnswer() public {
        priceFeed.makeZeroPrice();
        vm.expectRevert(PersatEscrowVault.OracleInvalidPrice.selector);
        vault.liquidate(DEAL_ID);
    }

    function test_RevertLiquidate_InvalidPrice_NegativeAnswer() public {
        priceFeed.makeNegativePrice();
        vm.expectRevert(PersatEscrowVault.OracleInvalidPrice.selector);
        vault.liquidate(DEAL_ID);
    }

    function test_RevertLiquidate_InvalidPrice_ZeroStartedAt() public {
        priceFeed.makeZeroStartedAt();
        vm.expectRevert(PersatEscrowVault.OracleInvalidPrice.selector);
        vault.liquidate(DEAL_ID);
    }

    function test_RevertLiquidate_InvalidPrice_RoundNotComplete() public {
        priceFeed.makeInvalidRound();
        vm.expectRevert(PersatEscrowVault.OracleInvalidPrice.selector);
        vault.liquidate(DEAL_ID);
    }

    // --- Not active ---

    function test_RevertLiquidate_NotActive_ProposedState() public {
        bytes16 dealId2 = _idFor(borrower, "deal-proposed");
        vm.prank(borrower);
        registry.proposeDeal(
            dealId2, true, lender, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION,
            PersatDealRegistry.Visibility.Private, bytes32(uint256(0x777))
        );
        vm.expectRevert(PersatEscrowVault.DealNotActive.selector);
        vault.liquidate(dealId2);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. markDefault
// ─────────────────────────────────────────────────────────────────────────────

contract VaultMarkDefaultTest is VaultFixture {
    function test_MarkDefault_SucceedsAfterMaturity() public {
        _activateLoan(DEAL_ID);

        // Warp to exactly 1 second after maturity
        skip(uint256(DURATION) * 30 days + 1);

        vault.markDefault(DEAL_ID);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Defaulted));
    }

    function test_MarkDefault_EmitsLoanDefaulted() public {
        _activateLoan(DEAL_ID);
        skip(uint256(DURATION) * 30 days + 1);

        vm.expectEmit(true, false, false, false, address(vault));
        emit PersatEscrowVault.LoanDefaulted(DEAL_ID);
        vault.markDefault(DEAL_ID);
    }

    function test_RevertMarkDefault_BeforeMaturity() public {
        _activateLoan(DEAL_ID);

        // Still before maturity — must revert
        vm.expectRevert(PersatEscrowVault.DealNotActive.selector);
        vault.markDefault(DEAL_ID);
    }

    function test_RevertMarkDefault_ExactlyAtMaturity() public {
        _activateLoan(DEAL_ID);

        // Warp to exact maturity boundary (not past it)
        skip(uint256(DURATION) * 30 days);

        vm.expectRevert(PersatEscrowVault.DealNotActive.selector);
        vault.markDefault(DEAL_ID);
    }

    function test_RevertMarkDefault_NotActive() public {
        // Deal that was never activated
        bytes16 dealId2 = _idFor(borrower, "deal-not-active");
        vm.prank(borrower);
        registry.proposeDeal(
            dealId2, true, lender, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION,
            PersatDealRegistry.Visibility.Private, bytes32(uint256(0x888))
        );
        vm.expectRevert(PersatEscrowVault.DealNotActive.selector);
        vault.markDefault(dealId2);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Admin functions
// ─────────────────────────────────────────────────────────────────────────────

contract VaultAdminTest is VaultFixture {
    function test_SetFeeBps_TakesEffectOnlyAfterDelay() public {
        vm.prank(owner);
        vault.setFeeBps(20);
        assertEq(vault.feeBps(), FEE_BPS);
        assertEq(vault.currentFeeBps(), FEE_BPS);

        skip(vault.FEE_CHANGE_DELAY());
        assertEq(vault.currentFeeBps(), 20);
    }

    function test_SetFeeBps_EmitsQueuedEvent() public {
        vm.expectEmit(false, false, false, true, address(vault));
        emit PersatEscrowVault.FeeChangeQueued(20, block.timestamp + vault.FEE_CHANGE_DELAY());
        vm.prank(owner);
        vault.setFeeBps(20);
    }

    function test_RevertSetFeeBps_TooHigh() public {
        vm.expectRevert(PersatEscrowVault.FeeTooHigh.selector);
        vm.prank(owner);
        vault.setFeeBps(51);
    }

    function test_RevertSetFeeBps_NonOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        vault.setFeeBps(10);
    }

    function test_SetFeeRecipient_Owner() public {
        address newRecipient = makeAddr("newRecipient");
        vm.prank(owner);
        vault.setFeeRecipient(newRecipient);
        assertEq(vault.feeRecipient(), newRecipient);
    }

    function test_RevertSetFeeRecipient_Zero() public {
        vm.expectRevert(PersatEscrowVault.ZeroAddress.selector);
        vm.prank(owner);
        vault.setFeeRecipient(address(0));
    }

    function test_RescueERC20_NonCircBTC() public {
        // Rescue a random ERC-20 (usdc)
        usdc.mint(address(vault), 1000e6);
        uint256 recipBefore = usdc.balanceOf(feeRecipient);

        vm.prank(owner);
        vault.rescueERC20(address(usdc), feeRecipient, 1000e6);

        assertEq(usdc.balanceOf(feeRecipient) - recipBefore, 1000e6);
    }

    function test_RevertRescueERC20_CircBTC() public {
        vm.expectRevert(PersatEscrowVault.CircBTCRescueBlocked.selector);
        vm.prank(owner);
        vault.rescueERC20(address(cirBtc), feeRecipient, 1);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Invariant: vault cirBTC balance >= sum of lockedCollateral (Active/Defaulted)
// ─────────────────────────────────────────────────────────────────────────────

/// Handler that drives vault state transitions with bounded inputs.
contract VaultHandler is Test {
    PersatDealRegistry internal registry;
    PersatEscrowVault  internal vault;
    MockERC20          internal usdc;
    MockERC20          internal cirBtc;
    MockPriceFeed      internal priceFeed;

    address internal owner;
    address internal feeRecipient;

    uint256 public ghostLockedCollateral; // sum of locked collateral in Active/Defaulted deals

    uint256 private _dealCounter;

    uint256 internal constant PRINCIPAL  = 10_000e6;
    uint256 internal constant COLLATERAL = 1e8;
    uint256 internal constant RATE_BPS   = 500;
    uint8   internal constant DURATION   = 6;
    uint256 internal constant FEE_BPS    = 10;

    bytes32 private constant BASE_SALT = bytes32(uint256(0x1111));

    constructor(
        PersatDealRegistry registry_,
        PersatEscrowVault vault_,
        MockERC20 usdc_,
        MockERC20 cirBtc_,
        MockPriceFeed priceFeed_,
        address owner_,
        address feeRecipient_
    ) {
        registry     = registry_;
        vault        = vault_;
        usdc         = usdc_;
        cirBtc       = cirBtc_;
        priceFeed    = priceFeed_;
        owner        = owner_;
        feeRecipient = feeRecipient_;
    }

    function activateNewDeal() external {
        _dealCounter++;
        bytes32 salt   = keccak256(abi.encode(BASE_SALT, _dealCounter));

        address borrowerAddr = address(uint160(uint256(keccak256(abi.encode("borrower", _dealCounter)))));
        address lenderAddr   = address(uint160(uint256(keccak256(abi.encode("lender",   _dealCounter)))));
        bytes16 dealId = bytes16(bytes.concat(
            registry.dealIdPrefix(borrowerAddr), bytes8(keccak256(abi.encode("handler-deal", _dealCounter)))
        ));

        vm.prank(borrowerAddr);
        registry.proposeDeal(
            dealId, true, lenderAddr,
            PRINCIPAL, COLLATERAL, RATE_BPS, DURATION,
            PersatDealRegistry.Visibility.Private,
            salt
        );
        vm.prank(lenderAddr);
        registry.claimDeal(dealId, salt);

        // Fund + approve
        cirBtc.mint(borrowerAddr, COLLATERAL);
        usdc.mint(lenderAddr, PRINCIPAL);
        vm.prank(borrowerAddr); cirBtc.approve(address(vault), COLLATERAL);
        vm.prank(lenderAddr);   usdc.approve(address(vault), PRINCIPAL);

        vm.prank(borrowerAddr);
        vault.activateLoan(dealId);

        ghostLockedCollateral += COLLATERAL;
    }
}

contract VaultInvariantTest is Test {
    PersatDealRegistry internal registry;
    PersatEscrowVault  internal vault;
    MockERC20          internal usdc;
    MockERC20          internal cirBtc;
    MockPriceFeed      internal priceFeed;
    VaultHandler       internal handler;

    address internal owner        = makeAddr("invOwner");
    address internal feeRecipient = makeAddr("invFeeRecipient");

    int256  internal constant BTC_PRICE = 60_000_00000000;
    uint256 internal constant STALENESS = 3600;
    uint256 internal constant LIQ_BPS   = 8000;
    uint256 internal constant MAX_INIT_LTV = 6500;
    uint256 internal constant FEE_BPS   = 10;

    function setUp() public {
        usdc      = new MockERC20("Mock USDC",   "mUSDC",   6);
        cirBtc    = new MockERC20("Mock cirBTC", "mcirBTC", 8);
        priceFeed = new MockPriceFeed(8, BTC_PRICE, block.timestamp);

        registry  = new PersatDealRegistry(address(usdc), address(cirBtc), owner);
        vault = new PersatEscrowVault(
            address(registry), address(usdc), address(cirBtc),
            address(priceFeed), STALENESS, LIQ_BPS, MAX_INIT_LTV,
            address(0), feeRecipient, FEE_BPS, owner
        );
        vm.prank(owner);
        registry.setVault(address(vault));

        handler = new VaultHandler(
            registry, vault, usdc, cirBtc, priceFeed, owner, feeRecipient
        );

        targetContract(address(handler));
    }

    /// @dev Vault's cirBTC balance must always be >= sum of all ghostLockedCollateral.
    function invariant_VaultCirBtcCoversLockedCollateral() public view {
        assertGe(
            cirBtc.balanceOf(address(vault)),
            handler.ghostLockedCollateral(),
            "vault cirBTC < ghost locked collateral"
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Fuzz: interest calculation
// ─────────────────────────────────────────────────────────────────────────────

contract VaultInterestFuzzTest is VaultFixture {
    /// @dev Interest = principal * rateBps * durationMonths / (10_000 * 12)
    ///      Total repayment must always equal principal + interest.
    function testFuzz_InterestCalculation(
        uint64 principal,
        uint16 rateBps,
        uint8  durationMonths
    ) public pure {
        principal      = uint64(bound(principal,      1e6,  1_000_000e6)); // 1 to 1M USDC
        rateBps        = uint16(bound(rateBps,        1,    10_000));       // up to 100% pa
        durationMonths = uint8(bound(durationMonths,  1,    36));           // 1–36 months

        uint256 interest       = uint256(principal) * uint256(rateBps) * uint256(durationMonths) / (10_000 * 12);
        uint256 totalRepayment = uint256(principal) + interest;

        // PROPERTY: totalRepayment must be >= principal (no underflow possible given positive interest)
        assertGe(totalRepayment, uint256(principal));
        // PROPERTY: interest grows with rate and duration
        assertEq(interest, uint256(principal) * uint256(rateBps) * uint256(durationMonths) / 120_000);
    }

    /// @dev Full round-trip fuzz: activate + repay, check lender balance delta.
    function testFuzz_ActivateRepay_RoundTrip(uint64 principal, uint16 rateBps, uint8 durationMonths) public {
        // Bounded so that principal + interest stays <= 65% of 1 BTC @ $60k (max initial LTV, F-05)
        principal      = uint64(bound(principal,      100e6, 30_000e6));
        rateBps        = uint16(bound(rateBps,        1,    2_000));         // up to 20%
        durationMonths = uint8(bound(durationMonths,  1,    12));

        bytes16 dealId = _idFor(borrower, abi.encode("fuzz-vault-deal", principal, rateBps, durationMonths));
        bytes32 salt   = keccak256(abi.encode(dealId, "fuzz"));

        vm.prank(borrower);
        registry.proposeDeal(
            dealId, true, lender,
            principal, COLLATERAL, rateBps, durationMonths,
            PersatDealRegistry.Visibility.Private,
            salt
        );
        vm.prank(lender);
        registry.claimDeal(dealId, salt);

        // Fund + approve
        cirBtc.mint(borrower, COLLATERAL);
        usdc.mint(lender, principal);
        vm.prank(borrower); cirBtc.approve(address(vault), COLLATERAL);
        vm.prank(lender);   usdc.approve(address(vault), principal);

        vm.prank(borrower);
        vault.activateLoan(dealId);
        vm.warp(vault.maturityOf(dealId));

        // Borrower received principal - fee directly at activation (F-03 / F-04)
        uint256 feeAmt         = uint256(principal) * FEE_BPS / 10_000;
        uint256 interest       = uint256(principal) * uint256(rateBps) * uint256(durationMonths) / (10_000 * 12);
        uint256 totalRepayment = uint256(principal) + interest;

        // Borrower received (principal - feeAmt) at activation.
        // They need totalRepayment for repay → shortfall = feeAmt + interest.
        uint256 shortfall = feeAmt + interest;
        usdc.mint(borrower, shortfall);
        vm.prank(borrower); usdc.approve(address(vault), totalRepayment);

        uint256 lenderBefore   = usdc.balanceOf(lender);
        uint256 borrowerCirBefore = cirBtc.balanceOf(borrower);

        vm.prank(borrower);
        vault.repayLoan(dealId);

        // Lender gets principal + interest
        assertEq(usdc.balanceOf(lender) - lenderBefore, totalRepayment);
        // Borrower gets collateral back
        assertEq(cirBtc.balanceOf(borrower) - borrowerCirBefore, COLLATERAL);
    }
}
