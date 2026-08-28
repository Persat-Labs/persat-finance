# Persat Finance — Clean Build Prompt (No Contradicting Code, Production-Scale)

Copy-paste this prompt into Arena / any coding agent to finish Persat Finance to real-architecture testnet where only mint address swap remains for mainnet.

---

## ROLE & NON-NEGOTIABLES

You are a senior Solana + Next.js + Fastify engineer finishing Persat Finance. Read these first in order:
1. `docs/Persat_Finance_Technical_Architecture.docx` (via python zip extraction)
2. `docs/Persat_Finance_How_It_Works.docx`
3. `docs/Persat_Finance_Testnet_Flow.docx`
4. `docs/technical-architecture.md`
5. `docs/build-spec.md` + `MILESTONES_ACHIEVED.md` + `WHAT_WE_BUILT.md`

**Hard rules — never violate:**
- Non-custodial at every layer. No Persat-controlled account holds funds. Vault PDA owns token account.
- Collateral: tBTC, zBTC ONLY (8 decimals). Exclude cbBTC, WBTC, SolvBTC by policy.
- Loan currency: USDC, USDT ONLY (6 decimals) treated as $1 MVP. No second oracle.
- Single BTC/USD Pyth pull oracle feed `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`, receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`. Staleness 60s, confidence 200bps. Fail-closed.
- Bridge auto-routing requires 3 signals: provider pause/status, observed success rate, on-Solana liquidity. Missing => manual, never guessed.
- Marketplace: structured terms ONLY. No free-text, no URLs, no social handles, no contact fields. `npm run frontend:marketplace-policy` must stay green.
- 8 programs, no CPI between them for MVP. Operator = gov signer 1 `99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD` signs `lock_vault`, `begin_funding`, `mark_active`, `close_deal`, `release_collateral`, `seize_collateral`, `mark_liquidated`, `record_origination_fee`. Vaults MUST be initialized with this as both authorities.
- Fees: 2% both paths, 5% cap, governance-adjustable.
- Backend never holds private keys or funds. Deal links + sessions stored as hashes only.
- No contradicting code: if `backend/src/database.ts` uses `pg`, then migrations must be PG (`gen_random_uuid()`), not MySQL. If frontend uses `MINTS.tBTC`, backend must accept same mint. Single source of truth: `contracts/config/devnet.json` + `frontend/src/lib/protocol/config.ts` + `ops/handoff/devnet-deployed.json` must match.

## WHAT "REAL ARCHITECTURE TESTNET" MEANS

- Programs deployed to devnet via `ops/handoff/deploy-devnet.yml` (requires founder secrets). All PDAs initialized.
- Frontend talks to real devnet RPC, real program IDs, real stand-in mints (`79AL...`, `DqQ1...`, `FsSP...`, `8zdn...`). Mainnet later is ONLY mint address swap + operator key + RPC.
- Full lifecycle works: propose_deal (Public/Private) -> confirm_deal (terms hash) -> initializeVault -> depositCollateral -> lockVault (operator) -> beginFunding -> activateLoan (lender) -> markActive (operator) -> makePayment/repayInFull -> closeDeal + releaseCollateral. Plus flagDefault, evaluate_position, seize, markLiquidated.
- Faucet works with 24h cooldown, idempotent, rate-limited.
- Oracle + bridge health live, cached, fail-closed, never crash UI.
- Backend: rate-limited, helmet, CORS strict, health checks DB+RPC+oracle+bridges, graceful shutdown, connection pooling (max 20), retry with backoff.
- Frontend: ErrorBoundary, loading skeletons, retry, pagination (cap 100 listings), polling with hidden-tab backoff, no blocking renders, transaction queue, ATA creation idempotent.

## SYSTEM THINKING FOR SCALE (NO CRASH UNDER PUMP)

**Frontend:**
- Every fetch wrapped in `fetchWithRetry` with AbortController 8s timeout, exponential backoff 300ms*2.5^n, 429 handling with Retry-After.
- Cache: oracle 5s, bridge 30s, marketplace 15s, user balances 10s. Use `localStorage` fallback but cap at 200 items, try/catch JSON parse.
- Use `useCallback` + `useMemo` for heavy computes, `React.memo` for cards, virtualize if >50 listings.
- Transaction sending: prep ATAs first, simulate, then send with `maxRetries 3`, confirm with `confirmed`, show explorer link. If wallet rejects, show friendly message, not crash.
- ErrorBoundary at layout + per-route. Loading.tsx with shimmer.
- No `window` access during SSR. All localStorage behind `typeof window !== 'undefined'`.
- Debounce inputs 300ms, validate with zod before sending.

**Backend:**
- Fastify: `@fastify/helmet`, `@fastify/cors` strict origins, `@fastify/rate-limit` global 100 req/min, `@fastify/sensible`.
- PG Pool: min 2 max 20, idle 30s, connection timeout 10s, `pool.on('error')` log not crash.
- Every route: zod validation, idempotency check (existing pending proposal, existing active deal link), 409 on duplicate, 429 on cooldown, 503 on DB down with friendly message.
- Bridge health: in-memory cache 30s + inFlight dedup to avoid thundering herd under pump.
- Oracle: cache 5s + inFlight dedup, fail-closed on stale/wide confidence.
- Health endpoint: checks DB `SELECT 1`, oracle fetch, bridge fetch, returns ok even if deps degraded (but reports).
- Graceful shutdown on SIGINT/SIGTERM: close Fastify + pool.
- Faucet: DB table `faucet_claims` with index, 24h cooldown, returns 429 with remaining hours.

**Contracts:**
- Already audited logic: checked arithmetic in `persat-core`, authority binding, terms hash binding, state machine. Don't change program IDs or seeds. Ensure frontend PDA derivations match `#[account(seeds = [...])]` exactly.

