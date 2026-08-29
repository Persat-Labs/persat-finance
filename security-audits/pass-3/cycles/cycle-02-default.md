# Cycle 02 — Default / liquidation path

- **Status:** `PENDING_LIVE_SIGS` — structure ready; fill signatures from browser (see `ops/handoff/A1-A2-live-cycle-runbook.md`)
- **Date:** _ISO date when PASS_
- **Cluster:** `devnet`
- **Definition of done:** A2 in `docs/MAINNET_CUTOVER_3_STEP.md`
- **Deal id (base64url):** `PENDING`
- **Deal id (16 raw bytes hex):** `PENDING`

## Roles (public keys only)

| Role | Address |
| --- | --- |
| Borrower | `PENDING` |
| Lender | `PENDING` |
| Operator | `99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD` |
| flagDefault reporter | `PENDING` (may be anyone) |

## Terms

| Field | Value |
| --- | --- |
| Visibility | Private |
| Principal / collateral / rate / duration | _record live values_ |
| Loan mint | stand-in USDC `FsSPdkdWnb8R7oziaiYFvhMbhHT7Sd9Uq55t88B7Muqe` |
| Collateral mint | stand-in tBTC `79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg` |
| Liquidation path | partial then full **or** full-only (document which) |
| Oracle path | Pyth PriceUpdateV2 **or** direct-seize fallback (must note) |

## Steps — funding to active (same as happy through mark_active)

| # | Instruction | Actor | Signature | Explorer |
| --- | --- | --- | --- | --- |
| 1 | `propose_deal` | Borrower | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 2 | `confirm_deal` | Lender | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 3 | `initialize_vault` | Borrower | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 4 | `deposit_collateral` | Borrower | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 5 | `lock_vault` | Operator | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 6 | `begin_funding` | Operator | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 7 | `activate_loan` | Lender | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 8 | `mark_active` | Operator | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |

## Steps — default & liquidation

| # | Instruction | Actor | Signature | Explorer |
| --- | --- | --- | --- | --- |
| 9 | `flag_default` | Reporter | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 10 | `seize_collateral` (partial ~50%) | Operator | `PENDING` or `N/A` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 11 | `mark_liquidated(fully=false)` | Operator | `PENDING` or `N/A` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 12 | `seize_collateral` (remainder / 100%) | Operator | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 13 | `mark_liquidated(fully=true)` | Operator | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 14 | `close_deal` (FullyLiquidated) | Operator | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |

## Final on-chain state

| Account | Expected | Observed |
| --- | --- | --- |
| Deal | `fully_liquidated` (or documented outcome) | `PENDING` |
| Vault | collateral reduced/zero; closed | `PENDING` |
| Loan | `defaulted` → liquidated terminal | `PENDING` |

## Reload-safe check

| Check | Pass? |
| --- | --- |
| Refresh `/deal/<id>/manage` — state matches chain | `PENDING` |
| Refresh `/deal/<id>/repay` — no crash; correct status | `PENDING` |
| Failure UX shows friendly error (if any failed attempt) | `PENDING` |

## Result

- **Pass / fail:** `PENDING`
- **Notes:** Document whether evaluate used fresh Pyth `PriceUpdateV2` or devnet direct-seize fallback (`/known-limitations`).

## How to complete

1. Follow `ops/handoff/A1-A2-live-cycle-runbook.md` § A2  
2. Replace every `PENDING`  
3. Set Status to `PASS`  
4. Check A2 in `docs/MAINNET_CUTOVER_3_STEP.md`
