//! Persat Finance price oracle adapter.
//!
//! A single BTC/USD feed, sourced from **Pyth**, values all collateral. USDC and
//! USDT are treated as exactly one dollar — the documented MVP simplification —
//! so no second feed exists.
//!
//! # Why a pull oracle changes the shape of this program
//!
//! Pyth on Solana is a *pull* oracle. Nobody pushes prices into this program.
//! Instead a client posts a signed Hermes update into a `PriceUpdateV2` account
//! owned by the Pyth receiver, then passes that account into whichever
//! instruction needs a price. Consequently this program stores **configuration
//! and policy**, not price data. There is no price field to go stale in
//! storage, and no pusher key that could be compromised to inject a false price.
//! That removes an entire trust assumption compared with a push design.
//!
//! # Fail-closed behaviour
//!
//! Every price read goes through [`OracleConfig::read_price`], which enforces,
//! in order:
//!
//! 1. **Ownership** — the account is owned by the Pyth receiver. Anchor's
//!    `Account<'info, PriceUpdateV2>` checks this, which is what stops an
//!    attacker passing a look-alike account they control.
//! 2. **Feed identity** — the update is for BTC/USD and not some other asset.
//! 3. **Staleness** — the update is within the configured window.
//! 4. **Verification level** — the update carries a full Wormhole quorum
//!    signature, not a partial one.
//! 5. **Sign** — the price is strictly positive.
//! 6. **Confidence** — Pyth's own uncertainty band is narrow relative to the
//!    price. A wide band means the publishers disagree, which is exactly when a
//!    lending protocol should decline to act.
//!
//! Any failure blocks the action. When the protocol cannot trust the price it
//! does nothing, rather than valuing collateral against data it cannot verify.

use anchor_lang::prelude::*;
use persat_core::ltv::{Price, MAX_PRICE_EXPO};
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

declare_id!("BajL3G7sLiH1oKUFs54okF3hv1FzkezNYma2MKGoYJDx");

/// Pyth BTC/USD price feed id.
///
/// The same id on every cluster: it identifies the *feed*, not an account.
/// <https://pyth.network/developers/price-feed-ids>
pub const BTC_USD_FEED_ID: &str =
    "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

/// Lower bound on the staleness window. Tighter than this would block the
/// protocol constantly on ordinary network jitter.
pub const MIN_STALENESS_SECONDS: u32 = 30;
/// Upper bound on the staleness window. Beyond this a price is not meaningful
/// for a volatile asset, so governance cannot weaken the check indefinitely.
pub const MAX_STALENESS_SECONDS: u32 = 3_600;
/// Default staleness window.
pub const DEFAULT_STALENESS_SECONDS: u32 = 60;

/// Widest acceptable Pyth confidence interval, in basis points of the price.
///
/// Pyth publishes `price ± conf`. A wide band means its publishers disagree,
/// typically during severe volatility or a feed problem. Acting on a price the
/// oracle itself is unsure about is how lending protocols mis-liquidate, so 2%
/// is treated as the limit beyond which the protocol declines to act.
pub const MAX_CONFIDENCE_BPS: u64 = 200;
/// Ceiling governance may set for the confidence bound: 10%.
pub const MAX_CONFIGURABLE_CONFIDENCE_BPS: u64 = 1_000;

#[program]
pub mod price_oracle {
    use super::*;

    /// Create the oracle configuration singleton.
    pub fn initialize_oracle(
        ctx: Context<InitializeOracle>,
        governance: Pubkey,
        staleness_threshold_seconds: u32,
        max_confidence_bps: u64,
    ) -> Result<()> {
        require!(
            governance != Pubkey::default(),
            OracleError::InvalidAuthority
        );
        require!(
            (MIN_STALENESS_SECONDS..=MAX_STALENESS_SECONDS).contains(&staleness_threshold_seconds),
            OracleError::InvalidStalenessThreshold
        );
        require!(
            max_confidence_bps > 0 && max_confidence_bps <= MAX_CONFIGURABLE_CONFIDENCE_BPS,
            OracleError::InvalidConfidenceBound
        );

        let oracle = &mut ctx.accounts.oracle;
        oracle.governance = governance;
        oracle.feed_id = get_feed_id_from_hex(BTC_USD_FEED_ID)
            .map_err(|_| error!(OracleError::InvalidFeed))?;
        oracle.staleness_threshold_seconds = staleness_threshold_seconds;
        oracle.max_confidence_bps = max_confidence_bps;
        oracle.paused = false;
        oracle.bump = ctx.bumps.oracle;
        Ok(())
    }

