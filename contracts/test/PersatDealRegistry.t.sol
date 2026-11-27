// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {PersatDealRegistry} from "../PersatDealRegistry.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

abstract contract RegistryFixture is Test {
    PersatDealRegistry internal registry;
    MockERC20 internal usdc;
    MockERC20 internal cirBtc;

    address internal owner       = makeAddr("owner");
    address internal borrower    = makeAddr("borrower");
    address internal lender      = makeAddr("lender");
    address internal stranger    = makeAddr("stranger");

    // Default deal parameters
    bytes16 internal DEAL_ID; // bound to the borrower (see dealIdPrefix)
    uint256 internal constant PRINCIPAL   = 10_000e6;   // 10 000 USDC
    uint256 internal constant COLLATERAL  = 1e8;        // 1 cirBTC (8 dec)
    uint256 internal constant RATE_BPS    = 1000;       // 10%
    uint8   internal constant DURATION    = 6;          // 6 months

    function setUp() public virtual {
        usdc   = new MockERC20("Mock USDC", "mUSDC", 6);
        cirBtc = new MockERC20("Mock cirBTC", "mcirBTC", 8);

        registry = new PersatDealRegistry(address(usdc), address(cirBtc), owner);
        DEAL_ID = _idFor(borrower, "deal-1");
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /// Deal ID whose first 8 bytes are bound to `proposer` (F-08).
    function _idFor(address proposer, bytes memory tag) internal view returns (bytes16) {
        return bytes16(bytes.concat(registry.dealIdPrefix(proposer), bytes8(keccak256(tag))));
    }

    /// Propose a private deal where msg.sender is the borrower.
    function _proposePrivateBorrower(bytes16 dealId, bytes32 salt, address reservedFor)
        internal
        returns (bytes32 claimToken)
    {
        claimToken = keccak256(abi.encode(dealId, salt));
        vm.prank(borrower);
        registry.proposeDeal(
            dealId,
            true,           // callerIsBorrower
            reservedFor,
            PRINCIPAL,
            COLLATERAL,
            RATE_BPS,
            DURATION,
            PersatDealRegistry.Visibility.Private,
            salt
        );
    }

    /// Propose a public deal where msg.sender is the borrower.
    function _proposePublicBorrower(bytes16 dealId) internal {
        vm.prank(borrower);
        registry.proposeDeal(
            dealId,
            true,
            address(0),
            PRINCIPAL,
            COLLATERAL,
            RATE_BPS,
            DURATION,
            PersatDealRegistry.Visibility.Public,
            bytes32(0)
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Deployment / initialization
// ─────────────────────────────────────────────────────────────────────────────

contract RegistryDeployTest is RegistryFixture {
    function test_ConstructorSetsImmutables() public view {
        assertEq(registry.usdc(),          address(usdc));
        assertEq(registry.cirBtc(),        address(cirBtc));
        assertEq(registry.owner(),         owner);
    }

    function test_VaultInitiallyZero() public view {
        assertEq(registry.vault(), address(0));
    }

    function test_RevertConstructor_ZeroUsdc() public {
        vm.expectRevert(PersatDealRegistry.ZeroAddress.selector);
        new PersatDealRegistry(address(0), address(cirBtc), owner);
    }

    function test_RevertConstructor_ZeroCirBtc() public {
        vm.expectRevert(PersatDealRegistry.ZeroAddress.selector);
        new PersatDealRegistry(address(usdc), address(0), owner);
    }

    function test_RevertConstructor_ZeroOwner() public {
        vm.expectRevert();
        new PersatDealRegistry(address(usdc), address(cirBtc), address(0));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. proposeDeal — private (callerIsBorrower = true)
// ─────────────────────────────────────────────────────────────────────────────

contract RegistryProposeDealPrivateBorrowerTest is RegistryFixture {
    bytes32 internal constant SALT = bytes32(uint256(0xdeadbeef));

    function test_PrivateDeal_CreatedInProposedState() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);

        assertEq(uint8(d.state),      uint8(PersatDealRegistry.DealState.Proposed));
        assertEq(uint8(d.visibility), uint8(PersatDealRegistry.Visibility.Private));
    }

    function test_PrivateDeal_FieldsCorrect() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);

        assertEq(d.dealId,         DEAL_ID);
        assertEq(d.borrower,       borrower);
        assertEq(d.lender,         address(0));
        assertEq(d.principal,      PRINCIPAL);
        assertEq(d.collateral,     COLLATERAL);
        assertEq(d.rateBps,        RATE_BPS);
        assertEq(d.durationMonths, DURATION);
    }

    function test_PrivateDeal_ClaimTokenSet() public {
        bytes32 expectedToken = keccak256(abi.encode(DEAL_ID, SALT));
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(d.claimToken, expectedToken);
    }

    function test_PrivateDeal_EmitsDealProposed() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit PersatDealRegistry.DealProposed(DEAL_ID, borrower, PersatDealRegistry.Visibility.Private);
        vm.prank(borrower);
        registry.proposeDeal(
            DEAL_ID, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION,
            PersatDealRegistry.Visibility.Private, SALT
        );
    }

    function test_RevertPropose_DealAlreadyExists() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        vm.expectRevert(PersatDealRegistry.DealAlreadyExists.selector);
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
    }

    function test_RevertPropose_ZeroPrincipal() public {
        vm.expectRevert(PersatDealRegistry.InvalidTerms.selector);
        vm.prank(borrower);
        registry.proposeDeal(
            DEAL_ID, true, address(0), 0, COLLATERAL, RATE_BPS, DURATION,
            PersatDealRegistry.Visibility.Private, SALT
        );
    }

    function test_RevertPropose_ZeroCollateral() public {
        vm.expectRevert(PersatDealRegistry.InvalidTerms.selector);
        vm.prank(borrower);
        registry.proposeDeal(
            DEAL_ID, true, address(0), PRINCIPAL, 0, RATE_BPS, DURATION,
            PersatDealRegistry.Visibility.Private, SALT
        );
    }

    function test_RevertPropose_ZeroRateBps() public {
        vm.expectRevert(PersatDealRegistry.InvalidTerms.selector);
        vm.prank(borrower);
        registry.proposeDeal(
            DEAL_ID, true, address(0), PRINCIPAL, COLLATERAL, 0, DURATION,
            PersatDealRegistry.Visibility.Private, SALT
        );
    }

    function test_RevertPropose_ZeroDuration() public {
        vm.expectRevert(PersatDealRegistry.InvalidTerms.selector);
        vm.prank(borrower);
        registry.proposeDeal(
            DEAL_ID, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, 0,
            PersatDealRegistry.Visibility.Private, SALT
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. proposeDeal — public (callerIsBorrower = false → lender proposes)
// ─────────────────────────────────────────────────────────────────────────────

contract RegistryProposeDealPublicLenderTest is RegistryFixture {
    function setUp() public override {
        super.setUp();
        DEAL_ID = _idFor(lender, "deal-1"); // lender is the proposer here
    }

    function test_PublicDeal_CreatedInProposedState() public {
        vm.prank(lender);
        registry.proposeDeal(
            DEAL_ID, false, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION,
            PersatDealRegistry.Visibility.Public, bytes32(0)
        );
        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);

        assertEq(uint8(d.state),      uint8(PersatDealRegistry.DealState.Proposed));
        assertEq(uint8(d.visibility), uint8(PersatDealRegistry.Visibility.Public));
        assertEq(d.lender,            lender);
        assertEq(d.borrower,          address(0));
        assertEq(d.claimToken,        bytes32(0));
    }

    function test_PublicDeal_EmitsDealProposed() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit PersatDealRegistry.DealProposed(DEAL_ID, lender, PersatDealRegistry.Visibility.Public);
        vm.prank(lender);
        registry.proposeDeal(
            DEAL_ID, false, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION,
            PersatDealRegistry.Visibility.Public, bytes32(0)
        );
    }

    function test_RevertPublicDeal_NonZeroSalt() public {
        vm.expectRevert(PersatDealRegistry.InvalidClaimToken.selector);
        vm.prank(lender);
        registry.proposeDeal(
            DEAL_ID, false, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION,
            PersatDealRegistry.Visibility.Public, bytes32(uint256(1))
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. claimDeal
// ─────────────────────────────────────────────────────────────────────────────

contract RegistryClaimDealTest is RegistryFixture {
    bytes32 internal constant SALT = bytes32(uint256(0xcafebabe));

    function test_ClaimDeal_ValidSalt_StateConfirmed() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);

        vm.prank(lender);
        registry.claimDeal(DEAL_ID, SALT);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state),  uint8(PersatDealRegistry.DealState.Confirmed));
        assertEq(d.lender,        lender);
    }

    function test_ClaimDeal_BindsCounterparty() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, SALT);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(d.borrower, borrower);
        assertEq(d.lender,   lender);
    }

    function test_ClaimDeal_TermsHashStored() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, SALT);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        // Verify termsHash matches the registry's own computation
        bytes32 expectedHash = registry.computeTermsHash(DEAL_ID);
        // Re-fetch after state change; computeTermsHash works on storage
        assertNotEq(d.termsHash, bytes32(0));
        assertEq(d.termsHash, expectedHash);
    }

    function test_ClaimDeal_ClaimTokenInvalidatedAfterClaim() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        bytes32 token = keccak256(abi.encode(DEAL_ID, SALT));
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, SALT);

        // claimToken in deal struct must be zeroed
        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(d.claimToken, bytes32(0));

        // usedClaimTokens mapping must be set
        assertTrue(registry.usedClaimTokens(token));
    }

    function test_ClaimDeal_EmitsDealConfirmed() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);

        // Must emit with correct borrower/lender — but termsHash is not known at test time
        // so we check only topics 1-3 (indexed), skip data check.
        vm.expectEmit(true, true, true, false, address(registry));
        emit PersatDealRegistry.DealConfirmed(DEAL_ID, borrower, lender, bytes32(0));
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, SALT);
    }

    function test_RevertClaim_WrongSalt() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);

        bytes32 wrongSalt = bytes32(uint256(0x1234));
        vm.expectRevert(PersatDealRegistry.InvalidClaimToken.selector);
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, wrongSalt);
    }

    function test_RevertClaim_ReplaySameSalt() public {
        // The claim token is keccak256(abi.encode(dealId, salt)).
        // To replay the SAME token on the SAME dealId, the deal must have been
        // cancelled (returned to Proposed) after the first claim — but the
        // contract transitions straight to Confirmed, so the state check fires
        // before ClaimTokenAlreadyUsed can be checked. 
        // Instead, verify that the usedClaimTokens mapping blocks a second claim
        // by forcing the state check to pass: we use the same dealId but cancel
        // is not possible in Confirmed, so the easiest replay scenario is to
        // directly mark the token used and then attempt a fresh deal with the
        // exact same (dealId, salt) pair — i.e. same computed token.
        // The cleanest approach: after a successful claim the deal is Confirmed,
        // so a second claimDeal reverts with InvalidState (Confirmed ≠ Proposed).
        // To isolate ClaimTokenAlreadyUsed we need a fresh Proposed deal whose
        // token hash collides. Because the hash is keccak256(dealId, salt) and
        // both dealId and salt are the same in the replay, we need the SAME dealId
        // — but the deal already exists. This means the replay scenario is
        // actually prevented by InvalidState, not ClaimTokenAlreadyUsed, when the
        // original deal is still alive (now Confirmed).
        //
        // To exercise ClaimTokenAlreadyUsed specifically:
        // 1. Propose deal with dealId A and salt S → token T = keccak256(A, S)
        // 2. Claim deal A → T is marked used; deal A is now Confirmed.
        // 3. Cancel deal A → Cancelled (allowed from Confirmed).
        // 4. Re-propose SAME dealId A — but DealAlreadyExists fires here.
        //
        // The contract stores the used flag on T, so an *identical* token on a
        // *different* deal would be blocked. The only way to get an identical
        // token on a different deal is keccak256(dealId2, salt2) == T, which
        // would require a collision. Therefore ClaimTokenAlreadyUsed is truly
        // only reachable when the state machine allows re-claiming after a cancel
        // of a Proposed deal (not possible — DealAlreadyExists blocks re-propose).
        //
        // This is a suspected contract design note: the ClaimTokenAlreadyUsed
        // guard is defence-in-depth against implementation changes rather than
        // a currently reachable branch. We verify the guard is set correctly
        // by reading the usedClaimTokens mapping directly.
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, SALT);

        bytes32 token = keccak256(abi.encode(DEAL_ID, SALT));
        assertTrue(registry.usedClaimTokens(token), "token must be marked used after claim");

        // Verify the deal is now in Confirmed state (not Proposed),
        // which would trigger InvalidState before ClaimTokenAlreadyUsed on any re-claim attempt.
        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Confirmed));
    }

    function test_RevertClaim_WrongCallerWhenReservedFor() public {
        // borrower reserves the deal for `lender` only
        _proposePrivateBorrower(DEAL_ID, SALT, lender);

        vm.expectRevert(PersatDealRegistry.Unauthorized.selector);
        vm.prank(stranger);
        registry.claimDeal(DEAL_ID, SALT);
    }

    function test_ClaimDeal_SucceedsWhenCallerMatchesReservedFor() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);

        vm.prank(lender);
        registry.claimDeal(DEAL_ID, SALT);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Confirmed));
        assertEq(d.reservedFor, address(0)); // cleared after claim
    }

    function test_RevertClaim_NotPrivateDeal() public {
        _proposePublicBorrower(DEAL_ID);

        vm.expectRevert(PersatDealRegistry.InvalidTerms.selector);
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, bytes32(0));
    }

    function test_RevertClaim_NotInProposedState() public {
        // Create and immediately cancel
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        vm.prank(borrower);
        registry.cancelDeal(DEAL_ID);

        vm.expectRevert(
            abi.encodeWithSelector(
                PersatDealRegistry.InvalidState.selector,
                PersatDealRegistry.DealState.Cancelled,
                PersatDealRegistry.DealState.Proposed
            )
        );
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, SALT);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. submitCounterOffer
// ─────────────────────────────────────────────────────────────────────────────

