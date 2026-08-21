//! Persat Finance loan lifecycle and payment program.
//!
//! Owns a loan from activation through completion or default. The path a deal
//! originated from — private link or marketplace — makes no difference here;
//! both converge on this identical logic.
//!
//! Payment model, matching the product specification:
//!
//! * Fixed monthly installments computed once at activation and never
//!   recomputed, so the borrower's quoted number cannot drift.
//! * A grace window after each due date. Default is only flagged once that
//!   window closes unpaid, never the instant a payment is late.
//! * Payments apply strictly in schedule order. Partial payments are rejected
//!   rather than half-applied, which keeps the "payments made" counter an exact
//!   description of what the borrower owes.
//!
//! The schedule is stored as its defining parameters, not as a list of dates.
//! Due dates are derived from the activation timestamp, so a loan cannot end up
//! with an inconsistent schedule after a partial write.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use persat_core::schedule::{build_schedule, Schedule};

declare_id!("2NQaeeutTk1itRUVDXg3wpJCVxN85r8CuUr59C2aPri3");

/// Nominal month length used for scheduling, in seconds (30 days).
///
/// A fixed-length month keeps due dates deterministic on-chain without a
/// calendar implementation. Both parties see the same schedule up front.
pub const SECONDS_PER_MONTH: i64 = 30 * 24 * 60 * 60;

/// Grace period after a due date before the payment counts as missed.
pub const GRACE_PERIOD_SECONDS: i64 = 5 * 24 * 60 * 60;

#[program]
pub mod loan_lifecycle {
    use super::*;

