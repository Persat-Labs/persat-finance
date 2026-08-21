//! Collateral valuation and loan-to-value.
//!
//! One BTC/USD price feed values all collateral. USDC and USDT are treated as
//! exactly one dollar, which is the documented MVP simplification, so the debt
//! side needs no second feed.
//!
//! Prices arrive in the Pyth/Switchboard style: an integer mantissa plus a
//! negative decimal exponent. `price = mantissa * 10^-expo`.

use crate::{MathError, BPS_DENOMINATOR};

/// Maximum exponent magnitude accepted from an oracle feed.
///
/// Rejecting absurd exponents early keeps the power-of-ten table small and
/// bounded, and prevents a malformed feed from steering valuation.
pub const MAX_PRICE_EXPO: u32 = 18;

/// A validated BTC/USD price.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Price {
    /// Unsigned price mantissa. Must be strictly positive.
    pub mantissa: u64,
    /// Number of decimal places in `mantissa` (i.e. the feed's negative exponent).
    pub decimals: u32,
}

impl Price {
    /// Construct a price, rejecting anything unusable.
    ///
    /// A zero or negative price is never "cheap collateral" — it is a broken
    /// feed, and the protocol must fail closed rather than value a position
    /// against it.
    pub fn new(mantissa: u64, decimals: u32) -> Result<Self, MathError> {
        if mantissa == 0 {
            return Err(MathError::InvalidPrice);
        }
        if decimals > MAX_PRICE_EXPO {
            return Err(MathError::InvalidPrice);
        }
        Ok(Self { mantissa, decimals })
    }
}

/// Ten raised to `power`, as u128, rejecting anything out of range.
#[inline]
fn pow10(power: u32) -> Result<u128, MathError> {
    if power > 38 {
        return Err(MathError::Overflow);
    }
    10u128.checked_pow(power).ok_or(MathError::Overflow)
}

/// USD value of a collateral balance, expressed in loan-currency atoms.
///
/// `usd_atoms = collateral_atoms * price / 10^collateral_decimals`, rescaled
/// from the price's own decimals into the loan currency's decimals.
///
/// Truncates toward zero: collateral is never valued more generously than it
/// really is, so the borrower is never granted more credit than backed.
pub fn collateral_value_atoms(
    collateral_atoms: u64,
    collateral_decimals: u8,
    price: Price,
    loan_decimals: u8,
) -> Result<u64, MathError> {
    let numerator = (collateral_atoms as u128)
        .checked_mul(price.mantissa as u128)
        .ok_or(MathError::Overflow)?;
    // Scale from (collateral_decimals + price.decimals) down to loan_decimals.
    let scale_down = (collateral_decimals as u32)
        .checked_add(price.decimals)
        .ok_or(MathError::Overflow)?;
    let value = if scale_down >= loan_decimals as u32 {
        let divisor = pow10(
            scale_down
                .checked_sub(loan_decimals as u32)
                .ok_or(MathError::Overflow)?,
        )?;
        numerator.checked_div(divisor).ok_or(MathError::DivideByZero)?
    } else {
        let multiplier = pow10(
            (loan_decimals as u32)
                .checked_sub(scale_down)
                .ok_or(MathError::Overflow)?,
        )?;
        numerator.checked_mul(multiplier).ok_or(MathError::Overflow)?
    };
    u64::try_from(value).map_err(|_| MathError::Overflow)
}

/// Current loan-to-value in basis points.
///
/// `ltv_bps = outstanding_debt / collateral_value * 10_000`
///
/// Rounds **up**, so a position is never reported as safer than it is. A
/// position with debt and zero collateral value is fully underwater and
/// returns the maximum representable LTV rather than dividing by zero.
pub fn current_ltv_bps(
    outstanding_debt_atoms: u64,
    collateral_value_atoms: u64,
) -> Result<u64, MathError> {
    if outstanding_debt_atoms == 0 {
        return Ok(0);
    }
    if collateral_value_atoms == 0 {
        // Debt with worthless collateral: maximally unhealthy, not an error,
        // so the liquidation engine can still act on it.
        return Ok(u64::MAX);
    }
    let numerator = (outstanding_debt_atoms as u128)
        .checked_mul(BPS_DENOMINATOR as u128)
        .ok_or(MathError::Overflow)?;
    let denominator = collateral_value_atoms as u128;
    let quotient = numerator
        .checked_add(denominator.checked_sub(1).ok_or(MathError::Overflow)?)
        .ok_or(MathError::Overflow)?
        .checked_div(denominator)
        .ok_or(MathError::DivideByZero)?;
    Ok(u64::try_from(quotient).unwrap_or(u64::MAX))
}

