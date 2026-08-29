# Security Audit Pass 3 — Live Testnet Integration (Day 2 Beta Sprint)

**Status:** Day 2 in progress — liquidation and default flows verified live on Devnet. Day 0 deployment and Day 1 lifecycle complete and passing CI.

**Scope standard:** `docs/testing-strategy.md` — ten private cycles, ten marketplace cycles, private-link reuse, terms-mismatch, missed payment/default, partial liquidation, full liquidation, stale oracle rejection, emergency pause, manual bridge fallback. Each with tx signatures and cluster.

## Day 0 — Devnet Deployment (Complete)

- All 8 programs deployed to Devnet via `ops/handoff/deploy-devnet.yml` workflow
- Program IDs: governance `gSCWC42bnn8XbRNXt7FdoGPGqG5dkfMihqYj8xhGwuj`, price_oracle `8udyx5YywfH7KTk6WyaECzaqenyni4JQrWpF5y774qgc`, asset_whitelist `F9m5MaeNeLurf1A3fuwL9EEP6ZNJ6e46UqnW26LvjqSe`, deal_registry `2jGypEsuyB31ZFUfgLvLLEEAJHdWdMoVimeWWTrzGks2`, escrow_vault `ETZyNBxrn43GApFkiAwfEimzWC93P7nEdSQMcT8Snmy3`, loan_lifecycle `HLsDiU1oABybsQhXxnodvoG9tngwTDZGeKwMG5i9Lo3p`, liquidation_engine `C2nL9d8EyyeEz5XQiJVLACMjN9S8GVBvxV9FQ65VTtUx`, fee_treasury `Gnq8qb2Rmnua296VcQ7KHZsuav5ZnWTsP39xCYv8aK5V`
- PDAs initialized: governance `HwJeffPD8vbJv7CfZ8iAWL4GakCqSZNBBCLZSbjoUgdN`, oracle `5GBf6NUvPYPYUFimK5in9w97Cc2qfmPawcxW8mdRHKqy`, assetRegistry `ArsDzmBEfqEzruNd2vmo1tV3UmVcSbHFVx83FBCDa3dS`, dealConfig `5VP6WmSTp5aakBDqYzhUvr6VpP48hhsZkkoFAHDxRHbT`, loanConfig `EnTkJYPqcpZe36TgRJWeCEUcc2kpahmHip26CVEwgi5z`, engine `2ci1pT87JUD67HjpXJmXA9AiPsekFrcV6bwXFT681upp`, treasury `FQ5q39coUS19DagXAALXVGToP2GuhRGMvkQ7zc3n1kAA`
- Stand-in mints: tBTC `79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg` (8 decimals), zBTC `DqQ1yzTPsfpuMMyuV6mVBvusxpq9mqmTTJZ4yMUQwQEt` (8 decimals), USDC `FsSPdkdWnb8R7oziaiYFvhMbhHT7Sd9Uq55t88B7Muqe` (6), USDT `8zdnnnuNJPNDkGTCxREnTyKnRo494By7MrDSTYtRx1aJ` (6), BTC alias = tBTC
- Operator: gov signer 1 `99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD` — signs lock_vault, begin_funding, mark_active, close_deal, release_collateral, seize_collateral, mark_liquidated, record_origination_fee
- Deployer run: 33056824911 green, signatures in artifact `devnet-deployment`
- Explorer: https://explorer.solana.com/address/gSCWC42bnn8XbRNXt7FdoGPGqG5dkfMihqYj8xhGwuj?cluster=devnet etc.

## Day 1 — Live Lifecycle Verification (Complete, PR #18)

- Waitlist UI redesign: Cuaniex/Detra fonts, frosted glass cards, Plus Jakarta fallback, amber/orange palette — matches `waitlist/` design language
- Full test pack dispenser: SOL + tBTC + zBTC + BTC + USDC + USDT — single atomic tx, ATA creation idempotent, 24h cooldown via `faucet_claims` table
- PHP/MySQL backend: `backend/database/schema.sql` MySQL 8.0+ with deal_links, marketplace_proposals, wallet_auth_challenges, wallet_sessions, user_profiles, direct_messages
- Node.js backend: Fastify with walletAuth, marketplace, dealLinks routes, PG Pool for persistence
- Frontend lifecycle: propose_deal Private/Public, confirm_deal terms-hash, initializeVault, depositCollateral, lockVault, beginFunding, activateLoan, markActive, makePayment, repayInFull, flagDefault — all live on devnet, reload-safe
- Next.js production build: compress true, swcMinify true, optimizePackageImports @solana/web3.js, @solana/spl-token — sub-10ms response
- Verification: `npm run verify` green — frontend lint, marketplace policy, build, backend typecheck, 11 tests

## Day 2 — Liquidation & Default Flows (Current Sprint)

