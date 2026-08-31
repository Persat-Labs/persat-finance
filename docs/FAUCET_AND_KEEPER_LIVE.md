# One-click faucet + Keeper — go live

## What the dApp does now

- **Test Funds / Claim Full Pack** calls `POST /v1/faucet/auto` then `POST /v1/faucet/claim` (same-origin via Next rewrites → API). **No keypair JSON upload** in the user modal.
- If the API has no deployer key, the modal falls back to **public Devnet SOL airdrop** and tells you SPL pack still needs ops config.
- **Keeper UI** (`/keeper`): connect **gov signer 1** (operator) wallet to run actions in-browser. Full autonomous loop is the **Node keeper**, not a browser upload.

## One-click faucet (full pack)

Live mint is **not** possible on PHP-only LyteHosting. You need the **Node** backend (`backend/`) with:

| Env | Purpose |
|-----|---------|
| `PERSAT_DEPLOYER_KEYPAIR` | JSON array (64 bytes) of the **devnet deployer** secret that owns mint authority for tBTC/zBTC/USDC/USDT stand-ins |
| `SOLANA_RPC_URL` / `PERSAT_RPC_URL` | Devnet RPC (Helius/QuickNode preferred; public RPC rate-limits) |
| `PERSAT_DATABASE_URL` | MySQL — `faucet_claims` 24h cooldown |
| `CLUSTER` | `devnet` |

### Steps

1. Fund the deployer pubkey with Devnet SOL (`faucet.solana.com`) so it can pay fees + 0.5 SOL transfers.
2. On the Node host (Fly/Railway/VPS — **not** pure PHP):

```bash
cd backend
# .env
PERSAT_DEPLOYER_KEYPAIR='[1,2,...64 numbers...]'
PERSAT_DATABASE_URL='mysql://user:pass@host:3306/persat'
SOLANA_RPC_URL='https://…devnet…'
PORT=4000
npm i && npm run start
```

3. Point dApp / reverse proxy at that host:
   - Netlify / Next: `API_PROXY_TARGET=https://api.persat.finance` (or your Node URL)
   - Or put Node behind `api.persat.finance` for `/v1/faucet/*` while PHP keeps sessions/marketplace if desired (`docs/BACKEND_HYBRID.md`).

4. Verify:

```bash
curl -s https://api.persat.finance/v1/faucet/status/<wallet>
# expect serverDispenseAvailable: true when key is loaded

curl -s -X POST https://api.persat.finance/v1/faucet/auto \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"<your-wallet>","asset":"ALL"}'
```

5. In the dApp: **Test Funds** → **Claim Full Pack — One Click**.

Until step 2–3 are done, PHP API will return cooldown/claim-only (503 on auto mint). The UI still works for SOL airdrop.

## Keeper live

| Mode | How |
|------|-----|
| **Manual (today)** | Open `/keeper`, connect **operator = gov signer 1** wallet, run Prepare Treasury / lock / flag default / etc. |
| **Autonomous Node** | On the same Node host as faucet: |

```bash
KEEPER_ENABLED=1
KEEPER_KEYPAIR_PATH=/secure/operator-devnet.json   # fee-paying operator, ideally not long-term gov
KEEPER_POLL_SECONDS=60
```

`backend/src/services/keeper.ts` starts in `stub` (ticks only) or `live-ready` (key present). Full deal-scan + sign is still B3 — use the `/keeper` UI for real transitions until that lands.

**Do not** paste deployer/operator secrets into the browser. Deployer stays server-side; operator signs in Phantom for manual keeper, or via `KEEPER_KEYPAIR_PATH` on the server.

## Security notes

- Never commit `persat-devnet-keypairs-KEEP-SECRET.json`.
- Mainnet: disable public faucet; dedicated fee-only keeper; 2-of-3 gov — see `docs/MAINNET_CUTOVER_3_STEP.md`.
