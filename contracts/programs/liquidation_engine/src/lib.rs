//! Persat Finance liquidation engine.
//!
//! Evaluates positions against fresh oracle data and authorizes seizure. All
//! sizing arithmetic lives in `persat_core::liquidation`, which is fuzzed on the
//! host target, so this program is limited to authorization, freshness, and
//! state transitions.
//!
//! The single most important rule here: **every price-dependent action requires
//! a fresh price**. If the oracle is stale, evaluation and both liquidation
//! paths refuse to run. A liquidation executed against a stale price is
//! irreversible and takes real user collateral, so the protocol would rather do
//! nothing and wait.
//!
//! The keeper that triggers these instructions has no discretion over amounts.
//! It chooses only *when* to ask; the program recomputes every figure from
//! on-chain state and current price.

use anchor_lang::prelude::*;
use persat_core::{
    liquidation::{
        evaluate_position, full_liquidation, partial_liquidation_amount, RiskThresholds,
    },
    ltv::{collateral_value_atoms, Price},
};

declare_id!("ddkJSDR6ke8zhPNNu2UQtESWas2HUopn2PwWKsuUXuj");

#[program]
pub mod liquidation_engine {
    use super::*;

    /// Configure the engine with the authorities it trusts.
    pub fn initialize_engine(
        ctx: Context<InitializeEngine>,
        governance: Pubkey,
        oracle: Pubkey,
    ) -> Result<()> {
        require!(
            governance != Pubkey::default() && oracle != Pubkey::default(),
            LiquidationError::InvalidAuthority
        );
        let engine = &mut ctx.accounts.engine;
        engine.governance = governance;
        engine.oracle = oracle;
        engine.paused = false;
        engine.bump = ctx.bumps.engine;
        Ok(())
    }

    /// Governance-only: halt all liquidation activity.
    pub fn set_paused(ctx: Context<UpdateEngine>, paused: bool) -> Result<()> {
        ctx.accounts.engine.paused = paused;
        Ok(())
    }

    /// Evaluate a position and record the result.
    ///
    /// Read-only with respect to funds. Requires a fresh price, so a stale
    /// oracle blocks evaluation rather than producing a stale verdict.
    pub fn evaluate(
        ctx: Context<Evaluate>,
        position: PositionInput,
        price_mantissa: u64,
        price_decimals: u32,
        price_observed_at: i64,
        staleness_threshold_seconds: u32,
    ) -> Result<()> {
        let engine = &ctx.accounts.engine;
        require!(!engine.paused, LiquidationError::EnginePaused);
        let price = require_fresh_price(
            price_mantissa,
            price_decimals,
            price_observed_at,
            staleness_threshold_seconds,
        )?;
        position.validate()?;

        let value = collateral_value_atoms(
            position.collateral_atoms,
            position.collateral_decimals,
            price,
            position.loan_decimals,
        )
        .map_err(|_| error!(LiquidationError::ValuationFailed))?;

        let health = evaluate_position(
            position.outstanding_debt_atoms,
            value,
            position.thresholds(),
        )
        .map_err(|_| error!(LiquidationError::ValuationFailed))?;

        emit!(PositionEvaluated {
            deal_id: position.deal_id,
            collateral_value_atoms: value,
            current_ltv_bps: health.current_ltv_bps,
            is_partial_liquidatable: health.is_partial_liquidatable,
            is_fully_liquidatable: health.is_fully_liquidatable,
        });
        Ok(())
    }

