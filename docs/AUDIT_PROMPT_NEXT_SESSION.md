# PERSAT FINANCE — AUDIT & FIX PROMPT FOR NEXT SESSION
# Copy-paste everything below this line into a fresh Arena agent session on branch arena/01a04948-persat-finance

---

You are auditing Persat Finance repo `Persat-Labs/persat-finance` on branch `arena/01a04948-persat-finance`. Your job: **verify every edit requested in the previous chat was done, and if not, do it now + fix all errors**. Then push.

## WHERE WE ARE AT (as of 2026-08-28 b45e0ca)

- Frontend: Next.js 14.2.35, 19 routes, First Load 87.4kB, build green. Servers running 3000 (frontend) + 4000 (backend). Preview live.
- Backend: Hybrid PHP/MySQL + Node.js sidecar implemented. `backend/src/database.ts` dual MySQL (mysql2 ^3.11.0) + PG support, UnifiedDb wrapper converts `? <-> $1` + `UUID() <-> gen_random_uuid()` + `DATE_ADD(NOW(), INTERVAL ? MINUTE) <-> NOW() + (? * INTERVAL '1 minute')`. `tsc --noEmit` passes. Routes converted to `?` placeholders.
- Docs: `backend/README.md` + `docs/BACKEND_HYBRID.md` + `.env.example` updated to MySQL example `mysql://user:pass@host:3306/persat_finance` + `PERSAT_DEPLOYER_KEYPAIR` + `DB_*` for PHP.
- Commits pushed: `d42fb11 feat: hybrid...` + `b45e0ca chore: ignore persat secret bundles`
- Still needed to verify: all UX overhaul items below, plus no contradicting code (MySQL vs PG mismatch), no OTF blurry fonts, no base64url crash, no missing auto-faucet.

## NON-NEGOTIABLE ARCHITECTURE INVARIANTS (never break)

- Non-custodial: vault PDA owns token account, no Persat account holds funds.
- Collateral: tBTC, zBTC ONLY (8 decimals). Exclude cbBTC, WBTC, SolvBTC.
- Loan: USDC, USDT ONLY (6 decimals) treated as $1 MVP. No second oracle.
- Single Pyth pull oracle feed `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`, receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, staleness 60s, confidence 200bps, fail-closed.
- Bridge auto-routing requires 3 signals: pause/status, success rate, on-chain liquidity. Missing => manual, never guessed.
- Marketplace structured terms ONLY. No free-text, URLs, social handles. `npm run frontend:marketplace-policy` must stay green.
- Fees: 2% both paths, 5% cap, 80% LTV, 85% liquidation.
- Backend never holds private keys except deployer for auto-faucet (env only), deal links + sessions stored as SHA-256 hashes only.
- Testnet = mainnet architecture, only mint swap for mainnet. No contradicting code: if `database.ts` uses `pg`, migrations must be PG; if frontend `MINTS.tBTC`, backend must accept same mint. Single source: `contracts/config/devnet.json` + `frontend/src/lib/protocol/config.ts` + `ops/handoff/devnet-deployed.json`.

## ALL EDITS REQUESTED THROUGHOUT CHAT (verify each, fix if missing)

### 1. Fonts — Phantom wallet style, no blurry OTF
- [ ] Check `frontend/public/fonts/` — must NOT contain `cuaniex-trial.otf`, `detra.otf`, `gafter.otf`, `rigter.otf`, `sogea.otf`. Delete if present.
- [ ] `frontend/src/app/globals.css` + `layout.tsx` must use `Inter + Plus Jakarta Sans + system-ui`, `antialiased`, crisp, no OTF import. No dramatic fonts.
- [ ] Verify `frontend/src/app/layout.tsx` does NOT import Cuaniex/Detra OTF.

### 2. Deposit flow — default BTC with auto-routing
- [ ] Default deposit type is BTC — user prompted to deposit BTC by default.
- [ ] System auto-converts BTC → tBTC/zBTC based on live bridge checker 3 signals: pause/status, success rate >80%, on-chain liquidity >$10k.
- [ ] Manual tBTC/zBTC selection remains as secondary option for users who already hold them.
- [ ] Check `frontend/src/components/bridge/BridgeDepositPanel.tsx` + `frontend/src/lib/protocol/bridge.ts` + `backend/src/services/bridge.ts` + `backend/src/routes/bridge.ts`: must implement `getBridgeHealth()` 30s cache + inFlight dedup + `getBestBridge()` picks highest successRate then liquidity + fail-closed auto/partial_auto/manual.
- [ ] No guessed routing if health missing.

