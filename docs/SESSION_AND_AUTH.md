# How Persat traces a session (and why Inspect is not “hacking”)

## Short answer

| Layer | What protects it | Can DevTools Inspect break it? |
| --- | --- | --- |
| **HTML / labels / CSS** | Nothing — it is your browser | **Yes** — anyone can edit their own DOM. That is normal and not a security bug. |
| **On-chain money & deals** | **Wallet-signed Solana transactions** | **No** — Phantom must approve; programs check signers + PDAs |
| **Off-chain API writes** (deal-links, marketplace proposals) | **SIWS challenge → Bearer session token** bound to wallet | **No** without stealing the token *and* passing server checks; cannot mint as another wallet |

Editing “$1,000,000” in the portfolio card does **not** change chain balances. Reloading restores truth from RPC.

---

## Session flow (token)

```text
1. User connects wallet          → publicKey known to dApp (adapter)
2. POST /v1/auth/challenge       → { challengeId, message }  (nonce, 5 min TTL)
3. wallet.signMessage(message)   → user sees Phantom prompt (NOT a tx, no funds)
4. POST /v1/auth/verify          → { token, wallet, expiresInSeconds: 86400 }
5. Client stores token           → localStorage persat_auth_token_v1 (Bearer secret)
6. API calls                     → Authorization: Bearer <token>
7. Server                        → SHA-256(token) lookup → request.wallet = bound pubkey
8. Writes                        → proposer/initiator FORCED to session wallet
```

**Logout:** `POST /v1/auth/logout` revokes token hash; disconnect clears local storage.

**Wallet switch:** session cleared if connected pubkey ≠ session wallet.

### Endpoints

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/v1/auth/status` | Public — explains scheme |
| POST | `/v1/auth/challenge` | Public — body `{ wallet }` |
| POST | `/v1/auth/verify` | Public — body `{ challengeId, signature, wallet? }` |
| GET | `/v1/auth/me` | Bearer |
| POST | `/v1/auth/logout` | Bearer |
| POST | `/v1/auth/introspect` | Bearer |

### Storage

- **With `PERSAT_DATABASE_URL`:** `wallet_auth_challenges` + `wallet_sessions` (hash only, never raw token)
- **Without DB (preview / Mode W):** in-memory maps in the API process (lost on restart)

Frontend: `frontend/src/lib/session.ts` (`useWalletSession`)  
Backend: `backend/src/domain/sessionStore.ts`, `backend/src/routes/walletAuth.ts`

---

## What “unprofessional” Inspect edits mean

Users (and attackers on their own machine) can always:

- Change text nodes, hide buttons, fake “Admin” badges  
- Edit React props in memory with extensions  
- Replay their **own** Bearer token from Application → Local Storage  

They cannot:

- Make the chain accept a tx they did not sign  
- Create a valid SIWS signature for a wallet they do not control  
- Call `POST /v1/marketplace/proposals` as `attacker` while holding `victim`’s session (body wallet is bound to session)

Professional apps (banks, Uniswap, Phantom) all allow DOM edit. Security is **server + chain**, not “disable Inspect.”

---

## Product UX

Wallet menu shows:

- **Mode W / no session** — chain-only; copy explains Inspect ≠ authority  
- **Sign in for session token** — SIWS when API reachable (same-origin proxy or `NEXT_PUBLIC_BACKEND_URL`)  
- **Signed in · Bearer token active** — green dot on wallet chip  

---

## Production hardening (later)

- [ ] HttpOnly secure cookie option (mitigate XSS steals of localStorage token) — still needs CSRF strategy  
- [ ] Short-lived access + refresh tokens  
- [ ] Bind token to user-agent hash / device (optional)  
- [ ] Durable DB sessions required in prod (`assertProdConfig`)  
- [ ] Content-Security-Policy already in `frontend/netlify.toml`  

XSS that runs in the page can still abuse a logged-in session — treat CSP + dependency hygiene as mandatory before mainnet API writes.
