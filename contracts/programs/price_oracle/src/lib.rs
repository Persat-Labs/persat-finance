//! Persat Finance price oracle adapter.
//!
//! A single BTC/USD feed values all collateral. USDC and USDT are treated as
//! exactly one dollar — the documented MVP simplification — so no second feed
//! exists.
//!
//! The defining behaviour of this program is that it **fails closed**. If the
//! price has not been refreshed within the configured staleness window, every
//! price-dependent action is blocked. When the protocol cannot trust the price,
//! it does nothing rather than acting on data it cannot verify. Being unable to
//! liquidate for a few minutes is recoverable; liquidating against a wrong
//! price is not.
//!
//! The pusher is an off-chain service that reads the upstream Pyth or
//! Switchboard feed and writes it here. It is *only* trusted to relay a price
//! it observed. It cannot exceed the configured deviation bound in a single
//! update, so a compromised pusher cannot instantly reprice the whole protocol.

use anchor_lang::prelude::*;
use persat_core::ltv::{Price, MAX_PRICE_EXPO};

declare_id!("BajL3G7sLiH1oKUFs54okF3hv1FzkezNYma2MKGoYJDx");

/// Lower bound on the staleness window. A window this tight would block the
/// protocol constantly on ordinary network jitter.
pub const MIN_STALENESS_SECONDS: u32 = 30;
/// Upper bound on the staleness window. Beyond this the price is not meaningful
/// for a volatile asset, so governance may not weaken the check indefinitely.
pub const MAX_STALENESS_SECONDS: u32 = 3_600;
/// Largest single-update price move, in basis points, before the update is
/// rejected as implausible. 25% in one tick is treated as a broken or hostile
/// feed rather than a real market move.
pub const MAX_DEVIATION_BPS: u64 = 2_500;

#[program]
pub mod price_oracle {
    use super::*;

    /// Create the oracle configuration singleton.
    pub fn initialize_oracle(
        ctx: Context<InitializeOracle>,
        governance: Pubkey,
        pusher: Pubkey,
        feed: Pubkey,
        staleness_threshold_seconds: u32,
        price_decimals: u32,
    ) -> Result<()> {
        require!(governance != Pubkey::default(), OracleError::InvalidAuthority);
        require!(pusher != Pubkey::default(), OracleError::InvalidAuthority);
        require!(feed != Pubkey::default(), OracleError::InvalidFeed);
        require!(
            (MIN_STALENESS_SECONDS..=MAX_STALENESS_SECONDS)
                .contains(&staleness_threshold_seconds),
            OracleError::InvalidStalenessThreshold
        );
        require!(price_decimals <= MAX_PRICE_EXPO, OracleError::InvalidPrice);

        let oracle = &mut ctx.accounts.oracle;
        oracle.governance = governance;
        oracle.pusher = pusher;
        oracle.feed = feed;
        oracle.staleness_threshold_seconds = staleness_threshold_seconds;
        oracle.price_decimals = price_decimals;
        // No price is published at initialization. Until the first push lands,
        // every consumer sees a stale oracle and correctly refuses to act.
        oracle.price_mantissa = 0;
        oracle.last_updated_at = 0;
        oracle.bump = ctx.bumps.oracle;
        Ok(())
    }

    /// Publish a fresh BTC/USD observation.
    pub fn push_price(ctx: Context<PushPrice>, mantissa: u64, observed_at: i64) -> Result<()> {
        require!(mantissa > 0, OracleError::InvalidPrice);
        let now = Clock::get()?.unix_timestamp;
        // A future-dated observation would extend the freshness window past
        // what was really observed, so it is rejected outright.
        require!(observed_at <= now, OracleError::FutureObservation);
        let age = now
            .checked_sub(observed_at)
            .ok_or(OracleError::ArithmeticOverflow)?;
        require!(
            age <= ctx.accounts.oracle.staleness_threshold_seconds as i64,
            OracleError::ObservationAlreadyStale
        );

        let oracle = &mut ctx.accounts.oracle;
        // Never accept an out-of-order update; it would rewind the price.
        require!(
            observed_at >= oracle.last_updated_at,
            OracleError::StaleObservationOrder
        );
        if oracle.price_mantissa > 0 {
            require!(
                within_deviation_bound(oracle.price_mantissa, mantissa),
                OracleError::PriceDeviationTooLarge
            );
        }
        oracle.price_mantissa = mantissa;
        oracle.last_updated_at = observed_at;
        emit!(PricePublished {
            mantissa,
            decimals: oracle.price_decimals,
            observed_at,
        });
        Ok(())
    }

