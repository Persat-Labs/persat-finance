# Persat Solana programs

Anchor workspace for the eight programs defined in the authoritative Technical Architecture document.

| # | Program | Responsibility | Status |
| --- | --- | --- | --- |
| 1 | `governance` | 2-of-3 multisig, 24h timelock, 1-of-3 emergency pause | Source + unit tests, CI-verified |
| 2 | `price_oracle` | Single BTC/USD adapter, fail-closed on staleness | Source + unit tests, CI-verified |
| 3 | `asset_whitelist` | Collateral and loan-currency policy | Source + unit tests, CI-verified |
| 4 | `deal_registry` | Private and public deals, terms binding | Source + unit tests, CI-verified |
| 5 | `escrow_vault` | PDA-owned collateral custody | Source, CI-verified build |
| 6 | `loan_lifecycle` | Activation, payments, default flagging | Source + unit tests, CI-verified |
| 7 | `liquidation_engine` | Position evaluation, partial/full liquidation | Source, CI-verified build |
| 8 | `fee_treasury` | Governance-parametrized origination fees | Source + unit tests, CI-verified |

Shared financial math lives in [`crates/persat-core`](crates/persat-core), which has no Solana
dependency so every calculation is unit-testable and fuzzable on the host target.

## Current status

**Not deployed.** No program has been deployed to any cluster, no deployer key exists in this
repository, and the program IDs below are deterministic placeholders generated from a domain
string. They must be replaced with real, generated program keypairs before any deployment.

The programs compile to SBF and the unit suite passes in CI. What has *not* happened yet:
live-validator integration tests (Pass 3), fuzzing at the mandated 10,000-iteration scale
(Pass 2), and adversarial audit (Pass 4). Do not treat a green CI badge as audit evidence.

## Building

The build runs in GitHub Actions (`.github/workflows/protocol.yml`), which installs Rust, the
Solana CLI, and Anchor. To build locally you need the same toolchain:

```bash
# Requires Rust, Solana CLI 3.1.10, Anchor 1.0.2 via avm
cd contracts
cargo test --workspace          # host-target unit tests, no validator needed
anchor build --ignore-keys      # SBF build
```

`cargo test --workspace` is the fast signal and needs no validator. It covers all shared math and
every pure program helper.

## Reading CI output

Actions job logs live in Azure blob storage, which some environments cannot reach. Use
[`scripts/ci-log.sh`](scripts/ci-log.sh) to resolve the signed log URL and print the failing lines.

## Program IDs

Declared in [`Anchor.toml`](Anchor.toml) and each program's `declare_id!`. These are placeholders.
Generating real program keypairs is a founder-side, secure-environment action — see
[`../GO_LIVE_AND_SCALE.md`](../GO_LIVE_AND_SCALE.md).

## Invariants every change must preserve

1. All monetary arithmetic is checked. No wrapping, no floats, no unchecked casts on a value that
   represents money. `overflow-checks` is on in release.
2. Collateral: tBTC and zBTC only. Loan currency: USDC and USDT only. Custodial wrapped BTC
   (cbBTC, WBTC) and CeFi reserve tokens (SolvBTC) are excluded by policy.
3. Maximum LTV at origination is 50%, enforced as a protocol constant, not a governance parameter.
4. Every price-dependent action fails closed on a stale oracle.
5. No Persat-controlled key can move user funds. Vault authority is a PDA.
6. Governance standard actions are 2-of-3 plus a 24-hour timelock; emergency pause is 1-of-3 with
   no timelock, and unpausing requires the full 2-of-3.
