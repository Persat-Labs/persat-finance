//! Persat Finance asset whitelist registry.
//!
//! This program is intentionally limited to asset-policy state. It never
//! receives, transfers, escrows, or approves user funds. Escrow and loan
//! programs must read the resulting records and validate their own accounts.

use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/// Maximum loan-to-value permitted by the MVP protocol: 50%.
const MAX_PROTOCOL_LTV_BPS: u16 = 5_000;
const BPS_DENOMINATOR: u16 = 10_000;

#[program]
pub mod asset_whitelist {
    use super::*;

    /// Creates the singleton registry and permanently records its governance authority.
    pub fn initialize_registry(ctx: Context<InitializeRegistry>, governance: Pubkey) -> Result<()> {
        require!(governance != Pubkey::default(), RegistryError::InvalidGovernance);
        let registry = &mut ctx.accounts.registry;
        registry.governance = governance;
        registry.bump = ctx.bumps.registry;
        Ok(())
    }

    /// Adds a supported collateral or loan-currency mint under governance control.
    pub fn add_asset_type(
        ctx: Context<AddAssetType>,
        category: AssetCategory,
        oracle_feed: Pubkey,
        risk: RiskParameters,
    ) -> Result<()> {
        validate_risk_parameters(category, oracle_feed, &risk)?;
        let asset = &mut ctx.accounts.asset;
        asset.registry = ctx.accounts.registry.key();
        asset.mint = ctx.accounts.mint.key();
        asset.category = category;
        asset.oracle_feed = oracle_feed;
        asset.risk = risk;
        asset.active = true;
        asset.bump = ctx.bumps.asset;
        Ok(())
    }

    /// Updates an existing record without changing its mint or category.
    pub fn update_asset_type(
        ctx: Context<UpdateAssetType>,
        oracle_feed: Pubkey,
        risk: RiskParameters,
    ) -> Result<()> {
        validate_risk_parameters(ctx.accounts.asset.category, oracle_feed, &risk)?;
        let asset = &mut ctx.accounts.asset;
        asset.oracle_feed = oracle_feed;
        asset.risk = risk;
        Ok(())
    }

    /// Stops new use of an asset without mutating any existing loan position.
    pub fn deactivate_asset_type(ctx: Context<DeactivateAssetType>) -> Result<()> {
        ctx.accounts.asset.active = false;
        Ok(())
    }
}

fn validate_risk_parameters(category: AssetCategory, oracle_feed: Pubkey, risk: &RiskParameters) -> Result<()> {
    require!(risk.max_ltv_bps > 0 && risk.max_ltv_bps <= MAX_PROTOCOL_LTV_BPS, RegistryError::InvalidMaxLtv);
    require!(risk.partial_liquidation_ltv_bps > risk.max_ltv_bps, RegistryError::InvalidLiquidationOrdering);
    require!(risk.full_liquidation_ltv_bps > risk.partial_liquidation_ltv_bps, RegistryError::InvalidLiquidationOrdering);
    require!(risk.full_liquidation_ltv_bps <= BPS_DENOMINATOR, RegistryError::InvalidLiquidationOrdering);
    if category == AssetCategory::Collateral {
        require!(oracle_feed != Pubkey::default(), RegistryError::MissingCollateralOracle);
    } else {
        // USDC/USDT are explicitly treated as $1 in the MVP; no second price feed is used.
        require!(oracle_feed == Pubkey::default(), RegistryError::UnexpectedLoanCurrencyOracle);
    }
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + AssetRegistry::INIT_SPACE, seeds = [b"asset-registry"], bump)]
    pub registry: Account<'info, AssetRegistry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddAssetType<'info> {
    #[account(has_one = governance @ RegistryError::UnauthorizedGovernance)]
    pub registry: Account<'info, AssetRegistry>,
    #[account(mut)]
    pub governance: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(init, payer = governance, space = 8 + AssetRecord::INIT_SPACE, seeds = [b"asset", registry.key().as_ref(), mint.key().as_ref()], bump)]
    pub asset: Account<'info, AssetRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAssetType<'info> {
    #[account(has_one = governance @ RegistryError::UnauthorizedGovernance)]
    pub registry: Account<'info, AssetRegistry>,
    pub governance: Signer<'info>,
    #[account(mut, has_one = registry, seeds = [b"asset", registry.key().as_ref(), asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Account<'info, AssetRecord>,
}

#[derive(Accounts)]
pub struct DeactivateAssetType<'info> {
    #[account(has_one = governance @ RegistryError::UnauthorizedGovernance)]
    pub registry: Account<'info, AssetRegistry>,
    pub governance: Signer<'info>,
    #[account(mut, has_one = registry, seeds = [b"asset", registry.key().as_ref(), asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Account<'info, AssetRecord>,
}

#[account]
#[derive(InitSpace)]
pub struct AssetRegistry {
    pub governance: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AssetRecord {
    pub registry: Pubkey,
    pub mint: Pubkey,
    pub category: AssetCategory,
    pub oracle_feed: Pubkey,
    pub risk: RiskParameters,
    pub active: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AssetCategory { Collateral, LoanCurrency }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct RiskParameters {
    pub max_ltv_bps: u16,
    pub partial_liquidation_ltv_bps: u16,
    pub full_liquidation_ltv_bps: u16,
}

#[error_code]
pub enum RegistryError {
    #[msg("Governance authority must not be the default public key.")] InvalidGovernance,
    #[msg("Only the configured governance authority may update asset policy.")] UnauthorizedGovernance,
    #[msg("Maximum LTV must be greater than zero and no greater than 50%. ")] InvalidMaxLtv,
    #[msg("Liquidation thresholds must be ordered above the maximum LTV.")] InvalidLiquidationOrdering,
    #[msg("Collateral must use a configured BTC/USD oracle feed.")] MissingCollateralOracle,
    #[msg("Loan currencies use the documented $1 MVP assumption and must not provide an oracle feed.")] UnexpectedLoanCurrencyOracle,
}
