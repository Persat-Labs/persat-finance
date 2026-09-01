# Deploy `api.persat.finance` on LyteHosting (PHP + MySQL)

**Goal:** durable sessions, deal-links, marketplace proposals, faucet cooldown, health + oracle proxy  
**Package:** `backend/php-deploy/`  
**Domain:** `https://api.persat.finance`  
**dApp already expects:** `NEXT_PUBLIC_BACKEND_URL=https://api.persat.finance`

---

## Critical DNS fix (read this first)

You said the **`api` subdomain was added in Netlify DNS**. That is fine **if Netlify is your DNS host** (NS → `dns*.nsone.net` — yes for `persat.finance`).

**What the record must point to is wrong if it targets Netlify’s site:**

| Wrong | Right |
| --- | --- |
| CNAME `api` → `persat-finance.netlify.app` (or any Netlify site) | **A** `api` → **LyteHosting Shared IP** |
| CNAME `api` → something without PHP/MySQL | A record to cPanel **Shared IP Address** |

Netlify serves static/Next sites. It does **not** run your PHP + MySQL API.

### Exact Netlify DNS steps

1. Netlify → Domain management → `persat.finance` → **DNS**.
2. Delete any bad `api` record that points at a Netlify hostname.
3. **Add record:**

   | Type | Name | Value | TTL |
   | --- | --- | --- | --- |
   | **A** | `api` | `<LyteHosting Shared IP>` | 3600 or Auto |

