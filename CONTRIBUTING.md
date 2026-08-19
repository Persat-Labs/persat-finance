# Contributing to Persat Finance

Thank you for contributing. This is financial infrastructure under active testnet development, so correctness, auditability, and explicit scope matter more than shipping quickly.

## First-day orientation

1. Read the four authoritative documents in `docs/`:
   - `Persat_Finance_How_It_Works.docx`
   - `Persat_Finance_Technical_Architecture.docx`
   - `Persat_Finance_Testnet_Flow.docx`
   - `Persat_Finance_10_Week_Roadmap.docx`
2. Read [`README.md`](README.md), [`WHAT_WE_BUILT.md`](WHAT_WE_BUILT.md), and [`MILESTONES_ACHIEVED.md`](MILESTONES_ACHIEVED.md).
3. Run the verification commands documented below before changing code.

## Local setup

```bash
npm --prefix frontend ci
npm --prefix backend ci
npm run verify
```

For protocol work, additionally install a compatible Rust toolchain, Solana CLI, and Anchor CLI. Do not create or use deployer keypairs in the repository.

## Contribution boundaries

### Allowed without deployment credentials

- Frontend routes, accessibility, responsive behavior, visual-system work
- Backend domain validation, tests, route contracts, and fail-closed service behavior
- Documentation, tests, audit plans, CI, and local tooling
- Anchor program source and tests once the toolchain is available

### Requires a security review and configured secure environment

- Any code that signs, sends, or relays a transaction
- Enabling stateful deal-link, proposal, keeper, notification, or bridge routing endpoints
- Any change to vault transfer logic, liquidation calculations, PDA seeds, oracle handling, whitelist policy, or governance rules
- Testnet deployment and all production configuration

## Required product invariants

Every change must preserve these constraints:

1. Non-custodial behavior at every layer.
2. tBTC/zBTC-only collateral; USDC/USDT-only loans.
3. Private links are single-use and server stores only a hash of the raw token.
4. Marketplace interaction is structured terms only—no free-text field or persistence column.
5. Oracle staleness blocks price-dependent behavior.
6. Governance standard actions require 2-of-3 signatures plus a 24-hour timelock; emergency pause is 1-of-3 with no timelock.

## Before opening a pull request

```bash
npm run verify
```

Also manually verify that marketplace screens include no `<textarea>`, message, description, URL, social-handle, or contact field. Document security-sensitive changes in the relevant audit-pass plan before merging.

## Secrets

Use encrypted environment settings or a secret manager. Never put secrets in source, fixtures, screenshots, issues, or chat. `.env.example` documents names only.
