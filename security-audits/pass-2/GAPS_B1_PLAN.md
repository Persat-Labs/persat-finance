# Pass-2 gaps (B1) — execution plan

Parent: `security-audits/pass-2/README.md`  
Cutover: `docs/MAINNET_CUTOVER_3_STEP.md` § B1  

Math fuzz (29 × 10k) is **done**. Still open:

1. **PDA seed fuzzing** (LiteSVM / program harness)
2. **Deal-state transition fuzzing** (random instruction sequences)

## Why not in `persat-core` alone

PDA derivation and account-state machines are enforced by **on-chain programs** under LiteSVM, not pure math in `persat-core`. Host-only `proptest` cannot close these gaps.

## Target properties (minimum)

### PDA seeds

- [ ] Known seed tuples always derive the same PDA (stability)
- [ ] Distinct logical entities never collide on the same PDA for fixed program id
- [ ] Spoofed bump / wrong seeds rejected by constraints (`ConstraintSeeds`)
- [ ] ≥ 10,000 random seed byte strings: derive + attempt spoof write → expect fail

**Harness home (proposed):** `contracts/tests/protocol-tests/` or extend existing LiteSVM suites per program.

### Deal-state transitions

- [ ] From each legal `DealState`, only allowlisted instructions succeed
- [ ] Random sequences of length 3–12 never reach an undefined state
- [ ] `confirm_deal` with wrong terms hash always fails
- [ ] Terminal states reject further lifecycle advances
- [ ] ≥ 10,000 random sequences (or exhaustive graph + 10k noise)

**Programs in scope:** `deal_registry`, `loan_lifecycle`, `escrow_vault` (authority-bound).

## Execution steps

1. Inventory legal transition graph from program source (table in this file when done).
2. Add LiteSVM tests asserting each edge + each illegal edge error code.
3. Add proptest-driven random walk over the instruction enum (host test driving LiteSVM).
4. CI: `cargo test` job already on protocol workflow — ensure new tests gate merge.
5. Record run id + pass count in `pass-2/README.md`; flip B1 checkboxes.

## Status

| Item | Status |
| --- | --- |
| Plan filed | **Yes** (this file) |
| LiteSVM PDA corpus | Not started |
| State-transition random walk | Not started |
| B1 exit | Open |

Do not mark Pass 2 complete in milestones until both gap rows say **executed** with CI links.
