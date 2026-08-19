//! Persat Finance asset whitelist registry.
//!
//! This program is intentionally limited to asset *policy*. It never receives,
//! transfers, escrows, or approves user funds. Escrow and loan programs read
//! these records and validate their own accounts.
//!
//! Both categories live in one registry so that adding a future asset — another
//! bridge, another stablecoin, or eventually a different collateral class —
//! follows a single governance-gated pattern rather than a new contract.
//!
//! Policy encoded here, per the Technical Architecture:
//!
//! * Collateral is restricted to trust-minimized BTC representations (tBTC,
//!   zBTC). Custodial wrapped Bitcoin (cbBTC, WBTC) and CeFi-adjacent reserve
//!   tokens (SolvBTC) are excluded. `add_asset_type` is governance-gated
//!   precisely so a custodial token cannot appear without a deliberate,
//!   visible governance action. The default posture is restrictive.
//! * Loan currency is restricted to USDC and USDT, treated as exactly $1.
//! * Collateral requires an oracle feed; loan currency must not carry one.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use persat_core::{liquidation::RiskThresholds, MAX_PROTOCOL_LTV_BPS};

declare_id!("7K66UwFGxZP5TJRRiQQXMV63yUz4v5K45sMiy6qwunZ5");

/// Maximum share of collateral a single partial liquidation may seize.
pub const MAX_PARTIAL_LIQUIDATION_BPS: u16 = 5_000;

#[program]
pub mod asset_whitelist {
    use super::*;

    /// Create the singleton registry and record its governance authority.
    pub fn initialize_registry(ctx: Context<InitializeRegistry>, governance: Pubkey) -> Result<()> {
        require!(
            governance != Pubkey::default(),
            RegistryError::InvalidGovernance
        );
        let registry = &mut ctx.accounts.registry;
        registry.governance = governance;
        registry.asset_count = 0;
        registry.bump = ctx.bumps.registry;
        Ok(())
    }

    /// Add a supported collateral or loan-currency mint under governance control.
    pub fn add_asset_type(
        ctx: Context<AddAssetType>,
        category: AssetCategory,
        oracle_feed: Pubkey,
        risk: RiskParameters,
    ) -> Result<()> {
        validate_asset_policy(
            category,
            oracle_feed,
            &risk,
            ctx.accounts.mint.decimals,
        )?;
        let registry_key = ctx.accounts.registry.key();
        let asset = &mut ctx.accounts.asset;
        asset.registry = registry_key;
        asset.mint = ctx.accounts.mint.key();
        asset.category = category;
        asset.oracle_feed = oracle_feed;
        asset.risk = risk;
        asset.decimals = ctx.accounts.mint.decimals;
        asset.active = true;
        asset.bump = ctx.bumps.asset;

        let registry = &mut ctx.accounts.registry;
        registry.asset_count = registry
            .asset_count
            .checked_add(1)
            .ok_or(RegistryError::ArithmeticOverflow)?;

        emit!(AssetRegistered {
            mint: asset.mint,
            category,
            max_ltv_bps: risk.max_ltv_bps,
        });
        Ok(())
    }

    /// Update an existing record without changing its mint or category.
    ///
    /// Category is immutable by design: reclassifying collateral as loan
    /// currency (or the reverse) would reinterpret every existing position that
    /// references it.
    pub fn update_asset_type(
        ctx: Context<UpdateAssetType>,
        oracle_feed: Pubkey,
        risk: RiskParameters,
    ) -> Result<()> {
        let category = ctx.accounts.asset.category;
        let decimals = ctx.accounts.asset.decimals;
        validate_asset_policy(category, oracle_feed, &risk, decimals)?;
        let asset = &mut ctx.accounts.asset;
        asset.oracle_feed = oracle_feed;
        asset.risk = risk;
        emit!(AssetUpdated {
            mint: asset.mint,
            max_ltv_bps: risk.max_ltv_bps,
        });
        Ok(())
    }

    /// Stop new use of an asset without mutating any existing loan position.
    ///
    /// Deactivation is deliberately not deletion. Live loans continue to
    /// reference the record for valuation and liquidation; only new deposits
    /// are refused.
    pub fn deactivate_asset_type(ctx: Context<UpdateAssetType>) -> Result<()> {
        let asset = &mut ctx.accounts.asset;
        require!(asset.active, RegistryError::AssetAlreadyInactive);
        asset.active = false;
        emit!(AssetDeactivated { mint: asset.mint });
        Ok(())
    }

    /// Re-enable a previously deactivated asset.
    pub fn reactivate_asset_type(ctx: Context<UpdateAssetType>) -> Result<()> {
        let asset = &mut ctx.accounts.asset;
        require!(!asset.active, RegistryError::AssetAlreadyActive);
        asset.active = true;
        Ok(())
    }
}