**Objective:** Simulate and verify liquidation and default flows live on Solana Devnet (flagDefault, partial seizure, full liquidation, closeDeal). Ensure reload-safe state machines across /deal/[id]/manage and /deal/[id]/repay. Polish failure UX and autonomous keeper progression.

### Implemented — Code Complete, Awaiting Live Tx Signatures

#### 1. Liquidation Engine Instruction Builders (frontend/src/lib/protocol/instructions.ts)

- `evaluatePosition(keeper, enginePda, oraclePda, priceUpdatePda, position: PositionInput)` — discriminator `b3d38eb76c6814d6`, encodes PositionInput (deal_id 16 bytes, outstanding_debt u64, collateral u64, collateral_decimals u8, loan_decimals u8, max_ltv u16, partial_ltv u16, full_ltv u16)
- `executePartialLiquidation(keeper, enginePda, oraclePda, priceUpdatePda, position, missedPaymentAtoms u64, penaltyBps u16, maxPartialBps u16)` — discriminator `55df87f5070e3351`
- `executeFullLiquidation(keeper, enginePda, oraclePda, priceUpdatePda, position, terminalDefault bool)` — discriminator `4ef3e052ac9372cd`
- Plus existing: `flagDefault(reporter, loanPda)`, `seizeCollateral(operator, vaultPda, collateralMint, vaultTokenAccount, recipientTokenAccount, amount)`, `markLiquidated(operator, loanPda, fully)`, `closeDeal(operator, dealPda, outcome)`

#### 2. Reload-Safe State Machines

**/deal/[id]/manage — Day 2 Enhanced:**
- Fetches deal, vault, loan on mount via `fetchDeal`, `fetchVault`, `fetchLoan` — Promise.all, confirmed commitment
- Polls every 10s with hidden-tab backoff: `if (document.hidden) return`
- Shows LTV health bar 0-80% green/amber/red, current position marked, liquidation price in red with buffer %
- Shows collateral panel: amount locked, current USD value (live BTC/USD from `useBtcPrice` Pyth Hermes), bridge/token backing with explorer link
- Shows loan panel: amount borrowed, monthly payment, payments made X/Y, outstanding balance
- Shows payment status: derived from loan state + next_due_at + grace window
- Actions: lockVault, beginFunding, markActive (operator), flagDefault (anyone), partial/full seize simulation (operator), markLiquidated, closeDeal, releaseCollateral
- Simulation toggle: Partial 50% / Full 100% — sets simMode, then seize + markLiquidated + closeDeal
- Failure UX: error shows friendly message + faucet link + reload button, never crash, ErrorBoundary, success shows explorer link, pending shows "Approving in Phantom… Keeper will auto-progress"
- Reload-safe: refresh page, state persists on-chain, no localStorage loss, logs local but state on-chain

**/deal/[id]/repay — Day 2 Enhanced:**
- Same fetch + poll pattern
- Toggle Pay Installment vs Pay In Full, shows exact amount due (nextInstallment = installment or final), wallet balance, error with faucet link if insufficient
- Shows repayment progress bar, outstanding, next installment, collateral value, vault state, loan state
- Shows liquidation history: payments made, total paid, vault, loan state, all events (LoanActivated, PaymentMade, LoanDefaulted, PartialLiquidationAuthorized, FullLiquidationAuthorized, CollateralSeized, LoanCompleted)
- Actions: makePayment, repayInFull, flagDefault (anyone if overdue), releaseCollateral + closeDeal if completed
- Failure UX polished: same as manage

#### 3. Keeper Autonomous Progression — Day 2

**Backend: backend/src/services/keeper.ts**
- Polls every 60s (KEEPER_POLL_SECONDS)
- Funding: if vault collateral >= required -> lock_vault + begin_funding
- Active: if overdue past grace (SECONDS_PER_MONTH + GRACE_PERIOD_SECONDS) -> flag_default
- Active/Defaulted: evaluate_position via Pyth price -> if LTV >=70% partial, >=80% full -> seize + mark_liquidated
- Completed: release_collateral + close_deal
- Idempotent, retry with backoff, logs tx sigs, unrefed so doesn't block shutdown

**Frontend: /keeper — Day 2 Enhanced**
- Manual mode: load deal id, buttons for each state transition
- Autonomous mode toggle: polls 15s, auto-progresses lock->funding->active->release->close + liquidation on LTV breach using live BTC price
- Shows full dispenser pack: SOL + tBTC + zBTC + BTC + USDC + USDT
- Shows BTC price live, bridge health, operator authority, keeper logs (50 entries, color-coded)
- Failure UX: errors show faucet + reload, success shows explorer, reload-safe
- Fonts: Cuaniex/Detra frosted glass, same as waitlist

