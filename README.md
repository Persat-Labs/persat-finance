# Persat Finance

Persat Finance is non-custodial Bitcoin-backed lending infrastructure on Solana. It supports two entry paths that converge into one audited loan lifecycle:

1. **Private direct deals** for people who already know one another, using a single-use deal link when a counterparty wallet is not known.
2. **An open marketplace** for structured lending proposals between people who do not already know one another.

> **Current status:** active MVP build for testnet. No Solana program is deployed, no user funds are handled by this repository, and the product must not be represented as ready for mainnet use.

## Start here

| If you are… | Read this first |
| --- | --- |
| A product or engineering contributor | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Looking for the authoritative product behavior | `docs/Persat_Finance_How_It_Works.docx` and `docs/Persat_Finance_Testnet_Flow.docx` |
| Working on protocol architecture | `docs/Persat_Finance_Technical_Architecture.docx` and [`docs/technical-architecture.md`](docs/technical-architecture.md) |
| Setting up local services | [`GO_LIVE_AND_SCALE.md`](GO_LIVE_AND_SCALE.md) |
| Reviewing existing implementation status | [`WHAT_WE_BUILT.md`](WHAT_WE_BUILT.md) and [`MILESTONES_ACHIEVED.md`](MILESTONES_ACHIEVED.md) |
| Testnet completion → 3-step mainnet cutover | [`docs/MAINNET_CUTOVER_3_STEP.md`](docs/MAINNET_CUTOVER_3_STEP.md) |

## Repository map

```text
contracts/  Planned Anchor/Solana workspace and protocol programs
frontend/   Next.js 14, React, TypeScript, Tailwind product application
backend/    Fastify/Node.js protocol-adjacent API and services
waitlist/   Independently deployed public waitlist site and Supabase setup
security-audits/  Evidence for mandatory four-pass audit process
docs/       Authoritative product documents and implementation references
```

## Local developer commands

Requirements currently used by the repository:

- Node.js 22+
- npm 10+
- Rust, Solana CLI, and Anchor are required before contract compilation/testing

```bash
# Frontend
npm --prefix frontend ci
npm run frontend:dev

# Backend
npm --prefix backend ci
npm run backend:dev

# Full currently available verification
npm run verify
```

The backend starts in a safe mode without database credentials. It exposes health diagnostics but does not enable deal-link or marketplace write paths until persistent storage, wallet authentication, and deployed-program verification are available.

## Non-negotiable safety rules

- Never commit keys, seed phrases, database passwords, RPC credentials, or deployment tokens.
- No Persat-controlled process may custody user assets.
- Collateral acceptance is restricted to **tBTC** and **zBTC**; cbBTC, WBTC, and SolvBTC are excluded.
- Loans use **USDC** or **USDT** only.
- Marketplace flows must never accept or persist free-text messages, URLs, social handles, or contact details.
- Price-dependent actions must fail closed on stale BTC/USD data.
- Security audit passes are evidence-driven; no pass is marked complete without its report.