    /// Activate a loan: record the schedule and disburse principal.
    ///
    /// Called in the same transaction as the collateral lock, so there is no
    /// intermediate state where one side is exposed. The fee split is applied
    /// here, at the FUNDING to ACTIVE transition.
    #[allow(clippy::too_many_arguments)]
    pub fn activate_loan(
        ctx: Context<ActivateLoan>,
        deal_id: [u8; 16],
        principal_atoms: u64,
        rate_bps: u16,
        duration_months: u16,
        collateral_atoms: u64,
        treasury_fee_atoms: u64,
    ) -> Result<()> {
        let schedule = build_schedule(principal_atoms, rate_bps, duration_months)
            .map_err(|_| error!(LoanError::InvalidTerms))?;
        // The fee is computed by the fee program; this program only refuses a
        // value that would leave the borrower with nothing.
        require!(
            treasury_fee_atoms < principal_atoms,
            LoanError::FeeExceedsPrincipal
        );
        let to_borrower = principal_atoms
            .checked_sub(treasury_fee_atoms)
            .ok_or(LoanError::ArithmeticOverflow)?;

        // Lender funds the borrower.
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.lender_token_account.to_account_info(),
                    mint: ctx.accounts.loan_mint.to_account_info(),
                    to: ctx.accounts.borrower_token_account.to_account_info(),
                    authority: ctx.accounts.lender.to_account_info(),
                },
            ),
            to_borrower,
            ctx.accounts.loan_mint.decimals,
        )?;

        // Lender funds the treasury with the origination fee.
        if treasury_fee_atoms > 0 {
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.lender_token_account.to_account_info(),
                        mint: ctx.accounts.loan_mint.to_account_info(),
                        to: ctx.accounts.treasury_token_account.to_account_info(),
                        authority: ctx.accounts.lender.to_account_info(),
                    },
                ),
                treasury_fee_atoms,
                ctx.accounts.loan_mint.decimals,
            )?;
        }

        let now = Clock::get()?.unix_timestamp;
        let loan = &mut ctx.accounts.loan;
        loan.deal_id = deal_id;
        loan.borrower = ctx.accounts.borrower.key();
        loan.lender = ctx.accounts.lender.key();
        loan.loan_mint = ctx.accounts.loan_mint.key();
        loan.principal_atoms = principal_atoms;
        loan.rate_bps = rate_bps;
        loan.duration_months = duration_months;
        loan.collateral_atoms = collateral_atoms;
        loan.total_repayment_atoms = schedule.total_repayment_atoms;
        loan.installment_atoms = schedule.installment_atoms;
        loan.final_installment_atoms = schedule.final_installment_atoms;
        loan.payments_made = 0;
        loan.total_paid_atoms = 0;
        loan.activated_at = now;
        loan.state = LoanState::Active;
        loan.bump = ctx.bumps.loan;

        emit!(LoanActivated {
            deal_id,
            principal_atoms,
            total_repayment_atoms: schedule.total_repayment_atoms,
            activated_at: now,
        });
        Ok(())
    }

    /// Make the next scheduled installment.
    ///
    /// The borrower must pay exactly the amount due. Overpaying is rejected as
    /// a likely client error rather than being absorbed silently, and
    /// underpaying does not advance the schedule.
    pub fn make_payment(ctx: Context<MakePayment>, amount: u64) -> Result<()> {
        let expected = {
            let loan = &ctx.accounts.loan;
            require!(
                matches!(loan.state, LoanState::Active | LoanState::Defaulted),
                LoanError::LoanNotRepayable
            );
            require!(
                loan.payments_made < loan.duration_months,
                LoanError::ScheduleComplete
            );
            loan.amount_due()?
        };
        require!(amount == expected, LoanError::IncorrectPaymentAmount);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.borrower_token_account.to_account_info(),
                    mint: ctx.accounts.loan_mint.to_account_info(),
                    to: ctx.accounts.lender_token_account.to_account_info(),
                    authority: ctx.accounts.borrower.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.loan_mint.decimals,
        )?;

        let loan = &mut ctx.accounts.loan;
        loan.payments_made = loan
            .payments_made
            .checked_add(1)
            .ok_or(LoanError::ArithmeticOverflow)?;
        loan.total_paid_atoms = loan
            .total_paid_atoms
            .checked_add(amount)
            .ok_or(LoanError::ArithmeticOverflow)?;

        // A borrower who catches up clears the default flag; the missed-payment
        // penalty already applied at partial liquidation is not reversed.
        if loan.state == LoanState::Defaulted {
            loan.state = LoanState::Active;
        }
        if loan.payments_made == loan.duration_months {
            loan.state = LoanState::Completed;
            emit!(LoanCompleted {
                deal_id: loan.deal_id,
                total_paid_atoms: loan.total_paid_atoms,
            });
        }

        emit!(PaymentMade {
            deal_id: loan.deal_id,
            amount,
            payments_made: loan.payments_made,
        });
        Ok(())
    }

    /// Repay the entire outstanding balance in one transaction.
    pub fn repay_in_full(ctx: Context<MakePayment>) -> Result<()> {
        let outstanding = {
            let loan = &ctx.accounts.loan;
            require!(
                matches!(loan.state, LoanState::Active | LoanState::Defaulted),
                LoanError::LoanNotRepayable
            );
            loan.outstanding_atoms()?
        };
        require!(outstanding > 0, LoanError::ScheduleComplete);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.borrower_token_account.to_account_info(),
                    mint: ctx.accounts.loan_mint.to_account_info(),
                    to: ctx.accounts.lender_token_account.to_account_info(),
                    authority: ctx.accounts.borrower.to_account_info(),
                },
            ),
            outstanding,
            ctx.accounts.loan_mint.decimals,
        )?;

        let loan = &mut ctx.accounts.loan;
        loan.total_paid_atoms = loan
            .total_paid_atoms
            .checked_add(outstanding)
            .ok_or(LoanError::ArithmeticOverflow)?;
        loan.payments_made = loan.duration_months;
        loan.state = LoanState::Completed;
        emit!(LoanCompleted {
            deal_id: loan.deal_id,
            total_paid_atoms: loan.total_paid_atoms,
        });
        Ok(())
    }

    /// Flag a loan as defaulted after its grace window closes unpaid.
    ///
    /// Called by the keeper bot. The keeper has no discretion: the instruction
    /// recomputes overdue status from the chain clock and refuses if the loan
    /// is not genuinely overdue, so a compromised keeper cannot manufacture a
    /// default.
    pub fn flag_default(ctx: Context<FlagDefault>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let loan = &mut ctx.accounts.loan;
        require!(loan.state == LoanState::Active, LoanError::LoanNotActive);
        require!(loan.is_overdue(now)?, LoanError::PaymentNotOverdue);
        loan.state = LoanState::Defaulted;
        emit!(LoanDefaulted {
            deal_id: loan.deal_id,
            payments_made: loan.payments_made,
            at: now,
        });
        Ok(())
    }

    /// Record that the liquidation engine closed this loan.
    pub fn mark_liquidated(ctx: Context<MarkLiquidated>, fully: bool) -> Result<()> {
        let loan = &mut ctx.accounts.loan;
        require!(
            matches!(loan.state, LoanState::Active | LoanState::Defaulted),
            LoanError::LoanNotRepayable
        );
        loan.state = if fully {
            LoanState::FullyLiquidated
        } else {
            LoanState::PartiallyLiquidated
        };
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(deal_id: [u8; 16])]
pub struct ActivateLoan<'info> {
    #[account(mut)]
    pub lender: Signer<'info>,
    /// CHECK: recorded as the borrower; receives principal into a checked ATA.
    pub borrower: UncheckedAccount<'info>,
    #[account(
        init,
        payer = lender,
        space = 8 + Loan::INIT_SPACE,
        seeds = [b"loan", deal_id.as_ref()],
        bump
    )]
    pub loan: Account<'info, Loan>,
    pub loan_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = lender_token_account.mint == loan_mint.key() @ LoanError::MintMismatch,
        constraint = lender_token_account.owner == lender.key() @ LoanError::InvalidTokenAccountOwner
    )]
    pub lender_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = borrower_token_account.mint == loan_mint.key() @ LoanError::MintMismatch,
        constraint = borrower_token_account.owner == borrower.key() @ LoanError::InvalidTokenAccountOwner
    )]
    pub borrower_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = treasury_token_account.mint == loan_mint.key() @ LoanError::MintMismatch
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MakePayment<'info> {
    #[account(mut, seeds = [b"loan", loan.deal_id.as_ref()], bump = loan.bump)]
    pub loan: Account<'info, Loan>,
    #[account(mut, address = loan.borrower @ LoanError::UnauthorizedBorrower)]
    pub borrower: Signer<'info>,
    #[account(address = loan.loan_mint @ LoanError::MintMismatch)]
    pub loan_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = borrower_token_account.mint == loan.loan_mint @ LoanError::MintMismatch,
        constraint = borrower_token_account.owner == loan.borrower @ LoanError::InvalidTokenAccountOwner
    )]
    pub borrower_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = lender_token_account.mint == loan.loan_mint @ LoanError::MintMismatch,
        constraint = lender_token_account.owner == loan.lender @ LoanError::InvalidTokenAccountOwner
    )]
    pub lender_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct FlagDefault<'info> {
    #[account(mut, seeds = [b"loan", loan.deal_id.as_ref()], bump = loan.bump)]
    pub loan: Account<'info, Loan>,
    /// Anyone may report a genuinely overdue loan; the state check is what
    /// grants authority, not the caller's identity.
    pub reporter: Signer<'info>,
}