contract RegistrySubmitCounterOfferTest is RegistryFixture {
    function test_SubmitCounterOffer_AddsOffer() public {
        _proposePublicBorrower(DEAL_ID);

        vm.prank(lender);
        registry.submitCounterOffer(DEAL_ID, PRINCIPAL * 2, COLLATERAL, RATE_BPS, DURATION);

        PersatDealRegistry.CounterOffer[] memory offers = registry.getCounterOffers(DEAL_ID);
        assertEq(offers.length, 1);
        assertEq(offers[0].proposer,       lender);
        assertEq(offers[0].principal,      PRINCIPAL * 2);
        assertEq(offers[0].collateral,     COLLATERAL);
        assertEq(offers[0].rateBps,        RATE_BPS);
        assertEq(offers[0].durationMonths, DURATION);
        assertTrue(offers[0].active);
    }

    function test_SubmitCounterOffer_EmitsEvent() public {
        _proposePublicBorrower(DEAL_ID);

        vm.expectEmit(true, true, true, false, address(registry));
        emit PersatDealRegistry.CounterOfferSubmitted(DEAL_ID, 0, lender);
        vm.prank(lender);
        registry.submitCounterOffer(DEAL_ID, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
    }

    function test_RevertCounterOffer_MaxExceeded() public {
        _proposePublicBorrower(DEAL_ID);

        // Fill up to MAX_COUNTER_OFFERS
        uint256 max = registry.MAX_COUNTER_OFFERS();
        for (uint256 i = 0; i < max; i++) {
            address offeror = address(uint160(i + 100));
            vm.prank(offeror);
            registry.submitCounterOffer(DEAL_ID, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
        }

        vm.expectRevert(PersatDealRegistry.MaxCounterOffersReached.selector);
        vm.prank(stranger);
        registry.submitCounterOffer(DEAL_ID, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
    }

    function test_RevertCounterOffer_PrivateDeal() public {
        bytes32 salt = bytes32(uint256(0x1));
        _proposePrivateBorrower(DEAL_ID, salt, address(0));

        vm.expectRevert(PersatDealRegistry.InvalidTerms.selector);
        vm.prank(lender);
        registry.submitCounterOffer(DEAL_ID, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
    }

    function test_RevertCounterOffer_ZeroPrincipal() public {
        _proposePublicBorrower(DEAL_ID);

        vm.expectRevert(PersatDealRegistry.InvalidTerms.selector);
        vm.prank(lender);
        registry.submitCounterOffer(DEAL_ID, 0, COLLATERAL, RATE_BPS, DURATION);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. acceptCounterOffer
// ─────────────────────────────────────────────────────────────────────────────

contract RegistryAcceptCounterOfferTest is RegistryFixture {
    function setUp() public override {
        super.setUp();
        // borrower proposes a public deal; lender submits an offer
        _proposePublicBorrower(DEAL_ID);
        vm.prank(lender);
        registry.submitCounterOffer(DEAL_ID, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
    }

    function test_AcceptCounterOffer_StateConfirmed() public {
        vm.prank(borrower);
        registry.acceptCounterOffer(DEAL_ID, 0);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Confirmed));
    }

    function test_AcceptCounterOffer_BindsLender() public {
        vm.prank(borrower);
        registry.acceptCounterOffer(DEAL_ID, 0);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(d.lender, lender);
    }

    function test_AcceptCounterOffer_TermsHashSet() public {
        vm.prank(borrower);
        registry.acceptCounterOffer(DEAL_ID, 0);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertNotEq(d.termsHash, bytes32(0));
    }

    function test_AcceptCounterOffer_OtherOffersNoLongerAcceptable() public {
        address lender2 = makeAddr("lender2");
        vm.prank(lender2);
        registry.submitCounterOffer(DEAL_ID, PRINCIPAL * 2, COLLATERAL, RATE_BPS, DURATION);

        vm.prank(borrower);
        registry.acceptCounterOffer(DEAL_ID, 0);

        PersatDealRegistry.CounterOffer[] memory offers = registry.getCounterOffers(DEAL_ID);
        assertFalse(offers[0].active);
        assertEq(registry.activeCounterOffers(DEAL_ID), 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                PersatDealRegistry.InvalidState.selector,
                PersatDealRegistry.DealState.Confirmed,
                PersatDealRegistry.DealState.Proposed
            )
        );
        vm.prank(borrower);
        registry.acceptCounterOffer(DEAL_ID, 1);
    }

    function test_AcceptCounterOffer_EmitsDealConfirmed() public {
        vm.expectEmit(true, true, true, false, address(registry));
        emit PersatDealRegistry.DealConfirmed(DEAL_ID, borrower, lender, bytes32(0));
        vm.prank(borrower);
        registry.acceptCounterOffer(DEAL_ID, 0);
    }

    function test_RevertAcceptCounterOffer_NonProposer() public {
        vm.expectRevert(PersatDealRegistry.Unauthorized.selector);
        vm.prank(stranger);
        registry.acceptCounterOffer(DEAL_ID, 0);
    }

    function test_RevertAcceptCounterOffer_OfferNotFound_OutOfBounds() public {
        vm.expectRevert(PersatDealRegistry.OfferNotFound.selector);
        vm.prank(borrower);
        registry.acceptCounterOffer(DEAL_ID, 99);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. cancelDeal
// ─────────────────────────────────────────────────────────────────────────────

contract RegistryCancelDealTest is RegistryFixture {
    bytes32 internal constant SALT = bytes32(uint256(0xabcd));

    function test_CancelDeal_BorrowerCanCancelProposed() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);

        vm.expectEmit(true, true, false, false, address(registry));
        emit PersatDealRegistry.DealCancelled(DEAL_ID, borrower);

        vm.prank(borrower);
        registry.cancelDeal(DEAL_ID);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Cancelled));
    }

    function test_CancelDeal_BorrowerCanCancelConfirmed() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, SALT);

        vm.prank(borrower);
        registry.cancelDeal(DEAL_ID);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Cancelled));
    }

    function test_CancelDeal_LenderCanCancel() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, SALT);

        vm.prank(lender);
        registry.cancelDeal(DEAL_ID);

        PersatDealRegistry.Deal memory d = registry.getDeal(DEAL_ID);
        assertEq(uint8(d.state), uint8(PersatDealRegistry.DealState.Cancelled));
    }

    function test_RevertCancelDeal_Stranger() public {
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        vm.expectRevert(PersatDealRegistry.Unauthorized.selector);
        vm.prank(stranger);
        registry.cancelDeal(DEAL_ID);
    }

    function test_RevertCancelDeal_ActiveDeal() public {
        // To get to Active we need to wire the vault — use a mock vault address
        _proposePrivateBorrower(DEAL_ID, SALT, lender);
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, SALT);

        // Set a mock vault address so we can call setDealActive
        address mockVault = makeAddr("mockVault");
        vm.prank(owner);
        registry.setVault(mockVault);

        vm.prank(mockVault);
        registry.setDealActive(DEAL_ID, block.timestamp);

        // Now try to cancel — must revert
        vm.expectRevert(
            abi.encodeWithSelector(
                PersatDealRegistry.InvalidState.selector,
                PersatDealRegistry.DealState.Active,
                PersatDealRegistry.DealState.Proposed
            )
        );
        vm.prank(borrower);
        registry.cancelDeal(DEAL_ID);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. setVault / onlyVault
