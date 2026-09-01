# Persat PHP API — LyteHosting package

Upload **this folder’s contents** to the document root of `api.persat.finance`.

| Doc | Purpose |
| --- | --- |
| `docs/LYTEHOSTING_API.md` | Full founder deploy + DNS checklist |
| `schema.sql` | phpMyAdmin import |
| `config/config.example.php` | Copy → `config.local.php` on server (gitignored) |

Matches dApp routes in `frontend/src/lib/api.ts` (`/health`, `/v1/auth/*`, profiles, deal-links, marketplace, faucet cooldown, oracle).

**Profiles:** `/v1/profiles/me` (GET/PUT, auth), `/v1/profiles/:walletOrUsername` (public), `/v1/profiles/username/:name/available`. Canonical identity = wallet; `id` is a server-issued opaque UUID. Username uniqueness enforced in MySQL.

**Not included:** server-side SPL faucet mint and keeper (Node sidecar later).
