# Security Audit Pass 2 — Fuzz Testing

**Status:** Partially complete. Financial calculation families are covered and passing.
PDA-derivation and deal-state-transition fuzzing remain outstanding (see Gaps).

**Scope standard:** `docs/testing-strategy.md` — at least 10,000 iterations for each financial
calculation family.

## What was executed

Property-based fuzzing via `proptest`, configured at **10,000 cases per property**, 29 properties
total, in [`contracts/crates/persat-core/tests/fuzz.rs`](../../contracts/crates/persat-core/tests/fuzz.rs).

Run automatically on every protocol CI run:

```bash
cd contracts && cargo test --workspace
```

**Latest result:** `test result: ok. 29 passed; 0 failed` — run
[32259806847](https://github.com/Persat-Labs/persat-finance/actions/runs/32259806847),
commit `8583d38`.

## Coverage against the mandated families

| Required family | Properties | Covered |
| --- | --- | --- |
| Interest / installment totals and final-payment rounding | `repayment_never_falls_below_principal`, `interest_is_monotonic_in_the_rate`, `a_zero_rate_never_accrues_interest`, `unsupported_durations_are_always_rejected`, `installments_always_reconstruct_the_total`, `every_indexed_payment_sums_to_the_total`, `outstanding_balance_decreases_to_exactly_zero` | Yes |
| LTV, collateral valuation | `ltv_is_monotonic_in_the_debt`, `worthless_collateral_always_reports_maximum_ltv`, `no_debt_is_always_zero_ltv`, `valuation_is_monotonic_in_the_collateral_amount`, `required_collateral_always_satisfies_its_own_limit`, `a_zero_ltv_limit_is_always_rejected`, `liquidation_price_never_panics`, `a_zero_price_is_always_rejected` | Yes |
| Partial liquidation cap | `partial_liquidation_respects_both_caps`, `partial_liquidation_of_an_empty_vault_seizes_nothing`, `full_liquidation_always_implies_partial`, `unordered_thresholds_are_always_rejected`, `an_ltv_above_the_protocol_ceiling_is_always_rejected` | Yes |
| Full-liquidation surplus | `full_liquidation_always_conserves_collateral`, `a_solvent_full_liquidation_always_covers_the_debt` | Yes |
| Token decimal conversion | `collateral_valuation_never_panics` (full 0–18 decimal matrix on collateral, price, and loan sides), `zero_collateral_is_always_worthless` | Yes |
| Maximum-value arithmetic | `mul_div_rounding_modes_stay_within_one_atom`, `division_by_zero_never_panics`, `applying_full_basis_points_is_the_identity` — all drawn from the unrestricted `u64` domain including `u64::MAX` | Yes |
| Fee calculation | `the_fee_split_always_conserves_the_principal`, `a_fee_above_the_cap_is_always_rejected` | Yes |
| PDA seed inputs | — | **No — see Gaps** |
| Deal-state transitions | — | **No — see Gaps** |

## The invariants being asserted

Every property asserts **totality** — no input, however extreme, may panic. An arithmetic overflow
is an acceptable outcome only when *reported* as a typed `MathError`; a panic in a financial
program is not. Beyond totality, the substantive claims are:

1. **Conservation.** A full liquidation moves exactly the collateral that was posted:
   `seized + surplus == collateral`, for every generated input. A fee split always satisfies
   `to_borrower + to_treasury == principal`. Value is never created or destroyed.
2. **Rounding direction.** Rounding always falls against the party who owes, never against the
   protocol or the party owed. Interest rounds up; the fee rounds down in the user's favour;
   required collateral rounds up; reported LTV rounds up so a position never looks safer than it is.
3. **Schedule exactness.** `installment × (n−1) + final == total` exactly, with no accumulated
   drift, so a borrower can never finish a schedule still owing a stray atom.
4. **Solvency.** When a position is solvent, the collateral seized is always worth at least the
   outstanding debt — the lender is never left short by a rounding error.
5. **Policy is not negotiable.** The 50% LTV ceiling and the 5% fee cap are rejected in every
   generated configuration that exceeds them.

## Findings

**No failures.** No counterexample was found in any property across the executed runs.

`proptest` shrinks any counterexample to a minimal failing case and, on a local run, persists it to
a regression file that is replayed on every subsequent run. No such file exists yet because nothing
has failed. If one appears, it must be committed alongside the fix.

## Gaps before Pass 2 can be marked complete

1. **PDA seed fuzzing.** The testing strategy requires confirming no seed collision or spoofing is
   possible. This needs the on-chain programs under LiteSVM rather than the pure-math crate, since
   PDA derivation is a Solana runtime concern. Blocked on the same integration harness as Pass 3.
2. **Deal-state transition fuzzing.** Randomised instruction sequences against the Deal Registry
   and Loan Lifecycle state machines, asserting no path reaches an invalid state. Also requires the
   LiteSVM harness.
3. **Long-running corpus.** The 10,000-case default is the mandated floor. Before mainnet
   consideration, these should run at a substantially higher case count in a scheduled job rather
   than only on pull requests.

A roadmap checkbox is not evidence. Pass 2 stays marked partial until items 1 and 2 have executed
and their results are recorded here.

## B1 execution plan

See [`GAPS_B1_PLAN.md`](./GAPS_B1_PLAN.md) for LiteSVM PDA + deal-state transition fuzz approach,
target properties, and exit criteria tied to `docs/MAINNET_CUTOVER_3_STEP.md` § B1.
