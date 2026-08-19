//! Fee and treasury math.
//!
//! The origination fee is **2%** for the MVP, applied equally to direct-deal and
//! marketplace-originated loans. It is collected once, at the FUNDING to ACTIVE
//! transition, and is charged to the borrower out of the disbursed principal.
//!
//! The program remains fully governance-parametrized, and the two paths keep
//! separate rate fields, so the architecture's open question — whether the two
//! origination paths should eventually diverge — can be answered later without
//! a contract redesign. Both fields simply default to the same 2% today.
//!
//! What no configuration can change is the safety envelope: no fee may exceed
//! the hard cap below, regardless of what governance sets.

use crate::MathError;

/// Hard ceiling on any origination fee: 5%.
///
/// This is a protocol constant, not a governance parameter. It bounds the worst
/// case a compromised or mistaken governance action could impose on a borrower.
pub const MAX_ORIGINATION_FEE_BPS: u16 = 500;

/// The MVP origination fee: 2%, identical on both origination paths.
pub const DEFAULT_ORIGINATION_FEE_BPS: u16 = 200;

/// Which path a deal originated from, so fees can eventually differ by path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DealOrigin {
    /// A private deal created directly or claimed through a deal link.
    Direct,
    /// A deal that began as a public marketplace listing.
    Marketplace,
}

/// Governance-configurable fee parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeeParameters {
    /// Origination fee applied to direct deals.
    pub direct_origination_fee_bps: u16,
    /// Origination fee applied to marketplace-originated deals.
    pub marketplace_origination_fee_bps: u16,
}

impl Default for FeeParameters {
    /// The launch configuration: 2% on both paths.
    fn default() -> Self {
        Self {
            direct_origination_fee_bps: DEFAULT_ORIGINATION_FEE_BPS,
            marketplace_origination_fee_bps: DEFAULT_ORIGINATION_FEE_BPS,
        }
    }
}

impl FeeParameters {
    /// Reject any parameter set that breaches the protocol cap.
    pub fn validate(&self) -> Result<(), MathError> {
        if self.direct_origination_fee_bps > MAX_ORIGINATION_FEE_BPS
            || self.marketplace_origination_fee_bps > MAX_ORIGINATION_FEE_BPS
        {
            return Err(MathError::InvalidParameter);
        }
        Ok(())
    }

    /// The fee rate that applies to a given origin.
    pub fn rate_for(&self, origin: DealOrigin) -> u16 {
        match origin {
            DealOrigin::Direct => self.direct_origination_fee_bps,
            DealOrigin::Marketplace => self.marketplace_origination_fee_bps,
        }
    }
}

/// How a disbursement splits between the borrower and the treasury.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Disbursement {
    /// Amount actually delivered to the borrower.
    pub to_borrower_atoms: u64,
    /// Origination fee routed to the treasury.
    pub to_treasury_atoms: u64,
}

