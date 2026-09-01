# Persat Finance — Testnet completion → 3-step mainnet cutover

**Status:** living checklist (not a go-live claim)  
**Branch context:** `arena/01a04c34-persat-finance` and successors  
**Last honest assessment:** 2026-08-29  

This document turns the “how far are we?” answer into **owners, evidence paths, and exit criteria**.  
Nothing here marks mainnet ready. A row is **done** only when its **Evidence** column has a real artifact (tx sig, CI run, report file).

---

## North star

| Milestone | Meaning | Exit criterion |
| --- | --- | --- |
| **A — Honest public testnet** | Waitlist users can use stand-in tokens on Solana **devnet** without being misled | Definition of A below all green |
| **B — Audit-grade testnet** | Pass-3 pack complete; Pass-1/2 gaps closed enough for external scope | Pass-3 README has 10 cycles + liquidation sigs |
| **C — 3-step mainnet cutover** | Config/ops flip only — no protocol redesign | Cutover runbook executed; real funds only after Pass-4 |

**Today:** between **A (partial)** and **B (not started as evidence pack)**.  
**Not** at C. Calling C “three env changes” before A/B is false.

---

## The eventual 3 steps (only valid after B + Pass-4 gate)

When audits and production ops exist, mainnet cutover is intentionally small:

| Step | Action | Files / systems |
| --- | --- | --- |
| **1. Cluster + RPC** | `mainnet-beta` + paid RPC (Helius/QuickNode/Triton) | `NEXT_PUBLIC_SOLANA_RPC_URL`, `SOLANA_RPC_URL`, CSP `connect-src`, wallet network checks |
| **2. Addresses** | Deploy/init 8 programs on mainnet **or** freeze already-audited IDs; whitelist **canonical** tBTC, zBTC, USDC, USDT | `contracts/config/mainnet.json` (create), `frontend/src/lib/protocol/config.ts`, asset_whitelist init txs |
| **3. Ops keys + kill switches** | Dedicated keeper (fee-only), 2-of-3 gov, remove faucet from public dApp, enable real bridges or explicitly disable BTC lock UX | Secret manager, Netlify/API env, `/faucet` gated or removed, bridge feature flags |

Until B is done, treat the table above as **target shape**, not a checklist you can run Monday.

---

## Current scorecard (2026-08-29)

| Layer | State | Cutover-ready? |
| --- | --- | --- |
| 8 Anchor programs + LiteSVM (~107 tests) | Strong | Architecture yes |
| Devnet Day-0 deploy | Done — `ops/handoff/devnet-deployed.json` | Deploy path yes |
| Full UI lifecycle + explorer sig archive | Partial (Day 1/2 in progress) | **No** |
| Audit Pass 1 | ~ complete (SBF host-cov caveat; CPI welding → Pass 3) | **Almost** |
| Audit Pass 2 | Math fuzz 29×10k OK; PDA + state-transition fuzz **open** | **No** |
| Audit Pass 3 | Live integration evidence incomplete | **No** |
| Audit Pass 4 | Empty | **No** |
| Product UI (home, deals, propose, marketplace, faucet, keeper) | Usable on preview; polish ongoing | Shell yes |
| Backend API | Health + foundations; writes gated; keeper **stub** | **No** |
| Mints | Stand-in SPL (expected on devnet) | Testnet OK |
| Bridges Threshold/Zeus | Simulated / deferred keys | **No** for real BTC |
| Oracle Pyth | Feed id real; PriceUpdateV2 path incomplete on some liq paths | Partial |
| Keeper | FE demo auto-mode; BE tick logs only | **No** |
| Hosting | `persat.finance` waitlist; `dapp.persat.finance` shell; **`api.persat.finance` NXDOMAIN** | Incomplete |
| Root README | Still understates deploy status in places | Needs sync |

---

## Definition of A — Honest public testnet

All boxes must be checked with evidence before marketing “open testnet.”

### A1. Golden path (happy)

