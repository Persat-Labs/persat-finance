# Persat Finance Backend — Hybrid PHP/MySQL + Node.js Sidecar

This backend implements the **recommended hybrid** from `docs/php-mysql-backend-blueprint.md` — cheap MySQL persistence for CRUD + Node.js microservice for Solana transactions.

## Architecture — Why Not 100% PHP/MySQL Only?

**You CAN use PHP/MySQL only for 80%**, and we have it:
- `src/Database.php` + `SolanaCrypto.php` (native `sodium_crypto_sign_verify_detached` Ed25519, C-speed)
- `public/api/auth/*.php`, `deals/*.php`, `messages/*.php`, `profiles/*.php`
- `schema.sql` MySQL 8.0+ — single dump, runs on cPanel/cheap VPS

**But 100% PHP/MySQL breaks:**
1. **Auto-faucet one-click** — needs `@solana/web3.js` + `@solana/spl-token` to create ATA, `createMintToInstruction`, `SystemProgram.transfer`, sign with deployer keypair. PHP has no mature SPL SDK.
2. **Keeper autonomous** — needs persistent process polling every 60s, evaluating LTV via Pyth, auto `seize_collateral` + `mark_liquidated` + `close_deal`. PHP is per-request, not persistent.
3. **Oracle + Bridge health** — needs 5s/30s in-memory cache + inFlight dedup to avoid thundering herd under pump. Node does this, PHP would need Redis + cron.

## Hybrid Recommended (Current)

- **PHP/MySQL (cPanel, cheap VPS, LAMP):** waitlist, `deal_links` (single-use 410 Gone), `marketplace_proposals` (structured terms only), `wallet_auth_challenges`, `wallet_sessions` (hash only), `faucet_claims` 24h cooldown — all CRUD, no Solana tx building
- **Node.js/Fastify (Fly/Railway/Render, port 4000):** `/v1/faucet/auto` + `/v1/faucet/claim` server-side dispensing from `PERSAT_DEPLOYER_KEYPAIR`, `/v1/oracle/btc-usd` 5s cache fail-closed, `/v1/bridges/health` 30s cache 3 signals (pause/status, success rate >80%, liquidity >$10k), keeper 60s tick

## Database — MySQL First, PG Fallback

`src/database.ts` now supports both:
- `PERSAT_DATABASE_URL=mysql://user:pass@host:port/db` → uses `mysql2/promise` pool, `UUID()`, `DATE_ADD(NOW(), INTERVAL ? MINUTE)`, `?` placeholders
- `PERSAT_DATABASE_URL=postgres://...` → uses `pg` pool, `$1` placeholders, `gen_random_uuid()`
- No DB → dev mode, faucet allows without cooldown, marketplace falls back to localStorage

**Schema:** `schema.sql` MySQL 8.0+ is authoritative — matches `docs/php-mysql-backend-blueprint.md`:
- `deal_links` (id VARCHAR(36) PK, deal_id UNIQUE, token_hash UNIQUE SHA-256, initiator_wallet, claimed_by_wallet, expires_at DATETIME, claimed_at DATETIME, terms_json JSON)
- `marketplace_proposals` (id, listing_id, proposer_wallet, principal_atoms DECIMAL(39,0), loan_mint CHECK USDC/USDT, rate_bps, duration_months 1-60, collateral_ltv_bps, status pending/accepted/declined/superseded)
- `wallet_auth_challenges` (id, wallet, nonce_hash UNIQUE, message TEXT, expires_at, used_at)
- `wallet_sessions` (id, wallet, token_hash UNIQUE, expires_at, revoked_at)
- `faucet_claims` (id, wallet, asset, claimed_at)
- `waitlist_signups` (id, full_name, email UNIQUE, role_type, region, referral_source)

**PHP alternative:** Same schema runs on MySQL via `src/Database.php` PDO — `PERSAT_DATABASE_URL` not needed for PHP, uses `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` env.

## Env — Single Source of Truth

```env
# MySQL recommended (cheap, cPanel)
PERSAT_DATABASE_URL=mysql://user:pass@host:3306/persat_finance
# OR Postgres (Supabase)
# PERSAT_DATABASE_URL=postgresql://...

# Solana — required for auto-faucet + keeper
SOLANA_RPC_URL=https://your-helius-devnet.rpc
PERSAT_DEPLOYER_KEYPAIR=[64 numbers] — JSON array, mint authority for tBTC/zBTC/USDC/USDT stand-ins
PERSAT_GOVERNANCE_SIGNER_1_PUBKEY=99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD

# Optional
ZEUS_API_KEY=
THRESHOLD_API_KEY=
PYTH_HERMES_URL=https://hermes.pyth.network
KEEPER_ENABLED=true
KEEPER_POLL_SECONDS=60
PORT=4000
NODE_ENV=development
CORS_ORIGINS=https://persat.finance,https://3000-*.e2b.app
```

## How Auto-Faucet Works (No Upload Needed)

1. User connects wallet on `/faucet`
2. Clicks "Claim Full Pack" → `POST /v1/faucet/auto { wallet }`
3. Backend checks cooldown in `faucet_claims` (24h), then `dispenseFromServer()`:
   - Connection to devnet RPC
   - Checks deployer balance ≥0.01 SOL
   - Builds Transaction: 0.5 SOL transfer + ATA creation if missing + mintTo 0.1 tBTC (79AL... 8d) + 0.1 zBTC (DqQ1... 8d) + 5000 USDC (FsSP... 6d) + 5000 USDT (8zdn... 6d)
   - Signs with deployer, sends raw tx, confirms
   - Returns sig + explorerUrl `https://explorer.solana.com/tx/<sig>?cluster=devnet`
4. Frontend shows explorer link, refreshes balance

If `PERSAT_DEPLOYER_KEYPAIR` not set, backend returns `mode: client_bundle` and frontend falls back to bundle upload (old flow for devs).

## How BTC Default Auto-Routing Works

- Default deposit type BTC — user prompted to deposit BTC
- `getBridgeHealth()` checks 3 signals: provider pause/status, observed success rate, on-Solana liquidity
- `getBestBridge()` picks highest successRate then liquidity
- `BridgeDepositPanel` shows BTC → auto tBTC/zBTC, manual selector for users who already have tBTC/zBTC
- Fail-closed: if health missing or stale oracle, manual fallback, never guessed

## Verification

```bash
cd backend && npm ci && npm run typecheck # ok — mysql2 + pg dual support
cd frontend && npm run build # 19 routes, 87.4kB First Load
npm run verify # lint + marketplace-policy + build + typecheck + 11 tests green
```

## Deploy

- **PHP/MySQL:** Upload `backend/public/` to cPanel `public_html/api/`, import `schema.sql` via phpMyAdmin, set `DB_*` env in `config.php`
- **Node.js:** Fly/Railway/Render: `npm run start` with `PERSAT_DATABASE_URL=mysql://...` + `PERSAT_DEPLOYER_KEYPAIR` + `SOLANA_RPC_URL`
- **Frontend:** Vercel/Netlify: `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_APP_URL`

Mainnet swap = change 4 mint addresses to canonical + operator to dedicated keeper + RPC to mainnet — same architecture.