### 3. Auto-faucet without bundle upload
- [ ] New users should NOT need to upload `persat-devnet-keypairs-KEEP-SECRET.json` each time.
- [ ] System automatically gives test SOL from deployer wallet and test BTC (tBTC/zBTC) into connected wallet via one-click claim.
- [ ] Check `backend/src/routes/faucet.ts`: must have `dispenseFromServer()` using `@solana/web3.js` + `@solana/spl-token` — `SystemProgram.transfer 0.5 SOL`, `createAssociatedTokenAccountInstruction` if missing, `createMintToInstruction` 0.1 tBTC (79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg) + 0.1 zBTC (DqQ1...) + 5000 USDC (FsSP...) + 5000 USDT (8zdn...), signs with `PERSAT_DEPLOYER_KEYPAIR`, returns explorerUrl.
- [ ] Endpoints: `POST /v1/faucet/auto {wallet}` + `POST /v1/faucet/claim` + `GET /v1/faucet/status/:wallet` — all with 24h cooldown via `faucet_claims` table, 429 with remaining hours.
- [ ] Frontend `frontend/src/app/faucet/page.tsx` must have "Claim Full Pack" one-click button that calls `/v1/faucet/auto`, shows explorer link, fallback to bundle upload only if `serverDispenseAvailable=false`.
- [ ] Bundle upload becomes optional advanced fallback, not mandatory.

### 4. Home page
- [ ] Must have clear list of tokens available in wallet, amount locked, available balance, locked collateral.
- [ ] Remove Activity Stream / Live Marketplace — Watch to Track section entirely.
- [ ] Check `frontend/src/app/page.tsx` or home component: shows balances via `useUserBalance` + locked via protocol, crisp cards, frosted glass, sub-10ms.

### 5. Deals page
- [ ] Must have feature to watch/track deals plus earnings and due date visibility.
- [ ] Must have two buttons at top: New Deal+ and My Deals.
- [ ] New Deal+ → `/deal/new` Propose a Loan page.
- [ ] My Deals → list of deals currently on plus proposals sent to handle/wallet directly, with Pending Deals, Active Deals, Closed Deals under My Deals, plus "I am the Lender / I am the Borrower" toggle like New Deal page.
- [ ] Deals trackable/manageable real-time — check `frontend/src/app/deals/page.tsx` + `frontend/src/app/deal/[id]/manage/page.tsx` + `frontend/src/app/deal/[id]/repay/page.tsx`.

### 6. Backend hybrid — PHP/MySQL only question
- [ ] Verify `backend/src/database.ts` dual support:
  - `detectDbType(url)` mysql:// vs postgres://
  - `mysql2/promise` pool uri, connectionLimit 20, `pg` Pool fallback 20/2
  - `UnifiedDb {type, query}` wrapper: `?` <-> `$1,$2` conversion, `UUID()` <-> `gen_random_uuid()`, `DATE_ADD(NOW(), INTERVAL ? MINUTE)` <-> `NOW() + (? * INTERVAL '1 minute')`
  - Must handle both directions, not only `$1` -> `?`.
- [ ] `backend/package.json` must have `mysql2@^3.11.0` + `pg` + `fastify` + `@solana/web3.js` + `@solana/spl-token`
- [ ] Routes must use `?` placeholders + `UUID()` + `DATE_ADD` for MySQL, wrapper converts for PG:
  - `faucet.ts`: `VARCHAR(36) PRIMARY KEY`, `DATETIME`, `INDEX idx_wallet_asset_time`, `UUID()` insert, cooldown query `?`
  - `dealLinks.ts`: `?` + `UUID()` + `DATE_ADD(NOW(), INTERVAL ? MINUTE)` + MySQL no RETURNING (SELECT then UPDATE)
  - `marketplace.ts`: `?` + `UUID()`
  - `walletAuth.ts`: no `db.connect()` transaction, sequential queries `UUID()` + `DATE_ADD`, fixed param count (3 params for challenge, not 4)
  - `middleware/auth.ts`: `?`
- [ ] `schema.sql` MySQL 8.0 schema matches `docs/php-mysql-backend-blueprint.md`: deal_links, marketplace_proposals (DECIMAL(39,0) principal_atoms, CHECK USDC/USDT, rate_bps, duration_months 1-60, collateral_ltv_bps), wallet_auth_challenges, wallet_sessions, faucet_claims, waitlist_signups.
- [ ] PHP files remain for 100% PHP hosting of CRUD: `backend/src/Database.php`, `SolanaCrypto.php` (base58Decode + sodium_crypto_sign_verify_detached), `backend/public/api/*.php`
- [ ] No contradicting code: previously `database.ts` PG but `schema.sql` MySQL — now unified.

### 7. Previous bug fixes — verify they stay fixed
- [ ] `src/lib/protocol/hooks.ts:69` `Buffer.from(id).toString("base64url")` crashes in browser — must use custom btoa/atob impl, not Buffer base64url.
- [ ] Fonts blurry OTF fixed via Inter+Plus Jakarta antialiased.
- [ ] `sh: 1: next: not found` — must run `npm ci` before `npm run dev` in frontend.
- [ ] `tsx: not found` + `/tmp/deployer.json: No such file` — backend `npm ci` + `frontend/scripts/generate-sandbox-bundle.mjs` regen.
- [ ] Public RPC `https://api.devnet.solana.com` rate-limited — must support Helius RPC via `SOLANA_RPC_URL` / `NEXT_PUBLIC_SOLANA_RPC_URL`, fallback to client_bundle.
- [ ] Push rejected `arena/... -> rejected fetch first` — must `git pull --rebase` or force with lease.