## TASKS TO FINISH (IN ORDER)

1. **Backend wiring:**
   - `src/config.ts` single source, no defaults for secrets.
   - `src/database.ts` pool with error handler, `requireDatabase()` with liveness `SELECT 1`.
   - `src/middleware/auth.ts` Bearer token hash verification against `wallet_sessions`.
   - `src/services/oracle.ts` Hermes fetch, cache 5s, staleness 60s, confidence 200bps.
   - `src/services/bridge.ts` 3-signal health, cache 30s, fail-closed.
   - `src/routes/bridge.ts`, `oracle.ts`, `faucet.ts`, `marketplace.ts`, `dealLinks.ts` all with zod, idempotency, rate-limit, auth where needed.
   - `src/server.ts` helmet, cors, rate-limit, health with deps, 404 + error handler, graceful shutdown.
   - Add `faucet_claims` table creation in faucet route (light migration).
   - Ensure `marketplace_proposals` has no free-text column — verify via `verify-marketplace-no-free-text.mjs`.

2. **Frontend wiring:**
   - `src/lib/api.ts` backend client with retry, timeout, request-id, auth token storage `persat_auth_token_v1`.
   - `src/lib/protocol/oracle.ts` `useBtcPrice` hook, 15s poll, fail-closed flag.
   - `src/lib/protocol/bridge.ts` `useBridgeHealth` hook, 30s poll, bestBridge auto.
   - `src/components/ErrorBoundary.tsx` and wrap in `layout.tsx`.
   - `src/components/bridge/BridgeDepositPanel.tsx` real health UI, auto vs manual, oracle status.
   - `src/lib/marketplace/marketplaceStore.ts` backend first, localStorage fallback, cap 100, merge logic, poll 30s with hidden-tab check.
   - `src/lib/protocol/userBalance.ts` already real RPC balances, add retry and cache.
   - `src/app/deal/[id]/page.tsx` add oracle + bridge hooks, fail-closed banners, retry, loading skeletons.
   - `src/app/faucet/page.tsx` use backend faucet cooldown API + bundle dispense, show remaining hours on 429.
   - `src/app/marketplace/page.tsx` use new store with loading, error, pagination, ErrorBoundary.
   - Add `src/app/loading.tsx` shimmer already exists — ensure used.