#[derive(Accounts)]
pub struct MarkLiquidated<'info> {
    #[account(mut, seeds = [b"loan", loan.deal_id.as_ref()], bump = loan.bump)]
    pub loan: Account<'info, Loan>,
    pub liquidation_engine: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Loan {
    pub deal_id: [u8; 16],
    pub borrower: Pubkey,
    pub lender: Pubkey,
    pub loan_mint: Pubkey,
    pub principal_atoms: u64,
    pub rate_bps: u16,
    pub duration_months: u16,
    pub collateral_atoms: u64,
    pub total_repayment_atoms: u64,
    pub installment_atoms: u64,
    pub final_installment_atoms: u64,
    pub payments_made: u16,
    pub total_paid_atoms: u64,
    pub activated_at: i64,
    pub state: LoanState,
    pub bump: u8,
}

impl Loan {
    /// Reconstruct the canonical schedule from stored parameters.
    pub fn schedule(&self) -> Result<Schedule> {
        build_schedule(self.principal_atoms, self.rate_bps, self.duration_months)
            .map_err(|_| error!(LoanError::InvalidTerms))
    }

    /// Amount due for the next unpaid installment.
    pub fn amount_due(&self) -> Result<u64> {
        require!(
            self.payments_made < self.duration_months,
            LoanError::ScheduleComplete
        );
        let last = self
            .duration_months
            .checked_sub(1)
            .ok_or(LoanError::ArithmeticOverflow)?;
        Ok(if self.payments_made == last {
            self.final_installment_atoms
        } else {
            self.installment_atoms
        })
    }