/// Split a principal into the borrower's share and the origination fee.
///
/// The fee rounds **down**, so rounding favours the user rather than the
/// protocol, and the two parts always sum to exactly the principal.
pub fn split_disbursement(
    principal_atoms: u64,
    parameters: FeeParameters,
    origin: DealOrigin,
) -> Result<Disbursement, MathError> {
    parameters.validate()?;
    let fee = crate::apply_bps(principal_atoms, parameters.rate_for(origin))?;
    let to_borrower = principal_atoms.checked_sub(fee).ok_or(MathError::Overflow)?;
    Ok(Disbursement {
        to_borrower_atoms: to_borrower,
        to_treasury_atoms: fee,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parameters() -> FeeParameters {
        FeeParameters {
            direct_origination_fee_bps: 50,
            marketplace_origination_fee_bps: 100,
        }
    }

    #[test]
    fn a_fee_above_the_protocol_cap_is_rejected() {
        let bad = FeeParameters {
            direct_origination_fee_bps: MAX_ORIGINATION_FEE_BPS + 1,
            marketplace_origination_fee_bps: 0,
        };
        assert_eq!(bad.validate(), Err(MathError::InvalidParameter));

        let bad = FeeParameters {
            direct_origination_fee_bps: 0,
            marketplace_origination_fee_bps: MAX_ORIGINATION_FEE_BPS + 1,
        };
        assert_eq!(bad.validate(), Err(MathError::InvalidParameter));
    }

    #[test]
    fn the_cap_itself_is_permitted() {
        let at_cap = FeeParameters {
            direct_origination_fee_bps: MAX_ORIGINATION_FEE_BPS,
            marketplace_origination_fee_bps: MAX_ORIGINATION_FEE_BPS,
        };
        assert!(at_cap.validate().is_ok());
    }

    #[test]
    fn each_path_can_carry_its_own_rate() {
        assert_eq!(parameters().rate_for(DealOrigin::Direct), 50);
        assert_eq!(parameters().rate_for(DealOrigin::Marketplace), 100);
    }

    #[test]
    fn the_split_always_conserves_the_principal() {
        for principal in [0u64, 1, 999, 1_000_000_000, u32::MAX as u64] {
            for origin in [DealOrigin::Direct, DealOrigin::Marketplace] {
                let split = split_disbursement(principal, parameters(), origin).unwrap();
                assert_eq!(
                    split.to_borrower_atoms + split.to_treasury_atoms,
                    principal,
                    "value created or destroyed at principal {principal}"
                );
            }
        }
    }

    #[test]
    fn a_marketplace_deal_pays_the_marketplace_rate() {
        // 10_000 USDC at 100bps => 100 USDC fee.
        let split =
            split_disbursement(10_000_000_000, parameters(), DealOrigin::Marketplace).unwrap();
        assert_eq!(split.to_treasury_atoms, 100_000_000);
        assert_eq!(split.to_borrower_atoms, 9_900_000_000);
    }

    #[test]
    fn a_zero_fee_configuration_charges_nothing() {
        let free = FeeParameters {
            direct_origination_fee_bps: 0,
            marketplace_origination_fee_bps: 0,
        };
        let split = split_disbursement(1_000_000, free, DealOrigin::Direct).unwrap();
        assert_eq!(split.to_treasury_atoms, 0);
        assert_eq!(split.to_borrower_atoms, 1_000_000);
    }

    #[test]
    fn dust_rounds_in_the_users_favour() {
        // 1 atom at 50bps rounds down to no fee rather than taking the atom.
        let split = split_disbursement(1, parameters(), DealOrigin::Direct).unwrap();
        assert_eq!(split.to_treasury_atoms, 0);
        assert_eq!(split.to_borrower_atoms, 1);
    }

    #[test]
    fn the_default_configuration_is_two_percent_on_both_paths() {
        let defaults = FeeParameters::default();
        assert_eq!(defaults.direct_origination_fee_bps, 200);
        assert_eq!(defaults.marketplace_origination_fee_bps, 200);
        assert!(defaults.validate().is_ok());
    }

    #[test]
    fn the_default_fee_on_ten_thousand_usdc_is_two_hundred() {
        // 10_000 USDC (6dp) at 2% => 200 USDC to treasury, 9_800 to borrower.
        let split =
            split_disbursement(10_000_000_000, FeeParameters::default(), DealOrigin::Direct)
                .unwrap();
        assert_eq!(split.to_treasury_atoms, 200_000_000);
        assert_eq!(split.to_borrower_atoms, 9_800_000_000);
    }

    #[test]
    fn the_default_fee_is_well_inside_the_protocol_cap() {
        assert!(DEFAULT_ORIGINATION_FEE_BPS < MAX_ORIGINATION_FEE_BPS);
    }

    #[test]
    fn the_borrower_always_receives_the_majority_of_the_principal() {
        // With a 5% cap, the borrower can never receive less than 95%.
        let at_cap = FeeParameters {
            direct_origination_fee_bps: MAX_ORIGINATION_FEE_BPS,
            marketplace_origination_fee_bps: MAX_ORIGINATION_FEE_BPS,
        };
        let split = split_disbursement(1_000_000_000, at_cap, DealOrigin::Direct).unwrap();
        assert_eq!(split.to_treasury_atoms, 50_000_000);
        assert!(split.to_borrower_atoms >= 950_000_000);
    }
}
