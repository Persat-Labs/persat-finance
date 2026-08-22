//! Persat Finance shared protocol math.
//!
//! This crate is deliberately free of any Solana or Anchor dependency so that
//! every financial calculation can be unit-tested and fuzzed on the host
//! target, without a validator. The on-chain programs call into these exact
//! functions, so a property proven here is a property of the deployed program.
//!
//! Invariants enforced throughout:
//!
//! * Every arithmetic operation is checked. There is no wrapping, no silent
//!   saturation on a value that represents money, and no floating point.
//! * All monetary values are unsigned integer token atoms (smallest unit).
//! * All rates and ratios are basis points (1 bps = 0.01%).
//! * USDC and USDT are treated as exactly one dollar. This is the documented
//!   MVP simplification recorded in the Technical Architecture; de-peg
//!   detection is explicitly deferred to post-MVP hardening.

#![cfg_attr(not(test), no_std)]
#![deny(clippy::arithmetic_side_effects)]

pub mod fees;
pub mod interest;
pub mod liquidation;
pub mod ltv;
pub mod schedule;

/// Basis-point denominator. 10_000 bps == 100%.
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Protocol-wide maximum loan-to-value at origination: 50%.
///
/// This ceiling is a policy constant, not a governance parameter. Governance
/// may configure a *stricter* per-asset LTV, never a looser one.
pub const MAX_PROTOCOL_LTV_BPS: u16 = 5_000;

/// The only collateral decimals the MVP supports (tBTC and zBTC are both 8dp).
pub const BTC_DECIMALS: u8 = 8;

/// Errors returned by protocol math. Each maps to an on-chain error code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    /// A checked arithmetic operation overflowed or underflowed.
    Overflow,
    /// A divisor was zero.
    DivideByZero,
    /// A supplied parameter was outside its permitted range.
    InvalidParameter,
    /// The oracle price was zero, negative, or otherwise unusable.
    InvalidPrice,
}

/// Multiply then divide in widened precision, truncating toward zero.
///
/// Used for every rate and ratio calculation. The intermediate product is
/// computed in `u128` so that a large principal multiplied by a large basis-point
/// figure cannot overflow before the division reduces it again.
#[inline]
pub fn mul_div_floor(value: u64, numerator: u64, denominator: u64) -> Result<u64, MathError> {
    if denominator == 0 {
        return Err(MathError::DivideByZero);
    }
    let product = (value as u128)
        .checked_mul(numerator as u128)
        .ok_or(MathError::Overflow)?;
    let quotient = product
        .checked_div(denominator as u128)
        .ok_or(MathError::DivideByZero)?;
    u64::try_from(quotient).map_err(|_| MathError::Overflow)
}

/// Multiply then divide, rounding any remainder up.
///
/// Used wherever rounding must never favour the party who owes money — for
/// example the amount a borrower must repay, or the collateral a position must
/// post. Rounding down there would leak value out of the protocol one lamport
/// at a time.
#[inline]
pub fn mul_div_ceil(value: u64, numerator: u64, denominator: u64) -> Result<u64, MathError> {
    if denominator == 0 {
        return Err(MathError::DivideByZero);
    }
    let product = (value as u128)
        .checked_mul(numerator as u128)
        .ok_or(MathError::Overflow)?;
    let denominator = denominator as u128;
    // (a + b - 1) / b, computed without overflowing the numerator.
    let quotient = product
        .checked_add(denominator.checked_sub(1).ok_or(MathError::Overflow)?)
        .ok_or(MathError::Overflow)?
        .checked_div(denominator)
        .ok_or(MathError::DivideByZero)?;
    u64::try_from(quotient).map_err(|_| MathError::Overflow)
}

/// Apply a basis-point rate to an amount, truncating toward zero.
#[inline]
pub fn apply_bps(amount: u64, bps: u16) -> Result<u64, MathError> {
    mul_div_floor(amount, bps as u64, BPS_DENOMINATOR)
}

/// Apply a basis-point rate to an amount, rounding up.
#[inline]
pub fn apply_bps_ceil(amount: u64, bps: u16) -> Result<u64, MathError> {
    mul_div_ceil(amount, bps as u64, BPS_DENOMINATOR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mul_div_floor_truncates_toward_zero() {
        assert_eq!(mul_div_floor(10, 1, 3).unwrap(), 3);
        assert_eq!(mul_div_floor(0, 500, 10_000).unwrap(), 0);
    }

    #[test]
    fn mul_div_ceil_rounds_remainder_up() {
        assert_eq!(mul_div_ceil(10, 1, 3).unwrap(), 4);
        // An exact division must not be inflated by the rounding step.
        assert_eq!(mul_div_ceil(9, 1, 3).unwrap(), 3);
        assert_eq!(mul_div_ceil(0, 1, 3).unwrap(), 0);
    }

    #[test]
    fn division_by_zero_is_rejected_not_panicked() {
        assert_eq!(mul_div_floor(1, 1, 0), Err(MathError::DivideByZero));
        assert_eq!(mul_div_ceil(1, 1, 0), Err(MathError::DivideByZero));
    }

    #[test]
    fn maximum_value_arithmetic_does_not_overflow_silently() {
        // u64::MAX * 10_000 far exceeds u64 but must be representable in the
        // widened intermediate, then fail only if the *result* cannot fit.
        assert_eq!(mul_div_floor(u64::MAX, 10_000, 10_000).unwrap(), u64::MAX);
        assert_eq!(mul_div_floor(u64::MAX, 10_001, 10_000), Err(MathError::Overflow));
    }

    #[test]
    fn apply_bps_matches_expected_percentages() {
        assert_eq!(apply_bps(1_000_000, 5_000).unwrap(), 500_000);
        assert_eq!(apply_bps(1_000_000, 0).unwrap(), 0);
        assert_eq!(apply_bps(1_000_000, 10_000).unwrap(), 1_000_000);
    }

    #[test]
    fn ceil_never_returns_less_than_floor() {
        for value in [0u64, 1, 7, 999, 1_000_000, u32::MAX as u64] {
            for bps in [0u16, 1, 250, 5_000, 10_000] {
                let floor = apply_bps(value, bps).unwrap();
                let ceil = apply_bps_ceil(value, bps).unwrap();
                assert!(ceil >= floor);
                // The two may differ by at most one atom.
                assert!(ceil - floor <= 1);
            }
        }
    }
}