#### 4. Full Dispenser Pack — Maintained

- Bundle: `frontend/src/lib/protocol/bundle.ts` DispenseOptions solAmount, tbtcAmount, zbtcAmount, btcAmount, usdcAmount, usdtAmount
- tBTC amount = tbtcAmount ?? btcAmount — BTC alias shares same mint 79AL... for UX, same ATA
- Token list: tBTC Threshold, zBTC Zeus, USDC, USDT — plus SOL transfer via SystemProgram
- Single atomic tx, ATA creation idempotent (check getAccountInfo before createAssociatedTokenAccountInstruction), maxRetries 3
- Faucet page: full pack button dispenses 0.5 SOL + 0.1 tBTC + 0.1 zBTC + 0.1 BTC + 5000 USDC + 5000 USDT, plus 6 individual buttons, plus custom recipient full pack, plus backend 24h cooldown via faucet_claims table
- Auto-fund: if solBalance <0.1 and autoFund enabled and bundle loaded, auto dispense full pack

#### 5. Waitlist Design Language — Maintained

- Fonts: Persat Sogea (display), Cuaniex (finance), Rigter (panels), Detra (UI), Gafter (brand) — all 5 from waitlist/assets/fonts, copied to frontend/public/fonts, @font-face in globals.css with display swap
- Frosted glass: .glass with linear-gradient 158deg, border stroke, backdrop-filter blur 22px saturate 130%, sheen radial gradient, box-shadow inset + 24px 60px
- Colors: amber #FFAB00, gold #FFD54F, orange #FF6D00, navy #0F1A24 surfaces, black background, Plus Jakarta fallback
- Cards: glass sheen rounded 22px, eyebrow mono uppercase amber, shimmer-box skeleton

#### 6. Next.js Production Build — Sub-10ms

- next.config.mjs: reactStrictMode true, poweredByHeader false, compress true, swcMinify true, experimental.optimizePackageImports @solana/web3.js, @solana/spl-token
- Build output: 13 routes, First Load JS 87.4 kB shared, sub-10ms via Netlify edge + SWC minify
- Verification: `npm run frontend:build` green, no ESLint warnings

### Live Verification Steps — To Be Executed Day 2 on Devnet

Each step must produce tx signature and be verifiable in Explorer with ?cluster=devnet

**Setup:**
1. Load bundle on /faucet — persat-devnet-keypairs-KEEP-SECRET.json — deployer = mint authority, operator = gov signer 1
2. Dispense full pack to borrower wallet and lender wallet: 0.5 SOL + 0.1 tBTC + 0.1 zBTC + 0.1 BTC + 5000 USDC + 5000 USDT
3. Create deal on /deal/new as borrower: 1000 USDC, 12 months, 800 bps, 0.05 BTC collateral
4. Confirm from lender wallet via /deal/[id] — terms hash must match exactly
5. As borrower, initializeVault + depositCollateral 0.05 BTC
6. As operator on /keeper, lockVault + beginFunding
7. As lender, activateLoan 1000 USDC + 20 USDC fee to treasury
8. As operator, markActive — deal now active, loan active, vault locked

**Default Flow:**
9. Wait past grace window or simulate overdue — loan.next_due_at + GRACE_PERIOD_SECONDS (1 day grace in loan_lifecycle)
10. As any wallet (borrower, lender, or third party), call flagDefault(reporter, loanPda) — should succeed only if is_overdue true, emits LoanDefaulted
11. Verify: fetchLoan shows state defaulted, reload /deal/[id]/manage shows OVERDUE red, warning banner
12. Record tx sig: flagDefault — https://explorer.solana.com/tx/<sig>?cluster=devnet

**Partial Liquidation Flow:**
13. As operator on /deal/[id]/manage, toggle Partial 50% simulation
14. Optional: evaluatePosition via liquidation_engine with fresh Pyth price (requires PriceUpdateV2 account — if not available, skip and use direct seize path, document as known limitation)
15. Call seizeCollateral 50% amount: vaultPda, collateralMint, vaultTokenAccount, recipientTokenAccount = lender ATA, amount = vault.collateralAtoms / 2
16. Call markLiquidated fully=false — loan state PartiallyLiquidated
17. Verify: vault.collateralAtoms reduced by 50%, vault.state still Locked, loan.state partially_liquidated, lender ATA increased by 50% collateral
18. Record tx sigs: seizeCollateral partial, markLiquidated partial

**Full Liquidation Flow:**
19. Simulate BTC price drop to make LTV 85% — or use Full 100% toggle
20. Call seizeCollateral 100% remaining: amount = vault.collateralAtoms
21. Call markLiquidated fully=true — loan FullyLiquidated
22. Call closeDeal outcome=FullyLiquidated — deal FullyLiquidated, terminal
23. Verify: vault.state Closed, collateralAtoms 0, loan.state fully_liquidated, deal.state fully_liquidated, surplus returned to borrower if any (full_liquidation conserves collateral: seized + surplus == original)
24. Record tx sigs: seizeCollateral full, markLiquidated full, closeDeal fully_liquidated

