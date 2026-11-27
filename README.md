# Persat Finance

Trust-minimized peer-to-peer Bitcoin-collateralised lending on Arc Testnet. Borrowers lock cirBTC as collateral and borrow USDC at fixed terms. Every deal state transition is governed by math and on-chain events — no operator keys, no god-mode.

Built with [Arc Studio](https://studio.arc.io)

---

## Tech stack

- **Smart contracts:** Solidity 0.8.24, OpenZeppelin 5.1.0, Foundry — deployed to Arc Testnet (chain ID 5042002)
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Wagmi v2, Viem, ConnectKit, React Router v7
- **Chain:** Arc Testnet — USDC is the native gas token

---

## Deployed contracts

### Arc Mainnet (Chain ID 5042)

> ⚠️ **Do not use the deployment below with real funds.** It predates the November 2026 security review: its
> "cirBTC" (`0x9b6e…54c4`) is a test token that **anyone can mint**, and it runs the old contract code.
> Redeploy with `scripts/deploy-mainnet.cjs` (see *Deploy contracts* below) and update the frontend addresses.

| Contract | Address | Explorer |
|---|---|---|
| PersatDealRegistry | `0x46725a32b46f5388be1237e2847694fdecab3b3c` | [View on Explorer](https://explorer.arc.io/address/0x46725a32b46f5388be1237e2847694fdecab3b3c) |
| PersatEscrowVault | `0x48396168c79fce1c4b002c1f8f660b0f73dd43f6` | [View on Explorer](https://explorer.arc.io/address/0x48396168c79fce1c4b002c1f8f660b0f73dd43f6) |
| cirBTC Collateral | `0x9b6ef2eb94fc756d2521ddc42baeb4ec3a3454c4` | [View on Explorer](https://explorer.arc.io/address/0x9b6ef2eb94fc756d2521ddc42baeb4ec3a3454c4) |
| Chainlink BTC/USD Oracle | `0xa109B535C70C8Be9995be64Bb6751AcDB27e03De` | [View on Explorer](https://explorer.arc.io/address/0xa109B535C70C8Be9995be64Bb6751AcDB27e03De) |
| Native USDC Gas & ERC-20 | `0x3600000000000000000000000000000000000000` | [View on Explorer](https://explorer.arc.io/address/0x3600000000000000000000000000000000000000) |

- **Live Arc Mainnet Proof Transaction:** [`0xd029dbc35c6a8881eafcdcbe26ef487a8ed1c72b6d1d65514133b4688c6caa8f`](https://explorer.arc.io/tx/0xd029dbc35c6a8881eafcdcbe26ef487a8ed1c72b6d1d65514133b4688c6caa8f)

### Arc Testnet (Chain ID 5042002)

| Contract | Address |
|---|---|
| PersatDealRegistry | `0x2ed7e6d7f293299a4f9083b4c49d6d0b53171e70` |
| PersatEscrowVault | `0x59241023610c71c56154e5c6d56821a750ff2e76` |
| MockPriceFeed (BTC/USD $60k) | `0xa620864091aa03188e33db8ef938dc7e82e4a463` |
| MockERC20 (cirBTC testnet) | `0x52c0757272713869f2a34827386c301a5c3af744` |
| USDC (Arc Testnet) | `0x3600000000000000000000000000000000000000` |

Explorer: `https://explorer.testnet.arc.io`

---

## Development

### Prerequisites

- Node.js 18+ and [Bun](https://bun.sh)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) for contract work

### Install

```bash
bun install
```

### Environment variables

Create a `.env` file in the project root with the following variables:

| Variable | Purpose |
|---|---|
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project ID (get free at cloud.walletconnect.com) |
| `VITE_REGISTRY_ADDRESS` | PersatDealRegistry contract address (defaults to Arc Testnet deploy) |
| `VITE_VAULT_ADDRESS` | PersatEscrowVault contract address (defaults to Arc Testnet deploy) |
| `VITE_CIRBTC_ADDRESS` | cirBTC ERC-20 address (defaults to Arc Testnet mock) |
| `VITE_PRICE_FEED_ADDRESS` | IPriceFeed oracle address (defaults to Arc Testnet mock) |

All `VITE_*_ADDRESS` variables have hardcoded defaults pointing to the Arc Testnet deploys, so the app works without any env configuration for testnet testing. Only `VITE_WALLETCONNECT_PROJECT_ID` is required for WalletConnect (MetaMask injected works without it).

### Run

```bash
bun run dev
```

Open `http://localhost:5173`

### Build

```bash
bun run build
```

### Test contracts

```bash
bun run contracts:test          # all unit, fuzz, invariant and security-regression tests
bun run contracts:build         # compile only
```

### Lint and typecheck

```bash
bun run check
```

---

## Deploy to Vercel

See [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md) for step-by-step instructions including Arc Testnet RPC configuration, environment variables, and wallet setup.

---

## Screens

| Route | Description |
|---|---|
| `/` | Dashboard — protocol overview, your deals |
| `/deal/new` | Create a private-link or open-marketplace deal |
| `/deal/claim/:token?salt=...` | Claim a private deal link |
| `/marketplace` | Browse open lending/borrowing orders, submit counter-offers |
| `/deal/:id/manage` | Manage a specific deal — approve, activate, repay, liquidate |

---

## Protocol rules (after the November 2026 security review)

| Rule | Value |
|---|---|
| Max LTV to activate a loan | 65% — `(principal + interest) / collateral value` |
| Liquidation threshold | 80% (same formula), permissionless |
| Overdue loans | liquidatable by anyone 7 days after maturity, whatever the LTV |
| Late fee | 2% of principal if repaid after maturity |
| Liquidator bonus | 3% of the lender's share, paid from the borrower's surplus only |
| Principal | sent directly to the borrower at activation (the vault never holds user USDC) |
| Open private links | carry an ephemeral key; claims are signed for the claimer's wallet |

Full list of findings and changes: `contracts/PersatFinance-design.md` → *Security review — November 2026*.

## Deploy contracts

```bash
forge build
# 1. Safety checks only (no transaction):
DRY_RUN=1 CIRBTC_ADDRESS=<official cirBTC from Circle> node scripts/deploy-mainnet.cjs
# 2. Deploy registry + vault and wire them (setVault is called by the script):
CIRBTC_ADDRESS=<official cirBTC> DEPLOYER_PRIVATE_KEY=<key> node scripts/deploy-mainnet.cjs
```

The script refuses to deploy if the collateral token can be minted by an arbitrary address, does not have
8 decimals, or if the oracle is stale. After deploying, update `MAINNET_*` addresses in
`src/contracts/addresses.ts` and the deployment block in `src/hooks/useUserDeals.ts` / `src/pages/Marketplace.tsx`.

On testnet, deploy `PythPriceFeedAdapter` (Pyth `0x2880aB155794e7179c9eE2e38200202908C17B43`, BTC/USD price id
`0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`) and pass it as the vault oracle instead of
`MockPriceFeed`. Pyth is pull-based: price updates must be pushed for the feed to stay fresh.
