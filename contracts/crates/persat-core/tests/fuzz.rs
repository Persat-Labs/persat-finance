//! Pass 2 — property-based fuzzing of every financial calculation family.
//!
//! `docs/testing-strategy.md` mandates at least 10,000 iterations across the
//! financial calculations. Each property below runs that many generated cases.
//!
//! Two kinds of claim are made here:
//!
//! 1. **Total functions.** No input, however extreme, may panic. Every function
//!    either returns a correct value or a typed `MathError`. This is the reason
//!    each property matches on the result instead of unwrapping: an overflow is
//!    an acceptable, *reported* outcome; a panic in a financial program is not.
//!
//! 2. **Conservation and direction.** Value is never created or destroyed, and
//!    every rounding decision falls in the documented direction — against
//!    whoever owes money, never against the protocol or the counterparty who is
//!    owed.

use persat_core::{
    apply_bps, apply_bps_ceil,
    fees::{split_disbursement, DealOrigin, FeeParameters, MAX_ORIGINATION_FEE_BPS},
    interest::{total_interest, total_repayment},
    liquidation::{
        evaluate_position, full_liquidation, partial_liquidation_amount, RiskThresholds,
    },
    ltv::{collateral_value_atoms, current_ltv_bps, liquidation_price, required_collateral_atoms, Price},
    mul_div_ceil, mul_div_floor,
    schedule::build_schedule,
    BPS_DENOMINATOR, MAX_PROTOCOL_LTV_BPS,
};
use proptest::prelude::*;

/// The three terms the product offers.
fn duration() -> impl Strategy<Value = u16> {
    prop::sample::select(vec![6u16, 12, 24])
}

