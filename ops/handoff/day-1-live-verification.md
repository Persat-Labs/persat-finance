# Day 1 — Live lifecycle verification (devnet)

Status: in progress. Branch: `arena/01a043d5-persat-finance`.

## Goal
Prove one complete loan lifecycle end-to-end through the real UI on Solana **devnet**,
then a second full cycle to confirm reproducibility. Record every transaction signature
and verify each state transition on-chain.

## Test Wallets Identified
| Role | Address | Status |
| --- | --- | --- |
| Borrower (Wallet A) | `8mdkcgNT2CDk5G9Pes55SUf7TkMxPpVvpu5wTL2myUWL` | Connected |
| Lender (Wallet B) | `2G2avktDrH2GTf5bodA6PnLK6zNhAp4Nxfxp4n3maCsX` | Configured |

## Environment notes (important)
- The sandbox **cannot** reach `api.devnet.solana.com` / `explorer.solana.com` / Pyth Hermes
  directly (network egress allowlist: npm registry + GitHub only). Solana Explorer pages ARE
  reachable through the proxied `fetch_page` tool, so on-chain verification is done there.
- Real wallet transactions run in **the user's browser** via the hosted UI; the user's machine
  has normal internet and can reach the devnet RPC. All user-facing actions are a click-list;
  no private key ever enters chat/repo/logs.
- Frontend dev server: `npm run dev -- -H 0.0.0.0 -p 3000` (port 3000 bound to 0.0.0.0).

## Deployed addresses (from run 33056824911) — PUBLIC keys only
| Item | Address |
| --- | --- |
| Deployer (upgrade/mint authority) | `EwyseaouyTn1rv5oLieia8rTPoVhEFyFvtjYYAkB45jC` |
| Operator / keeper (gov signer 1) | `99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD` |
| tBTC | `79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg` (8 dp) |
| zBTC | `DqQ1yzTPsfpuMMyuV6mVBvusxpq9mqmTTJZ4yMUQwQEt` (8 dp) |
| USDC | `FsSPdkdWnb8R7oziaiYFvhMbhHT7Sd9Uq55t88B7Muqe` (6 dp) |
| USDT | `8zdnnnuNJPNDkGTCxREnTyKnRo494By7MrDSTYtRx1aJ` (6 dp) |

Program IDs and PDAs: see `ops/handoff/devnet-deployed.json`.

## Changes made this session
1. **Applied stand-in mints** to `frontend/src/lib/protocol/config.ts` (`MINTS`) and
   `contracts/config/devnet.json` (zBTC, USDT mints). Confirmed live on faucet page.
2. **Reconstructed `ops/handoff/devnet-deployed.json`** (programs, PDAs, mints, governance,
   operator, asset plans) so `devnet-mint-tokens.mjs` and future tools resolve mints.
3. **Bug fix — deal id routing**: `frontend/src/app/deal/[id]/page.tsx` read the deal id with
   `useSearchParams()` (query string) but deal links put it in the URL **path**
   (`/deal/<base64url>`). Switched to `useParams()`.
4. **Bug fix — wallet connection hanging**: Added `autoConnect={true}` and enhanced `WalletButton.tsx`
   with active `.connect()` invocation, approval hints, cancellation handler, and timeout.
5. **Feature — Automated In-App Dispenser**: Built `frontend/src/lib/protocol/bundle.ts` and upgraded
   `/faucet` with client-side keypair bundle loading. Enables 1-click atomic dispensing of 0.5 SOL +
   0.1 tBTC + 5,000 USDC without terminal commands or public faucet rate limits.
6. **Feature — Automated Keeper**: Upgraded `/keeper` to sign state transitions directly using the loaded
   bundle keypair, eliminating the need to manually switch accounts in Phantom.

## Lifecycle state machine (drives the click-list)
```
borrower  : proposeDeal -> (counterparty confirm) initializeVault -> depositCollateral
operator  : lockVault -> beginFunding
lender    : activateLoan
operator  : markActive
borrower  : makePayment / repayInFull
operator  : releaseCollateral -> closeDeal(Completed)   [happy path]
```

## Evidence log
| Step | Tx / state | Verified | Signature |
| --- | --- | --- | --- |
| (pending) | | | |
