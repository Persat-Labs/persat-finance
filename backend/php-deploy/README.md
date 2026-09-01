# Persat PHP API — LyteHosting package

Upload **this folder’s contents** to the document root of `api.persat.finance`.

| Doc | Purpose |
| --- | --- |
| `docs/LYTEHOSTING_API.md` | Full founder deploy + DNS checklist |
| `schema.sql` | phpMyAdmin import |
| `config/config.example.php` | Copy → `config.local.php` on server (gitignored) |

Matches dApp routes in `frontend/src/lib/api.ts` (`/health`, `/v1/auth/*`, deal-links, marketplace, faucet cooldown, oracle).

**Not included:** server-side SPL faucet mint and keeper (Node sidecar later).
