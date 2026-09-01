# Profiles API — user identity (UUID ↔ wallet ↔ DB)

**Goal:** profile create / read / update goes through the API + MySQL, and the dApp
hydrates the UI from the server. `localStorage` is now only an **offline cache**,
NOT the source of truth.

**Scope:** PHP package `backend/php-deploy/` (the live `api.persat.finance`) plus
the Node sidecar `backend/src/` kept in sync.

---

## Identity model

| Concept | Value |
| --- | --- |
| **Primary identity** | Solana wallet address (`wallet`, SIWS-bound) |
| **Opaque id** | `id` = server-issued **UUID** (stable, never invented by the client) |
| Username | `username` — lowercase `[a-z0-9_]`, 3–20 chars, `UNIQUE` across wallets |
| Display name | `display_name` (defaults to `@<username>`) |
| Bio / avatar | `bio`, `avatar_seed` |

The wallet is the canonical key. `id` exists so the UI has an opaque, change-resistant
key for cache/link purposes, and the frontend stores/syncs it (never generates one).

---

## Database

`backend/php-deploy/schema.sql` (authoritative, MySQL 8.0+):

```sql
CREATE TABLE IF NOT EXISTS user_profiles (
  id VARCHAR(36) NOT NULL UNIQUE,
  wallet VARCHAR(44) PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  display_name VARCHAR(64) NOT NULL,
  bio TEXT NULL,
  avatar_seed VARCHAR(64) NULL,
  reputation_score INT NOT NULL DEFAULT 100,
  total_deals INT NOT NULL DEFAULT 0,
  active_loans INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username),
  INDEX idx_id (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Mirrored in `backend/database/schema.sql` (MySQL) and
`backend/migrations/003_user_profiles.sql` (Postgres, used by the Node sidecar).

### Upgrading an existing `user_profiles` table (missing `id`)

The old table had no `id`. If you already imported the previous schema, run this
**once** in phpMyAdmin (start with a backup):

```sql
UPDATE user_profiles SET id = LEFT(UUID(), 36) WHERE id IS NULL OR id = '';
ALTER TABLE user_profiles ADD COLUMN id VARCHAR(36) NULL AFTER wallet, ADD INDEX idx_id (id);
UPDATE user_profiles SET id = LEFT(UUID(), 36) WHERE id IS NULL OR id = '';
ALTER TABLE user_profiles MODIFY id VARCHAR(36) NOT NULL, ADD UNIQUE KEY unique_user_profile_id (id);
```

On a **fresh import** (`schema.sql` above) nothing is needed.

---

## API routes

All JSON. CORS allows `https://dapp.persat.finance`; writes fail-closed via SIWS
Bearer session (`Auth::requireSession()` / Node `requireWalletSession`).

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| GET | `/v1/profiles/me` | Bearer | Return session wallet's profile; **create a default row if missing** |
| PUT | `/v1/profiles/me` | Bearer | Update `username`/`display_name`/`bio`/`avatar_seed`; enforce `UNIQUE` username (409) |
| GET | `/v1/profiles/:walletOrUsername` | Public | Read by wallet (base58, 32–44 chars) or username (3–20 chars) |
| GET | `/v1/profiles/username/:name/available?wallet=` | Public | Username availability vs DB, excluding `?wallet=` |

Every profile response includes `wallet` and `id` (UUID).

### Request / response examples

**GET `/v1/profiles/me`** (after SIWS sign-in)

```json
{
  "ok": true,
  "wallet": "9QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD",
  "profile": {
    "id": "3f9e…", "wallet": "9QG…", "username": "user_9QGAd",
    "display_name": "@user_9QGAd", "bio": "", "avatar_seed": "9QGZmjKB",
    "reputation_score": 100, "total_deals": 0, "active_loans": 0,
    "created_at": "2026-09-01 12:00:00", "updated_at": "2026-09-01 12:00:00"
  }
}
```

**PUT `/v1/profiles/me`**

```json
{ "username": "satoshi", "display_name": "Satoshi", "bio": "HODLing until I can buy." }
```

→ `201/200` with the updated profile, or `409` `{ "error": "Username @satoshi is already taken by another wallet." }`.

**GET `/v1/profiles/username/satoshi/available?wallet=<caller>`**

```json
{ "available": true, "username": "satoshi" }
```

or `{ "available": false, "reason": "@satoshi is already claimed by another wallet." }`.

---

## Frontend

- `frontend/src/lib/api.ts` adds `profilesMe`, `profileGet`, `profilesUsernameAvailable`, `profileUpdate`.
- `frontend/src/lib/profile/userProfile.ts` is now **server-first**:
  - `useProfile(wallet)` → after connect + optional SIWS sign-in, calls `/v1/profiles/me`
    (which creates a default row) or falls back to the public `profileGet`.
  - `updateProfile` → **PUT server first**, cache only as offline fallback.
  - `checkUsernameAvailable` → calls the API, not only localStorage.
  - `cacheProfile()` writes server data to localStorage for other components
    (messages/marketplace `@handle` prefer the cached server profile).
- `frontend/src/app/profile/[id]/page.tsx` loads the viewed profile from the server
  and saves edits through `PUT /v1/profiles/me`.

---

## Deploy / test on Lyte

1. Import `backend/php-deploy/schema.sql` (or run the `id` ALTER above).
2. Upload the PHP package to `api.persat.finance` docroot (see `docs/LYTEHOSTING_API.md`).
3. Confirm routes with curl (after a SIWS challenge → verify → Bearer):

```bash
# Public
curl -sS "https://api.persat.finance/v1/profiles/username/satoshi/available?wallet=9QG…"
curl -sS "https://api.persat.finance/v1/profiles/9QG…"

# Auth flow
curl -sS -X POST https://api.persat.finance/v1/auth/challenge -H 'Content-Type: application/json' \
  -d '{"wallet":"9QG…"}'
# → { challengeId, message } ; sign message in wallet ; then:
curl -sS -X POST https://api.persat.finance/v1/auth/verify -H 'Content-Type: application/json' \
  -d '{"challengeId":"…","signature":"…","wallet":"9QG…"}'
# → { token }
curl -sS https://api.persat.finance/v1/profiles/me -H "Authorization: Bearer $TOKEN"
curl -sS -X PUT https://api.persat.finance/v1/profiles/me -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"username":"satoshi","display_name":"Satoshi","bio":""}'
```

**Acceptance (the four "Done" items this session):**
- [ ] Profile create/read/update goes through API + MySQL (curl: `GET /me` creates a row; `PUT /me` persists; refresh shows it).
- [ ] Frontend loads user by wallet/session id that matches DB (`Network` tab shows `/v1/profiles/*`).
- [ ] Username uniqueness enforced in DB (second wallet gets `409`).
- [ ] This note covers how to deploy/test profiles on Lyte.

---

## Known caveats

- Auto-faucet mint and keeper still require the Node sidecar (unchanged).
- `@handle` in messages/marketplace resolves from the cached server profile; a
  profile must have been fetched at least once before it appears (new users show a
  derived placeholder until they've created/fetched a profile).