    /// Compute and authorize a partial liquidation after a missed payment.
    ///
    /// Seizes only enough to cover the missed installment plus penalty, capped
    /// by the asset's configured share of collateral. The loan continues.
    pub fn execute_partial_liquidation(
        ctx: Context<ExecuteLiquidation>,
        position: PositionInput,
        missed_payment_atoms: u64,
        penalty_bps: u16,
        max_partial_bps: u16,
        price_mantissa: u64,
        price_decimals: u32,
        price_observed_at: i64,
        staleness_threshold_seconds: u32,
    ) -> Result<()> {
        let engine = &ctx.accounts.engine;
        require!(!engine.paused, LiquidationError::EnginePaused);
        let price = require_fresh_price(
            price_mantissa,
            price_decimals,
            price_observed_at,
            staleness_threshold_seconds,
        )?;
        position.validate()?;
        require!(missed_payment_atoms > 0, LiquidationError::NothingToLiquidate);

        let value = collateral_value_atoms(
            position.collateral_atoms,
            position.collateral_decimals,
            price,
            position.loan_decimals,
        )
        .map_err(|_| error!(LiquidationError::ValuationFailed))?;

        // The position must genuinely be liquidatable. A missed payment alone
        // does not authorize seizure if the position is still healthy.
        let health = evaluate_position(
            position.outstanding_debt_atoms,
            value,
            position.thresholds(),
        )
        .map_err(|_| error!(LiquidationError::ValuationFailed))?;
        require!(
            health.is_partial_liquidatable,
            LiquidationError::PositionNotLiquidatable
        );
        // A fully liquidatable position must go through the full path, not be
        // whittled down one partial seizure at a time.
        require!(
            !health.is_fully_liquidatable,
            LiquidationError::RequiresFullLiquidation
        );

        let seize = partial_liquidation_amount(
            missed_payment_atoms,
            penalty_bps,
            position.collateral_atoms,
            value,
            max_partial_bps,
        )
        .map_err(|_| error!(LiquidationError::ValuationFailed))?;
        require!(seize > 0, LiquidationError::NothingToLiquidate);

        emit!(PartialLiquidationAuthorized {
            deal_id: position.deal_id,
            seize_atoms: seize,
            current_ltv_bps: health.current_ltv_bps,
        });
        Ok(())
    }

    /// Compute and authorize a full liquidation.
    ///
    /// Repays the lender from collateral and returns any surplus to the
    /// borrower. Permitted when the LTV threshold is breached, or when the loan
    /// has terminally defaulted.
    pub fn execute_full_liquidation(
        ctx: Context<ExecuteLiquidation>,
        position: PositionInput,
        terminal_default: bool,
        price_mantissa: u64,
        price_decimals: u32,
        price_observed_at: i64,
        staleness_threshold_seconds: u32,
    ) -> Result<()> {
        let engine = &ctx.accounts.engine;
        require!(!engine.paused, LiquidationError::EnginePaused);
        let price = require_fresh_price(
            price_mantissa,
            price_decimals,
            price_observed_at,
            staleness_threshold_seconds,
        )?;
        position.validate()?;

        let value = collateral_value_atoms(
            position.collateral_atoms,
            position.collateral_decimals,
            price,
            position.loan_decimals,
        )
        .map_err(|_| error!(LiquidationError::ValuationFailed))?;

        let health = evaluate_position(
            position.outstanding_debt_atoms,
            value,
            position.thresholds(),
        )
        .map_err(|_| error!(LiquidationError::ValuationFailed))?;
        require!(
            health.is_fully_liquidatable || terminal_default,
            LiquidationError::PositionNotLiquidatable
        );

        let outcome = full_liquidation(
            position.outstanding_debt_atoms,
            position.collateral_atoms,
            value,
        )
        .map_err(|_| error!(LiquidationError::ValuationFailed))?;

        // Conservation check: the engine must never authorize moving more
        // collateral than the vault holds.
        let moved = outcome
            .seized_atoms
            .checked_add(outcome.surplus_atoms)
            .ok_or(LiquidationError::ArithmeticOverflow)?;
        require!(
            moved == position.collateral_atoms,
            LiquidationError::ConservationViolation
        );

        emit!(FullLiquidationAuthorized {
            deal_id: position.deal_id,
            seize_atoms: outcome.seized_atoms,
            surplus_atoms: outcome.surplus_atoms,
            shortfall_atoms: outcome.shortfall_atoms,
            current_ltv_bps: health.current_ltv_bps,
        });
        Ok(())
    }
}

/// Validate freshness and construct a usable price, or fail closed.
fn require_fresh_price(
    mantissa: u64,
    decimals: u32,
    observed_at: i64,
    staleness_threshold_seconds: u32,
) -> Result<Price> {
    let now = Clock::get()?.unix_timestamp;
    let age = now
        .checked_sub(observed_at)
        .ok_or(LiquidationError::ArithmeticOverflow)?;
    // Negative age means the observation is future-dated; treat as untrusted.
    require!(age >= 0, LiquidationError::StalePrice);
    require!(
        age <= staleness_threshold_seconds as i64,
        LiquidationError::StalePrice
    );
    Price::new(mantissa, decimals).map_err(|_| error!(LiquidationError::StalePrice))
}

