# Cycle 01 — Happy path (private direct deal)

- **Status:** `PENDING_LIVE_SIGS` — structure ready; fill signatures from browser (see `ops/handoff/A1-A2-live-cycle-runbook.md`)
- **Date:** _ISO date when PASS_
- **Cluster:** `devnet`
- **Definition of done:** A1 in `docs/MAINNET_CUTOVER_3_STEP.md`
- **Deal id (base64url):** `PENDING`
- **Deal id (16 raw bytes hex):** `PENDING`

## Roles (public keys only)

| Role | Address |
| --- | --- |
| Borrower | `PENDING` |
| Lender | `PENDING` |
| Operator | `99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD` |

## Terms

| Field | Value |
| --- | --- |
| Visibility | Private |
| Creator side | Borrower |
| Principal | _e.g. 100 USDC_ |
| Loan mint | `FsSPdkdWnb8R7oziaiYFvhMbhHT7Sd9Uq55t88B7Muqe` (stand-in USDC) |
| Collateral mint | `79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg` (stand-in tBTC) |
| Collateral atoms | _PENDING_ |
| Rate bps | _e.g. 800_ |
| Duration months | _e.g. 3_ |
| Max LTV bps | 5000 |

## Steps

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
| 9 | `repay_in_full` (or final `make_payment`) | Borrower | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 10 | `release_collateral` | Operator | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |
| 11 | `close_deal` (Completed) | Operator | `PENDING` | https://explorer.solana.com/tx/PENDING?cluster=devnet |

## Final on-chain state

| Account | Expected | Observed | Explorer |
| --- | --- | --- | --- |
| Deal | completed / closed-completed | `PENDING` | |
| Vault | released / closed; collateral returned | `PENDING` | |
| Loan | repaid / completed | `PENDING` | |

## Result

- **Pass / fail:** `PENDING`
- **Notes:** Stand-in mints (not canonical tBTC/USDC). Operator = gov signer 1 (devnet MVP). No real Bitcoin bridge.

## How to complete

1. Follow `ops/handoff/A1-A2-live-cycle-runbook.md` § A1  
2. Replace every `PENDING`  
3. Set Status to `PASS`  
4. Check A1 in `docs/MAINNET_CUTOVER_3_STEP.md`
