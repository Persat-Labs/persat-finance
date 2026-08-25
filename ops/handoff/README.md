# Devnet Day-0 handoff — maintainer runbook

Everything the maintainer must personally do (the Arena token deliberately
cannot) lives here. Total time: **~30 minutes**. Order matters.

## 1. Generate keypairs (5 min, on your machine)

Open **`ops/handoff/generate-keypairs.html`** — download it and open it
locally in Chrome/Edge/Safari/Firefox. Click **Generate**, then:

- **Paste the "public keys" block into the Arena chat** (public data, safe)
- **Keep the downloaded bundle** `persat-devnet-keypairs-KEEP-SECRET.json`
  somewhere safe. It contains private keys for the 8 program addresses, the
  deployer wallet, and governance signers 1–3. Losing program keys means new
  program addresses; losing the deployer means losing the upgrade authority.

Prefer a terminal? Equivalent with Solana CLI:

```bash
for n in governance price_oracle asset_whitelist deal_registry escrow_vault \
         loan_lifecycle liquidation_engine fee_treasury deployer gov1 gov2 gov3; do
  solana-keygen new --no-bip39-passphrase -o "persat-$n.json"
done
```

## 2. Create the GitHub secrets (10 min)

Repo → **Settings → Secrets and variables → Actions → New repository
secret**. Ten secrets, values copied from the bundle:

| Secret name | Value |
| --- | --- |
| `PERSAT_DEPLOYER_KEYPAIR` | deployer keypair JSON |
| `PERSAT_GOVERNANCE_SIGNER_1_KEYPAIR` | gov-signer-1 keypair JSON |
| `PERSAT_PROGRAM_KEY_GOVERNANCE` | governance keypair JSON |
| `PERSAT_PROGRAM_KEY_PRICE_ORACLE` | price_oracle keypair JSON |
| `PERSAT_PROGRAM_KEY_ASSET_WHITELIST` | asset_whitelist keypair JSON |
| `PERSAT_PROGRAM_KEY_DEAL_REGISTRY` | deal_registry keypair JSON |
| `PERSAT_PROGRAM_KEY_ESCROW_VAULT` | escrow_vault keypair JSON |
| `PERSAT_PROGRAM_KEY_LOAN_LIFECYCLE` | loan_lifecycle keypair JSON |
| `PERSAT_PROGRAM_KEY_LIQUIDATION_ENGINE` | liquidation_engine keypair JSON |
| `PERSAT_PROGRAM_KEY_FEE_TREASURY` | fee_treasury keypair JSON |

Optional: `PERSAT_RPC_URL` for a dedicated Helius/QuickNode endpoint
(defaults to the public devnet RPC, which is rate-limited but works).

Governance signers 2 and 3 are **not** uploaded — keep them offline.

## 3. Fund the deployer (5 min)

Copy the **deployer public key** → request Devnet SOL at
<https://faucet.solana.com> repeatedly until it holds **≥ 25 SOL**
(program-deploy rent for 8 programs is the bulk of the cost).

## 4. Commit the two workflow files (5 min, web UI)

The Arena token cannot push workflow files, so you commit these yourself:

1. **Deploy workflow** — create `.github/workflows/deploy-devnet.yml`
   with the exact content of **`ops/handoff/deploy-devnet.yml`**
   (GitHub → Add file → Create new file → paste → commit to the
   `arena/01a03809-persat-finance` branch).
2. **Coverage floors** — replace `.github/workflows/protocol.yml` with the
   content of **`ops/handoff/protocol-coverage.yml`** (open the existing
   file → pencil → select-all → paste → commit). This is the patch from
   PR #8's body, pre-applied.

## 5. Merge PR #8 (1 min)

<https://github.com/Persat-Labs/persat-finance/pull/8> — admin console sync
+ protocol test hardening. All checks green except the coverage floor,
which step 4.2 above fixes.

## 6. Tell Arena

Reply in the session once steps 1–5 are done (paste the public-key block
from step 1). Arena then:

- updates the eight `declare_id!`s + `Anchor.toml` + `config/devnet.json`
  with the real program IDs and pushes,
- adds `contracts/scripts/devnet-init.mjs` (config PDA initialization,
  devnet mint creation, asset registration) and pushes,
- you dispatch **Deploy programs to Devnet** from the Actions tab; CI
  builds, deploys, initializes, and emits the deployment manifest.

## Security notes

- No keypair, seed, or `.env` ever enters the repository or the chat —
  only public keys. `.gitignore` already blocks `*.keypair.json`.
- Program keypairs fix the program *addresses*; the deployer wallet is the
  *upgrade authority* during testing. Both must survive: back up the bundle.
- Governance signers 2–3 staying offline is what makes the emergency pause
  genuinely 1-of-3 *and* unpausing genuinely 2-of-3.
