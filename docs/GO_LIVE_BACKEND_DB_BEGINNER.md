# Get database + backend live — clear beginner steps

**Goal:** durable sessions, deal-links, marketplace proposals, faucet cooldown  
**Today without this:** Arena preview API only, `storage: not_configured`, sessions in **memory**

You do **not** need PHP for the first live API. Use **Node backend + one MySQL (or Postgres) database**.  
Never put passwords or keypairs in Git or chat.

---

## Big picture (3 boxes)

```text
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  dApp frontend   │     │  Node API        │     │  MySQL database  │
│  dapp.persat…    │────▶│  api.persat…     │────▶│  tables live     │
│  Netlify         │     │  Fly/Railway/…   │     │  (or Postgres)   │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        wallet ──▶ Solana RPC (Helius) ──▶ on-chain deals (separate)
```

| Box | What you buy/create | Env you set |
| --- | --- | --- |
| Database | MySQL 8 or Postgres | `PERSAT_DATABASE_URL` on the API |
| Backend | Always-on Node host | `PERSAT_DATABASE_URL`, `SOLANA_RPC_URL`, `PORT`, CORS |
| Frontend | Already on Netlify idea | `NEXT_PUBLIC_BACKEND_URL=https://api.persat.finance` |

Wallet + on-chain txs work **without** the DB. DB unlocks the rows in your table (sessions, deal-links, etc.).

---

## Time & cost (honest)

| Path | Time | Ballpark |
| --- | --- | --- |
| **A — Fastest:** Railway or Render (API + MySQL add-on) | ~1–2 hours first time | Free trial / few $/mo |
| **B — Cheap long-term:** Namecheap/cPanel MySQL + small VPS or Railway for Node only | ~ half day | DB cheap, Node small |
| **C — Postgres:** Supabase free DB + Railway Node | ~1–2 hours | Free tier possible |

**Recommended for beginners: Path A (Railway).** One dashboard, MySQL plugin, deploy from GitHub.

---

## Before you start (checklist)

- [ ] GitHub repo access (`Persat-Labs/persat-finance`)
- [ ] Ability to add DNS at Namecheap for `api.persat.finance`
- [ ] Ability to set env vars on Netlify (dApp site)
- [ ] Password manager (store DB password + any keys)
- [ ] Optional: Helius/QuickNode **devnet** RPC URL (better than public RPC)

**Do not** commit:

- Database passwords  
- `PERSAT_DEPLOYER_KEYPAIR`  
- Session secrets  

---

# PATH A — Railway (beginner default)

## Step 1 — Create a MySQL database