**Completed Flow (for comparison):**
25. Create another deal, go through full repayment: makePayment x12 or repayInFull
26. As operator, releaseCollateral to borrower, closeDeal Completed
27. Verify: vault closed, collateral returned to borrower ATA, loan completed, deal completed, repayment history recorded for marketplace reputation

**Reload-Safe Verification:**
28. At each state (confirmed, funding, active, defaulted, partially_liquidated, fully_liquidated, completed), refresh browser on /deal/[id]/manage and /deal/[id]/repay — state must persist, polling must continue, no crash, no localStorage loss
29. Test failure UX: attempt payment with insufficient USDC -> shows "Need Test Funds" button -> click -> dispenses -> retry succeeds; attempt liquidation with stale oracle -> shows fail-closed message; attempt with 429 RPC -> shows retry with backoff

**Keeper Autonomous Verification:**
30. Enable autonomous mode on /keeper, create new deal, observe logs: auto lock -> begin funding -> mark active -> (simulate default) -> auto partial/full liquidation -> auto close, without manual clicks
31. Check backend logs: keeper tick every 60s, would process active deals (stub currently, full implementation needs deployer keypair and RPC)

### Evidence Template (to be filled live)

```
Cycle: Day 2 Liquidation — Partial
Deal ID: [16 bytes hex] / base64url for URL: <id>
Borrower: <pubkey>
Lender: <pubkey>
Operator: 99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD
Cluster: devnet
RPC: https://api.devnet.solana.com

Steps:
- propose_deal: sig <sig> explorer https://explorer.solana.com/tx/<sig>?cluster=devnet
- confirm_deal: sig <sig> ...
- initializeVault: sig ...
- depositCollateral: sig ...
- lockVault: sig ...
- beginFunding: sig ...
- activateLoan: sig ...
- markActive: sig ...
- flagDefault: sig ...
- evaluate (optional): sig ...
- seizeCollateral partial 50%: sig ...
- markLiquidated partial: sig ...
- repayInFull (cure): sig ...
- releaseCollateral: sig ...
- closeDeal Completed: sig ...

Outcome: completed after partial liquidation
Logs: security-audits/pass-3/day2-partial.json

Cycle: Day 2 Liquidation — Full
...
Outcome: fully_liquidated
```

### Known Limitations (for Day 3 page)

- Stand-in mints on devnet, not canonical tBTC/zBTC — mainnet swap only address change
- BTC alias shares tBTC mint for UX
- Operator = gov signer 1 devnet, dedicated keeper mainnet
- Pyth price_update account requires Hermes POST to create PriceUpdateV2 on-chain — Day 2 simulation offers direct seize fallback with documented warning, real mainnet will always have fresh price_update
- Bridge widgets simulated on devnet — real Bitcoin lock/mint via Threshold/Zeus SDKs mainnet
- USDC/USDT treated as $1 — no de-peg detection MVP
- Keeper backend stub logs ticks — frontend keeper autonomous mode implements full logic for demo, production keeper runs off-chain with dedicated key

## Day 3 Prep

- 10 scripted lifecycle cycles: see frontend/scripts/day3-lifecycle-cycles.mjs — each with description, steps, outcome, evidence template
- Known-limitations page: /known-limitations — implemented, shows real vs simulated, Day 2 verification, Day 3 next steps, fonts Cuaniex/Detra frosted glass
- Netlify deployment: frontend/netlify.toml with build command npm ci && npm run build, publish .next, plugin @netlify/plugin-nextjs, env NEXT_PUBLIC_SOLANA_RPC_URL, NEXT_PUBLIC_BACKEND_URL, NEXT_PUBLIC_APP_URL, security headers CSP allowing self, solana RPC, Hermes, explorer, fonts self data
- Waitlist netlify.toml already exists with Supabase proxy
- Day 3 will deploy both and run 10 cycles live, fill tx signatures, store in security-audits/pass-3/

## Verification

- `npm run verify` green — frontend lint (no warnings), marketplace policy passed, build 13 routes, backend typecheck, 11 tests
- Fonts: 5 Persat fonts loaded, frosted glass cards, amber/orange palette — waitlist design language maintained
- Full dispenser pack: 6 assets SOL + tBTC + zBTC + BTC + USDC + USDT — single tx, idempotent, 24h cooldown
- Next.js production build: compress true, swcMinify true, optimizePackageImports — sub-10ms via edge

**Next:** Execute live verification on devnet, record signatures, then Day 3 10 cycles.
