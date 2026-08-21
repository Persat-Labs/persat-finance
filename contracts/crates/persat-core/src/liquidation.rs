//! Liquidation evaluation and seizure sizing.
//!
//! Two distinct triggers exist, and they are deliberately not the same event:
//!
//! * **Partial liquidation** follows a *missed payment*. It seizes only enough
//!   collateral to cover that missed installment plus a penalty, capped, and
//!   the loan continues with reduced collateral.
//! * **Full liquidation** follows an *LTV breach* at the full threshold, or a
//!   terminal default. It repays the lender in full and returns any surplus to
//!   the borrower.
//!
//! Every seizure is capped at the collateral actually present. The engine can
//! never seize collateral that does not exist, and never seizes more than the
//! debt it is settling plus the configured penalty.

use crate::{ltv::current_ltv_bps, MathError};

/// Health of a position against its configured thresholds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PositionHealth {
    /// Current loan-to-value in basis points.
    pub current_ltv_bps: u64,
    /// Position has crossed the partial-liquidation threshold.
    pub is_partial_liquidatable: bool,
    /// Position has crossed the full-liquidation threshold.
    pub is_fully_liquidatable: bool,
}

/// Risk thresholds for an asset, mirroring the Asset Whitelist Registry record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RiskThresholds {
    /// Maximum LTV permitted at origination.
    pub max_ltv_bps: u16,
    /// LTV at which partial liquidation becomes permitted.
    pub partial_liquidation_ltv_bps: u16,
    /// LTV at which the whole position is liquidated.
    pub full_liquidation_ltv_bps: u16,
}

impl RiskThresholds {
    /// Validate the strict ordering the protocol depends on.
    ///
    /// `0 < max < partial < full <= 10_000`. If these were ever allowed to
    /// cross, a position could be simultaneously openable and liquidatable.
    pub fn validate(&self, max_protocol_ltv_bps: u16) -> Result<(), MathError> {
        if self.max_ltv_bps == 0 || self.max_ltv_bps > max_protocol_ltv_bps {
            return Err(MathError::InvalidParameter);
        }
        if self.partial_liquidation_ltv_bps <= self.max_ltv_bps {
            return Err(MathError::InvalidParameter);
        }
        if self.full_liquidation_ltv_bps <= self.partial_liquidation_ltv_bps {
            return Err(MathError::InvalidParameter);
        }
        if self.full_liquidation_ltv_bps as u64 > crate::BPS_DENOMINATOR {
            return Err(MathError::InvalidParameter);
        }
        Ok(())
    }
}

/// Evaluate a position against its thresholds.
pub fn evaluate_position(
    outstanding_debt_atoms: u64,
    collateral_value_atoms: u64,
    thresholds: RiskThresholds,
) -> Result<PositionHealth, MathError> {
    let ltv = current_ltv_bps(outstanding_debt_atoms, collateral_value_atoms)?;
    Ok(PositionHealth {
        current_ltv_bps: ltv,
        is_partial_liquidatable: ltv >= thresholds.partial_liquidation_ltv_bps as u64,
        is_fully_liquidatable: ltv >= thresholds.full_liquidation_ltv_bps as u64,
    })
}

/// Collateral to seize for a missed payment, in collateral atoms.
///
/// Covers the missed installment plus `penalty_bps`, converted to collateral at
/// the current price, then capped by both:
///
/// * `max_partial_bps` of the posted collateral, so one missed payment can
///   never wipe out a position; and
/// * the collateral actually available.
pub fn partial_liquidation_amount(
    missed_payment_atoms: u64,
    penalty_bps: u16,
    collateral_atoms: u64,
    collateral_value_atoms: u64,
    max_partial_bps: u16,
) -> Result<u64, MathError> {
    if collateral_atoms == 0 || collateral_value_atoms == 0 {
        return Ok(0);
    }
    let penalty = crate::apply_bps_ceil(missed_payment_atoms, penalty_bps)?;
    let target_value = missed_payment_atoms
        .checked_add(penalty)
        .ok_or(MathError::Overflow)?;
    // Convert the owed value into collateral atoms, rounding up so the seizure
    // genuinely covers what is owed.
    let seize = crate::mul_div_ceil(collateral_atoms, target_value, collateral_value_atoms)?;
    // Cap 1: never take more than the configured share of posted collateral.
    let cap = crate::apply_bps(collateral_atoms, max_partial_bps)?;
    let seize = if seize > cap { cap } else { seize };
    // Cap 2: never take more than exists.
    Ok(if seize > collateral_atoms { collateral_atoms } else { seize })
}

