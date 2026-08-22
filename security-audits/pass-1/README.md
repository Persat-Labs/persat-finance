# Security Audit Pass 1 — Unit and Access-Control Coverage

**Status:** Partially complete. Pure logic and policy validation are covered and passing.
Instruction-level access-control tests against a runtime remain outstanding (see Gaps).

**Scope standard:** `docs/testing-strategy.md` — 95%+ line/branch coverage for each Anchor program,
including every success path and rejection path.

## What was executed

Host-target unit tests across the protocol workspace, run on every CI run:

```bash
cd contracts && cargo test --workspace
```

**Latest result:** all suites passing — run
[32259806847](https://github.com/Persat-Labs/persat-finance/actions/runs/32259806847), commit `8583d38`.

| Suite | Tests | What it covers |
| --- | --- | --- |
| `persat-core` (unit) | 66 | Interest, schedule, LTV/valuation, liquidation sizing, fee split — success and rejection paths, boundary values, `u64::MAX` arithmetic |
| `persat-core` (fuzz) | 29 × 10,000 cases | See [Pass 2](../pass-2/README.md) |
| `price_oracle` | 10 | Staleness boundary (exact threshold, one second past), never-published oracle, backwards clock, deviation bound inclusivity, threshold range |
| `asset_whitelist` | 11 | Category/oracle-feed policy, collateral decimals, LTV ceiling, threshold ordering, partial-liquidation cap, `is_accepted` category isolation |
| `deal_registry` | 10 | Terms validation, terms-hash sensitivity per field, mint-swap collision resistance, binding rules |
| `loan_lifecycle` | 10 | Installment sequencing, schedule exactness, due/overdue/grace boundaries, outstanding tracking |
| `fee_treasury` | 4 | Parameter round-trip, cap rejection, per-origin rates, origin mapping |

## Rejection paths verified

Access control and policy rejection are asserted directly wherever they are expressible without a
runtime:

- **Governance:** duplicate signer at initialization, non-signer proposing, re-approval by the same
  signer, execution below threshold, execution before timelock, execution after expiry, double
  execution, pause when already paused, unpause when not paused, unpause by a single signer.
  *(Enforced in source via `require!`; asserted end-to-end only once the LiteSVM harness exists.)*
- **Oracle:** stale price blocks every price-dependent read, zero price rejected, future-dated
  observation rejected, out-of-order observation rejected, implausible single-update jump rejected.
- **Whitelist:** collateral without an oracle feed, loan currency carrying an oracle feed,
  unexpected collateral decimals, LTV above the 50% ceiling, unordered thresholds, uncapped partial
  liquidation, zero-LTV asset.
- **Deal Registry:** zero principal, zero collateral, unsupported duration, LTV above ceiling,
  identical loan and collateral mints, unrepayable terms, self-dealing, public listing binding a
  counterparty at creation.
- **Loan Lifecycle:** payment outside the schedule, incorrect payment amount, default flagged before
  the grace window closes, action on a completed schedule.

## LiteSVM access-control harness — written, not yet proven

`contracts/tests/protocol-tests/tests/governance.rs` runs the **real compiled program** inside
LiteSVM, an in-process Solana VM. This is the only way to exercise Anchor's
`#[derive(Accounts)]` constraints — signer checks, `has_one`, PDA seeds — which the unit tests
cannot reach because they are enforced by the runtime, not by program logic.

Seven tests cover the governance security root:

| Test | Asserts |
| --- | --- |
| `governance_initializes_with_three_distinct_signers` | Singleton PDA is created, protocol starts unpaused |
| `a_single_signer_can_trigger_the_emergency_pause` | 1-of-3 pause, no timelock |
| `a_wallet_outside_the_signer_set_cannot_pause` | **Arbitrary wallet is rejected** — the core access-control claim |
| `unpausing_requires_two_distinct_signers` | Same signer twice fails; two distinct succeed |
| `pausing_an_already_paused_protocol_is_rejected` | No double-pause |
| `unpausing_a_running_protocol_is_rejected` | No spurious unpause |
| `the_governance_singleton_cannot_be_initialized_twice` | Signer set cannot be reset |

> **These have not yet executed in CI.** The workflow currently runs `cargo test` *before*
> `anchor build`, so `target/deploy/governance.so` does not exist and every test takes the skip
> path — reporting `7 passed` in `0.00s` while proving nothing. A green tick that verifies
> nothing is worse than a red one, so this is recorded as unproven rather than as evidence.
>
> The fix is prepared in `docs/ci/protocol.yml.ready`: build before test, and set
> `PERSAT_REQUIRE_PROGRAMS=1` so a missing program becomes a hard failure instead of a silent
> skip. Applying it requires the `workflows` permission or a manual paste. Once applied, replace
> this note with the run id and the real pass count.

## Gaps before Pass 1 can be marked complete

1. **Execute the LiteSVM harness in CI.** Written and committed; blocked only on the workflow
   step-order fix described above.
2. **Extend the harness to the remaining seven programs.** Governance is covered because it is the
   security root. Escrow Vault is the next priority, since it is the only program that custodies
   funds, followed by the Deal Registry terms-hash binding.
3. **Measured coverage.** The 95% line/branch target is stated but not yet measured. A coverage
   tool (`cargo-llvm-cov`) needs adding to CI to produce a real number rather than an assertion.
   The instruction bodies of `escrow_vault` and `liquidation_engine` in particular have no
   host-target tests, because their logic is almost entirely CPI and account validation.
4. **Escrow Vault and Liquidation Engine.** Both compile and are reviewed, but neither has
   executable test evidence yet for the same reason.

Pass 1 stays marked partial until every item above has executed and its result is recorded here.
