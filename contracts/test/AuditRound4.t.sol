// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PersatDealRegistry} from "../PersatDealRegistry.sol";
import {PersatEscrowVault} from "../PersatEscrowVault.sol";
import {AuditRound2Test} from "./AuditRound2.t.sol";

contract AuditRound4Test is AuditRound2Test {
    function test_R4_MinimumPrincipal() public {
        bytes16 small = _id(borrower, "r4-small");
        vm.prank(borrower);
        vm.expectRevert(PersatDealRegistry.PrincipalTooLow.selector);
        registry.proposeDeal(small, true, address(0), 99e6, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Public, bytes32(0));

        bytes16 id = _proposePublic("r4-min");
        vm.prank(lender);
        vm.expectRevert(PersatDealRegistry.PrincipalTooLow.selector);
        registry.submitCounterOffer(id, 99e6, COLLATERAL, RATE_BPS, DURATION);
    }

    function test_R4_InvitationsAreKeptApartFromUserDeals() public {
        bytes16 id = _id(borrower, "r4-inv");
        vm.prank(borrower);
        registry.proposeDeal(id, true, lender, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION, PersatDealRegistry.Visibility.Private, bytes32("s"));

        assertEq(registry.userDealCount(lender), 0);
        assertEq(registry.invitationCount(lender), 1);
        assertEq(registry.getInvitations(lender, 0, 10)[0], id);

        vm.prank(lender);
        registry.claimDeal(id, bytes32("s"));
        assertEq(registry.userDealCount(lender), 1);
        assertEq(registry.getUserDeals(lender, 0, 10)[0], id);
    }

    function test_R4_OpenPublicIndexOnlyHoldsOpenOrders() public {
        bytes16 a = _proposePublic("r4-open-a");
        bytes16 b = _proposePublic("r4-open-b");
        bytes16 c = _proposePublic("r4-open-c");
        assertEq(registry.openPublicDealCount(), 3);

        vm.prank(borrower);
        registry.cancelDeal(a);
        vm.prank(lender);
        registry.submitCounterOffer(b, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
        vm.prank(borrower);
        registry.acceptCounterOffer(b, 0);

        assertEq(registry.openPublicDealCount(), 1);
        assertEq(registry.getOpenPublicDeals(0, 10)[0], c);
        assertEq(registry.publicDealCount(), 3);
    }

    function test_R4_ActiveOfferReadStaysBounded() public {
        bytes16 id = _proposePublic("r4-grow");
        for (uint256 i = 0; i < 200; i++) {
            vm.startPrank(griefer);
            registry.submitCounterOffer(id, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
            registry.cancelCounterOffer(id, i);
            vm.stopPrank();
        }
        vm.prank(lender);
        registry.submitCounterOffer(id, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);

        PersatDealRegistry.CounterOffer[] memory active = registry.getActiveCounterOffers(id);
        assertEq(active.length, 1);
        assertEq(active[0].proposer, lender);
        assertEq(registry.counterOfferCount(id), 201);
        assertEq(registry.getCounterOffersPage(id, 195, 10).length, 6);
    }

    function test_R4_CreatorRejectsOfferAndProposerCannotRetry() public {
        bytes16 id = _proposePublic("r4-reject");
        vm.prank(griefer);
        registry.submitCounterOffer(id, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);

        vm.prank(keeper);
        vm.expectRevert(PersatDealRegistry.Unauthorized.selector);
        registry.rejectCounterOffer(id, 0);

        vm.prank(borrower);
        registry.rejectCounterOffer(id, 0);
        assertEq(registry.activeCounterOffers(id), 0);
        assertEq(registry.getActiveCounterOffers(id).length, 0);

        vm.prank(griefer);
        vm.expectRevert(PersatDealRegistry.ProposerRejected.selector);
        registry.submitCounterOffer(id, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
    }

    function test_R4_OffersExpireAfterSevenDays() public {
        bytes16 id = _proposePublic("r4-expire");
        vm.prank(lender);
        registry.submitCounterOffer(id, PRINCIPAL, COLLATERAL, RATE_BPS, DURATION);
        assertEq(registry.getActiveCounterOffers(id)[0].expiresAt, block.timestamp + 7 days);

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(borrower);
        vm.expectRevert(PersatDealRegistry.OfferExpired.selector);
        registry.acceptCounterOffer(id, 0);

        vm.prank(lender);
        registry.cancelCounterOffer(id, 0);
        assertEq(registry.activeCounterOffers(id), 0);
    }

    function test_R4_BorrowerAddsCollateralToAvoidLiquidation() public {
        bytes16 id = _activate("r4-topup");
        feed.setAnswer(11_800e8);
        feed.setFresh();

        vm.prank(keeper);
        vm.expectRevert(PersatEscrowVault.NotBorrower.selector);
        vault.addCollateral(id, 5e7);

        vm.prank(borrower);
        vault.addCollateral(id, 5e7);
        assertEq(vault.lockedCollateral(id), COLLATERAL + 5e7);

        vm.prank(keeper);
        vm.expectRevert(PersatEscrowVault.LTVHealthy.selector);
        vault.liquidate(id);

        uint256 before = cirBtc.balanceOf(borrower);
        vm.prank(borrower);
        vault.repayLoan(id);
        assertEq(cirBtc.balanceOf(borrower) - before, COLLATERAL + 5e7);
    }

    function test_R4_LiquidationPauseIsBoundedAndFollowedByGrace() public {
        bytes16 id = _activate("r4-liqpause");
        feed.setAnswer(11_800e8);
        feed.setFresh();

        vm.prank(keeper);
        vm.expectRevert();
        vault.pauseLiquidations(2 hours);

        vm.startPrank(owner);
        vm.expectRevert(PersatEscrowVault.LiquidationPauseTooLong.selector);
        vault.pauseLiquidations(25 hours);
        vault.pauseLiquidations(2 hours);
        vm.stopPrank();
        uint256 until = block.timestamp + 2 hours + 6 hours;
        assertEq(vault.liquidationsPausedUntil(), until);

        vm.warp(until - 1);
        feed.setFresh();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PersatEscrowVault.LiquidationsPaused.selector, until));
        vault.liquidate(id);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PersatEscrowVault.LiquidationPauseCooldown.selector, until + 3 days));
        vault.pauseLiquidations(1 hours);

        vm.warp(until);
        feed.setFresh();
        vm.prank(keeper);
        vault.liquidate(id);
        assertEq(uint8(registry.getDeal(id).state), uint8(PersatDealRegistry.DealState.Liquidated));

        vm.warp(until + 3 days);
        vm.prank(owner);
        vault.pauseLiquidations(1 hours);
    }

    function test_R4_RenounceOwnershipIsDisabled() public {
        vm.startPrank(owner);
        vm.expectRevert(PersatDealRegistry.RenounceDisabled.selector);
        registry.renounceOwnership();
        vm.expectRevert(PersatEscrowVault.RenounceDisabled.selector);
        vault.renounceOwnership();
        vm.stopPrank();
        assertEq(registry.owner(), owner);
        assertEq(vault.owner(), owner);
    }

    function test_R4_LenderCanActivateOnceBorrowerApproved() public {
        bytes16 id = _confirm("r4-lender-activates");
        uint256 borrowerUsdc = usdc.balanceOf(borrower);

        vm.prank(keeper);
        vm.expectRevert(PersatEscrowVault.NotDealParty.selector);
        vault.activateLoan(id);

        vm.prank(borrower);
        cirBtc.approve(address(vault), 0);
        vm.prank(lender);
        vm.expectRevert();
        vault.activateLoan(id);

        vm.prank(borrower);
        cirBtc.approve(address(vault), COLLATERAL);
        vm.prank(lender);
        vault.activateLoan(id);

        assertEq(uint8(registry.getDeal(id).state), uint8(PersatDealRegistry.DealState.Active));
        assertEq(vault.lockedCollateral(id), COLLATERAL);
        assertEq(usdc.balanceOf(borrower) - borrowerUsdc, PRINCIPAL - PRINCIPAL * FEE_BPS / 10_000);
    }
}
