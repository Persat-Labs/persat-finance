# Backend Hybrid Decision — PHP/MySQL + Node.js Sidecar

## Question: Can We Use PHP/MySQL Only?

**Short answer: 80% yes, 100% no.** You can and should use PHP/MySQL for cheap persistence. We already have it (`backend/src/Database.php`, `SolanaCrypto.php`, `public/api/*.php`). But auto-faucet one-click, keeper autonomy, and oracle/bridge health need Node.js.

## What PHP/MySQL Handles (Cheap cPanel/LAMP, $3-5/mo)

- **Auth:** `wallet_auth_challenges` + `wallet_sessions` — nonce SHA-256 hash + Ed25519 verify via `sodium_crypto_sign_verify_detached` (C-speed, no JS dependency)
- **Deals:** `deal_links` single-use 410 Gone, `marketplace_proposals` structured terms only (principal_atoms DECIMAL(39,0), rate_bps, duration_months, collateral_ltv_bps, status enum)
- **Messages/Profiles:** CRUD, no Solana tx
- **Faucet cooldown:** `faucet_claims` 24h check — but dispensing still needs Solana SDK
- **Waitlist:** `waitlist_signups` full_name, email UNIQUE, role_type, region, referral_source

**Why it works:** PDO + prepared `?`, libsodium native, `schema.sql` single dump, phpMyAdmin import. No external dep beyond PHP 8.2+ ext-sodium.

## What Node.js Sidecar Handles (Fly/Railway/Render, port 4000)

- **Auto-faucet dispenser** (`POST /v1/faucet/auto`): builds Transaction with `@solana/web3.js` + `@solana/spl-token` — SystemProgram.transfer 0.5 SOL, createAssociatedTokenAccount if missing, createMintToInstruction 0.1 tBTC (79AL...), 0.1 zBTC (DqQ1...), 5000 USDC (FsSP...), 5000 USDT (8zdn...). Signs with `PERSAT_DEPLOYER_KEYPAIR`, sends raw tx. PHP cannot do this maturely — no SPL token SDK.
- **Keeper autonomous** (`keeper.ts`): persistent process polling every 60s, evaluating LTV via Pyth, auto `seize_collateral` + `mark_liquidated` + `close_deal`. PHP is per-request, not persistent — needs cron+lock which is fragile.
- **Oracle Pyth** (`/v1/oracle/btc-usd`): 5s in-memory cache + inFlight dedup to avoid thundering herd under pump. PHP would need Redis + extra infra.
- **Bridge health** (`/v1/bridges/health`): 30s cache 3 signals — pause/status, success rate >80%, on-chain liquidity >$10k — auto/partial_auto/fail_closed routing for BTC default deposit. PHP per-request would hammer Zeus/Threshold APIs.

## Database Unification

`backend/src/database.ts` now dual:
- `PERSAT_DATABASE_URL=mysql://...` → `mysql2/promise` pool, `?` placeholders, `UUID()`, `DATE_ADD(NOW(), INTERVAL ? MINUTE)`, `VARCHAR(36)` PK, `DATETIME`, `INDEX`
- `PERSAT_DATABASE_URL=postgresql://...` → `pg` pool, `$1` placeholders, `gen_random_uuid()`
- Wrapper `UnifiedDb { type: 'mysql'|'pg'|'none', query(text, params) => {rows, rowCount} }` converts `$1`→`?`, `gen_random_uuid()`→`UUID()` automatically
- `schema.sql` MySQL 8.0+ authoritative, matches `docs/php-mysql-backend-blueprint.md` — no drift
- All routes (`faucet.ts`, `dealLinks.ts`, `marketplace.ts`, `walletAuth.ts`, `auth.ts`) now MySQL-first `?` + `UUID()` + `DATE_ADD`

## Verification

```bash
cd backend && npm ci && npm run typecheck # ok mysql2 3.11.0 + pg 8.16.3
cd frontend && npm run build # 19 routes
npm run verify # lint + marketplace-policy + build + typecheck + 11 tests
```

## Deploy Split

- **PHP/MySQL:** Upload `backend/public/` to cPanel `public_html/api/`, import `schema.sql`, set `DB_*` in `config.php`
- **Node.js:** Fly: `fly launch --dockerfile Dockerfile`, set `PERSAT_DATABASE_URL=mysql://...` + `PERSAT_DEPLOYER_KEYPAIR=[...]` + `SOLANA_RPC_URL=https://...helius...`
- **Frontend:** Vercel: `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_SOLANA_RPC_URL`

## Mainnet Swap

Change 4 mint addresses in `frontend/src/lib/solana/tokens.ts` to canonical tBTC/zBTC/USDC/USDT + operator to dedicated keeper + RPC to mainnet — same hybrid architecture, no code rewrite.

## Security Invariants Preserved

- No custody: vault PDA, hash-only tokens, SHA-256 deal link token_hash, no amount/rate in link
- Pyth fail-closed: stale/invalid → `mustRefreshOracle` error, never guessed
- 2% fee 5% cap, 80% LTV, 85% liquidation, non-custodial