4. Where to find the IP (LyteHosting):
   - cPanel → right sidebar **General Information** → **Shared IP Address**  
   - Or Welcome email / Customer Portal  
   - Docs: [How to Locate Your Server Details](https://lytehosting.com/knowledgebase/121/How-to-Locate-Your-Server-Details.html)

5. Wait 5–30+ minutes. Test:

   ```bash
   dig +short api.persat.finance A
   # should print the Lyte shared IP only
   curl -sS https://api.persat.finance/health
   ```

### Also in LyteHosting cPanel

1. **Domains → Addon Domains** or **Subdomains** → create **`api.persat.finance`**.
2. Document root = folder you will upload into (recommended: `api.persat.finance` or `public_html/api`).
3. After DNS points here, issue **SSL**: cPanel → **SSL/TLS Status** → Run AutoSSL for `api.persat.finance`  
   (or Let’s Encrypt). Browsers need `https://`.

---

## What this PHP stack does / does not

| Feature | On LyteHosting PHP? |
| --- | --- |
| `GET /health` | Yes |
| SIWS auth (`/v1/auth/*`) + durable sessions | Yes |
| Deal-links create/claim/status | Yes |
| Marketplace proposals | Yes |
| Faucet **cooldown** rows | Yes |
| BTC price via Pyth Hermes | Yes (proxy) |
| Bridge health | Stub → manual only |
| **Auto-faucet mint** (SPL + SOL) | **No** — needs Node + `PERSAT_DEPLOYER_KEYPAIR` later |
| Keeper auto-liquidation loop | **No** — Node/cron later |

On-chain deals still use the wallet + Solana RPC from the dApp. This API only stores off-chain session/index data.

---

## Step-by-step deploy

### 1. Create MySQL database

cPanel → **MySQL® Databases**:

1. Create database (e.g. `youruser_persat`).
2. Create user + strong password.
3. **Add user to database** → **ALL PRIVILEGES**.
4. Note full names (cPanel prefixes `youruser_`).

### 2. Import schema

cPanel → **phpMyAdmin** → select your database → **Import** →  
upload **`backend/php-deploy/schema.sql`** (or `backend/database/schema.sql`).

Confirm tables:

- `wallet_auth_challenges`, `wallet_sessions`
- `deal_links`, `marketplace_proposals`
- `faucet_claims`, `waitlist_signups`, …

### 3. Upload PHP package

Upload the **contents** of `backend/php-deploy/` into the subdomain document root:

```text
index.php
.htaccess
schema.sql          (optional on server after import)
config/
  config.example.php
  config.local.php  ← you create this on server only
lib/
  bootstrap.php, Database.php, SolanaCrypto.php, Http.php, Auth.php, Uuid.php
routes/
  oracle.php, faucet.php, marketplace.php, deal_links.php
```

**Tools:** cPanel File Manager, or FTP/SFTP (host = shared IP or server hostname from Welcome email).

### 4. Create `config.local.php` on the server

Copy `config.example.php` → `config.local.php` **on the server only** (never commit):

```php
<?php
return [
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => 'youruser_persat',
    'db_user' => 'youruser_persat',
    'db_pass' => 'YOUR_REAL_PASSWORD',
    'cors_origins' => [
        'https://dapp.persat.finance',
        'https://persat.finance',
        'https://www.persat.finance',
        'http://localhost:3000',
    ],
    'app_url' => 'https://dapp.persat.finance',
    'cluster' => 'devnet',
    'pyth_hermes_url' => 'https://hermes.pyth.network',
    'btc_usd_feed_id' => '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    'challenge_ttl_seconds' => 300,
    'session_ttl_seconds'   => 86400,
];
```

Permissions: readable by PHP, not world-writable. `.htaccess` blocks direct HTTP download of config files.

### 5. PHP extensions

cPanel → **Select PHP Version** (MultiPHP):

- PHP **8.1+** (8.2 preferred)
- Enable: **pdo_mysql**, **mysqlnd**, **sodium** (or `libsodium`), **json**, **openssl**, **curl** (optional)

### 6. Prove API health

```bash
curl -sS https://api.persat.finance/health
curl -sS https://api.persat.finance/v1/auth/status
curl -sS https://api.persat.finance/v1/oracle/btc-usd
```

**Success looks like:**

```json
{
  "ok": true,
  "runtime": "php-mysql",
  "checks": { "storage": "configured" },
  "dependencies": { "database": "ok", ... }
}
```

```json
{ "ok": true, "mode": "database", ... }
```

### 7. Point the dApp at the API (Netlify)

Site for **`dapp.persat.finance`** (base = `frontend/`):

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_BACKEND_URL` | `https://api.persat.finance` |
| `NEXT_PUBLIC_APP_URL` | `https://dapp.persat.finance` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | your Helius/QuickNode devnet URL (recommended) |

Trigger a new deploy. Hard-refresh the dApp.

CSP already allows `https://api.persat.finance` in `frontend/netlify.toml`.

### 8. End-to-end smoke test

1. Open `https://dapp.persat.finance` → Connect Phantom (devnet).
2. **Sign in** for session → should succeed (Bearer token stored).
3. Refresh page → still signed in (`wallet_sessions` row in phpMyAdmin).
4. Create marketplace proposal or deal-link (if UI path available) → row appears in MySQL.
5. Faucet: cooldown is tracked; auto-mint may say use client bundle until Node sidecar exists.

---

## Folder layout on server (recommended)

```text
/home/youruser/api.persat.finance/     ← document root for subdomain
  index.php
  .htaccess
  config/config.local.php
  lib/...
  routes/...
```

If you put files under `public_html/api/`, either:

- set subdomain docroot to that folder, **or**
- keep DNS on that host and accept paths like `https://api.persat.finance/...` only if the vhost root is correct.

Front controller also accepts a `/api` prefix strip if needed.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `dig` shows Netlify IPs (`13.52…` / `52.52…`) | A record still wrong — point at Lyte **Shared IP** |
| SSL error / cert name mismatch | AutoSSL on `api.persat.finance` after DNS is correct |
| `database: error: …` | Wrong `db_*` in `config.local.php`; user not granted on DB |
| `mode` not `database` | Same as above |
| 404 on `/v1/...` | `.htaccess` not uploaded; `mod_rewrite` off; wrong docroot |
| 401 always / Bearer ignored | Apache not passing `Authorization` — ensure `.htaccess` rewrite env rule |
| CORS error in browser | Add exact dApp origin to `cors_origins`; check HTTPS both sides |
| `sodium_*` undefined | Enable sodium in MultiPHP |
| Auto-faucet 503 | Expected on PHP-only — use client bundle or add Node later |

---

## Security checklist

- [ ] `config.local.php` never in Git
- [ ] Strong DB password; DB user only has rights on `persat` DB
- [ ] HTTPS only (redirect HTTP → HTTPS in cPanel)
- [ ] No deployer keypair on shared PHP host for now
- [ ] Waitlist site still `persat.finance` from `waitlist/` — do not repoint that Netlify base to `frontend/`

---

## After this works (optional later)

| Need | Path |
| --- | --- |
| One-click auto-faucet mint | Small Node service (Railway/Fly) with `PERSAT_DEPLOYER_KEYPAIR` + same MySQL remote host if allowed |
| Keeper | Same Node process or cron hitting programs |
| Real bridges | ZEUS/THRESHOLD keys — deferred |

Remote MySQL from outside LyteHosting often needs **Remote MySQL** allowlist in cPanel — only if you split Node elsewhere.

---

## Evidence block (paste when live)

```text
Date:
Host: LyteHosting cPanel
api.persat.finance A → (IP only, no password)
curl /health → ok, database: ok
curl /v1/auth/status → mode: database
dApp NEXT_PUBLIC_BACKEND_URL: https://api.persat.finance
SSL: AutoSSL yes/no
Waitlist still waitlist/: yes
```

When `/health` returns `database: ok`, paste that JSON (redact nothing secret — there shouldn’t be secrets) and we can verify the next Netlify env click.