/// A well-ordered threshold set, which is the only kind the registry admits.
fn thresholds() -> impl Strategy<Value = RiskThresholds> {
    (1u16..=MAX_PROTOCOL_LTV_BPS, 1u16..=2_000u16, 1u16..=2_000u16).prop_map(
        |(max_ltv, partial_gap, full_gap)| {
            let partial = max_ltv.saturating_add(partial_gap).min(9_998);
            let full = partial.saturating_add(full_gap).min(10_000);
            RiskThresholds {
                max_ltv_bps: max_ltv,
                partial_liquidation_ltv_bps: partial.max(max_ltv.saturating_add(1)),
                full_liquidation_ltv_bps: full.max(partial.saturating_add(1)),
            }
        },
    )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    // ---------------------------------------------------------------- helpers

    /// Ceil is never below floor, and never more than one atom above it.
    #[test]
    fn mul_div_rounding_modes_stay_within_one_atom(
        value in any::<u64>(),
        numerator in any::<u64>(),
        denominator in 1u64..=u64::MAX,
    ) {
        match (
            mul_div_floor(value, numerator, denominator),
            mul_div_ceil(value, numerator, denominator),
        ) {
            (Ok(floor), Ok(ceil)) => {
                prop_assert!(ceil >= floor);
                prop_assert!(ceil - floor <= 1);
            }
            // Overflow must be reported symmetrically or only by the ceil side,
            // which is the larger of the two.
            (Ok(_), Err(_)) | (Err(_), Err(_)) => {}
            (Err(_), Ok(_)) => prop_assert!(false, "ceil succeeded where floor overflowed"),
        }
    }

    /// A zero denominator is always an error and never a panic.
    #[test]
    fn division_by_zero_never_panics(value in any::<u64>(), numerator in any::<u64>()) {
        prop_assert!(mul_div_floor(value, numerator, 0).is_err());
        prop_assert!(mul_div_ceil(value, numerator, 0).is_err());
    }

    /// Applying the full 100% returns the original amount exactly.
    #[test]
    fn applying_full_basis_points_is_the_identity(amount in any::<u64>()) {
        prop_assert_eq!(apply_bps(amount, 10_000).unwrap(), amount);
        prop_assert_eq!(apply_bps_ceil(amount, 10_000).unwrap(), amount);
        prop_assert_eq!(apply_bps(amount, 0).unwrap(), 0);
    }

    // --------------------------------------------------------------- interest

    /// Interest is never negative and repayment always covers the principal.
    #[test]
    fn repayment_never_falls_below_principal(
        principal in any::<u64>(),
        rate in 0u16..=10_000u16,
        months in duration(),
    ) {
        if let Ok(total) = total_repayment(principal, rate, months) {
            prop_assert!(total >= principal);
            let interest = total_interest(principal, rate, months).unwrap();
            prop_assert_eq!(total - principal, interest);
        }
    }

    /// A zero rate is genuinely interest-free, at any scale.
    #[test]
    fn a_zero_rate_never_accrues_interest(principal in any::<u64>(), months in duration()) {
        prop_assert_eq!(total_interest(principal, 0, months).unwrap(), 0);
    }

    /// Interest grows monotonically with the rate — never inverts on rounding.
    #[test]
    fn interest_is_monotonic_in_the_rate(
        principal in 0u64..1_000_000_000_000_000u64,
        rate_a in 0u16..=10_000u16,
        rate_b in 0u16..=10_000u16,
        months in duration(),
    ) {
        let (low, high) = if rate_a <= rate_b { (rate_a, rate_b) } else { (rate_b, rate_a) };
        let low_interest = total_interest(principal, low, months).unwrap();
        let high_interest = total_interest(principal, high, months).unwrap();
        prop_assert!(high_interest >= low_interest);
    }

    /// A term the product does not offer is always rejected.
    #[test]
    fn unsupported_durations_are_always_rejected(
        principal in any::<u64>(),
        rate in 0u16..=10_000u16,
        months in any::<u16>().prop_filter("only unsupported", |m| ![6u16, 12, 24].contains(m)),
    ) {
        prop_assert!(total_interest(principal, rate, months).is_err());
    }

    // --------------------------------------------------------------- schedule

    /// The defining schedule invariant: installments reconstruct the total
    /// exactly, with no accumulated rounding drift over the whole term.
    #[test]
    fn installments_always_reconstruct_the_total(
        principal in 1u64..1_000_000_000_000_000u64,
        rate in 0u16..=10_000u16,
        months in duration(),
    ) {
        if let Ok(schedule) = build_schedule(principal, rate, months) {
            let regular = (schedule.installment_atoms as u128)
                * ((schedule.installment_count as u128) - 1);
            let sum = regular + schedule.final_installment_atoms as u128;
            prop_assert_eq!(sum, schedule.total_repayment_atoms as u128);
            // The final payment absorbs the remainder, so it is never smaller.
            prop_assert!(schedule.final_installment_atoms >= schedule.installment_atoms);
            // And never more than one full installment larger.
            let excess = schedule.final_installment_atoms - schedule.installment_atoms;
            prop_assert!(excess < schedule.installment_count as u64);
        }
    }

    /// Walking the schedule by index reproduces the total exactly.
    #[test]
    fn every_indexed_payment_sums_to_the_total(
        principal in 1u64..1_000_000_000_000u64,
        rate in 0u16..=10_000u16,
        months in duration(),
    ) {
        if let Ok(schedule) = build_schedule(principal, rate, months) {
            let mut sum = 0u128;
            for index in 0..schedule.installment_count {
                sum += schedule.amount_due_at(index).unwrap() as u128;
            }
            prop_assert_eq!(sum, schedule.total_repayment_atoms as u128);
            // Reading past the end is an error, never a wrap to index zero.
            prop_assert!(schedule.amount_due_at(schedule.installment_count).is_err());
        }
    }

    /// Outstanding balance decreases monotonically and lands exactly on zero.
    #[test]
    fn outstanding_balance_decreases_to_exactly_zero(
        principal in 1u64..1_000_000_000_000u64,
        rate in 0u16..=10_000u16,
        months in duration(),
    ) {
        if let Ok(schedule) = build_schedule(principal, rate, months) {
            let mut previous = u64::MAX;
            for paid in 0..=schedule.installment_count {
                let outstanding = schedule.outstanding_after(paid).unwrap();
                prop_assert!(outstanding <= previous);
                previous = outstanding;
            }
            prop_assert_eq!(schedule.outstanding_after(schedule.installment_count).unwrap(), 0);
        }
    }

    // -------------------------------------------------- valuation and the LTV

    /// Collateral valuation never panics across the full decimal matrix.
    #[test]
    fn collateral_valuation_never_panics(
        atoms in any::<u64>(),
        collateral_decimals in 0u8..=18u8,
        mantissa in 1u64..=u64::MAX,
        price_decimals in 0u32..=18u32,
        loan_decimals in 0u8..=18u8,
    ) {
        let price = Price::new(mantissa, price_decimals).unwrap();
        let _ = collateral_value_atoms(atoms, collateral_decimals, price, loan_decimals);
    }

    /// Zero collateral is worth nothing, whatever the price or decimals.
    #[test]
    fn zero_collateral_is_always_worthless(
        collateral_decimals in 0u8..=18u8,
        mantissa in 1u64..=u64::MAX,
        price_decimals in 0u32..=18u32,
        loan_decimals in 0u8..=18u8,
    ) {
        let price = Price::new(mantissa, price_decimals).unwrap();
        if let Ok(value) = collateral_value_atoms(0, collateral_decimals, price, loan_decimals) {
            prop_assert_eq!(value, 0);
        }
    }

    /// More collateral is never worth less.
    #[test]
    fn valuation_is_monotonic_in_the_collateral_amount(
        a in 0u64..1_000_000_000_000u64,
        b in 0u64..1_000_000_000_000u64,
        mantissa in 1u64..1_000_000_000_000u64,
    ) {
        let (low, high) = if a <= b { (a, b) } else { (b, a) };
        let price = Price::new(mantissa, 8).unwrap();
        if let (Ok(low_value), Ok(high_value)) = (
            collateral_value_atoms(low, 8, price, 6),
            collateral_value_atoms(high, 8, price, 6),
        ) {
            prop_assert!(high_value >= low_value);
        }
    }

    /// A zero or malformed price is always rejected, never silently used.
    #[test]
    fn a_zero_price_is_always_rejected(decimals in 0u32..=18u32) {
        prop_assert!(Price::new(0, decimals).is_err());
    }

    /// More debt against the same collateral is never a healthier position.
    #[test]
    fn ltv_is_monotonic_in_the_debt(
        debt_a in any::<u64>(),
        debt_b in any::<u64>(),
        collateral_value in 1u64..=u64::MAX,
    ) {
        let (low, high) = if debt_a <= debt_b { (debt_a, debt_b) } else { (debt_b, debt_a) };
        let low_ltv = current_ltv_bps(low, collateral_value).unwrap();
        let high_ltv = current_ltv_bps(high, collateral_value).unwrap();
        prop_assert!(high_ltv >= low_ltv);
    }

    /// Debt against worthless collateral is always maximally unhealthy, and
    /// never an error — the liquidation engine must still be able to act.
    #[test]
    fn worthless_collateral_always_reports_maximum_ltv(debt in 1u64..=u64::MAX) {
        prop_assert_eq!(current_ltv_bps(debt, 0).unwrap(), u64::MAX);
    }

    /// No debt is always zero LTV, even with no collateral at all.
    #[test]
    fn no_debt_is_always_zero_ltv(collateral_value in any::<u64>()) {
        prop_assert_eq!(current_ltv_bps(0, collateral_value).unwrap(), 0);
    }

    /// The collateral requirement always produces a position that genuinely
    /// satisfies the limit it was calculated for. This is the property that
    /// stops a rounding error from originating an under-collateralised loan.
    #[test]
    fn required_collateral_always_satisfies_its_own_limit(
        principal in 1u64..1_000_000_000_000u64,
        max_ltv in 1u16..=MAX_PROTOCOL_LTV_BPS,
        mantissa in 1_000u64..10_000_000_000_000u64,
    ) {
        let price = Price::new(mantissa, 8).unwrap();
        if let Ok(atoms) = required_collateral_atoms(principal, max_ltv, 8, price, 6) {
            if let Ok(value) = collateral_value_atoms(atoms, 8, price, 6) {
                let ltv = current_ltv_bps(principal, value).unwrap();
                prop_assert!(
                    ltv <= max_ltv as u64,
                    "principal {} at {}bps produced ltv {}",
                    principal, max_ltv, ltv
                );
            }
        }
    }

    /// A zero LTV limit is always rejected rather than dividing by zero.
    #[test]
    fn a_zero_ltv_limit_is_always_rejected(
        principal in any::<u64>(),
        mantissa in 1u64..=u64::MAX,
    ) {
        let price = Price::new(mantissa, 8).unwrap();
        prop_assert!(required_collateral_atoms(principal, 0, 8, price, 6).is_err());
    }

    /// The liquidation price never panics and needs real collateral.
    #[test]
    fn liquidation_price_never_panics(
        debt in any::<u64>(),
        collateral in any::<u64>(),
        threshold in 0u16..=10_000u16,
    ) {
        let result = liquidation_price(debt, collateral, 8, threshold, 6, 8);
        if collateral == 0 || threshold == 0 {
            prop_assert!(result.is_err());
        }
    }

    // ------------------------------------------------------------ liquidation

    /// A fully liquidatable position is always also partially liquidatable,
    /// because the thresholds are strictly ordered.
    #[test]
    fn full_liquidation_always_implies_partial(
        debt in any::<u64>(),
        collateral_value in any::<u64>(),
        thresholds in thresholds(),
    ) {
        prop_assume!(thresholds.validate(MAX_PROTOCOL_LTV_BPS).is_ok());
        let health = evaluate_position(debt, collateral_value, thresholds).unwrap();
        if health.is_fully_liquidatable {
            prop_assert!(health.is_partial_liquidatable);
        }
    }

    /// Partial liquidation never seizes more than exists, and never more than
    /// the configured share of posted collateral.
    #[test]
    fn partial_liquidation_respects_both_caps(
        missed in any::<u64>(),
        penalty in 0u16..=10_000u16,
        collateral in any::<u64>(),
        collateral_value in any::<u64>(),
        max_partial in 1u16..=10_000u16,
    ) {
        if let Ok(seized) = partial_liquidation_amount(
            missed, penalty, collateral, collateral_value, max_partial,
        ) {
            prop_assert!(seized <= collateral);
            let cap = apply_bps(collateral, max_partial).unwrap();
            prop_assert!(seized <= cap);
        }
    }

    /// An empty or worthless vault yields nothing, rather than erroring or
    /// seizing phantom collateral.
    #[test]
    fn partial_liquidation_of_an_empty_vault_seizes_nothing(
        missed in any::<u64>(),
        penalty in 0u16..=10_000u16,
        max_partial in 1u16..=10_000u16,
    ) {
        prop_assert_eq!(
            partial_liquidation_amount(missed, penalty, 0, 1_000, max_partial).unwrap(),
            0
        );
        prop_assert_eq!(
            partial_liquidation_amount(missed, penalty, 1_000, 0, max_partial).unwrap(),
            0
        );
    }

    /// The central conservation law: a full liquidation moves exactly the
    /// collateral that was posted. Not one atom is created or destroyed.
    #[test]
    fn full_liquidation_always_conserves_collateral(
        debt in any::<u64>(),
        collateral in any::<u64>(),
        collateral_value in any::<u64>(),
    ) {
        if let Ok(outcome) = full_liquidation(debt, collateral, collateral_value) {
            let moved = (outcome.seized_atoms as u128) + (outcome.surplus_atoms as u128);
            prop_assert_eq!(moved, collateral as u128);
            // A shortfall can never exceed the debt it failed to cover.
            prop_assert!(outcome.shortfall_atoms <= debt);
        }
    }

    /// A solvent position always leaves the lender whole: the seized collateral
    /// is worth at least the outstanding debt.
    #[test]
    fn a_solvent_full_liquidation_always_covers_the_debt(
        debt in 1u64..1_000_000_000_000u64,
        collateral in 1u64..1_000_000_000u64,
        surplus_factor in 1u64..1_000u64,
    ) {
        // Construct a position that is solvent by definition.
        let collateral_value = match debt.checked_mul(surplus_factor) {
            Some(value) if value > debt => value,
            _ => return Ok(()),
        };
        let outcome = full_liquidation(debt, collateral, collateral_value).unwrap();
        prop_assert_eq!(outcome.shortfall_atoms, 0);
        let recovered = mul_div_floor(outcome.seized_atoms, collateral_value, collateral).unwrap();
        prop_assert!(recovered >= debt, "recovered {} < debt {}", recovered, debt);
    }

    /// Threshold validation always rejects any out-of-order configuration.
    #[test]
    fn unordered_thresholds_are_always_rejected(
        max_ltv in 1u16..=MAX_PROTOCOL_LTV_BPS,
        partial in 0u16..=10_000u16,
        full in 0u16..=10_000u16,
    ) {
        let candidate = RiskThresholds {
            max_ltv_bps: max_ltv,
            partial_liquidation_ltv_bps: partial,
            full_liquidation_ltv_bps: full,
        };
        let ordered = partial > max_ltv && full > partial && (full as u64) <= BPS_DENOMINATOR;
        prop_assert_eq!(candidate.validate(MAX_PROTOCOL_LTV_BPS).is_ok(), ordered);
    }

    /// An LTV above the protocol ceiling is always rejected, whatever else is
    /// configured. The 50% cap is not negotiable by governance.
    #[test]
    fn an_ltv_above_the_protocol_ceiling_is_always_rejected(
        excess in 1u16..=5_000u16,
        partial_gap in 1u16..=1_000u16,
        full_gap in 1u16..=1_000u16,
    ) {
        let max_ltv = MAX_PROTOCOL_LTV_BPS.saturating_add(excess);
        let candidate = RiskThresholds {
            max_ltv_bps: max_ltv,
            partial_liquidation_ltv_bps: max_ltv.saturating_add(partial_gap),
            full_liquidation_ltv_bps: max_ltv
                .saturating_add(partial_gap)
                .saturating_add(full_gap),
        };
        prop_assert!(candidate.validate(MAX_PROTOCOL_LTV_BPS).is_err());
    }

    // ------------------------------------------------------------------- fees

    /// The disbursement split always conserves the principal exactly.
    #[test]
    fn the_fee_split_always_conserves_the_principal(
        principal in any::<u64>(),
        direct in 0u16..=MAX_ORIGINATION_FEE_BPS,
        marketplace in 0u16..=MAX_ORIGINATION_FEE_BPS,
    ) {
        let parameters = FeeParameters {
            direct_origination_fee_bps: direct,
            marketplace_origination_fee_bps: marketplace,
        };
        for origin in [DealOrigin::Direct, DealOrigin::Marketplace] {
            let split = split_disbursement(principal, parameters, origin).unwrap();
            let total = (split.to_borrower_atoms as u128) + (split.to_treasury_atoms as u128);
            prop_assert_eq!(total, principal as u128);
            // The borrower always keeps at least 95%, because the cap is 5%.
            prop_assert!(split.to_treasury_atoms <= apply_bps(principal, MAX_ORIGINATION_FEE_BPS).unwrap());
        }
    }

    /// Any rate above the protocol cap is always rejected.
    #[test]
    fn a_fee_above_the_cap_is_always_rejected(excess in 1u16..=10_000u16) {
        let parameters = FeeParameters {
            direct_origination_fee_bps: MAX_ORIGINATION_FEE_BPS.saturating_add(excess),
            marketplace_origination_fee_bps: 0,
        };
        prop_assert!(parameters.validate().is_err());
        prop_assert!(split_disbursement(1_000, parameters, DealOrigin::Direct).is_err());
    }
}
