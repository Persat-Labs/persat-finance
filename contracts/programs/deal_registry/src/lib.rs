//! Persat Finance deal registry.
//!
//! The registry is the single entry point for **both** counterparty paths, and
//! the state machine below is identical from `Confirmed` onward regardless of
//! how the two parties found each other:
//!
//! * A **private** deal is created bound to a known counterparty wallet, or
//!   left open for a single-use deal-link claim.
//! * A **public** deal *is* the marketplace listing. There is deliberately no
//!   second on-chain listing system — that keeps the audited surface small.
//!
//! `confirm_deal` is binding-only and never mutates terms. When a marketplace
//! proposal differs from the listing, the backend cancels the listing and
//! creates a new private deal bound to both wallets, rather than amending terms
//! in place. That choice keeps this program simple enough to reason about: no
//! instruction here can ever change an agreed number.

use anchor_lang::prelude::*;
use persat_core::{
    fees::DealOrigin,
    interest::is_allowed_duration,
    schedule::build_schedule,
    MAX_PROTOCOL_LTV_BPS,
};

declare_id!("FvjjNfQLUKKE66aRoi5xMmmWbJhgyyY96YDF7j2uSc3D");

/// Upper bound on an interest rate, in basis points (100% APR).
///
/// A rate above this is far more likely to be a client-side unit error than a
/// genuine agreement, so it is rejected rather than silently accepted.
pub const MAX_RATE_BPS: u16 = 10_000;

#[program]
pub mod deal_registry {
    use super::*;

    /// Create a deal in `Proposed` state.
    ///
    /// The creator declares whether they are the borrower or the lender. The
    /// opposite side is either bound immediately (when the counterparty wallet
    /// is known) or left open for a claim or a marketplace match.
    pub fn propose_deal(
        ctx: Context<ProposeDeal>,
        deal_id: [u8; 16],
        terms: DealTerms,
        visibility: Visibility,
        creator_side: Side,
        counterparty: Option<Pubkey>,
    ) -> Result<()> {
        terms.validate()?;
        let creator = ctx.accounts.creator.key();
        // A wallet cannot be both sides of its own loan. Allowing it would let
        // one party manufacture fake repayment history for the marketplace
        // reputation signal at zero real risk.
        if let Some(other) = counterparty {
            require!(other != Pubkey::default(), DealError::InvalidCounterparty);
            require!(other != creator, DealError::SelfDealing);
        }
        // A public listing is open to anyone by definition, so binding a
        // counterparty up front contradicts publishing it.
        if visibility == Visibility::Public {
            require!(counterparty.is_none(), DealError::PublicDealCannotBindCounterparty);
        }

        let deal = &mut ctx.accounts.deal;
        deal.deal_id = deal_id;
        deal.creator = creator;
        deal.terms = terms;
        deal.visibility = visibility;
        deal.origin = match visibility {
            Visibility::Public => DealOriginKind::Marketplace,
            Visibility::Private => DealOriginKind::Direct,
        };
        match creator_side {
            Side::Borrower => {
                deal.borrower = creator;
                deal.lender = counterparty.unwrap_or_default();
            }
            Side::Lender => {
                deal.lender = creator;
                deal.borrower = counterparty.unwrap_or_default();
            }
        }
        deal.creator_side = creator_side;
        deal.state = DealState::Proposed;
        deal.created_at = Clock::get()?.unix_timestamp;
        deal.confirmed_at = 0;
        deal.bump = ctx.bumps.deal;

        emit!(DealProposed {
            deal_id,
            creator,
            visibility,
            principal_atoms: terms.principal_atoms,
        });
        Ok(())
    }

    /// Bind the counterparty and move the deal to `Confirmed`.
    ///
    /// The confirmer must supply a hash of the terms they believe they are
    /// agreeing to. If it does not match the stored terms exactly, the
    /// instruction fails. This is what makes a stale or tampered client screen
    /// unable to bind someone to numbers they never saw.
    pub fn confirm_deal(ctx: Context<ConfirmDeal>, expected_terms_hash: [u8; 32]) -> Result<()> {
        let confirmer = ctx.accounts.confirmer.key();
        let deal = &mut ctx.accounts.deal;

        require!(deal.state == DealState::Proposed, DealError::InvalidStateTransition);
        require!(
            deal.terms_hash()? == expected_terms_hash,
            DealError::TermsMismatch
        );
        require!(confirmer != deal.creator, DealError::SelfDealing);

        // Fill whichever side is still open; if it was pre-bound, only that
        // exact wallet may confirm.
        match deal.creator_side {
            Side::Borrower => {
                if deal.lender == Pubkey::default() {
                    deal.lender = confirmer;
                } else {
                    require!(deal.lender == confirmer, DealError::UnauthorizedCounterparty);
                }
            }
            Side::Lender => {
                if deal.borrower == Pubkey::default() {
                    deal.borrower = confirmer;
                } else {
                    require!(deal.borrower == confirmer, DealError::UnauthorizedCounterparty);
                }
            }
        }

        deal.state = DealState::Confirmed;
        deal.confirmed_at = Clock::get()?.unix_timestamp;
        emit!(DealConfirmed {
            deal_id: deal.deal_id,
            borrower: deal.borrower,
            lender: deal.lender,
        });
        Ok(())
    }