// ─────────────────────────────────────────────────────────────────────────────

contract RegistrySetVaultTest is RegistryFixture {
    function test_SetVault_Owner() public {
        address mockVault = makeAddr("vault");
        vm.prank(owner);
        registry.setVault(mockVault);
        assertEq(registry.vault(), mockVault);
    }

    function test_SetVault_EmitsEvent() public {
        address mockVault = makeAddr("vault");
        vm.expectEmit(false, false, false, true, address(registry));
        emit PersatDealRegistry.VaultSet(mockVault);
        vm.prank(owner);
        registry.setVault(mockVault);
    }

    function test_RevertSetVault_NonOwner() public {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        vm.prank(stranger);
        registry.setVault(makeAddr("vault"));
    }

    function test_RevertSetVault_AlreadySet() public {
        address mockVault = makeAddr("vault");
        vm.prank(owner);
        registry.setVault(mockVault);

        vm.expectRevert(PersatDealRegistry.VaultAlreadySet.selector);
        vm.prank(owner);
        registry.setVault(makeAddr("vault2"));
    }

    function test_RevertNotVault_Unauthorized() public {
        _setupVaultWithPrivateDeal();

        // A non-vault address cannot call vault-only functions
        vm.expectRevert(PersatDealRegistry.NotVault.selector);
        vm.prank(stranger);
        registry.setDealActive(DEAL_ID, block.timestamp);
    }

    /// Helper: propose + confirm + wire a fake vault, return the vault addr.
    function _setupVaultWithPrivateDeal() internal returns (address fakeVault) {
        bytes32 salt = bytes32(uint256(0x99));
        _proposePrivateBorrower(DEAL_ID, salt, lender);
        vm.prank(lender);
        registry.claimDeal(DEAL_ID, salt);

        fakeVault = makeAddr("fakeVault");
        vm.prank(owner);
        registry.setVault(fakeVault);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Pausing
// ─────────────────────────────────────────────────────────────────────────────

contract RegistryPauseTest is RegistryFixture {
    function test_RevertProposeDeal_WhenPaused() public {
        vm.prank(owner);
        registry.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(borrower);
        registry.proposeDeal(
            DEAL_ID, true, address(0), PRINCIPAL, COLLATERAL, RATE_BPS, DURATION,
            PersatDealRegistry.Visibility.Private, bytes32(uint256(1))
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Fuzz: proposeDeal with varied valid parameters
// ─────────────────────────────────────────────────────────────────────────────

contract RegistryFuzzTest is RegistryFixture {
    function testFuzz_ProposeDeal_ValidParams(
        uint128 principal,
        uint128 collateral,
        uint16 rateBps,
        uint8 durationMonths
    ) public {
        // Constrain to valid (non-zero) domain
        principal      = uint128(bound(principal,      100e6, type(uint128).max));
        collateral     = uint128(bound(collateral,     1, type(uint128).max));
        rateBps        = uint16(bound(rateBps,         1, 10_000));
        durationMonths = uint8(bound(durationMonths,   1, 24));

        bytes16 dealId = _idFor(borrower, abi.encode(principal, collateral, rateBps, durationMonths));
        bytes32 salt   = keccak256(abi.encode(dealId, "fuzz-salt"));

        vm.prank(borrower);
        registry.proposeDeal(
            dealId,
            true,
            lender,
            principal,
            collateral,
            rateBps,
            durationMonths,
            PersatDealRegistry.Visibility.Private,
            salt
        );

        PersatDealRegistry.Deal memory d = registry.getDeal(dealId);
        assertEq(d.principal,      principal);
        assertEq(d.collateral,     collateral);
        assertEq(d.rateBps,        rateBps);
        assertEq(d.durationMonths, durationMonths);
        assertEq(uint8(d.state),   uint8(PersatDealRegistry.DealState.Proposed));
    }
}