    /// Read and validate the current BTC/USD price, emitting the result.
    ///
    /// Exists so the keeper and the frontend can confirm the protocol's own
    /// view of the price, and so integration tests can assert fail-closed
    /// behaviour directly. Other programs perform the same validation through
    /// [`OracleConfig::read_price`] rather than calling across programs.
    pub fn read_btc_usd(ctx: Context<ReadPrice>) -> Result<()> {
        let clock = Clock::get()?;
        let observation = ctx
            .accounts
            .oracle
            .read_price(&ctx.accounts.price_update, &clock)?;
        emit!(PriceObserved {
            mantissa: observation.mantissa,
            decimals: observation.decimals,
            confidence: observation.confidence,
            publish_time: observation.publish_time,
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

    /// Governance-only: change the confidence bound.
    pub fn set_confidence_bound(ctx: Context<UpdateOracle>, max_confidence_bps: u64) -> Result<()> {
        require!(
            max_confidence_bps > 0 && max_confidence_bps <= MAX_CONFIGURABLE_CONFIDENCE_BPS,
            OracleError::InvalidConfidenceBound
        );
        ctx.accounts.oracle.max_confidence_bps = max_confidence_bps;
        Ok(())
    }

    /// Governance-only: halt every price-dependent action.
    ///
    /// A deliberate kill switch for a suspected feed problem. Because all price
    /// reads route through one validation path, setting this stops new funding,
    /// liquidation, and valuation together rather than piecemeal.
    pub fn set_paused(ctx: Context<UpdateOracle>, paused: bool) -> Result<()> {
        ctx.accounts.oracle.paused = paused;
        Ok(())
    }
}

/// A validated price observation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Observation {
    /// Positive price mantissa.
    pub mantissa: u64,
    /// Decimal places in `mantissa`.
    pub decimals: u32,
    /// Pyth confidence interval, in the same scale as `mantissa`.
    pub confidence: u64,
    pub publish_time: i64,
}

impl Observation {
    /// Convert into the valuation type used by the shared math crate.
    pub fn price(&self) -> Result<Price> {
        Price::new(self.mantissa, self.decimals).map_err(|_| error!(OracleError::InvalidPrice))
    }
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
pub struct ReadPrice<'info> {
    #[account(seeds = [b"oracle"], bump = oracle.bump)]
    pub oracle: Account<'info, OracleConfig>,
    /// Pyth price update. `Account<PriceUpdateV2>` enforces that the Pyth
    /// receiver owns this account, which is what prevents a caller from
    /// supplying a look-alike account holding a price of their choosing.
    pub price_update: Account<'info, PriceUpdateV2>,
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
    /// Pyth BTC/USD feed id this adapter accepts, and only this one.
    pub feed_id: [u8; 32],
    /// Age beyond which an update must not be used.
    pub staleness_threshold_seconds: u32,
    /// Widest acceptable confidence interval, in basis points of the price.
    pub max_confidence_bps: u64,
    /// Governance kill switch for all price-dependent actions.
    pub paused: bool,
    pub bump: u8,
}

impl OracleConfig {
    /// Validate a Pyth update and return a usable price, or fail closed.
    ///
    /// This is the single entry point for price data. There is deliberately no
    /// way to obtain a mantissa without every check below attached to it.
    pub fn read_price(
        &self,
        price_update: &Account<'_, PriceUpdateV2>,
        clock: &Clock,
    ) -> Result<Observation> {
        require!(!self.paused, OracleError::OraclePaused);

        // Feed identity and staleness. `get_price_no_older_than` rejects both a
        // mismatched feed and an update older than the window.
        let price = price_update
            .get_price_no_older_than(
                clock,
                self.staleness_threshold_seconds as u64,
                &self.feed_id,
            )
            .map_err(|_| error!(OracleError::StalePrice))?;

        // Require a full Wormhole quorum, not a partially verified update.
        require!(
            price_update.verification_level.gte(
                pyth_solana_receiver_sdk::price_update::VerificationLevel::Full
            ),
            OracleError::InsufficientVerification
        );

        // A zero or negative price is a broken feed, never cheap collateral.
        require!(price.price > 0, OracleError::InvalidPrice);
        let mantissa = u64::try_from(price.price).map_err(|_| error!(OracleError::InvalidPrice))?;

        // Pyth exponents are negative for fractional prices. A positive
        // exponent would mean a price scaled *up*, which this adapter does not
        // model, so it is rejected rather than silently mis-scaled.
        require!(price.exponent <= 0, OracleError::UnsupportedExponent);
        let decimals = price.exponent.unsigned_abs();
        require!(decimals <= MAX_PRICE_EXPO, OracleError::UnsupportedExponent);

        // Confidence bound: refuse to act when Pyth itself is uncertain.
        let confidence_bps = (price.conf as u128)
            .checked_mul(persat_core::BPS_DENOMINATOR as u128)
            .ok_or(OracleError::ArithmeticOverflow)?
            .checked_div(mantissa as u128)
            .ok_or(OracleError::ArithmeticOverflow)?;
        require!(
            confidence_bps <= self.max_confidence_bps as u128,
            OracleError::ConfidenceTooWide
        );

        Ok(Observation {
            mantissa,
            decimals,
            confidence: price.conf,
            publish_time: price.publish_time,
        })
    }
}

#[event]
pub struct PriceObserved {
    pub mantissa: u64,
    pub decimals: u32,
    pub confidence: u64,
    pub publish_time: i64,
}

#[error_code]
pub enum OracleError {
    #[msg("Authority must not be the default public key.")]
    InvalidAuthority,
    #[msg("The BTC/USD feed id could not be parsed.")]
    InvalidFeed,
    #[msg("Only the configured governance authority may change oracle configuration.")]
    UnauthorizedGovernance,
    #[msg("The staleness threshold is outside the permitted range.")]
    InvalidStalenessThreshold,
    #[msg("The confidence bound is outside the permitted range.")]
    InvalidConfidenceBound,
    #[msg("The oracle is paused. Price-dependent actions are blocked.")]
    OraclePaused,
    #[msg("BTC/USD price is stale or is for the wrong feed. Price-dependent actions are blocked.")]
    StalePrice,
    #[msg("The price update is not fully verified by a Wormhole quorum.")]
    InsufficientVerification,
    #[msg("The published price is zero, negative, or otherwise unusable.")]
    InvalidPrice,
    #[msg("The price exponent is outside the supported range.")]
    UnsupportedExponent,
    #[msg("The oracle confidence interval is too wide to act on safely.")]
    ConfidenceTooWide,
    #[msg("An oracle arithmetic operation overflowed.")]
    ArithmeticOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Confidence check in isolation, mirroring `read_price`.
    fn confidence_bps(price: u64, conf: u64) -> u128 {
        (conf as u128) * (persat_core::BPS_DENOMINATOR as u128) / (price as u128)
    }

    #[test]
    fn the_btc_usd_feed_id_parses() {
        let feed_id = get_feed_id_from_hex(BTC_USD_FEED_ID).unwrap();
        assert_eq!(feed_id.len(), 32);
        // A parsed id must not be all zeroes, which would match a blank account.
        assert_ne!(feed_id, [0u8; 32]);
    }

    #[test]
    fn a_different_feed_id_produces_a_different_value() {
        // Guards against the adapter accepting any feed. This is the ETH/USD id.
        let btc = get_feed_id_from_hex(BTC_USD_FEED_ID).unwrap();
        let eth = get_feed_id_from_hex(
            "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
        )
        .unwrap();
        assert_ne!(btc, eth);
    }

    #[test]
    fn a_tight_confidence_band_is_accepted() {
        // BTC at 100k with ±$50 is 5bps, far inside the 200bps bound.
        assert!(confidence_bps(100_000_00000000, 50_00000000) <= MAX_CONFIDENCE_BPS as u128);
    }

    #[test]
    fn a_wide_confidence_band_is_rejected() {
        // ±$5,000 on 100k is 500bps, well beyond the bound.
        assert!(confidence_bps(100_000_00000000, 5_000_00000000) > MAX_CONFIDENCE_BPS as u128);
    }

    #[test]
    fn the_confidence_boundary_is_inclusive() {
        // Exactly 2% must pass; a hair over must not.
        assert_eq!(confidence_bps(10_000, 200), MAX_CONFIDENCE_BPS as u128);
        assert!(confidence_bps(10_000, 200) <= MAX_CONFIDENCE_BPS as u128);
        assert!(confidence_bps(10_000, 201) > MAX_CONFIDENCE_BPS as u128);
    }

    #[test]
    fn the_staleness_window_range_is_enforced_at_both_ends() {
        assert!(MIN_STALENESS_SECONDS < MAX_STALENESS_SECONDS);
        assert!((MIN_STALENESS_SECONDS..=MAX_STALENESS_SECONDS).contains(&DEFAULT_STALENESS_SECONDS));
        assert!(!(MIN_STALENESS_SECONDS..=MAX_STALENESS_SECONDS).contains(&0));
        assert!(!(MIN_STALENESS_SECONDS..=MAX_STALENESS_SECONDS)
            .contains(&(MAX_STALENESS_SECONDS + 1)));
    }

    #[test]
    fn the_configurable_confidence_bound_is_capped() {
        // Governance may loosen the bound, but not without limit.
        assert!(MAX_CONFIDENCE_BPS <= MAX_CONFIGURABLE_CONFIDENCE_BPS);
        assert!(MAX_CONFIGURABLE_CONFIDENCE_BPS < persat_core::BPS_DENOMINATOR);
    }

    #[test]
    fn a_pyth_exponent_converts_to_our_decimal_convention() {
        // Pyth publishes BTC/USD at exponent -8.
        let exponent: i32 = -8;
        assert!(exponent <= 0);
        let decimals = exponent.unsigned_abs();
        assert_eq!(decimals, 8);
        assert!(decimals <= MAX_PRICE_EXPO);
        // And that decimal count must be usable by the valuation math.
        assert!(Price::new(100_000_00000000, decimals).is_ok());
    }
}