- [ ] Propose private deal on-chain (`deal_registry::propose_deal`)
- [ ] Counterparty confirm (`confirm_deal`, terms-hash binds)
- [ ] Vault init + deposit collateral + lock
- [ ] Begin funding → activate loan → mark active
- [ ] At least one repayment (partial or full)
- [ ] Close completed deal

**Evidence:** table of explorer URLs (`?cluster=devnet`) in `security-audits/pass-3/cycles/cycle-01-happy.md`  
**Owner:** protocol + product  
**Refs:** `ops/handoff/day-1-live-verification.md`, UI `/deal/new` → `/deal/[id]/*`

### A2. Default / liquidation path

- [ ] `flagDefault` after grace
- [ ] Partial seize
- [ ] Full liquidation + `mark_liquidated` + `closeDeal`
- [ ] Failure UX: friendly error, retry, faucet hint, no crash

**Evidence:** `security-audits/pass-3/cycles/cycle-02-default.md` + sigs  
**Owner:** protocol + keeper  
**Refs:** `frontend/scripts/day2-liquidation-sim.mjs`, `/keeper`, `/known-limitations`

### A3. Product truthfulness

- [ ] Bottom **Deals** → `/deals` (My Deals), not `/deal/new`
- [ ] My Deals shows **real** tracked/on-chain only (no demo cards)
- [ ] Propose shows marketplace vs private + live calculation above the fold on mobile
- [ ] Home: no fake Activity Stream; no endless loader; no hydration error overlay
- [ ] `/known-limitations` matches reality (stand-in mints, sim bridges, operator=gov1)

**Evidence:** screenshot pack or short Loom in `security-audits/pass-3/ui/`  
**Owner:** product (frontend)

### A4. Hosted surface

- [ ] `dapp.persat.finance` serves this frontend from **merged `main`** (or clearly labeled preview)
- [ ] Paid or dedicated **devnet RPC** in prod env (not only public 100/10s)
- [ ] `api.persat.finance` resolves + `/health` OK **or** dApp documented as wallet-RPC-only with backend optional
- [ ] Waitlist stays on `persat.finance` from `waitlist/` (do not point that site’s base at `frontend`)

**Evidence:** DNS + curl health + Netlify deploy log  
**Owner:** founder / ops  
**Refs:** `frontend/netlify.toml`, `waitlist/`, `.env.example`

### A5. Safety labeling

- [ ] Every public entry shows **Devnet / not real funds**
- [ ] Faucet copy: stand-in tokens only
- [ ] Bridge CTAs either hidden or “simulated — mainnet later”
- [ ] No claim of completed Pass-4 or mainnet readiness

**Evidence:** production screenshots  
**Owner:** product

---

## Definition of B — Audit-grade testnet

### B1. Pass-2 gaps

- [ ] PDA-derivation fuzz family (≥10k iters) + report
- [ ] Deal-state-transition fuzz family + report

**Evidence:** `security-audits/pass-2/README.md` updated; CI green  
**Owner:** protocol  
**Refs:** `docs/testing-strategy.md`, `contracts/crates/persat-core/tests/fuzz.rs`

### B2. Pass-3 live pack

- [ ] **10** scripted lifecycle cycles with tx signatures + cluster
- [ ] Liquidation suite recorded (not checkbox-only)
- [ ] Cross-program CPI welding notes (loan → vault lock, etc.)
- [ ] Known limitations frozen for external readers

**Evidence:** `security-audits/pass-3/` filled; scripts under `frontend/scripts/day3-lifecycle-cycles.mjs` produce real sigs  
**Owner:** protocol + security  
**Refs:** `security-audits/pass-3/README.md`

### B3. Production-shaped keeper (still devnet)

- [ ] Dedicated keeper keypair ≠ long-term “gov signer 1 is operator forever”
- [ ] Backend or separate worker **signs** keep/liq txs (not stub log-only)
- [ ] Always prefer Pyth PriceUpdateV2 path; direct-seize only as documented emergency
- [ ] Monitoring: tick success/fail metrics + alert hook (even webhook)

