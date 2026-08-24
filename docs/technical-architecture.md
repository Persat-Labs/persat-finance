# Technical architecture implementation guide

The authoritative architecture is [`Persat_Finance_Technical_Architecture.docx`](Persat_Finance_Technical_Architecture.docx). This Markdown file is the contributor-facing implementation map and must remain consistent with that document.

## Boundaries

- **On-chain:** eight Anchor programs own deal state, whitelist policy, escrow, price validity, payments, liquidation, fee configuration, and governance.
- **Frontend:** Next.js/React renders the private-deal and marketplace paths. It never holds private keys or bypasses wallet approval.
- **Backend:** Node.js provides wallet-auth sessions, deal-link token storage, proposal tracking, indexing, bridge health, notifications, and keeper coordination. It never holds user funds.
- **Off-chain persistence:** PostgreSQL stores only non-custodial application state. Sensitive bearer values (deal links and sessions) are stored as hashes.

## Cross-layer rules

1. The backend may index and propose actions, but it must not create a deal, bind a counterparty, or move assets without verified wallet authorization and an on-chain transaction.
2. A public listing is an unconfirmed `Public` Deal Registry account. Proposals remain off-chain to reduce contract surface.
3. An accepted exact-match proposal confirms the original deal. An accepted counterproposal cancels the public listing and creates a new private deal bound to both known wallets.
4. Oracle-dependent operations require a fresh BTC/USD price from Pyth, additionally gated on full Wormhole verification and a confidence interval within 2% of the price. USDC and USDT are treated as one dollar only as an explicitly documented MVP simplification.
5. Bridge auto-routing requires all three signals: provider pause/status, observed success rate, and on-Solana liquidity. Missing health data results in manual bridge choice, never a guessed route.

## Current implementation status

- Frontend application and wallet-adapter foundation: implemented and build-verified.
- Backend health, fail-closed bridge response, structured schemas, database migration, and wallet-signature challenge foundation: implemented and type/test verified.
- All eight Anchor programs: source complete, SBF build and host unit tests verified in CI. Not deployed to any cluster; program IDs are placeholders.
- Runtime access-control verification (LiteSVM, `PERSAT_REQUIRE_PROGRAMS=1`): all eight programs, 107 tests, CI-verified green with non-zero wall-clock times (run 32671421373 at commit `554b2fd`). The liquidation suite drives the real `price_oracle` program — stale feed, wrong feed, partial Wormhole quorum, and wide confidence all block evaluation. See `security-audits/pass-1/README.md` for per-run evidence.
- Security fixes from that harness: deal-registry state transitions, loan `mark_liquidated`, and treasury fee recording are now bound to recorded protocol authority addresses (findings F-1/F-2/F-4 in `security-audits/pass-1/`), and the oracle attributes under-verified Pyth updates as `InsufficientVerification` rather than staleness (F-5).
- Oracle provider resolved: **Pyth**, BTC/USD feed `0xe62df6c8…415b43`, read as a pull oracle with no protocol-held pusher key.
- Origination fee resolved: **2%** on both paths, governance-adjustable within the 5% protocol cap.
- Shared financial math (`contracts/crates/persat-core`): implemented with checked arithmetic and unit-tested on the host target.
- Persistent backend deployment, wallet-auth route integration, indexer, keepers, bridge SDK integration, on-chain client wiring (the CPI welding between programs itself), measured coverage (workflow pending founder apply, `docs/ci/`), and testnet deployment: pending.