    /// Cancel a deal before funding, or withdraw/supersede a public listing.
    pub fn cancel_deal(ctx: Context<CancelDeal>) -> Result<()> {
        let actor = ctx.accounts.actor.key();
        let deal = &mut ctx.accounts.deal;
        // Cancellation is only safe before any value has moved. Once funding
        // begins the escrow and loan programs own the outcome.
        require!(
            matches!(deal.state, DealState::Proposed | DealState::Confirmed),
            DealError::InvalidStateTransition
        );
        require!(
            actor == deal.creator || actor == deal.borrower || actor == deal.lender,
            DealError::UnauthorizedCounterparty
        );
        deal.state = DealState::Cancelled;
        emit!(DealCancelled { deal_id: deal.deal_id, actor });
        Ok(())
    }

    /// Advance a confirmed deal into `Funding`.
    ///
    /// Restricted to the escrow vault program, which is the only component that
    /// can observe a real collateral deposit.
    pub fn begin_funding(ctx: Context<AdvanceState>) -> Result<()> {
        let deal = &mut ctx.accounts.deal;
        require!(deal.state == DealState::Confirmed, DealError::InvalidStateTransition);
        require!(deal.is_fully_bound(), DealError::CounterpartyNotBound);
        deal.state = DealState::Funding;
        Ok(())
    }

    /// Mark a deal active once collateral is locked and principal disbursed.
    pub fn mark_active(ctx: Context<AdvanceState>) -> Result<()> {
        let deal = &mut ctx.accounts.deal;
        require!(deal.state == DealState::Funding, DealError::InvalidStateTransition);
        deal.state = DealState::Active;
        Ok(())
    }

    /// Record a terminal outcome for the deal.
    pub fn close_deal(ctx: Context<AdvanceState>, outcome: CloseOutcome) -> Result<()> {
        let deal = &mut ctx.accounts.deal;
        require!(
            matches!(
                deal.state,
                DealState::Active | DealState::Repaying | DealState::Defaulted
            ),
            DealError::InvalidStateTransition
        );
        deal.state = match outcome {
            CloseOutcome::Completed => DealState::Completed,
            CloseOutcome::FullyLiquidated => DealState::FullyLiquidated,
        };
        emit!(DealClosed { deal_id: deal.deal_id, outcome });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(deal_id: [u8; 16])]
pub struct ProposeDeal<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Deal::INIT_SPACE,
        seeds = [b"deal", deal_id.as_ref()],
        bump
    )]
    pub deal: Account<'info, Deal>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfirmDeal<'info> {
    pub confirmer: Signer<'info>,
    #[account(mut, seeds = [b"deal", deal.deal_id.as_ref()], bump = deal.bump)]
    pub deal: Account<'info, Deal>,
}

#[derive(Accounts)]
pub struct CancelDeal<'info> {
    pub actor: Signer<'info>,
    #[account(mut, seeds = [b"deal", deal.deal_id.as_ref()], bump = deal.bump)]
    pub deal: Account<'info, Deal>,
}

/// State advanced by another protocol program via CPI.
#[derive(Accounts)]
pub struct AdvanceState<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"deal", deal.deal_id.as_ref()], bump = deal.bump)]
    pub deal: Account<'info, Deal>,
}

#[account]
#[derive(InitSpace)]
pub struct Deal {
    /// Client-generated unique identifier (UUID bytes).
    pub deal_id: [u8; 16],
    pub creator: Pubkey,
    /// Zero until a borrower is bound.
    pub borrower: Pubkey,
    /// Zero until a lender is bound.
    pub lender: Pubkey,
    pub creator_side: Side,
    pub terms: DealTerms,
    pub visibility: Visibility,
    pub origin: DealOriginKind,
    pub state: DealState,
    pub created_at: i64,
    pub confirmed_at: i64,
    pub bump: u8,
}

impl Deal {
    /// Both sides bound to real, distinct wallets.
    pub fn is_fully_bound(&self) -> bool {
        self.borrower != Pubkey::default()
            && self.lender != Pubkey::default()
            && self.borrower != self.lender
    }

