# A4 — Hosted surface (founder checklist)

**Definition of done:** `docs/MAINNET_CUTOVER_3_STEP.md` § A4  

Persat ships as **two sites** on purpose:

| Host | Content | Netlify base / repo path |
| --- | --- | --- |
| `persat.finance` | Waitlist landing | `waitlist/` — **do not** point this site at `frontend/` |
| `dapp.persat.finance` | Product dApp | `frontend/` |
| `api.persat.finance` | Protocol-adjacent API (optional at A) | `backend/` |

---

## Decision: backend mode for testnet A

Pick **one** and document it on `/known-limitations` + this file’s status line.

### Mode W — Wallet-RPC-only (recommended until API DNS exists)

- Browser talks to **Solana RPC** (+ Pyth Hermes) directly via wallet adapter.
- `NEXT_PUBLIC_BACKEND_URL` may be **empty**.
- Deal links / marketplace index that need the API stay disabled or local-only.
- **Status line to publish:** “Testnet dApp is wallet + RPC; API optional.”

### Mode A — API required

- `api.persat.finance` DNS **A/CNAME** → backend host (Fly, Railway, Render, VPS, etc.).
- TLS cert valid; `GET https://api.persat.finance/health` returns JSON `ok: true`.
- Frontend `NEXT_PUBLIC_BACKEND_URL=https://api.persat.finance`.
- CSP `connect-src` already allows `https://api.persat.finance` in `frontend/netlify.toml`.

**Current DNS (last checked in session):** `api.persat.finance` was **NXDOMAIN**. Until fixed, operate in **Mode W**.

---

## Founder checklist

### 1. RPC (do this even in Mode W)

- [ ] Provision Helius / QuickNode / Triton **devnet** endpoint  
- [ ] Set Netlify env `NEXT_PUBLIC_SOLANA_RPC_URL` on the **dApp** site  
- [ ] Set backend `SOLANA_RPC_URL` if API is deployed  
- [ ] Confirm public `api.devnet.solana.com` is not the only prod path (rate limit 100/10s)

### 2. dApp site (`dapp.persat.finance`)

- [ ] Netlify site base directory = `frontend` (or build from `frontend/`)  
- [ ] Build command: `npm ci && npm run build` (or repo root script)  
- [ ] Publish directory: `frontend/.next` **or** Next runtime per Netlify Next plugin  
- [ ] Env:
  - `NEXT_PUBLIC_SOLANA_RPC_URL`
  - `NEXT_PUBLIC_BACKEND_URL` (empty for Mode W, or `https://api.persat.finance`)
  - `NEXT_PUBLIC_CLUSTER=devnet` if used
- [ ] Production branch = **`main`** (Arena session branches are not production until merge)
- [ ] After merge: hard-refresh dApp; confirm home + `/deals` + `/deal/new` load

### 3. Waitlist site (`persat.finance`)

- [ ] Remains on `waitlist/` base  
- [ ] No accidental base-directory switch to `frontend`  
- [ ] Optional CTA → `https://dapp.persat.finance` labeled **Devnet**

### 4. API site (`api.persat.finance`) — Mode A only

- [ ] Create DNS record at Namecheap → Netlify DNS or host IP  
- [ ] Deploy `backend/` with:
  - `PORT`
  - `SOLANA_RPC_URL`
  - `CLUSTER=devnet`
  - DB URL only if enabling write routes
  - `KEEPER_ENABLED` / key path only when ready (B3)
- [ ] `curl -sS https://api.persat.finance/health | jq`  
- [ ] CORS allows `https://dapp.persat.finance`

### 5. Merge discipline

Arena work lives on session branches (e.g. `arena/01a04c34-persat-finance`).  

- [ ] Open PR → review → merge to **`main`**  
- [ ] Netlify auto-deploy from `main`  
- [ ] Do not tell waitlist users “live on mainnet”  
- [ ] Tag release optional: `testnet-A-YYYYMMDD`

### 6. Evidence for A4

Record here or in `security-audits/pass-3/ui/a4-hosting.md`:

```text
Date:
Mode: W | A
dApp URL:
dApp deploy log / commit SHA on main:
RPC provider: (name only, no key)
api.persat.finance: NXDOMAIN | health OK
Waitlist base still waitlist/: yes
```

---

## Agent / contributor boundary

| Can do in Arena | Founder-only |
| --- | --- |
| Document Mode W, wire empty-backend UX | DNS at Namecheap |
| PR from session branch | Merge to `main` |
| Netlify.toml CSP / env **names** | Netlify env **values** / tokens |
| Local `:3000` / `:4000` preview | Production certs |

---

## Status

- **Chosen mode:** `W — wallet-RPC-only` (default until API DNS exists)
- **A4 checkbox:** open until founder evidence block above is filled