3. **Ops & Config:**
   - Ensure `frontend/src/lib/protocol/config.ts` MINTS match `contracts/config/devnet.json` and `ops/handoff/devnet-deployed.json`.
   - `contracts/Anchor.toml` cluster = Devnet, wallet = `target/deploy/asset_whitelist-keypair.json` for CI.
   - `ops/handoff/deploy-devnet.yml` must be copy-paste ready to `.github/workflows/deploy-devnet.yml`. It needs secrets: `PERSAT_RPC_URL`, `PERSAT_DEPLOYER_KEYPAIR` (funded >=25 SOL), `PERSAT_GOVERNANCE_SIGNER_1_KEYPAIR`, 8 program keys.
   - Add `.env.example` entries for all required envs, no real values.

4. **Verification:**
   - `npm --prefix backend run typecheck` green.
   - `npm --prefix frontend run build` green.
   - `npm run verify` (frontend lint + marketplace policy + backend typecheck + tests) green.
   - `cargo test --workspace` in contracts green (if Rust available, else CI).
   - Manual: create deal without counterparty -> appears in marketplace, propose, accept -> new private deal, fund -> vault, etc.

## WHAT FOUNDER MUST DO (YOUR INPUT NEEDED)

**One-time, ~5 minutes, blocking testnet:**
1. Generate keypairs locally: `solana-keygen new --no-outfile` for deployer + gov signer 1, and `anchor keys list` or `solana-keygen new` for each of 8 programs. Use `ops/handoff/generate-keypairs.html` if offline.
2. Fund deployer with >=25 SOL via `https://faucet.solana.com` (devnet).
3. In GitHub repo Settings -> Secrets and variables -> Actions, add:
   - `PERSAT_RPC_URL` = your Helius/QuickNode devnet RPC (or leave empty for public, but rate-limited)
   - `PERSAT_DEPLOYER_KEYPAIR` = JSON array of deployer secret key (64 numbers)
   - `PERSAT_GOVERNANCE_SIGNER_1_KEYPAIR` = JSON array
   - `PERSAT_PROGRAM_KEY_GOVERNANCE`, `PRICE_ORACLE`, `ASSET_WHITELIST`, `DEAL_REGISTRY`, `ESCROW_VAULT`, `LOAN_LIFECYCLE`, `LIQUIDATION_ENGINE`, `FEE_TREASURY` = each program keypair JSON array
4. Copy `ops/handoff/deploy-devnet.yml` to `.github/workflows/deploy-devnet.yml` via GitHub web UI (Add file -> Create new file, paste, commit). This grants workflow permission.
5. Run workflow: Actions -> "Deploy programs to Devnet" -> Run workflow. Wait ~10 min. Download artifact `devnet-deployed.json` and commit to `ops/handoff/` if you want frontend MINTS auto-updated (already placeholder matches).
6. Set backend envs: `PERSAT_DATABASE_URL` (Neon/Supabase PG), `SOLANA_RPC_URL` (same Helius), `NEXT_PUBLIC_BACKEND_URL` = your deployed backend URL, `NEXT_PUBLIC_SOLANA_RPC_URL` same RPC. No secrets in repo.
7. Deploy backend to Fly/Railway/Render with `npm --prefix backend run start`, frontend to Vercel with `npm --prefix frontend run build`.

**After that, no input needed — testnet is real architecture. Mainnet later = only change `MINTS` to mainnet canonical tBTC/zBTC/USDC/USDT + operator to dedicated keeper + RPC to mainnet.**

## DELIVERABLE

- Clean, no-contradiction codebase, all verification green.
- Testnet URL where users can complete full loan loop, marketplace, faucet, bridge health, oracle, all fail-closed, no crash under 100 concurrent users.
- This doc + updated `MILESTONES_ACHIEVED.md` + `WHAT_WE_BUILT.md`.

---

Copy above into agent. Then tell agent: "Start with backend/server.ts and frontend/lib/api.ts, then bridge + oracle wiring, then marketplace store, then faucet, then verify build."
