//! Interest calculation.
//!
//! The MVP uses **simple interest** accrued over the full loan term, not
//! compounding. Both parties agree to a fixed annual rate in basis points and a
//! term in whole months, and the resulting total is fixed at origination. This
//! matches the fixed-monthly-installment product described in the How It Works
//! and Testnet Flow documents: the borrower is quoted one unchanging number.

use crate::{MathError, BPS_DENOMINATOR};

/// Months in a year, used to pro-rate the annual rate over the term.
pub const MONTHS_PER_YEAR: u64 = 12;

/// Permitted loan terms in whole months.
pub const ALLOWED_DURATIONS_MONTHS: [u16; 3] = [6, 12, 24];

/// Returns true if `months` is one of the terms the product offers.
#[inline]
pub fn is_allowed_duration(months: u16) -> bool {
    // `contains` on a fixed array avoids any allocation in a no_std context.
    let mut index = 0usize;
    while index < ALLOWED_DURATIONS_MONTHS.len() {
        if ALLOWED_DURATIONS_MONTHS[index] == months {
            return true;
        }
        index = index.saturating_add(1);
    }
    false
}

/// Total simple interest owed across the whole term.
///
/// `interest = principal * annual_rate_bps * months / (10_000 * 12)`
///
/// Rounds **up**. Rounding down would let a borrower repay marginally less than
/// the agreed rate, and repeated across many loans that difference is a real
/// loss to lenders.
pub fn total_interest(
    principal_atoms: u64,
    annual_rate_bps: u16,
    duration_months: u16,
) -> Result<u64, MathError> {
    if !is_allowed_duration(duration_months) {
        return Err(MathError::InvalidParameter);
    }
    let numerator = (annual_rate_bps as u128)
        .checked_mul(duration_months as u128)
        .ok_or(MathError::Overflow)?;
    let denominator = (BPS_DENOMINATOR as u128)
        .checked_mul(MONTHS_PER_YEAR as u128)
        .ok_or(MathError::Overflow)?;
    let product = (principal_atoms as u128)
        .checked_mul(numerator)
        .ok_or(MathError::Overflow)?;
    let quotient = product
        .checked_add(denominator.checked_sub(1).ok_or(MathError::Overflow)?)
        .ok_or(MathError::Overflow)?
        .checked_div(denominator)
        .ok_or(MathError::DivideByZero)?;
    u64::try_from(quotient).map_err(|_| MathError::Overflow)
}

/// Total amount the borrower repays over the life of the loan.
pub fn total_repayment(
    principal_atoms: u64,
    annual_rate_bps: u16,
    duration_months: u16,
) -> Result<u64, MathError> {
    let interest = total_interest(principal_atoms, annual_rate_bps, duration_months)?;
    principal_atoms.checked_add(interest).ok_or(MathError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_documented_durations_are_accepted() {
        assert!(is_allowed_duration(6));
        assert!(is_allowed_duration(12));
        assert!(is_allowed_duration(24));
        assert!(!is_allowed_duration(0));
        assert!(!is_allowed_duration(1));
        assert!(!is_allowed_duration(18));
        assert!(!is_allowed_duration(36));
        assert!(!is_allowed_duration(u16::MAX));
    }

    #[test]
    fn rejects_a_term_the_product_does_not_offer() {
        assert_eq!(
            total_interest(1_000_000, 1_000, 18),
            Err(MathError::InvalidParameter)
        );
    }

    #[test]
    fn one_year_at_ten_percent_is_ten_percent() {
        // 10_000 USDC (6dp) at 1000bps for 12 months == 1_000 USDC interest.
        let interest = total_interest(10_000_000_000, 1_000, 12).unwrap();
        assert_eq!(interest, 1_000_000_000);
    }

    #[test]
    fn six_months_accrues_half_of_the_annual_rate() {
        let interest = total_interest(10_000_000_000, 1_000, 6).unwrap();
        assert_eq!(interest, 500_000_000);
    }

    #[test]
    fn two_years_accrues_double_the_annual_rate() {
        let interest = total_interest(10_000_000_000, 1_000, 24).unwrap();
        assert_eq!(interest, 2_000_000_000);
    }

    #[test]
    fn interest_rounds_up_so_the_lender_is_never_shortchanged() {
        // 1 atom at 1bps for 6 months is a vanishing fraction, but must not
        // round away to zero and silently make the loan interest-free.
        let interest = total_interest(1, 1, 6).unwrap();
        assert_eq!(interest, 1);
    }

    #[test]
    fn a_zero_rate_loan_accrues_no_interest() {
        assert_eq!(total_interest(10_000_000_000, 0, 12).unwrap(), 0);
        assert_eq!(total_repayment(10_000_000_000, 0, 12).unwrap(), 10_000_000_000);
    }

    #[test]
    fn zero_principal_accrues_no_interest() {
        assert_eq!(total_interest(0, 5_000, 24).unwrap(), 0);
    }

    #[test]
    fn extreme_principal_overflows_instead_of_wrapping() {
        assert_eq!(
            total_repayment(u64::MAX, 10_000, 24),
            Err(MathError::Overflow)
        );
    }

    #[test]
    fn total_repayment_always_covers_principal() {
        for principal in [1u64, 1_000, 1_000_000_000, u32::MAX as u64] {
            for rate in [0u16, 1, 500, 2_500] {
                for months in [6u16, 12, 24] {
                    let total = total_repayment(principal, rate, months).unwrap();
                    assert!(total >= principal);
                }
            }
        }
    }
}
