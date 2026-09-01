# A1 / A2 — Live cycle runbook (devnet)

**Goal:** Produce explorer-backed evidence files:

- `security-audits/pass-3/cycles/cycle-01-happy.md` (A1)
- `security-audits/pass-3/cycles/cycle-02-default.md` (A2)

**Constraint:** This Arena sandbox cannot hold keypairs or reliably reach devnet RPC for signing.  
**You** run transactions in the browser (Phantom on Devnet). **Agent/docs** only record public sigs.

No private keys in chat, git, or screenshots of seed phrases.

---

## Prerequisites (once)

| Item | Detail |
| --- | --- |
| Cluster | Solana **Devnet** in Phantom |
| dApp | Arena Frontend preview **or** `dapp.persat.finance` after merge |
| Bundle | `persat-devnet-keypairs-KEEP-SECRET.json` (local only) for faucet + keeper operator |
| Wallets | Borrower wallet A, lender wallet B (two Phantom accounts or two devices) |
| Operator | Gov signer 1 / operator `99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD` via bundle on `/keeper` |
| Mints | Stand-in tBTC / USDC from `/faucet` (see `ops/handoff/devnet-deployed.json`) |

### Fund wallets

1. Open `/faucet` as borrower → load bundle (if you are deployer) **or** use Auto-Faucet / claim path available in UI.
2. Dispense **SOL + tBTC + USDC** to borrower.
3. Switch to lender → dispense **SOL + USDC**.
4. Confirm balances on home dashboard.

Suggested happy-path terms (adjust if BTC price moves):

| Field | Value |
| --- | --- |
| Role | Borrower proposes |
| Principal | `100` USDC |
| Collateral | `0.01` tBTC (ensure LTV ≤ 50% at live Pyth price) |
| Rate | `800` bps (8%) |
| Duration | `3` months (faster than 12 for demo) |
| Visibility | **Send to Handle / Wallet Only** (private) |
| Counterparty | Lender pubkey (base58) |

---

## A1 — Happy path click list

Record **each** Phantom success signature immediately (copy from Phantom or explorer link in UI).

| # | Actor | Where | Action | Instruction (on-chain) |
| --- | --- | --- | --- | --- |
| 1 | Borrower | `/deal/new` | Propose private deal → confirm in wallet | `propose_deal` |
| 2 | — | Share modal / URL | Copy `/deal/<id>` link | — |
| 3 | Lender | `/deal/<id>` | Confirm deal (terms hash) | `confirm_deal` |
| 4 | Borrower | `/deal/<id>` | Initialize vault (if prompted) | `initialize_vault` |
| 5 | Borrower | `/deal/<id>` | Deposit collateral | `deposit_collateral` |
| 6 | Operator | `/keeper` | Load deal id → **Lock vault** | `lock_vault` |
| 7 | Operator | `/keeper` | **Begin funding** | `begin_funding` |
| 8 | Lender | `/deal/<id>` or fund route | **Activate loan** (send USDC) | `activate_loan` |
| 9 | Operator | `/keeper` | **Mark active** | `mark_active` |
| 10 | Borrower | `/deal/<id>/repay` | **Pay in full** (or pay remaining schedule) | `repay_in_full` / `make_payment` |
| 11 | Operator | `/keeper` or manage | **Release collateral** | `release_collateral` |
| 12 | Operator | `/keeper` or manage | **Close deal (Completed)** | `close_deal` |

### Verify on-chain

For each sig: open  
`https://explorer.solana.com/tx/<SIGNATURE>?cluster=devnet`  
Confirm **Success**.

Final states (via `/deal/<id>/manage` reload or explorer accounts):

- Deal: `completed` / closed completed  
- Loan: completed / repaid  
- Vault: released / closed, collateral returned to borrower  

### Write evidence

1. Copy `security-audits/pass-3/cycles/cycle-01-happy.md`
2. Fill every signature row (replace `PENDING`)
3. Set **Status: PASS** and ISO date
4. Optional: paste into chat; agent will not invent sigs

Or emit from JSON:

```bash
node frontend/scripts/record-cycle.mjs \
  --template happy \
  --out security-audits/pass-3/cycles/cycle-01-happy.md \
  --json path/to/cycle-01-sigs.json
```

---

## A2 — Default / liquidation click list

Start a **new** deal (do not reuse A1 deal id). Prefer short duration and terms you can default quickly.

| # | Actor | Where | Action | Instruction |
| --- | --- | --- | --- | --- |
| 1–9 | Same as A1 through **Mark active** | | | through `mark_active` |
| 10 | Anyone | `/deal/<id>/manage` or keeper | After grace / overdue: **Flag default** | `flag_default` |
| 11 | Operator | manage / keeper | **Partial seize ~50%** (if UI offers) | `seize_collateral` |
| 12 | Operator | manage / keeper | **Mark liquidated (partial)** optional | `mark_liquidated(false)` |
| 13 | Operator | manage / keeper | **Full seize** remaining **or** full path | `seize_collateral` |
| 14 | Operator | manage / keeper | **Mark liquidated (full)** | `mark_liquidated(true)` |
| 15 | Operator | manage / keeper | **Close deal (FullyLiquidated)** | `close_deal` |

**Note:** Prefer Pyth `PriceUpdateV2` evaluate path when available. Direct seize without price update is a **devnet fallback** — say so in the evidence notes (see `/known-limitations`).

### Verify

- Loan: `defaulted` → `partially_liquidated` and/or `fully_liquidated`  
- Vault collateral reduced / zero  
- Deal terminal: `fully_liquidated` (or documented partial outcome)  
- Reload `/manage` and `/repay` — state persists (reload-safe)

### Write evidence

Fill `security-audits/pass-3/cycles/cycle-02-default.md` the same way.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Wrong network | Phantom → Devnet |
| Insufficient funds | `/faucet` + bundle |
| LTV too high | Lower principal or raise collateral |
| Operator txs fail | Bundle loaded on `/keeper`; vault inited with operator as loan + liq authority |
| Confirm fails terms hash | Same terms both sides; no stale client |
| RPC 429 | Wait; founder should set dedicated RPC (A4) |
| Blank preview | Frontend port 3000, hard refresh |

---

## Done criteria

| File | Status field | All step sigs | Explorer links work |
| --- | --- | --- | --- |
| `cycle-01-happy.md` | `PASS` | Yes | Yes |
| `cycle-02-default.md` | `PASS` | Yes | Yes |

Then check A1/A2 boxes in `docs/MAINNET_CUTOVER_3_STEP.md`.