/// Validate an asset record against protocol policy.
fn validate_asset_policy(
    category: AssetCategory,
    oracle_feed: Pubkey,
    risk: &RiskParameters,
    decimals: u8,
) -> Result<()> {
    // Reuse the shared, fuzz-tested threshold ordering rule so the registry and
    // the liquidation engine can never disagree about what is valid.
    let thresholds: RiskThresholds = (*risk).into();
    thresholds
        .validate(MAX_PROTOCOL_LTV_BPS)
        .map_err(|_| error!(RegistryError::InvalidRiskParameters))?;
    require!(
        risk.liquidation_penalty_bps <= persat_core::BPS_DENOMINATOR as u16,
        RegistryError::InvalidRiskParameters
    );
    require!(
        risk.max_partial_liquidation_bps > 0
            && risk.max_partial_liquidation_bps <= MAX_PARTIAL_LIQUIDATION_BPS,
        RegistryError::InvalidRiskParameters
    );

    match category {
        AssetCategory::Collateral => {
            require!(
                oracle_feed != Pubkey::default(),
                RegistryError::MissingCollateralOracle
            );
            // tBTC and zBTC are both 8-decimal. A mint that does not match is
            // not the asset the risk parameters were calibrated against.
            require!(
                decimals == persat_core::BTC_DECIMALS,
                RegistryError::UnexpectedCollateralDecimals
            );
        }
        AssetCategory::LoanCurrency => {
            // USDC/USDT are treated as $1 in the MVP; no second feed is used.
            require!(
                oracle_feed == Pubkey::default(),
                RegistryError::UnexpectedLoanCurrencyOracle
            );
        }
    }
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + AssetRegistry::INIT_SPACE,
        seeds = [b"asset-registry"],
        bump
    )]
    pub registry: Account<'info, AssetRegistry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddAssetType<'info> {
    #[account(
        mut,
        has_one = governance @ RegistryError::UnauthorizedGovernance,
        seeds = [b"asset-registry"],
        bump = registry.bump
    )]
    pub registry: Account<'info, AssetRegistry>,
    #[account(mut)]
    pub governance: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = governance,
        space = 8 + AssetRecord::INIT_SPACE,
        seeds = [b"asset", registry.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub asset: Account<'info, AssetRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAssetType<'info> {
    #[account(
        has_one = governance @ RegistryError::UnauthorizedGovernance,
        seeds = [b"asset-registry"],
        bump = registry.bump
    )]
    pub registry: Account<'info, AssetRegistry>,
    pub governance: Signer<'info>,
    #[account(
        mut,
        has_one = registry @ RegistryError::AssetRegistryMismatch,
        seeds = [b"asset", registry.key().as_ref(), asset.mint.as_ref()],
        bump = asset.bump
    )]
    pub asset: Account<'info, AssetRecord>,
}