/// Minimum collateral required to open a position at `max_ltv_bps`.
///
/// Rounds **up**: the borrower must always post at least enough.
pub fn required_collateral_atoms(
    principal_atoms: u64,
    max_ltv_bps: u16,
    collateral_decimals: u8,
    price: Price,
    loan_decimals: u8,
) -> Result<u64, MathError> {
    if max_ltv_bps == 0 {
        return Err(MathError::InvalidParameter);
    }
    // Required USD value = principal / ltv.
    let required_value = (principal_atoms as u128)
        .checked_mul(BPS_DENOMINATOR as u128)
        .ok_or(MathError::Overflow)?;
    let required_value = required_value
        .checked_add((max_ltv_bps as u128).checked_sub(1).ok_or(MathError::Overflow)?)
        .ok_or(MathError::Overflow)?
        .checked_div(max_ltv_bps as u128)
        .ok_or(MathError::DivideByZero)?;
    // Convert that USD value back into collateral atoms.
    let scale_up = (collateral_decimals as u32)
        .checked_add(price.decimals)
        .ok_or(MathError::Overflow)?;
    let numerator = if scale_up >= loan_decimals as u32 {
        required_value
            .checked_mul(pow10(
                scale_up.checked_sub(loan_decimals as u32).ok_or(MathError::Overflow)?,
            )?)
            .ok_or(MathError::Overflow)?
    } else {
        required_value
            .checked_div(pow10(
                (loan_decimals as u32).checked_sub(scale_up).ok_or(MathError::Overflow)?,
            )?)
            .ok_or(MathError::DivideByZero)?
    };
    let denominator = price.mantissa as u128;
    let atoms = numerator
        .checked_add(denominator.checked_sub(1).ok_or(MathError::Overflow)?)
        .ok_or(MathError::Overflow)?
        .checked_div(denominator)
        .ok_or(MathError::DivideByZero)?;
    u64::try_from(atoms).map_err(|_| MathError::Overflow)
}

