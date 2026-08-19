# Persat backend

The Node.js service owns no user funds. It provides API, indexer, notification, bridge-health, and keeper-adjacent services around the Solana programs.

## Current safety posture

- `GET /health` is available for deployment monitoring.
- `GET /v1/bridges/health` is deliberately fail-closed: neither bridge is reported as routable until live provider verification is configured.
- Deal-link and marketplace write route source is present but is **not registered** yet. It must first be guarded by a wallet-signature authentication flow and connected to deployed Deal Registry program verification. This avoids allowing a server to bind arbitrary wallets or mutate off-chain matching state.
- `migrations/001_marketplace_and_deal_links.sql` stores SHA-256 token hashes only; raw private-link tokens are never persisted.

## Founder configuration required before stateful services

The backend needs a PostgreSQL connection string in its secure deployment environment (`PERSAT_DATABASE_URL`). The existing Supabase project can supply PostgreSQL if you choose to use it. Do not commit or paste the connection string into chat.