#[account]
#[derive(InitSpace)]
pub struct AssetRegistry {
    pub governance: Pubkey,
    /// Number of assets ever registered, for auditability.
    pub asset_count: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AssetRecord {
    pub registry: Pubkey,
    pub mint: Pubkey,
    pub category: AssetCategory,
    /// BTC/USD feed for collateral; default (all zeroes) for loan currency.
    pub oracle_feed: Pubkey,
    pub risk: RiskParameters,
    /// Mint decimals, captured at registration so valuation cannot drift.
    pub decimals: u8,
    pub active: bool,
    pub bump: u8,
}

impl AssetRecord {
    /// Whether this record may back a *new* deposit in the given category.
    ///
    /// This is the `is_accepted(mint, category)` check every other program
    /// performs before accepting collateral or disbursing a loan.
    pub fn is_accepted(&self, category: AssetCategory) -> bool {
        self.active && self.category == category
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AssetCategory {
    Collateral,
    LoanCurrency,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct RiskParameters {
    /// Maximum LTV at origination. Never above the 50% protocol ceiling.
    pub max_ltv_bps: u16,
    /// LTV at which partial liquidation becomes permitted.
    pub partial_liquidation_ltv_bps: u16,
    /// LTV at which the position is fully liquidated.
    pub full_liquidation_ltv_bps: u16,
    /// Penalty added to a missed payment during partial liquidation.
    pub liquidation_penalty_bps: u16,
    /// Cap on how much collateral one partial liquidation may seize.
    pub max_partial_liquidation_bps: u16,
}

impl From<RiskParameters> for RiskThresholds {
    fn from(value: RiskParameters) -> Self {
        Self {
            max_ltv_bps: value.max_ltv_bps,
            partial_liquidation_ltv_bps: value.partial_liquidation_ltv_bps,
            full_liquidation_ltv_bps: value.full_liquidation_ltv_bps,
        }
    }
}

#[event]
pub struct AssetRegistered {
    pub mint: Pubkey,
    pub category: AssetCategory,
    pub max_ltv_bps: u16,
}

#[event]
pub struct AssetUpdated {
    pub mint: Pubkey,
    pub max_ltv_bps: u16,
}

#[event]
pub struct AssetDeactivated {
    pub mint: Pubkey,
}

#[error_code]
pub enum RegistryError {
    #[msg("Governance authority must not be the default public key.")]
    InvalidGovernance,
    #[msg("Only the configured governance authority may update asset policy.")]
    UnauthorizedGovernance,
    #[msg("Risk parameters must satisfy 0 < max LTV <= 50% < partial < full <= 100%.")]
    InvalidRiskParameters,
    #[msg("Collateral must use a configured BTC/USD oracle feed.")]
    MissingCollateralOracle,
    #[msg("Collateral mints must use the 8 decimals tBTC and zBTC share.")]
    UnexpectedCollateralDecimals,
    #[msg("Loan currencies use the documented $1 MVP assumption and must not provide an oracle feed.")]
    UnexpectedLoanCurrencyOracle,
    #[msg("The asset record does not belong to this registry.")]
    AssetRegistryMismatch,
    #[msg("The asset is already inactive.")]
    AssetAlreadyInactive,
    #[msg("The asset is already active.")]
    AssetAlreadyActive,
    #[msg("A registry arithmetic operation overflowed.")]
    ArithmeticOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collateral_risk() -> RiskParameters {
        RiskParameters {
            max_ltv_bps: 5_000,
            partial_liquidation_ltv_bps: 7_000,
            full_liquidation_ltv_bps: 8_000,
            liquidation_penalty_bps: 500,
            max_partial_liquidation_bps: 2_000,
        }
    }

    fn feed() -> Pubkey {
        Pubkey::new_unique()
    }

    #[test]
    fn a_valid_collateral_asset_is_accepted() {
        assert!(validate_asset_policy(
            AssetCategory::Collateral,
            feed(),
            &collateral_risk(),
            8
        )
        .is_ok());
    }

    #[test]
    fn a_valid_loan_currency_is_accepted() {
        assert!(validate_asset_policy(
            AssetCategory::LoanCurrency,
            Pubkey::default(),
            &collateral_risk(),
            6
        )
        .is_ok());
    }

    #[test]
    fn collateral_without_an_oracle_feed_is_rejected() {
        assert!(validate_asset_policy(
            AssetCategory::Collateral,
            Pubkey::default(),
            &collateral_risk(),
            8
        )
        .is_err());
    }

    #[test]
    fn a_loan_currency_carrying_an_oracle_feed_is_rejected() {
        // Guards the documented single-oracle assumption.
        assert!(validate_asset_policy(
            AssetCategory::LoanCurrency,
            feed(),
            &collateral_risk(),
            6
        )
        .is_err());
    }

    #[test]
    fn collateral_with_unexpected_decimals_is_rejected() {
        assert!(validate_asset_policy(
            AssetCategory::Collateral,
            feed(),
            &collateral_risk(),
            6
        )
        .is_err());
    }

    #[test]
    fn an_ltv_above_the_fifty_percent_ceiling_is_rejected() {
        let mut risk = collateral_risk();
        risk.max_ltv_bps = 5_001;
        assert!(validate_asset_policy(AssetCategory::Collateral, feed(), &risk, 8).is_err());
    }

    #[test]
    fn unordered_liquidation_thresholds_are_rejected() {
        let mut risk = collateral_risk();
        risk.partial_liquidation_ltv_bps = 4_000; // below max LTV
        assert!(validate_asset_policy(AssetCategory::Collateral, feed(), &risk, 8).is_err());

        let mut risk = collateral_risk();
        risk.full_liquidation_ltv_bps = 6_000; // below partial
        assert!(validate_asset_policy(AssetCategory::Collateral, feed(), &risk, 8).is_err());
    }

    #[test]
    fn a_zero_ltv_asset_is_rejected() {
        let mut risk = collateral_risk();
        risk.max_ltv_bps = 0;
        assert!(validate_asset_policy(AssetCategory::Collateral, feed(), &risk, 8).is_err());
    }

    #[test]
    fn an_uncapped_partial_liquidation_is_rejected() {
        let mut risk = collateral_risk();
        risk.max_partial_liquidation_bps = 0;
        assert!(validate_asset_policy(AssetCategory::Collateral, feed(), &risk, 8).is_err());

        let mut risk = collateral_risk();
        risk.max_partial_liquidation_bps = MAX_PARTIAL_LIQUIDATION_BPS + 1;
        assert!(validate_asset_policy(AssetCategory::Collateral, feed(), &risk, 8).is_err());
    }

    #[test]
    fn is_accepted_requires_both_the_right_category_and_an_active_record() {
        let record = AssetRecord {
            registry: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            category: AssetCategory::Collateral,
            oracle_feed: feed(),
            risk: collateral_risk(),
            decimals: 8,
            active: true,
            bump: 255,
        };
        assert!(record.is_accepted(AssetCategory::Collateral));
        // A collateral asset must never satisfy a loan-currency check.
        assert!(!record.is_accepted(AssetCategory::LoanCurrency));

        let mut inactive = record;
        inactive.active = false;
        assert!(!inactive.is_accepted(AssetCategory::Collateral));
    }
}