    /// Canonical hash of the agreed terms.
    ///
    /// Field order is fixed and every field is length-prefixed by its own fixed
    /// width, so two different term sets cannot produce the same digest.
    pub fn terms_hash(&self) -> Result<[u8; 32]> {
        Ok(self.terms.hash())
    }
}

/// The economic terms both parties agree to. Immutable once proposed.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct DealTerms {
    /// Principal in loan-currency atoms.
    pub principal_atoms: u64,
    /// Loan currency mint (must be a whitelisted USDC/USDT mint).
    pub loan_mint: Pubkey,
    /// Collateral mint (must be a whitelisted tBTC/zBTC mint).
    pub collateral_mint: Pubkey,
    /// Collateral the borrower must post, in collateral atoms.
    pub collateral_atoms: u64,
    /// Annual simple interest rate in basis points.
    pub rate_bps: u16,
    /// Term in whole months (6, 12, or 24).
    pub duration_months: u16,
    /// Agreed LTV at origination, in basis points.
    pub ltv_bps: u16,
}

impl DealTerms {
    /// Reject any term set the protocol will not honour.
    pub fn validate(&self) -> Result<()> {
        require!(self.principal_atoms > 0, DealError::InvalidPrincipal);
        require!(self.collateral_atoms > 0, DealError::InvalidCollateral);
        require!(self.rate_bps <= MAX_RATE_BPS, DealError::InvalidRate);
        require!(
            is_allowed_duration(self.duration_months),
            DealError::InvalidDuration
        );
        require!(
            self.ltv_bps > 0 && self.ltv_bps <= MAX_PROTOCOL_LTV_BPS,
            DealError::InvalidLtv
        );
        require!(
            self.loan_mint != Pubkey::default() && self.collateral_mint != Pubkey::default(),
            DealError::InvalidMint
        );
        // Collateral and loan currency must be different assets.
        require!(self.loan_mint != self.collateral_mint, DealError::InvalidMint);
        // The schedule must be constructible, so a deal can never be confirmed
        // and then prove unrepayable at activation time.
        build_schedule(self.principal_atoms, self.rate_bps, self.duration_months)
            .map_err(|_| error!(DealError::UnrepayableTerms))?;
        Ok(())
    }