    /// Governance-only: change the staleness window.
    pub fn set_staleness_threshold(ctx: Context<UpdateOracle>, seconds: u32) -> Result<()> {
        require!(
            (MIN_STALENESS_SECONDS..=MAX_STALENESS_SECONDS).contains(&seconds),
            OracleError::InvalidStalenessThreshold
        );
        ctx.accounts.oracle.staleness_threshold_seconds = seconds;
        Ok(())
    }

    /// Governance-only: point the adapter at a different upstream feed.
    ///
    /// Changing the feed invalidates the published price. The protocol returns
    /// to a stale, fail-closed state until the new feed publishes, rather than
    /// carrying a price from the old source across the switch.
    pub fn set_feed_address(ctx: Context<UpdateOracle>, feed: Pubkey) -> Result<()> {
        require!(feed != Pubkey::default(), OracleError::InvalidFeed);
        let oracle = &mut ctx.accounts.oracle;
        oracle.feed = feed;
        oracle.price_mantissa = 0;
        oracle.last_updated_at = 0;
        Ok(())
    }

    /// Governance-only: rotate the pusher key.
    pub fn set_pusher(ctx: Context<UpdateOracle>, pusher: Pubkey) -> Result<()> {
        require!(pusher != Pubkey::default(), OracleError::InvalidAuthority);
        ctx.accounts.oracle.pusher = pusher;
        Ok(())
    }
}

/// True when `next` is within the permitted deviation of `previous`.
fn within_deviation_bound(previous: u64, next: u64) -> bool {
    let (low, high) = if next >= previous {
        (previous, next)
    } else {
        (next, previous)
    };
    let delta = high.saturating_sub(low) as u128;
    let bound = (previous as u128).saturating_mul(MAX_DEVIATION_BPS)
        / persat_core::BPS_DENOMINATOR as u128;
    delta <= bound
}

#[derive(Accounts)]
pub struct InitializeOracle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + OracleConfig::INIT_SPACE,
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, OracleConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PushPrice<'info> {
    #[account(
        mut,
        has_one = pusher @ OracleError::UnauthorizedPusher,
        seeds = [b"oracle"],
        bump = oracle.bump
    )]
    pub oracle: Account<'info, OracleConfig>,
    pub pusher: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateOracle<'info> {
    #[account(
        mut,
        has_one = governance @ OracleError::UnauthorizedGovernance,
        seeds = [b"oracle"],
        bump = oracle.bump
    )]
    pub oracle: Account<'info, OracleConfig>,
    pub governance: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct OracleConfig {
    /// Authority permitted to change configuration.
    pub governance: Pubkey,
    /// Off-chain service permitted to publish observations.
    pub pusher: Pubkey,
    /// Upstream Pyth or Switchboard feed this adapter mirrors.
    pub feed: Pubkey,
    /// Age beyond which the published price must not be used.
    pub staleness_threshold_seconds: u32,
    /// Decimal places in `price_mantissa`.
    pub price_decimals: u32,
    /// Most recent published price. Zero means "no usable price".
    pub price_mantissa: u64,
    /// Observation timestamp of the published price.
    pub last_updated_at: i64,
    pub bump: u8,
}

impl OracleConfig {
    /// True when the published price is too old to act on.
    pub fn is_stale(&self, now: i64) -> bool {
        if self.price_mantissa == 0 {
            return true;
        }
        match now.checked_sub(self.last_updated_at) {
            // A clock that runs backwards past the observation is treated as
            // untrustworthy rather than as an extremely fresh price.
            Some(age) => age < 0 || age > self.staleness_threshold_seconds as i64,
            None => true,
        }
    }

    /// The current price, or an error if it cannot be trusted.
    ///
    /// This is the single entry point every price-dependent action must use.
    /// There is deliberately no way to read the mantissa without the freshness
    /// check attached.
    pub fn require_fresh_price(&self, now: i64) -> Result<Price> {
        require!(!self.is_stale(now), OracleError::StalePrice);
        Price::new(self.price_mantissa, self.price_decimals)
            .map_err(|_| error!(OracleError::InvalidPrice))
    }
}