### 8. Build & verification
- [ ] `cd backend && npm ci && ./node_modules/.bin/tsc --noEmit` passes
- [ ] `cd frontend && npm run build` 19 routes, First Load ~87kB
- [ ] `npm run verify` (if exists) lint + marketplace-policy + build + typecheck + tests green
- [ ] Backend health: `curl localhost:4000/health` ok, `curl localhost:4000/v1/bridges/health` returns auto/tbtc/zbtc
- [ ] Frontend preview live on 3000, backend 4000.

## 3 STEPS FOR MAINNET-TESTNET (testnet is literally mainnet except mint swap)

**Current testnet is mainnet-identical architecture. Only 3 changes to become mainnet:**

1. **Mint swap** — Change 4 mint addresses in `frontend/src/lib/solana/tokens.ts` + `frontend/src/lib/protocol/config.ts` + `contracts/config/devnet.json`:
   - Devnet stand-ins: tBTC `79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg` (8d), zBTC `DqQ1yzTPsfpuMMyuV6mVBvusxpq9mqmTTJZ4yMUQwQEt` (8d), USDC `FsSPdkdWnb8R7oziaiYFvhMbhHT7Sd9Uq55t88B7Muqe` (6d), USDT `8zdnnnuNJPNDkGTCxREnTyKnRo494By7MrDSTYtRx1aJ` (6d)
   - → Mainnet canonical: tBTC mainnet, zBTC mainnet, USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`
   - No code rewrite, only address constants.

2. **RPC + operator swap** — Change RPC and authority:
   - `SOLANA_RPC_URL` + `NEXT_PUBLIC_SOLANA_RPC_URL`: `https://api.devnet.solana.com` (or Helius devnet) → Helius/QuickNode mainnet-beta
   - `SOLANA_CLUSTER`: `devnet` → `mainnet-beta`
   - Operator: `PERSAT_GOVERNANCE_SIGNER_1_PUBKEY=99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD` (dev deployer) → dedicated keeper multisig 2-of-3 `GOVERNANCE_SIGNER_1/2/3`
   - `PERSAT_DEPLOYER_KEYPAIR` → removed (no mint authority on mainnet, auto-faucet disabled)

3. **Governance + keeper production enable** — Flip flags:
   - `KEEPER_ENABLED=false` → `true`, `KEEPER_POLL_SECONDS=60`, `KEEPER_KEYPAIR_PATH` → dedicated keeper keypair (not deployer)
   - Enable `GOVERNANCE_SIGNER_2_PUBKEY`, `GOVERNANCE_SIGNER_3_PUBKEY` multisig for `lock_vault`, `begin_funding`, `mark_active`, `close_deal`, `release_collateral`, `seize_collateral`, `mark_liquidated`, `record_origination_fee`
   - `CORS_ORIGINS`: `https://3000-*.e2b.app` → `https://persat.finance,https://app.persat.finance`
   - `NODE_ENV`: `development` → `production`, helmet strict, rate-limit 100/min

After these 3, testnet **is** mainnet. No re-architecture.

## YOUR TASK NOW

1. Read `backend/src/database.ts`, `backend/src/routes/*.ts`, `backend/src/middleware/auth.ts`, `frontend/src/app/faucet/page.tsx`, `frontend/src/components/bridge/BridgeDepositPanel.tsx`, `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`, `frontend/src/app/page.tsx`, `frontend/src/app/deals/page.tsx`, `.env.example`, `backend/README.md`, `docs/BACKEND_HYBRID.md`, `schema.sql`, `docs/php-mysql-backend-blueprint.md`.
2. For each checklist item above, verify file content. If missing or wrong, fix it now (edit file, install deps, run tsc).
3. Run `cd backend && npm ci && npx tsc --noEmit` — must be green. Run `cd frontend && npm run build` — must be 19 routes.
4. Restart backend `npx tsx watch src/server.ts` and frontend `npm run dev -- --hostname 0.0.0.0 --port 3000` if needed, verify `curl localhost:4000/health` and `/v1/bridges/health`.
5. Commit all fixes to same branch `arena/01a04948-persat-finance` and push `git push origin arena/01a04948-persat-finance`.
6. Output summary: what was already ok, what you fixed, build status, and confirm 3-step mainnet cutover still valid.

Do not ask for secrets. Use `PERSAT_DATABASE_URL=mysql://...` example, never real creds. Do not commit `persat-*.json` or `*KEEP-SECRET*.json`.