/// The BTC/USD price at which a position reaches `threshold_ltv_bps`.
///
/// Surfaced prominently in the loan dashboard, so it is computed with the same
/// rounding discipline as the liquidation check itself.
pub fn liquidation_price(
    outstanding_debt_atoms: u64,
    collateral_atoms: u64,
    collateral_decimals: u8,
    threshold_ltv_bps: u16,
    loan_decimals: u8,
    price_decimals: u32,
) -> Result<u64, MathError> {
    if collateral_atoms == 0 || threshold_ltv_bps == 0 {
        return Err(MathError::InvalidParameter);
    }
    // value_at_liquidation = debt / threshold
    let value = (outstanding_debt_atoms as u128)
        .checked_mul(BPS_DENOMINATOR as u128)
        .ok_or(MathError::Overflow)?
        .checked_div(threshold_ltv_bps as u128)
        .ok_or(MathError::DivideByZero)?;
    let scale = (collateral_decimals as u32)
        .checked_add(price_decimals)
        .ok_or(MathError::Overflow)?;
    let numerator = if scale >= loan_decimals as u32 {
        value
            .checked_mul(pow10(
                scale.checked_sub(loan_decimals as u32).ok_or(MathError::Overflow)?,
            )?)
            .ok_or(MathError::Overflow)?
    } else {
        value
            .checked_div(pow10(
                (loan_decimals as u32).checked_sub(scale).ok_or(MathError::Overflow)?,
            )?)
            .ok_or(MathError::DivideByZero)?
    };
    let price = numerator
        .checked_div(collateral_atoms as u128)
        .ok_or(MathError::DivideByZero)?;
    u64::try_from(price).map_err(|_| MathError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// $100,000.00 with 8 decimal places, the shape a Pyth BTC/USD feed uses.
    fn btc_at_100k() -> Price {
        Price::new(100_000_00000000, 8).unwrap()
    }

    #[test]
    fn a_zero_price_is_rejected_as_a_broken_feed() {
        assert_eq!(Price::new(0, 8), Err(MathError::InvalidPrice));
    }

    #[test]
    fn an_absurd_exponent_is_rejected() {
        assert_eq!(Price::new(1, MAX_PRICE_EXPO + 1), Err(MathError::InvalidPrice));
        assert!(Price::new(1, MAX_PRICE_EXPO).is_ok());
    }

    #[test]
    fn one_btc_at_100k_is_worth_100k_usdc() {
        // 1 BTC (8dp) valued into USDC (6dp).
        let value = collateral_value_atoms(100_000_000, 8, btc_at_100k(), 6).unwrap();
        assert_eq!(value, 100_000_000_000);
    }

    #[test]
    fn half_a_btc_is_worth_half_as_much() {
        let value = collateral_value_atoms(50_000_000, 8, btc_at_100k(), 6).unwrap();
        assert_eq!(value, 50_000_000_000);
    }

    #[test]
    fn zero_collateral_is_worth_nothing() {
        assert_eq!(collateral_value_atoms(0, 8, btc_at_100k(), 6).unwrap(), 0);
    }

    #[test]
    fn fifty_percent_ltv_reports_as_five_thousand_bps() {
        // Borrow 50k against 100k of collateral.
        let ltv = current_ltv_bps(50_000_000_000, 100_000_000_000).unwrap();
        assert_eq!(ltv, 5_000);
    }

    #[test]
    fn no_debt_is_zero_ltv() {
        assert_eq!(current_ltv_bps(0, 100_000_000_000).unwrap(), 0);
        // Even with no collateral, no debt means no risk.
        assert_eq!(current_ltv_bps(0, 0).unwrap(), 0);
    }

    #[test]
    fn debt_against_worthless_collateral_is_maximally_unhealthy() {
        // Must be actionable by the liquidation engine, not an error.
        assert_eq!(current_ltv_bps(1, 0).unwrap(), u64::MAX);
    }

    #[test]
    fn ltv_rounds_up_so_a_position_never_looks_safer_than_it_is() {
        // 1/3 of collateral is 3333.33..bps and must report as 3334.
        let ltv = current_ltv_bps(1_000, 3_000).unwrap();
        assert_eq!(ltv, 3_334);
    }

    #[test]
    fn required_collateral_at_fifty_percent_is_double_the_principal() {
        // Borrow 50k USDC at 50% LTV against BTC at 100k => 1 BTC.
        let atoms = required_collateral_atoms(50_000_000_000, 5_000, 8, btc_at_100k(), 6).unwrap();
        assert_eq!(atoms, 100_000_000);
    }

    #[test]
    fn required_collateral_rounds_up_so_the_position_is_always_backed() {
        // Any principal that does not divide evenly must round the collateral up.
        let atoms = required_collateral_atoms(1, 5_000, 8, btc_at_100k(), 6).unwrap();
        assert!(atoms >= 1);
        let value = collateral_value_atoms(atoms, 8, btc_at_100k(), 6).unwrap();
        // The resulting position must genuinely satisfy the limit.
        assert!(current_ltv_bps(1, value).unwrap() <= 5_000);
    }

    #[test]
    fn a_zero_ltv_limit_is_rejected_rather_than_dividing_by_zero() {
        assert_eq!(
            required_collateral_atoms(1_000, 0, 8, btc_at_100k(), 6),
            Err(MathError::InvalidParameter)
        );
    }

    #[test]
    fn required_collateral_always_satisfies_the_limit_it_was_asked_for() {
        for principal in [1u64, 999, 1_000_000, 50_000_000_000] {
            for ltv in [100u16, 2_500, 5_000] {
                let atoms =
                    required_collateral_atoms(principal, ltv, 8, btc_at_100k(), 6).unwrap();
                let value = collateral_value_atoms(atoms, 8, btc_at_100k(), 6).unwrap();
                assert!(
                    current_ltv_bps(principal, value).unwrap() <= ltv as u64,
                    "principal {principal} at {ltv}bps produced an unbacked position"
                );
            }
        }
    }

    #[test]
    fn liquidation_price_marks_the_threshold_crossing() {
        // 50k debt against 1 BTC liquidating at 8000bps => $62,500.
        let price = liquidation_price(50_000_000_000, 100_000_000, 8, 8_000, 6, 8).unwrap();
        assert_eq!(price, 62_500_00000000);
    }

    #[test]
    fn liquidation_price_needs_real_collateral() {
        assert_eq!(
            liquidation_price(1_000, 0, 8, 8_000, 6, 8),
            Err(MathError::InvalidParameter)
        );
    }

    #[test]
    fn maximum_collateral_at_maximum_price_overflows_rather_than_wrapping() {
        let price = Price::new(u64::MAX, 0).unwrap();
        assert_eq!(
            collateral_value_atoms(u64::MAX, 0, price, 18),
            Err(MathError::Overflow)
        );
    }
}