/// Outcome of a full liquidation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FullLiquidation {
    /// Collateral seized and sold to repay the lender.
    pub seized_atoms: u64,
    /// Collateral returned to the borrower.
    pub surplus_atoms: u64,
    /// Debt left unpaid because the collateral did not cover it.
    pub shortfall_atoms: u64,
}

/// Resolve a full liquidation.
///
/// The lender is repaid as fully as the collateral allows, and every remaining
/// atom belongs to the borrower. Seized plus surplus always equals exactly the
/// collateral that was posted — the protocol keeps nothing here.
pub fn full_liquidation(
    outstanding_debt_atoms: u64,
    collateral_atoms: u64,
    collateral_value_atoms: u64,
) -> Result<FullLiquidation, MathError> {
    if collateral_atoms == 0 {
        return Ok(FullLiquidation {
            seized_atoms: 0,
            surplus_atoms: 0,
            shortfall_atoms: outstanding_debt_atoms,
        });
    }
    if collateral_value_atoms == 0 {
        // Collateral exists but is worthless: it cannot repay anything, and it
        // still belongs to the borrower.
        return Ok(FullLiquidation {
            seized_atoms: 0,
            surplus_atoms: collateral_atoms,
            shortfall_atoms: outstanding_debt_atoms,
        });
    }
    if collateral_value_atoms <= outstanding_debt_atoms {
        // Underwater: everything goes to the lender and debt may remain.
        let shortfall = outstanding_debt_atoms
            .checked_sub(collateral_value_atoms)
            .ok_or(MathError::Overflow)?;
        return Ok(FullLiquidation {
            seized_atoms: collateral_atoms,
            surplus_atoms: 0,
            shortfall_atoms: shortfall,
        });
    }
    // Healthy enough to cover the debt: seize only what the debt requires,
    // rounding up so the lender is made whole, and return the rest.
    let seized = crate::mul_div_ceil(
        collateral_atoms,
        outstanding_debt_atoms,
        collateral_value_atoms,
    )?;
    let seized = if seized > collateral_atoms { collateral_atoms } else { seized };
    let surplus = collateral_atoms
        .checked_sub(seized)
        .ok_or(MathError::Overflow)?;
    Ok(FullLiquidation {
        seized_atoms: seized,
        surplus_atoms: surplus,
        shortfall_atoms: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thresholds() -> RiskThresholds {
        RiskThresholds {
            max_ltv_bps: 5_000,
            partial_liquidation_ltv_bps: 7_000,
            full_liquidation_ltv_bps: 8_000,
        }
    }

    #[test]
    fn valid_thresholds_are_accepted() {
        assert!(thresholds().validate(5_000).is_ok());
    }

    #[test]
    fn thresholds_must_be_strictly_ordered() {
        let mut bad = thresholds();
        bad.partial_liquidation_ltv_bps = 5_000; // equal to max
        assert_eq!(bad.validate(5_000), Err(MathError::InvalidParameter));

        let mut bad = thresholds();
        bad.full_liquidation_ltv_bps = 7_000; // equal to partial
        assert_eq!(bad.validate(5_000), Err(MathError::InvalidParameter));

        let mut bad = thresholds();
        bad.full_liquidation_ltv_bps = 10_001; // beyond 100%
        assert_eq!(bad.validate(5_000), Err(MathError::InvalidParameter));
    }

    #[test]
    fn max_ltv_cannot_exceed_the_protocol_ceiling() {
        let mut bad = thresholds();
        bad.max_ltv_bps = 5_001;
        assert_eq!(bad.validate(5_000), Err(MathError::InvalidParameter));
        bad.max_ltv_bps = 0;
        assert_eq!(bad.validate(5_000), Err(MathError::InvalidParameter));
    }

    #[test]
    fn a_healthy_position_is_not_liquidatable() {
        let health = evaluate_position(50_000_000_000, 100_000_000_000, thresholds()).unwrap();
        assert_eq!(health.current_ltv_bps, 5_000);
        assert!(!health.is_partial_liquidatable);
        assert!(!health.is_fully_liquidatable);
    }

    #[test]
    fn crossing_the_partial_threshold_is_detected_exactly() {
        // Exactly 7000bps must trigger; one bps below must not.
        let at = evaluate_position(70_000_000_000, 100_000_000_000, thresholds()).unwrap();
        assert!(at.is_partial_liquidatable);
        assert!(!at.is_fully_liquidatable);

        let below = evaluate_position(69_990_000_000, 100_000_000_000, thresholds()).unwrap();
        assert!(!below.is_partial_liquidatable);
    }

    #[test]
    fn crossing_the_full_threshold_implies_both_flags() {
        let health = evaluate_position(85_000_000_000, 100_000_000_000, thresholds()).unwrap();
        assert!(health.is_partial_liquidatable);
        assert!(health.is_fully_liquidatable);
    }

    #[test]
    fn a_position_with_no_collateral_value_is_fully_liquidatable() {
        let health = evaluate_position(1, 0, thresholds()).unwrap();
        assert!(health.is_fully_liquidatable);
    }

    #[test]
    fn partial_liquidation_covers_the_payment_plus_penalty() {
        // 1 BTC posted, worth 100k. Missed payment 1_000 USDC, 5% penalty
        // => 1_050 USDC of collateral => 0.0105 BTC.
        let seized = partial_liquidation_amount(
            1_000_000_000,
            500,
            100_000_000,
            100_000_000_000,
            2_000,
        )
        .unwrap();
        assert_eq!(seized, 1_050_000);
    }

    #[test]
    fn partial_liquidation_is_capped_so_one_miss_cannot_wipe_a_position() {
        // A huge missed payment must still be capped at 20% of collateral.
        let seized = partial_liquidation_amount(
            90_000_000_000,
            500,
            100_000_000,
            100_000_000_000,
            2_000,
        )
        .unwrap();
        assert_eq!(seized, 20_000_000);
    }

    #[test]
    fn partial_liquidation_never_exceeds_available_collateral() {
        let seized = partial_liquidation_amount(
            90_000_000_000,
            500,
            100_000_000,
            100_000_000_000,
            10_000,
        )
        .unwrap();
        assert!(seized <= 100_000_000);
    }

    #[test]
    fn partial_liquidation_on_an_empty_vault_seizes_nothing() {
        assert_eq!(
            partial_liquidation_amount(1_000, 500, 0, 100_000, 2_000).unwrap(),
            0
        );
        assert_eq!(
            partial_liquidation_amount(1_000, 500, 100_000, 0, 2_000).unwrap(),
            0
        );
    }

    #[test]
    fn full_liquidation_returns_surplus_to_the_borrower() {
        // 1 BTC worth 100k against 50k of debt: seize half, return half.
        let result = full_liquidation(50_000_000_000, 100_000_000, 100_000_000_000).unwrap();
        assert_eq!(result.seized_atoms, 50_000_000);
        assert_eq!(result.surplus_atoms, 50_000_000);
        assert_eq!(result.shortfall_atoms, 0);
    }

    #[test]
    fn full_liquidation_conserves_every_atom_of_collateral() {
        for debt in [1u64, 10_000_000_000, 99_999_999_999, 100_000_000_000] {
            let result = full_liquidation(debt, 100_000_000, 100_000_000_000).unwrap();
            assert_eq!(
                result.seized_atoms + result.surplus_atoms,
                100_000_000,
                "collateral was created or destroyed at debt {debt}"
            );
        }
    }

    #[test]
    fn an_underwater_position_seizes_everything_and_records_the_shortfall() {
        // Debt 120k against collateral worth 100k.
        let result = full_liquidation(120_000_000_000, 100_000_000, 100_000_000_000).unwrap();
        assert_eq!(result.seized_atoms, 100_000_000);
        assert_eq!(result.surplus_atoms, 0);
        assert_eq!(result.shortfall_atoms, 20_000_000_000);
    }

    #[test]
    fn worthless_collateral_is_returned_not_confiscated() {
        let result = full_liquidation(1_000, 100_000_000, 0).unwrap();
        assert_eq!(result.seized_atoms, 0);
        assert_eq!(result.surplus_atoms, 100_000_000);
        assert_eq!(result.shortfall_atoms, 1_000);
    }

    #[test]
    fn liquidating_an_empty_vault_reports_the_whole_debt_as_shortfall() {
        let result = full_liquidation(1_000, 0, 0).unwrap();
        assert_eq!(result.seized_atoms, 0);
        assert_eq!(result.surplus_atoms, 0);
        assert_eq!(result.shortfall_atoms, 1_000);
    }

    #[test]
    fn full_liquidation_seizure_always_covers_the_debt_when_solvent() {
        // Rounding must never leave the lender short by an atom.
        for debt in [1u64, 7, 333, 12_345_678, 49_999_999_999] {
            let result = full_liquidation(debt, 100_000_000, 100_000_000_000).unwrap();
            let recovered = crate::mul_div_floor(
                result.seized_atoms,
                100_000_000_000,
                100_000_000,
            )
            .unwrap();
            assert!(recovered >= debt, "lender left short at debt {debt}");
        }
    }
}
