# Persat Finance milestones

This record follows the authoritative 10-week roadmap. Status reflects verified repository work only; it does not claim a testnet deployment or audit outcome before those occur.

## Week 1 — Lock architecture and global brand foundation

- [x] Global, single BTC/USD oracle, dual-path (private deal + open marketplace) architecture reviewed against the authoritative How It Works, Technical Architecture, Competitive Analysis, Testnet Flow, and 10-Week Roadmap documents.
- [x] Existing waitlist visual language extracted into the main frontend foundation: dark surface system, amber/orange palette, Plus Jakarta Sans/Geist/JetBrains Mono fallbacks, panel and glow treatment, mono labels, minimum 48px controls, and inline-state-ready inputs.
- [x] Next.js 14 + TypeScript + Tailwind frontend workspace initialized.
- [x] Initial product home screen implements equal-weight private-deal and marketplace entry paths.
- [x] Anchor/Solana environment initialized. The development sandbox has no route to crates.io or the Anza release host, so GitHub Actions is used as the compiler and test runner. `contracts/scripts/ci-log.sh` resolves Actions log output for environments that cannot reach Azure blob storage.
- [x] Node.js API foundation added with health checks, fail-closed bridge health, Solana wallet-signature challenge/verification source, and unregistered secure route source for future deal-link and proposal handling.
- [x] CI pipeline configured for frontend lint/build and backend typecheck/test.
- [x] Contributor onboarding, handoff map, and four-pass testing strategy documented.
- [x] Marketplace structured-input source policy check added to local verification.
- [x] Anchor/Solana CI job green. The `Verify Solana protocol` job previously failed at `anchor test` with `Unable to read keypair file (~/.config/solana/id.json)`; the runner has no provider wallet. Fixed by pointing the provider at the keypair `anchor build` generates in `target/deploy` and running host-target `cargo test`, which needs no validator.
- [ ] Secure deployment configuration received and verified.

## Week 2 — Core programs: Registry & Whitelist

- [x] Asset Whitelist Registry: `add_asset_type`, `update_asset_type`, `deactivate`/`reactivate`, `is_accepted`, covering both collateral and loan-currency categories. Unit tested and CI-verified.
- [x] Deal Registry: `propose_deal` (Public and Private), `confirm_deal` (binding-only, terms-hash checked), `cancel_deal`, state advancement. Unit tested and CI-verified.
- [ ] tBTC, zBTC, USDC, USDT mint addresses integrated into the whitelist on a live cluster — blocked on founder-side cluster choice and mint confirmation.

## Weeks 3–5 — Remaining programs (source ahead of schedule, runtime-tested)

- [x] Escrow Vault, Price Oracle, Loan Lifecycle, Liquidation Engine, Fee & Treasury, and Governance program source complete; SBF build verified in CI.
- [x] Shared financial math extracted to `contracts/crates/persat-core` with checked arithmetic throughout.
- [x] LiteSVM access-control harness covers all eight programs — 107 runtime tests, all CI-verified at commit `554b2fd` (run 32671421373) with non-zero wall-clock times in every suite (no silent skips; `PERSAT_REQUIRE_PROGRAMS=1` in force): governance 7, escrow vault 18, deal registry terms-hash binding 18, loan lifecycle 17, liquidation engine 16 (drives the real price_oracle program — stale feed, wrong feed, partial Wormhole quorum, wide confidence all block evaluation), price oracle 11, asset whitelist 12, fee treasury 8. Every suite asserts exact Anchor error codes.
- [x] Four findings discovered by the harness and fixed the same week: registry state transitions, loan `mark_liquidated`, and the treasury fee counter now bind to recorded protocol authorities (F-1, F-2, F-4), and the oracle attributes under-verified Pyth updates distinctly from staleness (F-5). See `security-audits/pass-1/README.md`.
- [ ] Cross-program CPI invocation testing between the programs themselves (loan program calling `lock_vault`, etc.) — the harness currently binds authority with standing keypairs, an identical check at Anchor's layer; full CPI welding is part of Pass 3.
- [ ] First full manual lifecycle dry run on a live cluster — blocked on deployment approval.

## Security audit passes

- [~] Pass 1 — unit and access-control coverage: runtime suites exist and are CI-verified for all eight programs (run 32671421373, 107 tests green). Remaining to mark complete: measured coverage, which awaits the founder-applied `cargo llvm-cov` workflow in `docs/ci/`, plus cross-program CPI welding (Pass 3 scope). See `security-audits/pass-1/`.
- [~] Pass 2 — fuzzing: financial calculation families complete at 10,000 iterations each, 29 properties passing. PDA and state-transition fuzzing outstanding. See `security-audits/pass-2/`.
- [ ] Pass 3 — live testnet integration: not started, requires deployment.
- [ ] Pass 4 — adversarial audit: not started.

## Weeks 6–10

Not started. No later-week task is marked complete before source, tests, and the required audit pass evidence exist.
