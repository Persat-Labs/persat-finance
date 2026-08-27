# Persat Finance — PHP + MySQL Backend

Self-hosted, lightweight **PHP 8.2+ and MySQL 8.0+** backend for Persat Finance, built to the specifications in `docs/php-mysql-backend-blueprint.md`.

## Features
- **Native Solana Libsodium Verification:** Ed25519 cryptographic signature verification without external dependencies.
- **Profiles & Handles:** Unique usernames, trust scores, and trading bios for lenders and borrowers.
- **In-App Messaging & Deal Negotiation:** Direct messages with embedded loan proposal cards.
- **Deal Links & Non-Custodial Escrow Indexing:** Single-use private links and marketplace proposals.

---

## 1. Database Setup (MySQL 8.0+)
Import the schema:
```bash
mysql -u root -p < database/schema.sql
```

## 2. Environment Variables
Configure your database credentials in your `.env` or web server:
```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=persat_finance
DB_USERNAME=root
DB_PASSWORD=your_password
```

## 3. Running with PHP Built-in Server (Local Development)
```bash
cd backend/public
php -S 0.0.0.0:8000
```

## 4. API Endpoints
- `POST /api/auth/challenge.php` — Generate wallet signature challenge nonce.
- `POST /api/auth/verify.php` — Verify Ed25519 signature and issue session token.
- `GET /api/profiles/index.php?wallet=...` — Retrieve user profile by wallet address.
- `GET /api/profiles/index.php?username=...` — Retrieve user profile by username.
- `POST /api/profiles/index.php` — Create or update user profile.
- `GET /api/messages/index.php?wallet=...` — Retrieve user conversation threads.
- `POST /api/messages/index.php` — Send message with optional deal proposal.
- `POST /api/deals/index.php` — Create single-use deal link.
- `GET /api/deals/index.php?deal_id=...` — Retrieve deal link details.
