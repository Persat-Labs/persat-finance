//! Repayment schedule construction.
//!
//! Persat Finance loans repay in fixed monthly installments. The scheduling
//! rule is deliberately simple and exactly reversible:
//!
//! * every installment except the last is `total / n`, truncated;
//! * the final installment additionally absorbs the whole remainder.
//!
//! This guarantees `installment * (n - 1) + final == total` exactly, for every
//! input, with no accumulated rounding drift and no possibility of the final
//! payment underflowing. A borrower can never finish the schedule still owing
//! a stray atom, and can never be credited one they did not pay.

use crate::{interest::total_repayment, MathError};

/// A fully resolved repayment schedule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Schedule {
    /// Principal disbursed to the borrower, in loan-currency atoms.
    pub principal_atoms: u64,
    /// Total interest across the full term, in loan-currency atoms.
    pub interest_atoms: u64,
    /// Principal plus interest.
    pub total_repayment_atoms: u64,
    /// Number of monthly installments.
    pub installment_count: u16,
    /// Amount of every installment except the final one.
    pub installment_atoms: u64,
    /// Final installment, which absorbs the rounding remainder.
    pub final_installment_atoms: u64,
}

impl Schedule {
    /// Amount due for a given zero-based installment index.
    pub fn amount_due_at(&self, index: u16) -> Result<u64, MathError> {
        if index >= self.installment_count {
            return Err(MathError::InvalidParameter);
        }
        let last = self.installment_count.checked_sub(1).ok_or(MathError::Overflow)?;
        Ok(if index == last {
            self.final_installment_atoms
        } else {
            self.installment_atoms
        })
    }

    /// Total still outstanding after `payments_made` installments have been paid.
    pub fn outstanding_after(&self, payments_made: u16) -> Result<u64, MathError> {
        if payments_made > self.installment_count {
            return Err(MathError::InvalidParameter);
        }
        if payments_made == self.installment_count {
            return Ok(0);
        }
        let paid = (self.installment_atoms as u128)
            .checked_mul(payments_made as u128)
            .ok_or(MathError::Overflow)?;
        let outstanding = (self.total_repayment_atoms as u128)
            .checked_sub(paid)
            .ok_or(MathError::Overflow)?;
        u64::try_from(outstanding).map_err(|_| MathError::Overflow)
    }
}

/// Build the repayment schedule for a set of agreed terms.
pub fn build_schedule(
    principal_atoms: u64,
    annual_rate_bps: u16,
    duration_months: u16,
) -> Result<Schedule, MathError> {
    if principal_atoms == 0 {
        return Err(MathError::InvalidParameter);
    }
    let total = total_repayment(principal_atoms, annual_rate_bps, duration_months)?;
    let count = duration_months;
    if count == 0 {
        return Err(MathError::InvalidParameter);
    }
    let installment = total
        .checked_div(count as u64)
        .ok_or(MathError::DivideByZero)?;
    let remainder = total
        .checked_rem(count as u64)
        .ok_or(MathError::DivideByZero)?;
    let final_installment = installment.checked_add(remainder).ok_or(MathError::Overflow)?;
    let interest = total
        .checked_sub(principal_atoms)
        .ok_or(MathError::Overflow)?;
    Ok(Schedule {
        principal_atoms,
        interest_atoms: interest,
        total_repayment_atoms: total,
        installment_count: count,
        installment_atoms: installment,
        final_installment_atoms: final_installment,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installments_sum_exactly_to_the_total() {
        let schedule = build_schedule(10_000_000_000, 1_000, 12).unwrap();
        let sum = schedule.installment_atoms * (schedule.installment_count as u64 - 1)
            + schedule.final_installment_atoms;
        assert_eq!(sum, schedule.total_repayment_atoms);
    }

    #[test]
    fn a_clean_division_leaves_an_equal_final_payment() {
        // 12_000 total over 12 months divides exactly.
        let schedule = build_schedule(12_000_000_000, 0, 12).unwrap();
        assert_eq!(schedule.installment_atoms, 1_000_000_000);
        assert_eq!(schedule.final_installment_atoms, 1_000_000_000);
    }

    #[test]
    fn the_final_payment_absorbs_the_remainder() {
        // Total 100 over 6 months: 16 each, final 16 + 4 = 20.
        let schedule = build_schedule(100, 0, 6).unwrap();
        assert_eq!(schedule.installment_atoms, 16);
        assert_eq!(schedule.final_installment_atoms, 20);
        assert_eq!(16 * 5 + 20, 100);
    }

    #[test]
    fn the_final_payment_is_never_smaller_than_a_regular_one() {
        for principal in [1u64, 7, 100, 999_999, 10_000_000_000] {
            for rate in [0u16, 1, 137, 5_000] {
                for months in [6u16, 12, 24] {
                    let schedule = build_schedule(principal, rate, months).unwrap();
                    assert!(schedule.final_installment_atoms >= schedule.installment_atoms);
                }
            }
        }
    }

    #[test]
    fn a_tiny_principal_still_produces_a_payable_schedule() {
        // Below one atom per installment, every regular payment is zero and the
        // final payment carries the entire balance. It must not underflow.
        let schedule = build_schedule(1, 0, 24).unwrap();
        assert_eq!(schedule.installment_atoms, 0);
        assert_eq!(schedule.final_installment_atoms, 1);
        assert_eq!(schedule.total_repayment_atoms, 1);
    }

    #[test]
    fn zero_principal_is_not_a_loan() {
        assert_eq!(build_schedule(0, 1_000, 12), Err(MathError::InvalidParameter));
    }

    #[test]
    fn outstanding_falls_to_zero_only_on_the_last_payment() {
        let schedule = build_schedule(10_000_000_000, 1_000, 12).unwrap();
        assert_eq!(
            schedule.outstanding_after(0).unwrap(),
            schedule.total_repayment_atoms
        );
        assert_eq!(
            schedule.outstanding_after(11).unwrap(),
            schedule.final_installment_atoms
        );
        assert_eq!(schedule.outstanding_after(12).unwrap(), 0);
    }

    #[test]
    fn reading_past_the_end_of_the_schedule_is_rejected() {
        let schedule = build_schedule(10_000_000_000, 1_000, 12).unwrap();
        assert_eq!(schedule.amount_due_at(11).unwrap(), schedule.final_installment_atoms);
        assert_eq!(schedule.amount_due_at(12), Err(MathError::InvalidParameter));
        assert_eq!(schedule.outstanding_after(13), Err(MathError::InvalidParameter));
    }

    #[test]
    fn every_scheduled_amount_is_reachable() {
        let schedule = build_schedule(5_000_000_000, 750, 24).unwrap();
        let mut sum = 0u64;
        for index in 0..schedule.installment_count {
            sum += schedule.amount_due_at(index).unwrap();
        }
        assert_eq!(sum, schedule.total_repayment_atoms);
    }
}
