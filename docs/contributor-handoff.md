# Contributor handoff map

## Frontend contributor

Owns `frontend/`. Use `npm run frontend:dev`, then run `npm run frontend:lint`, `npm run frontend:marketplace-policy`, and `npm run frontend:build` before opening a PR. Product routes and intended Testnet Flow screens are mapped in `docs/Persat_Finance_Testnet_Flow.docx`.

## Backend contributor

Owns `backend/`. Start with `backend/README.md`, `backend/migrations/001_marketplace_and_deal_links.sql`, and the existing fail-closed route boundaries. Do not expose a state-changing endpoint before verifying wallet authorization and deployed program state.

## Protocol contributor

Owns `contracts/`. Start only after Rust/Solana/Anchor are installed. Read the authoritative Technical Architecture before creating program IDs or sending any transaction. No deployer key belongs in the repository.

## Security contributor

Owns audit evidence in `security-audits/pass-[n]/`. Start from `docs/testing-strategy.md`; reports must distinguish planned tests from verified execution evidence.

## Source of truth order

1. User-approved current build prompt
2. Technical Architecture and Testnet Flow documents
3. How It Works and 10-Week Roadmap documents
4. This repository's implementation docs