**Evidence:** keeper runbook + sample logs + 3 autonomous closes  
**Owner:** backend + ops  
**Refs:** `backend/src/`, `/keeper`, `GO_LIVE_AND_SCALE.md`

### B4. Backend persistence (if deal-links / marketplace index are in scope)

- [ ] Postgres (or chosen store) migrated
- [ ] Wallet signature challenge auth on write routes
- [ ] No free-text marketplace columns (policy script still green)
- [ ] Deal-link tokens stored hashed only

**Evidence:** `backend` deploy + migration applied + route tests  
**Owner:** backend  
**Refs:** `backend/migrations/`, `docs/BACKEND_HYBRID.md`

### B5. Load / incident (pre-public promo)

- [ ] ~100 concurrent smoke (RPC + API)
- [ ] Rate limit / pagination caps verified
- [ ] Rollback: previous Netlify deploy + program upgrade authority procedure written
- [ ] Incident contacts + pause procedure (1-of-3 emergency)

**Evidence:** `docs/incident-response.md` (create) + load notes in pass-3  
**Owner:** ops  
**Refs:** `GO_LIVE_AND_SCALE.md`

---

## Definition of C — Before running the 3 steps

### C1. Audit Pass 4

- [ ] Adversarial / external review scoped and **report filed** under `security-audits/pass-4/`
- [ ] All critical/high findings fixed or explicitly accepted with founder sign-off

### C2. Mainnet config pack (prepared, not necessarily live)

- [ ] `contracts/config/mainnet.json` with real program IDs (post-deploy) or deploy script ready
- [ ] Canonical mint addresses confirmed (tBTC / zBTC / USDC / USDT)
- [ ] Governance pubkeys (3) published; signers 2–3 offline procedure tested on devnet first
- [ ] Upgrade authority policy: multisig or renounce plan documented

### C3. Bridges (pick one policy)

**Policy P1 — Real BTC collateral at launch**

- [ ] Threshold + Zeus SDK/credentials, health checks, fail-closed
- [ ] Manual fallback path tested

**Policy P2 — Stables-first / BTC bridge later (recommended if keys deferred)**

- [ ] Product copy: collateral = wrapped BTC **already on Solana**; no embedded lock/mint claim
- [ ] Bridge widgets removed or “coming”
- [ ] `/known-limitations` states P2 until P1 ships

**Current founder direction (session):** skip ZEUS/THRESHOLD API keys for now → default **P2** unless reversed.

### C4. Kill testnet-only surfaces

- [ ] Public `/faucet` disabled or auth-gated to internal
- [ ] Stand-in mint code paths compile-out or unreachable on mainnet cluster flag
- [ ] Operator=gov1 path removed
- [ ] CSP + wallet errors say Mainnet, not Devnet

---

## Workstreams — priority order (shortest path A → B → C)

```text
1. Golden lifecycle sigs (A1)     ─┐
2. Default/liq sigs (A2)         ─┼─► A exit
3. Product truth + host (A3–A5)  ─┘
4. Pass-2 fuzz gaps (B1)
5. 10-cycle Pass-3 pack (B2)
6. Keeper + API shape (B3–B4)
7. Load + incident (B5)          ─► B exit
8. Pass-4 + mainnet pack (C*)    ─► run 3-step cutover
```

Do **not** start mainnet program deploy until **B exit** and founder auth.

---

## Owner matrix

| Area | Primary owner | Backup |
| --- | --- | --- |
| On-chain programs / CPI / fuzz | Protocol contributor | Security |
| Live cycle evidence / explorer archive | Protocol + Product | Security |
| dApp UX / My Deals / propose | Frontend | — |
| Keeper worker / API / DB | Backend | Ops |
| DNS, Netlify, secrets, RPC keys | Founder / Ops | — |
| Audit folders pass-1…4 | Security | Protocol |
| Waitlist `persat.finance` | Founder (stay on `waitlist/`) | — |