#[event]
pub struct PricePublished {
    pub mantissa: u64,
    pub decimals: u32,
    pub observed_at: i64,
}

#[error_code]
pub enum OracleError {
    #[msg("Authority must not be the default public key.")]
    InvalidAuthority,
    #[msg("The upstream feed address is invalid.")]
    InvalidFeed,
    #[msg("Only the configured governance authority may change oracle configuration.")]
    UnauthorizedGovernance,
    #[msg("Only the configured pusher may publish a price.")]
    UnauthorizedPusher,
    #[msg("The staleness threshold is outside the permitted range.")]
    InvalidStalenessThreshold,
    #[msg("The published price is zero or otherwise unusable.")]
    InvalidPrice,
    #[msg("BTC/USD price is stale. Price-dependent actions are blocked until fresh data arrives.")]
    StalePrice,
    #[msg("The observation is dated in the future.")]
    FutureObservation,
    #[msg("The observation was already stale when submitted.")]
    ObservationAlreadyStale,
    #[msg("The observation is older than the currently published price.")]
    StaleObservationOrder,
    #[msg("The price moved further in one update than the protocol permits.")]
    PriceDeviationTooLarge,
    #[msg("An oracle arithmetic operation overflowed.")]
    ArithmeticOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> OracleConfig {
        OracleConfig {
            governance: Pubkey::new_unique(),
            pusher: Pubkey::new_unique(),
            feed: Pubkey::new_unique(),
            staleness_threshold_seconds: 60,
            price_decimals: 8,
            price_mantissa: 100_000_00000000,
            last_updated_at: 1_000,
            bump: 255,
        }
    }

    #[test]
    fn a_fresh_price_is_usable() {
        let oracle = config();
        assert!(!oracle.is_stale(1_030));
        assert!(oracle.require_fresh_price(1_030).is_ok());
    }

    #[test]
    fn a_price_exactly_at_the_threshold_is_still_fresh() {
        let oracle = config();
        assert!(!oracle.is_stale(1_060));
    }

    #[test]
    fn one_second_past_the_threshold_fails_closed() {
        let oracle = config();
        assert!(oracle.is_stale(1_061));
        assert!(oracle.require_fresh_price(1_061).is_err());
    }

    #[test]
    fn an_oracle_that_never_published_is_stale() {
        let mut oracle = config();
        oracle.price_mantissa = 0;
        oracle.last_updated_at = 0;
        assert!(oracle.is_stale(0));
        assert!(oracle.require_fresh_price(0).is_err());
    }

    #[test]
    fn a_backwards_clock_is_treated_as_untrustworthy() {
        let oracle = config();
        assert!(oracle.is_stale(999));
    }

    #[test]
    fn a_normal_market_move_is_accepted() {
        // 100k -> 110k is 10%, well inside the bound.
        assert!(within_deviation_bound(100_000_00000000, 110_000_00000000));
        // and the same move downward.
        assert!(within_deviation_bound(100_000_00000000, 90_000_00000000));
    }

    #[test]
    fn an_implausible_jump_is_rejected() {
        // 100k -> 200k in a single update is not a market move.
        assert!(!within_deviation_bound(100_000_00000000, 200_000_00000000));
        // A collapse to near zero is equally implausible.
        assert!(!within_deviation_bound(100_000_00000000, 1));
    }

    #[test]
    fn the_deviation_boundary_is_inclusive() {
        // Exactly 25% up must be permitted.
        assert!(within_deviation_bound(100_000, 125_000));
        assert!(!within_deviation_bound(100_000, 125_001));
    }

    #[test]
    fn the_staleness_window_range_is_enforced_at_both_ends() {
        assert!(MIN_STALENESS_SECONDS < MAX_STALENESS_SECONDS);
        assert!(!(MIN_STALENESS_SECONDS..=MAX_STALENESS_SECONDS).contains(&0));
        assert!(!(MIN_STALENESS_SECONDS..=MAX_STALENESS_SECONDS)
            .contains(&(MAX_STALENESS_SECONDS + 1)));
    }
}
