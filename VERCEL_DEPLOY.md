# Deploying Persat Finance to Vercel

## Prerequisites

- A [Vercel account](https://vercel.com/signup) (free tier works)
- Your GitHub repo pushed: `https://github.com/MaxCybOps/persat-finance-arc.git`
- A free [WalletConnect Cloud](https://cloud.walletconnect.com) project ID

---

## Step 1 — Push to GitHub

If you haven't already, push the project:

```bash
git init                                                  # if not already a git repo
git remote add origin https://github.com/MaxCybOps/persat-finance-arc.git
git add .
git commit -m "feat: frontend + contracts"
git push -u origin main
```

---

## Step 2 — Import into Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Add New > Project**
3. Select **Import Git Repository** and pick `MaxCybOps/persat-finance-arc`
4. Configure the build:
   - **Framework Preset:** Vite
   - **Build Command:** `bun run build` (or `vite build`)
   - **Output Directory:** `dist`
   - **Install Command:** `bun install` (or leave blank — Vercel auto-detects)

---

## Step 3 — Environment variables

In the Vercel project settings under **Environment Variables**, add:

| Key | Value | Notes |
|---|---|---|
| `VITE_WALLETCONNECT_PROJECT_ID` | `<your project ID>` | From cloud.walletconnect.com |
| `VITE_REGISTRY_ADDRESS` | `0x277ec42de9cc634fa25c2f308f5e14c71e7a0593` | Already defaults in code |
| `VITE_VAULT_ADDRESS` | `0x79a374e95a85611a95847ed9939a63be96418e49` | Already defaults in code |
| `VITE_CIRBTC_ADDRESS` | `0x52c0757272713869f2a34827386c301a5c3af744` | Already defaults in code |
| `VITE_PRICE_FEED_ADDRESS` | `0xa620864091aa03188e33db8ef938dc7e82e4a463` | Already defaults in code |

The address variables are optional — defaults are already baked in for Arc Testnet. Only `VITE_WALLETCONNECT_PROJECT_ID` is needed for WalletConnect to work in production.

---

## Step 4 — Deploy

Click **Deploy**. Vercel builds and deploys. The first deploy takes about 60–90 seconds.

---

## Step 5 — Arc Testnet wallet setup (for users)

To interact with Persat Finance on Arc Testnet, users need to add Arc Testnet to MetaMask (or any injected wallet):

| Field | Value |
|---|---|
| Network Name | Arc Testnet |
| RPC URL | `https://rpc.testnet.arc.io` |
| Chain ID | `5042002` |
| Currency Symbol | `USDC` |
| Block Explorer | `https://explorer.testnet.arc.io` |

**Important:** On Arc, USDC is the native gas token. Users need testnet USDC to pay gas — there is no separate ETH. Direct users to the "Get test USDC" button inside Arc Studio, or to `https://faucet.arc.io`.

---

## Step 6 — Connect WalletConnect domain (optional but recommended)

In [WalletConnect Cloud](https://cloud.walletconnect.com):
1. Open your project
2. Under **Allowed Domains**, add your Vercel preview URL and your production domain

---

## Vercel SPA routing fix

React Router uses client-side routing. Add a `vercel.json` in the project root to redirect all 404s to `index.html`:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

This file is already included in the repository.

---

## After deploy

1. Visit your Vercel URL
2. Connect MetaMask on Arc Testnet
3. Create a deal at `/deal/new`
4. Share the claim link with your counterparty

---

## One-time owner action (still pending)

The Registry owner (`0x5B12Ce46C7194aD57d143bC22847224047b1Ef42`) must call:

```
PersatDealRegistry.setVault(0x79a374e95a85611a95847ed9939a63be96418e49)
```

Without this call, `claimDeal` will succeed but `activateLoan` on the vault will revert because the vault won't trust the registry. Use the Contracts panel ABI tool or a Foundry `cast send` command with the owner's private key.