---

## Evidence locations (do not invent paths later)

| Artifact | Path |
| --- | --- |
| Devnet program IDs / mints | `ops/handoff/devnet-deployed.json` |
| Devnet cluster config | `contracts/config/devnet.json` |
| FE protocol constants | `frontend/src/lib/protocol/config.ts` |
| Day-0 handoff | `ops/handoff/README.md` |
| Day-1 live notes | `ops/handoff/day-1-live-verification.md` |
| Day-2 liq script | `frontend/scripts/day2-liquidation-sim.mjs` |
| Day-3 cycles script | `frontend/scripts/day3-lifecycle-cycles.mjs` |
| Pass folders | `security-audits/pass-{1,2,3,4}/` |
| Known limitations UX | `frontend/src/app/known-limitations/page.tsx` |
| Go-live secrets table | `GO_LIVE_AND_SCALE.md` |
| This checklist | `docs/MAINNET_CUTOVER_3_STEP.md` |

When a cycle completes, **append** sigs under `security-audits/pass-3/cycles/` — do not only update chat history.

---

## Explicit non-goals (until checked above)

- Mainnet deploy “to get real users faster”
- Representing Arena preview as production mainnet
- Pointing waitlist Netlify base at `frontend/`
- Committing keypairs, seed phrases, or RPC admin tokens
- Custody of user funds by any Persat process
- Marketplace free-text / contact fields
- Claiming bridges live while keys are deferred

---

## Session log (product track on this Arena branch)

Completed toward **A3** (not full A):

- [x] Bottom nav Deals → `/deals`
- [x] Header My Deals + New Deal
- [x] Propose: publish toggle + live calculation reachable on mobile
- [x] Home hydration mismatch fixed (dashboard first paint; guide overlay)
- [x] Removed centered “persat” loading flash; layout-mimic `loading.tsx`
- [x] Onboarding hang gate removed (no `ready=false` forever)

**A1 / A2 / A4 / B scaffolding (2026-08-29):**

- [x] `ops/handoff/A1-A2-live-cycle-runbook.md` — browser click-list for happy + default paths
- [x] `security-audits/pass-3/cycles/cycle-01-happy.md` — evidence template (`PENDING_LIVE_SIGS`)
- [x] `security-audits/pass-3/cycles/cycle-02-default.md` — evidence template (`PENDING_LIVE_SIGS`)
- [x] `frontend/scripts/record-cycle.mjs` — JSON → markdown emitter for real sigs
- [x] `docs/HOSTING_A4.md` — Mode W (wallet-RPC-only) default + founder DNS/merge checklist
- [x] `security-audits/pass-2/GAPS_B1_PLAN.md` — PDA + state-transition fuzz plan
- [x] `security-audits/pass-3/B2_TEN_CYCLES.md` — 10-cycle map (1–2 = A; 3–10 = B2)
- [x] Backend keeper: stub vs live-ready modes (`KEEPER_ENABLED` / `KEEPER_KEYPAIR_PATH`)

Still open for **A** (needs live browser + founder):

- [ ] A1 — replace `PENDING` sigs in `cycle-01-happy.md` → Status `PASS`
- [ ] A2 — replace `PENDING` sigs in `cycle-02-default.md` → Status `PASS`
- [ ] A4 — founder fills evidence block in `docs/HOSTING_A4.md` (RPC + merge to `main`)
- [ ] A5 production labeling pass on live dApp
- [ ] Locked collateral sum from vaults (FE TODO in `userBalance.ts`)

---

## How to update this doc

1. Change a checkbox only when evidence exists.  
2. Bump **Last honest assessment** date.  
3. One line in **Session log** per merged PR that moves A/B/C.  
4. Never delete failed approaches — move to a short “Abandoned” note if needed.

---

## One-line status

**Devnet beta with real program IDs and a usable dApp shell — not a 3-step mainnet cutover. Finish A, then B, then C.**