1. Go to [railway.app](https://railway.app) → sign in with GitHub.  
2. **New Project** → **Add MySQL** (or “Database” → MySQL).  
3. Open the MySQL service → **Variables** / **Connect**.  
4. Copy the URL. It looks like:

   ```text
   mysql://root:PASSWORD@host:port/railway
   ```

5. Save it in your password manager as `PERSAT_DATABASE_URL`.

*(Postgres works too: `postgresql://…` — same env name.)*

## Step 2 — Create the tables

1. On Railway MySQL, open **Query** / **Data** tab, **or** use any SQL client (TablePlus, DBeaver, mysql CLI).  
2. Run the full file from the repo:

   **File:** `backend/database/schema.sql`

3. If the host already chose a database name, you can skip or edit the `CREATE DATABASE` / `USE` lines and run only the `CREATE TABLE` statements.  
4. Confirm tables exist, at least:

   - `wallet_auth_challenges`  
   - `wallet_sessions`  
   - `deal_links`  
   - `marketplace_proposals`  
   - `faucet_claims`  

## Step 3 — Deploy the Node backend

1. Railway → **New** → **GitHub Repo** → `persat-finance`.  
2. Set **Root Directory** to `backend` (important).  
3. Build/start (Railway often auto-detects). If asked:

   ```text
   Install: npm ci
   Start:    npm run start
   ```

4. Open the service → **Variables** → add:

   | Variable | Example / notes |
   | --- | --- |
   | `PERSAT_DATABASE_URL` | Paste MySQL URL from Step 1 |
   | `PORT` | `4000` (or leave Railway `PORT` if they inject it — then match their port) |
   | `NODE_ENV` | `production` |
   | `SOLANA_CLUSTER` | `devnet` |
   | `SOLANA_RPC_URL` | `https://…helius…` or `https://api.devnet.solana.com` |
   | `NEXT_PUBLIC_APP_URL` | `https://dapp.persat.finance` |
   | `CORS_ORIGINS` | `https://dapp.persat.finance,https://persat.finance` |
   | `PERSAT_DEPLOYER_KEYPAIR` | **Optional** for now — only if you want server auto-faucet |
   | `KEEPER_ENABLED` | leave unset until you want keeper |

5. Deploy. Railway gives a public URL like `https://something.up.railway.app`.

## Step 4 — Prove the API is healthy

In a browser or terminal:

```bash
curl -sS https://YOUR-RAILWAY-URL.up.railway.app/health
```

**Success looks like:**

```json
"ok": true,
"checks": { "storage": "configured", ... },
"dependencies": { "database": "ok", ... }
```

Also:

```bash
curl -sS https://YOUR-RAILWAY-URL.up.railway.app/v1/auth/status
```

Expect `"mode": "database"` (not `"memory"`).

If `database` is still `not_configured` or `error:`:

- URL typo / wrong password  
- Tables not created  
- Railway MySQL not on same project / networking  

## Step 5 — Point `api.persat.finance` at the API

### 5a. Custom domain on Railway

1. Railway service → **Settings** → **Domains** → add `api.persat.finance`.  
2. They show a CNAME target (e.g. `xxx.up.railway.app`).

### 5b. Namecheap DNS

1. Namecheap → Domain List → `persat.finance` → **Advanced DNS**.  
2. Add record:

   | Type | Host | Value |
   | --- | --- | --- |
   | **CNAME** | `api` | `xxx.up.railway.app` (exactly what Railway shows) |

3. Wait 5–30 minutes (sometimes longer).  
4. Test:

   ```bash
   curl -sS https://api.persat.finance/health
   ```

TLS: Railway usually provisions HTTPS for custom domains automatically.

## Step 6 — Point the dApp at the API

1. Netlify → site for **`dapp.persat.finance`** (frontend, base `frontend/`).  
2. **Site settings → Environment variables:**

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_BACKEND_URL` | `https://api.persat.finance` |
   | `NEXT_PUBLIC_SOLANA_RPC_URL` | your Helius/QuickNode devnet URL (recommended) |
   | `NEXT_PUBLIC_APP_URL` | `https://dapp.persat.finance` |

3. **Trigger a new deploy** (Deploys → Trigger deploy).  
4. Hard-refresh the dApp.

**Important:** merge your Arena branch to **`main`** if production deploys from `main`, or production will stay on old code.

## Step 7 — Prove features from the table

| Feature | How to verify |
| --- | --- |
| Durable sessions | dApp → Connect wallet → **Sign in for session token** → refresh page → still “Signed in”. Restart API on Railway → still works (DB). |
| Deal-link create | After SIWS, create private deal link via UI/API — should **201**, not 503. |
| Marketplace proposals | Authenticated POST — row appears in `marketplace_proposals`. |
| Faucet cooldown | Claim twice within 24h — second should be blocked once DB + faucet route use `faucet_claims`. |

```bash
# Session path smoke test (replace URL)
curl -sS https://api.persat.finance/v1/auth/challenge \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"YOUR_BASE58_PUBKEY"}'
# → challengeId + message  (then sign in wallet UI; curl alone cannot finish verify)
```

---

# PATH B — cPanel MySQL + Node elsewhere

Use if you already pay for Namecheap hosting with MySQL.

1. cPanel → **MySQL Databases** → create database `persat_finance` + user + password → **Add user to DB (ALL PRIVILEGES)**.  
2. phpMyAdmin → Import → `backend/database/schema.sql`.  
3. Build URL:

   ```text
   mysql://DB_USER:DB_PASSWORD@localhost:3306/persat_finance
   ```

   If Node is **not** on the same machine, use the host cPanel gives (often not `localhost` from outside — you may need “Remote MySQL” allowlist or keep Node on a host that can reach it).  
4. Deploy Node on Railway/Render/Fly with that `PERSAT_DATABASE_URL` (Steps 3–7 above).  
5. Same DNS for `api.persat.finance`.

**PHP upload** (`backend/public/`) is optional later for pure CRUD; the live dApp session flow you have now talks to the **Node** `/v1/*` routes.

---

# PATH C — Supabase Postgres

1. [supabase.com](https://supabase.com) → New project.  
2. **Project Settings → Database** → Connection string (URI).  
3. Convert to:

   ```text
   postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres
   ```

4. SQL Editor: run Postgres-friendly migrations in `backend/migrations/*.sql`  
   **or** adapt `schema.sql` types (UUID, `timestamptz`) — Node `database.ts` supports both MySQL and Postgres.  
5. Same Railway Node deploy with `PERSAT_DATABASE_URL=postgresql://…`.

---

## Minimum env cheat sheet (copy/paste names only)

**On API host (Railway):**

```env
PERSAT_DATABASE_URL=mysql://...
SOLANA_RPC_URL=https://...
SOLANA_CLUSTER=devnet
NODE_ENV=production
PORT=4000
NEXT_PUBLIC_APP_URL=https://dapp.persat.finance
CORS_ORIGINS=https://dapp.persat.finance,https://persat.finance
```

**On Netlify dApp:**

```env
NEXT_PUBLIC_BACKEND_URL=https://api.persat.finance
NEXT_PUBLIC_SOLANA_RPC_URL=https://...
NEXT_PUBLIC_APP_URL=https://dapp.persat.finance
```

**Optional later:**

```env
PERSAT_DEPLOYER_KEYPAIR=[...json array...]   # server auto-faucet
KEEPER_ENABLED=1
KEEPER_KEYPAIR_PATH=...                      # or inline secret strategy you choose
ADMIN_API_KEY=...
```

---

## What you do NOT need for “DB + backend live”

- Mainnet  
- ZEUS / Threshold keys  
- External audit complete  
- PHP (Node + MySQL is enough for your feature table)  
- Changing Solana program IDs  

## What stays true after go-live

| Still true | Why |
| --- | --- |
| User ID = wallet pubkey | DB rows store `wallet` base58 |
| Inspect can edit HTML | Still cosmetic |
| On-chain deals need Phantom tx | DB does not replace the chain |
| Waitlist site stays on `waitlist/` | Don’t point that Netlify site at `frontend/` |

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `storage: not_configured` | `PERSAT_DATABASE_URL` missing on **API** service |
| `database: error: …` | Bad URL, SSL, or DB not reachable from Railway |
| `mode: memory` | API doesn’t see DB URL — redeploy after setting var |
| CORS error in browser | Add exact dApp origin to `CORS_ORIGINS` |
| dApp still hits memory/old API | `NEXT_PUBLIC_BACKEND_URL` not set or deploy not rebuilt |
| 503 on deal-links | DB down or tables missing |
| `api.persat.finance` NXDOMAIN | DNS CNAME not added or not propagated |
| Public RPC 429 | Switch `SOLANA_RPC_URL` to Helius/QuickNode |

---

## Done when

- [ ] `curl https://api.persat.finance/health` → `database: ok`  
- [ ] `curl https://api.persat.finance/v1/auth/status` → `mode: database`  
- [ ] dApp Sign-in session survives API restart  
- [ ] At least one row appears in `wallet_sessions` after you sign in  
- [ ] Waitlist still on `persat.finance` from `waitlist/`  

---

## Help in-repo

| Doc | Topic |
| --- | --- |
| `backend/README.md` | Hybrid architecture, env list |
| `backend/database/schema.sql` | MySQL tables |
| `docs/HOSTING_A4.md` | DNS / Mode W vs Mode A |
| `docs/SESSION_AND_AUTH.md` | SIWS tokens |
| `GO_LIVE_AND_SCALE.md` | Secrets table |

When Step 4 health shows `database: ok`, paste that JSON (no secrets) and we can double-check the next DNS/Netlify clicks.
