//! Persat Finance fee and treasury program.
//!
//! The fee model is **not finalized**. Per the Technical Architecture this
//! program is kept fully governance-parametrized so whatever structure is
//! eventually chosen — including a different rate for direct-deal versus
//! marketplace-originated loans — can be configured without a contract
//! redesign.
//!
//! Two safety properties hold regardless of what governance configures:
//!
//! * No configurable fee can exceed the 5% protocol cap enforced in
//!   `persat_core::fees`. Governance cannot set a confiscatory rate.
//! * The fee is quoted, not held. This program computes the split and records
//!   the treasury destination; the loan lifecycle program performs the actual
//!   transfer atomically at the FUNDING to ACTIVE transition. This program
//!   never takes custody of user funds.

use anchor_lang::prelude::*;
use persat_core::fees::{split_disbursement, DealOrigin, FeeParameters};

declare_id!("Gnq8qb2Rmnua296VcQ7KHZsuav5ZnWTsP39xCYv8aK5V");

#[program]
pub mod fee_treasury {
    use super::*;

    /// Create the treasury configuration singleton.
    ///
    /// `loan_authority` is the only identity permitted to record collected
    /// fees, so the cumulative total cannot be inflated by an arbitrary
    /// caller replaying self-consistent fee math.
    pub fn initialize_treasury(
        ctx: Context<InitializeTreasury>,
        governance: Pubkey,
        treasury: Pubkey,
        loan_authority: Pubkey,
        direct_origination_fee_bps: u16,
        marketplace_origination_fee_bps: u16,
    ) -> Result<()> {
        require!(
            governance != Pubkey::default()
                && treasury != Pubkey::default()
                && loan_authority != Pubkey::default(),
            FeeError::InvalidAuthority
        );
        let parameters = FeeParameters {
            direct_origination_fee_bps,
            marketplace_origination_fee_bps,
        };
        parameters
            .validate()
            .map_err(|_| error!(FeeError::FeeAboveProtocolCap))?;

        let config = &mut ctx.accounts.config;
        config.governance = governance;
        config.treasury = treasury;
        config.loan_authority = loan_authority;
        config.direct_origination_fee_bps = direct_origination_fee_bps;
        config.marketplace_origination_fee_bps = marketplace_origination_fee_bps;
        config.total_collected_atoms = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Governance-only: update fee parameters.
    pub fn set_fee_parameters(
        ctx: Context<UpdateTreasury>,
        direct_origination_fee_bps: u16,
        marketplace_origination_fee_bps: u16,
    ) -> Result<()> {
        let parameters = FeeParameters {
            direct_origination_fee_bps,
            marketplace_origination_fee_bps,
        };
        parameters
            .validate()
            .map_err(|_| error!(FeeError::FeeAboveProtocolCap))?;
        let config = &mut ctx.accounts.config;
        config.direct_origination_fee_bps = direct_origination_fee_bps;
        config.marketplace_origination_fee_bps = marketplace_origination_fee_bps;
        emit!(FeeParametersUpdated {
            direct_origination_fee_bps,
            marketplace_origination_fee_bps,
        });
        Ok(())
    }

    /// Governance-only: change where fees are sent.
    pub fn set_treasury(ctx: Context<UpdateTreasury>, treasury: Pubkey) -> Result<()> {
        require!(treasury != Pubkey::default(), FeeError::InvalidAuthority);
        ctx.accounts.config.treasury = treasury;
        Ok(())
    }

    /// Record an origination fee collected during activation.
    ///
    /// The fee amount is recomputed here from the configured rate rather than
    /// trusted from the caller, so a caller cannot over-report or under-report
    /// what was actually charged.
    pub fn record_origination_fee(
        ctx: Context<RecordFee>,
        principal_atoms: u64,
        origin: FeeOrigin,
        reported_fee_atoms: u64,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let split = split_disbursement(principal_atoms, config.parameters(), origin.into())
            .map_err(|_| error!(FeeError::FeeAboveProtocolCap))?;
        require!(
            split.to_treasury_atoms == reported_fee_atoms,
            FeeError::FeeMismatch
        );
        require!(
            ctx.accounts.loan_program.key() == config.loan_authority,
            FeeError::UnauthorizedProgram
        );

        let config = &mut ctx.accounts.config;
        config.total_collected_atoms = config
            .total_collected_atoms
            .checked_add(reported_fee_atoms)
            .ok_or(FeeError::ArithmeticOverflow)?;

        emit!(OriginationFeeCollected {
            principal_atoms,
            fee_atoms: reported_fee_atoms,
            origin,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + TreasuryConfig::INIT_SPACE,
        seeds = [b"treasury"],
        bump
    )]
    pub config: Account<'info, TreasuryConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateTreasury<'info> {
    #[account(
        mut,
        has_one = governance @ FeeError::UnauthorizedGovernance,
        seeds = [b"treasury"],
        bump = config.bump
    )]
    pub config: Account<'info, TreasuryConfig>,
    pub governance: Signer<'info>,
}

#[derive(Accounts)]
pub struct RecordFee<'info> {
    #[account(mut, seeds = [b"treasury"], bump = config.bump)]
    pub config: Account<'info, TreasuryConfig>,
    /// The loan lifecycle program, which performed the actual transfer.
    pub loan_program: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct TreasuryConfig {
    pub governance: Pubkey,
    /// Destination that receives origination fees.
    pub treasury: Pubkey,
    /// The loan lifecycle program's authority: the only identity permitted to
    /// record collected fees into `total_collected_atoms`.
    pub loan_authority: Pubkey,
    pub direct_origination_fee_bps: u16,
    pub marketplace_origination_fee_bps: u16,
    /// Cumulative fees recorded, for transparency.
    pub total_collected_atoms: u64,
    pub bump: u8,
}

impl TreasuryConfig {
    pub fn parameters(&self) -> FeeParameters {
        FeeParameters {
            direct_origination_fee_bps: self.direct_origination_fee_bps,
            marketplace_origination_fee_bps: self.marketplace_origination_fee_bps,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum FeeOrigin {
    Direct,
    Marketplace,
}

impl From<FeeOrigin> for DealOrigin {
    fn from(value: FeeOrigin) -> Self {
        match value {
            FeeOrigin::Direct => DealOrigin::Direct,
            FeeOrigin::Marketplace => DealOrigin::Marketplace,
        }
    }
}

#[event]
pub struct FeeParametersUpdated {
    pub direct_origination_fee_bps: u16,
    pub marketplace_origination_fee_bps: u16,
}

#[event]
pub struct OriginationFeeCollected {
    pub principal_atoms: u64,
    pub fee_atoms: u64,
    pub origin: FeeOrigin,
}

#[error_code]
pub enum FeeError {
    #[msg("Authority must not be the default public key.")]
    InvalidAuthority,
    #[msg("Only the configured governance authority may change fee parameters.")]
    UnauthorizedGovernance,
    #[msg("The requested fee exceeds the protocol maximum of 5%.")]
    FeeAboveProtocolCap,
    #[msg("The reported fee does not match the configured fee schedule.")]
    FeeMismatch,
    #[msg("A treasury arithmetic operation overflowed.")]
    ArithmeticOverflow,
    #[msg("Only the loan program's recorded authority may record collected fees.")]
    UnauthorizedProgram,
}

#[cfg(test)]
mod tests {
    use super::*;
    use persat_core::fees::MAX_ORIGINATION_FEE_BPS;

    fn config() -> TreasuryConfig {
        TreasuryConfig {
            governance: Pubkey::new_unique(),
            treasury: Pubkey::new_unique(),
            loan_authority: Pubkey::new_unique(),
            direct_origination_fee_bps: 50,
            marketplace_origination_fee_bps: 100,
            total_collected_atoms: 0,
            bump: 255,
        }
    }

    #[test]
    fn configured_parameters_round_trip() {
        let parameters = config().parameters();
        assert_eq!(parameters.direct_origination_fee_bps, 50);
        assert_eq!(parameters.marketplace_origination_fee_bps, 100);
        assert!(parameters.validate().is_ok());
    }

    #[test]
    fn a_rate_above_the_cap_is_rejected() {
        let parameters = FeeParameters {
            direct_origination_fee_bps: MAX_ORIGINATION_FEE_BPS + 1,
            marketplace_origination_fee_bps: 0,
        };
        assert!(parameters.validate().is_err());
    }

    #[test]
    fn each_origin_resolves_to_its_own_rate() {
        let parameters = config().parameters();
        let direct = split_disbursement(1_000_000_000, parameters, DealOrigin::Direct).unwrap();
        let market =
            split_disbursement(1_000_000_000, parameters, DealOrigin::Marketplace).unwrap();
        assert_eq!(direct.to_treasury_atoms, 5_000_000);
        assert_eq!(market.to_treasury_atoms, 10_000_000);
        assert!(market.to_treasury_atoms > direct.to_treasury_atoms);
    }

    #[test]
    fn the_fee_origin_mapping_is_faithful() {
        assert_eq!(DealOrigin::from(FeeOrigin::Direct), DealOrigin::Direct);
        assert_eq!(
            DealOrigin::from(FeeOrigin::Marketplace),
            DealOrigin::Marketplace
        );
    }
}