    /// Total still outstanding across the remaining schedule.
    pub fn outstanding_atoms(&self) -> Result<u64> {
        self.total_repayment_atoms
            .checked_sub(self.total_paid_atoms)
            .ok_or_else(|| error!(LoanError::ArithmeticOverflow))
    }

    /// Due timestamp of the next unpaid installment.
    pub fn next_due_at(&self) -> Result<i64> {
        let months = (self.payments_made as i64)
            .checked_add(1)
            .ok_or(LoanError::ArithmeticOverflow)?;
        let offset = months
            .checked_mul(SECONDS_PER_MONTH)
            .ok_or(LoanError::ArithmeticOverflow)?;
        self.activated_at
            .checked_add(offset)
            .ok_or_else(|| error!(LoanError::ArithmeticOverflow))
    }

    /// True when the current installment is due but not yet late.
    pub fn is_due(&self, now: i64) -> Result<bool> {
        if self.payments_made >= self.duration_months {
            return Ok(false);
        }
        Ok(now >= self.next_due_at()?)
    }

    /// True when the grace window has closed on an unpaid installment.
    pub fn is_overdue(&self, now: i64) -> Result<bool> {
        if self.payments_made >= self.duration_months {
            return Ok(false);
        }
        let deadline = self
            .next_due_at()?
            .checked_add(GRACE_PERIOD_SECONDS)
            .ok_or(LoanError::ArithmeticOverflow)?;
        Ok(now > deadline)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum LoanState {
    Active,
    Defaulted,
    PartiallyLiquidated,
    FullyLiquidated,
    Completed,
}

#[event]
pub struct LoanActivated {
    pub deal_id: [u8; 16],
    pub principal_atoms: u64,
    pub total_repayment_atoms: u64,
    pub activated_at: i64,
}

#[event]
pub struct PaymentMade {
    pub deal_id: [u8; 16],
    pub amount: u64,
    pub payments_made: u16,
}

#[event]
pub struct LoanCompleted {
    pub deal_id: [u8; 16],
    pub total_paid_atoms: u64,
}

#[event]
pub struct LoanDefaulted {
    pub deal_id: [u8; 16],
    pub payments_made: u16,
    pub at: i64,
}

#[error_code]
pub enum LoanError {
    #[msg("These terms cannot produce a valid repayment schedule.")]
    InvalidTerms,
    #[msg("The origination fee cannot equal or exceed the principal.")]
    FeeExceedsPrincipal,
    #[msg("The loan is not in a repayable state.")]
    LoanNotRepayable,
    #[msg("The loan is not active.")]
    LoanNotActive,
    #[msg("Every scheduled payment has already been made.")]
    ScheduleComplete,
    #[msg("Payment must exactly match the amount currently due.")]
    IncorrectPaymentAmount,
    #[msg("The payment is not yet overdue.")]
    PaymentNotOverdue,
    #[msg("Only the borrower on this loan may pay it.")]
    UnauthorizedBorrower,
    #[msg("The token mint does not match the loan currency.")]
    MintMismatch,
    #[msg("The token account owner does not match the expected party.")]
    InvalidTokenAccountOwner,
    #[msg("A loan arithmetic operation overflowed.")]
    ArithmeticOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn loan() -> Loan {
        let schedule = build_schedule(12_000_000_000, 1_000, 12).unwrap();
        Loan {
            deal_id: [7u8; 16],
            borrower: Pubkey::new_unique(),
            lender: Pubkey::new_unique(),
            loan_mint: Pubkey::new_unique(),
            principal_atoms: 12_000_000_000,
            rate_bps: 1_000,
            duration_months: 12,
            collateral_atoms: 24_000_000,
            total_repayment_atoms: schedule.total_repayment_atoms,
            installment_atoms: schedule.installment_atoms,
            final_installment_atoms: schedule.final_installment_atoms,
            payments_made: 0,
            total_paid_atoms: 0,
            activated_at: 1_000_000,
            state: LoanState::Active,
            bump: 255,
        }
    }

    #[test]
    fn the_first_payment_is_a_regular_installment() {
        let loan = loan();
        assert_eq!(loan.amount_due().unwrap(), loan.installment_atoms);
    }

    #[test]
    fn the_last_payment_is_the_final_installment() {
        let mut loan = loan();
        loan.payments_made = 11;
        assert_eq!(loan.amount_due().unwrap(), loan.final_installment_atoms);
    }

    #[test]
    fn a_completed_schedule_has_nothing_due() {
        let mut loan = loan();
        loan.payments_made = 12;
        assert!(loan.amount_due().is_err());
    }

    #[test]
    fn paying_every_installment_settles_the_loan_exactly() {
        let mut loan = loan();
        let mut paid = 0u64;
        for _ in 0..loan.duration_months {
            paid += loan.amount_due().unwrap();
            loan.payments_made += 1;
        }
        assert_eq!(paid, loan.total_repayment_atoms);
    }

    #[test]
    fn due_dates_advance_one_month_at_a_time() {
        let mut loan = loan();
        assert_eq!(loan.next_due_at().unwrap(), 1_000_000 + SECONDS_PER_MONTH);
        loan.payments_made = 1;
        assert_eq!(loan.next_due_at().unwrap(), 1_000_000 + 2 * SECONDS_PER_MONTH);
    }

    #[test]
    fn a_payment_is_not_due_before_its_date() {
        let loan = loan();
        assert!(!loan.is_due(1_000_000).unwrap());
        assert!(loan.is_due(1_000_000 + SECONDS_PER_MONTH).unwrap());
    }

    #[test]
    fn a_late_payment_inside_the_grace_window_is_not_a_default() {
        let loan = loan();
        let due = 1_000_000 + SECONDS_PER_MONTH;
        assert!(loan.is_due(due + 1).unwrap());
        // One day late: due, but not defaulted.
        assert!(!loan.is_overdue(due + 24 * 60 * 60).unwrap());
        // Exactly at the end of grace is still not overdue.
        assert!(!loan.is_overdue(due + GRACE_PERIOD_SECONDS).unwrap());
        // One second past grace is.
        assert!(loan.is_overdue(due + GRACE_PERIOD_SECONDS + 1).unwrap());
    }

    #[test]
    fn a_fully_paid_loan_can_never_be_overdue() {
        let mut loan = loan();
        loan.payments_made = 12;
        assert!(!loan.is_overdue(i64::MAX / 2).unwrap());
        assert!(!loan.is_due(i64::MAX / 2).unwrap());
    }

    #[test]
    fn outstanding_tracks_what_has_been_paid() {
        let mut loan = loan();
        assert_eq!(loan.outstanding_atoms().unwrap(), loan.total_repayment_atoms);
        loan.total_paid_atoms = loan.installment_atoms;
        assert_eq!(
            loan.outstanding_atoms().unwrap(),
            loan.total_repayment_atoms - loan.installment_atoms
        );
        loan.total_paid_atoms = loan.total_repayment_atoms;
        assert_eq!(loan.outstanding_atoms().unwrap(), 0);
    }

    #[test]
    fn the_stored_schedule_matches_the_recomputed_one() {
        // Guards against stored values drifting from the canonical math.
        let loan = loan();
        let schedule = loan.schedule().unwrap();
        assert_eq!(schedule.installment_atoms, loan.installment_atoms);
        assert_eq!(schedule.final_installment_atoms, loan.final_installment_atoms);
        assert_eq!(schedule.total_repayment_atoms, loan.total_repayment_atoms);
    }
}