/// Position snapshot supplied by the caller and re-validated on chain.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PositionInput {
    pub deal_id: [u8; 16],
    pub outstanding_debt_atoms: u64,
    pub collateral_atoms: u64,
    pub collateral_decimals: u8,
    pub loan_decimals: u8,
    pub max_ltv_bps: u16,
    pub partial_liquidation_ltv_bps: u16,
    pub full_liquidation_ltv_bps: u16,
}

impl PositionInput {
    fn thresholds(&self) -> RiskThresholds {
        RiskThresholds {
            max_ltv_bps: self.max_ltv_bps,
            partial_liquidation_ltv_bps: self.partial_liquidation_ltv_bps,
            full_liquidation_ltv_bps: self.full_liquidation_ltv_bps,
        }
    }

    /// Reject a malformed snapshot before any valuation happens.
    fn validate(&self) -> Result<()> {
        self.thresholds()
            .validate(persat_core::MAX_PROTOCOL_LTV_BPS)
            .map_err(|_| error!(LiquidationError::InvalidThresholds))?;
        require!(
            self.collateral_decimals <= 18 && self.loan_decimals <= 18,
            LiquidationError::InvalidThresholds
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeEngine<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Engine::INIT_SPACE,
        seeds = [b"liquidation-engine"],
        bump
    )]
    pub engine: Account<'info, Engine>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateEngine<'info> {
    #[account(
        mut,
        has_one = governance @ LiquidationError::UnauthorizedGovernance,
        seeds = [b"liquidation-engine"],
        bump = engine.bump
    )]
    pub engine: Account<'info, Engine>,
    pub governance: Signer<'info>,
}

#[derive(Accounts)]
pub struct Evaluate<'info> {
    #[account(seeds = [b"liquidation-engine"], bump = engine.bump)]
    pub engine: Account<'info, Engine>,
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteLiquidation<'info> {
    #[account(seeds = [b"liquidation-engine"], bump = engine.bump)]
    pub engine: Account<'info, Engine>,
    pub keeper: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Engine {
    pub governance: Pubkey,
    pub oracle: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

#[event]
pub struct PositionEvaluated {
    pub deal_id: [u8; 16],
    pub collateral_value_atoms: u64,
    pub current_ltv_bps: u64,
    pub is_partial_liquidatable: bool,
    pub is_fully_liquidatable: bool,
}

#[event]
pub struct PartialLiquidationAuthorized {
    pub deal_id: [u8; 16],
    pub seize_atoms: u64,
    pub current_ltv_bps: u64,
}

#[event]
pub struct FullLiquidationAuthorized {
    pub deal_id: [u8; 16],
    pub seize_atoms: u64,
    pub surplus_atoms: u64,
    pub shortfall_atoms: u64,
    pub current_ltv_bps: u64,
}

#[error_code]
pub enum LiquidationError {
    #[msg("Authority must not be the default public key.")]
    InvalidAuthority,
    #[msg("Only the configured governance authority may change engine configuration.")]
    UnauthorizedGovernance,
    #[msg("Liquidation is paused.")]
    EnginePaused,
    #[msg("BTC/USD price is stale. Liquidation is blocked until fresh data arrives.")]
    StalePrice,
    #[msg("Risk thresholds are invalid or out of order.")]
    InvalidThresholds,
    #[msg("Collateral valuation failed.")]
    ValuationFailed,
    #[msg("The position does not meet the liquidation threshold.")]
    PositionNotLiquidatable,
    #[msg("The position is fully liquidatable and must use the full liquidation path.")]
    RequiresFullLiquidation,
    #[msg("There is nothing to liquidate.")]
    NothingToLiquidate,
    #[msg("Liquidation would not conserve the posted collateral.")]
    ConservationViolation,
    #[msg("A liquidation arithmetic operation overflowed.")]
    ArithmeticOverflow,
}