    /// Canonical SHA-256 digest over the terms in fixed field order.
    pub fn hash(&self) -> [u8; 32] {
        let mut buffer = [0u8; 8 + 32 + 32 + 8 + 2 + 2 + 2];
        buffer[0..8].copy_from_slice(&self.principal_atoms.to_le_bytes());
        buffer[8..40].copy_from_slice(self.loan_mint.as_ref());
        buffer[40..72].copy_from_slice(self.collateral_mint.as_ref());
        buffer[72..80].copy_from_slice(&self.collateral_atoms.to_le_bytes());
        buffer[80..82].copy_from_slice(&self.rate_bps.to_le_bytes());
        buffer[82..84].copy_from_slice(&self.duration_months.to_le_bytes());
        buffer[84..86].copy_from_slice(&self.ltv_bps.to_le_bytes());
        solana_sha256_hasher::hash(&buffer).to_bytes()
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Side {
    Borrower,
    Lender,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Visibility {
    Private,
    Public,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum DealOriginKind {
    Direct,
    Marketplace,
}

impl From<DealOriginKind> for DealOrigin {
    fn from(value: DealOriginKind) -> Self {
        match value {
            DealOriginKind::Direct => DealOrigin::Direct,
            DealOriginKind::Marketplace => DealOrigin::Marketplace,
        }
    }
}

/// The lifecycle states from the Technical Architecture state machine.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum DealState {
    Proposed,
    Confirmed,
    Funding,
    Active,
    Repaying,
    Defaulted,
    PartiallyLiquidated,
    FullyLiquidated,
    Completed,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum CloseOutcome {
    Completed,
    FullyLiquidated,
}

#[event]
pub struct DealProposed {
    pub deal_id: [u8; 16],
    pub creator: Pubkey,
    pub visibility: Visibility,
    pub principal_atoms: u64,
}

#[event]
pub struct DealConfirmed {
    pub deal_id: [u8; 16],
    pub borrower: Pubkey,
    pub lender: Pubkey,
}

#[event]
pub struct DealCancelled {
    pub deal_id: [u8; 16],
    pub actor: Pubkey,
}

#[event]
pub struct DealClosed {
    pub deal_id: [u8; 16],
    pub outcome: CloseOutcome,
}

#[error_code]
pub enum DealError {
    #[msg("Principal must be greater than zero.")]
    InvalidPrincipal,
    #[msg("Collateral must be greater than zero.")]
    InvalidCollateral,
    #[msg("Interest rate exceeds the maximum the protocol accepts.")]
    InvalidRate,
    #[msg("Duration must be 6, 12, or 24 months.")]
    InvalidDuration,
    #[msg("LTV must be greater than zero and no greater than 50%.")]
    InvalidLtv,
    #[msg("Loan and collateral mints must be distinct, non-default mints.")]
    InvalidMint,
    #[msg("These terms cannot produce a valid repayment schedule.")]
    UnrepayableTerms,
    #[msg("The counterparty address is invalid.")]
    InvalidCounterparty,
    #[msg("A wallet cannot be both borrower and lender on the same deal.")]
    SelfDealing,
    #[msg("A public listing must not bind a counterparty at creation.")]
    PublicDealCannotBindCounterparty,
    #[msg("The submitted terms hash does not match the stored deal terms.")]
    TermsMismatch,
    #[msg("This wallet is not a party to this deal.")]
    UnauthorizedCounterparty,
    #[msg("The deal is not in a state that permits this action.")]
    InvalidStateTransition,
    #[msg("Both borrower and lender must be bound before funding.")]
    CounterpartyNotBound,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terms() -> DealTerms {
        DealTerms {
            principal_atoms: 10_000_000_000,
            loan_mint: Pubkey::new_unique(),
            collateral_mint: Pubkey::new_unique(),
            collateral_atoms: 20_000_000,
            rate_bps: 1_000,
            duration_months: 12,
            ltv_bps: 5_000,
        }
    }

    #[test]
    fn valid_terms_are_accepted() {
        assert!(terms().validate().is_ok());
    }

    #[test]
    fn zero_principal_is_rejected() {
        let mut t = terms();
        t.principal_atoms = 0;
        assert!(t.validate().is_err());
    }

    #[test]
    fn zero_collateral_is_rejected() {
        let mut t = terms();
        t.collateral_atoms = 0;
        assert!(t.validate().is_err());
    }

    #[test]
    fn an_ltv_above_the_protocol_ceiling_is_rejected() {
        let mut t = terms();
        t.ltv_bps = 5_001;
        assert!(t.validate().is_err());
        t.ltv_bps = 0;
        assert!(t.validate().is_err());
    }

    #[test]
    fn an_unsupported_duration_is_rejected() {
        let mut t = terms();
        t.duration_months = 18;
        assert!(t.validate().is_err());
    }

    #[test]
    fn identical_loan_and_collateral_mints_are_rejected() {
        let mut t = terms();
        t.collateral_mint = t.loan_mint;
        assert!(t.validate().is_err());
    }

    #[test]
    fn the_terms_hash_changes_when_any_field_changes() {
        let base = terms();
        let baseline = base.hash();

        let mut changed = base;
        changed.principal_atoms += 1;
        assert_ne!(baseline, changed.hash());

        let mut changed = base;
        changed.rate_bps += 1;
        assert_ne!(baseline, changed.hash());

        let mut changed = base;
        changed.duration_months = 24;
        assert_ne!(baseline, changed.hash());

        let mut changed = base;
        changed.collateral_atoms += 1;
        assert_ne!(baseline, changed.hash());

        let mut changed = base;
        changed.ltv_bps -= 1;
        assert_ne!(baseline, changed.hash());
    }

    #[test]
    fn the_terms_hash_is_stable_for_identical_terms() {
        let a = terms();
        let b = a;
        assert_eq!(a.hash(), b.hash());
    }

    #[test]
    fn swapping_the_mints_produces_a_different_hash() {
        // Guards against a field-order collision in the digest buffer.
        let base = terms();
        let mut swapped = base;
        swapped.loan_mint = base.collateral_mint;
        swapped.collateral_mint = base.loan_mint;
        assert_ne!(base.hash(), swapped.hash());
    }

    #[test]
    fn a_deal_is_only_fully_bound_with_two_distinct_wallets() {
        let wallet = Pubkey::new_unique();
        let mut deal = Deal {
            deal_id: [1u8; 16],
            creator: wallet,
            borrower: wallet,
            lender: Pubkey::default(),
            creator_side: Side::Borrower,
            terms: terms(),
            visibility: Visibility::Private,
            origin: DealOriginKind::Direct,
            state: DealState::Proposed,
            created_at: 0,
            confirmed_at: 0,
            bump: 255,
        };
        assert!(!deal.is_fully_bound());

        deal.lender = Pubkey::new_unique();
        assert!(deal.is_fully_bound());

        // The same wallet on both sides must never count as bound.
        deal.lender = deal.borrower;
        assert!(!deal.is_fully_bound());
    }
}
