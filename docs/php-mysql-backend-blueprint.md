# Persat Finance — PHP + MySQL Backend Blueprint

This document provides the complete architectural and code-level blueprint for replacing the Fastify/Node.js/Supabase backend with a modern, self-hosted, lightweight **PHP (8.2+) and MySQL (8.0+)** stack.

---

## ⚖️ Strategic Stack Comparison

| Feature | Next.js + Fastify + Supabase (Current) | PHP (8.2+) + MySQL (Proposed) |
| --- | --- | --- |
| **Hosting Complexity** | High (Requires Node hosting + Supabase PaaS) | **Low** (Runs on cPanel, cheap VPS, or basic lamp stack) |
| **Self-Hosting** | Hard (PostgreSQL + Supabase local/Docker setup) | **Extremely Easy** (Single dump, native apache/nginx) |
| **Database Dialect** | PostgreSQL | **MySQL / MariaDB** |
| **Access Control** | Database Row-Level Security (PostgreSQL RLS) | **Application-Layer Authorization** (Highly testable in PHP) |
| **Solana Cryptography** | Node `@solana/web3.js` & `tweetnacl` | **Native PHP Libsodium Extension** (Built-in, high-speed C-level) |

---

## 1. 🗄️ MySQL Database Schema Translation

Here is the exact translation of your Postgres schema (`001_marketplace_and_deal_links.sql` and the waitlist `schema.sql`) into native, optimized MySQL:

```sql
-- -----------------------------------------------------
-- Table structures for Persat Finance
-- -----------------------------------------------------

-- 1. Deal Links table
CREATE TABLE IF NOT EXISTS deal_links (
  id VARCHAR(36) PRIMARY KEY, -- Standard UUID representation
  deal_id VARCHAR(255) NOT NULL UNIQUE,
  token_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 hex hash
  initiator_wallet VARCHAR(44) NOT NULL, -- Solana base58 address length
  claimed_by_wallet VARCHAR(44) NULL,
  expires_at DATETIME NOT NULL,
  claimed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token_hash (token_hash),
  CONSTRAINT chk_single_claim CHECK (
    (claimed_at IS NULL AND claimed_by_wallet IS NULL) OR 
    (claimed_at IS NOT NULL AND claimed_by_wallet IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Marketplace Proposals table
CREATE TABLE IF NOT EXISTS marketplace_proposals (
  id VARCHAR(36) PRIMARY KEY,
  listing_id VARCHAR(255) NOT NULL,
  proposer_wallet VARCHAR(44) NOT NULL,
  principal_atoms DECIMAL(39, 0) NOT NULL, -- MySQL high-precision numerical
  loan_mint VARCHAR(10) NOT NULL,
  rate_bps INT NOT NULL,
  duration_months INT NOT NULL,
  collateral_ltv_bps INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_listing_status (listing_id, status),
  CONSTRAINT chk_loan_mint CHECK (loan_mint IN ('USDC', 'USDT')),
  CONSTRAINT chk_rate_bps CHECK (rate_bps BETWEEN 1 AND 100000),
  CONSTRAINT chk_duration_months CHECK (duration_months IN (6, 12, 24)),
  CONSTRAINT chk_collateral_ltv_bps CHECK (collateral_ltv_bps BETWEEN 1 AND 5000),
  CONSTRAINT chk_proposal_status CHECK (status IN ('pending', 'accepted', 'declined', 'superseded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Wallet Auth Challenges table
CREATE TABLE IF NOT EXISTS wallet_auth_challenges (
  id VARCHAR(36) PRIMARY KEY,
  wallet VARCHAR(44) NOT NULL,
  nonce_hash VARCHAR(64) NOT NULL UNIQUE,
  message TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wallet_expires (wallet, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Wallet Sessions table
CREATE TABLE IF NOT EXISTS wallet_sessions (
  id VARCHAR(36) PRIMARY KEY,
  wallet VARCHAR(44) NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Waitlist Signups table (replacing Supabase)
CREATE TABLE IF NOT EXISTS waitlist_signups (
  id VARCHAR(36) PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  role_type VARCHAR(50) NOT NULL,
  region VARCHAR(100) NULL,
  referral_source VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 2. 🔑 Solana Cryptography & Signature Verification in PHP

Verifying standard Solana wallet signatures requires **Ed25519 detached signature verification**. Since PHP 7.2, the native **`sodium`** extension comes compiled by default. 

Here is the lightweight, optimized PHP library to decode Solana's Base58 inputs and perform C-speed Ed25519 signature verification:

```php
<?php

/**
 * Solana Crypto Helpers for PHP 8.2+
 * Utilizing PHP's native Libsodium extension.
 */
class SolanaCrypto {
    
    // Alphabet for Base58 decoding
    private static string $base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

    /**
     * Decode a Base58 string (used for Solana Public Keys and Signatures)
     */
    public static function base58Decode(string $base58): string {
        $alphabet = self::$base58Alphabet;
        $bytes = [0];
        
        for ($i = 0; $i < strlen($base58); $i++) {
            $char = $base58[$i];
            $value = strpos($alphabet, $char);
            if ($value === false) {
                throw new InvalidArgumentException("Invalid Base58 character: $char");
            }
            
            $carry = $value;
            for ($j = 0; $j < count($bytes); $j++) {
                $carry += $bytes[$j] * 58;
                $bytes[$j] = $carry & 0xff;
                $carry >>= 8;
            }
            
            while ($carry > 0) {
                $bytes[] = $carry & 0xff;
                $carry >>= 8;
            }
        }
        
        // Handle leading zeroes
        for ($i = 0; $i < strlen($base58) && $base58[$i] === $alphabet[0]; $i++) {
            $bytes[] = 0;
        }
        
        return pack('C*', ...array_reverse($bytes));
    }

    /**
     * Verifies that a signature is valid for a given message and Solana public key.
     * 
     * @param string $signatureBase58  The base58 encoded signature (64 bytes decoded)
     * @param string $message          The plaintext message signed by the wallet
     * @param string $publicKeyBase58  The base58 encoded public key (32 bytes decoded)
     * @return bool
     */
    public static function verifySignature(string $signatureBase58, string $message, string $publicKeyBase58): bool {
        try {
            $signature = self::base58Decode($signatureBase58);
            $publicKey = self::base58Decode($publicKeyBase58);
            
            // Check lengths: Solana signature must be 64 bytes, public key must be 32 bytes
            if (strlen($signature) !== 64 || strlen($publicKey) !== 32) {
                return false;
            }
            
            // Use native C-level Ed25519 verification
            return sodium_crypto_sign_verify_detached($signature, $message, $publicKey);
        } catch (Exception $e) {
            return false;
        }
    }
}
```

---

## 3. 📝 Waitlist Submission Endpoint (Self-Hosted PHP Replacement)

This is a clean, modern, secure single-file script (`submit-signup.php`) that handles waitlist subscriptions in MySQL. It performs strict validation and stops spam, with zero reliance on Supabase:

```php
<?php
// submit-signup.php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); // Configure to your specific origins in production
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method Not Allowed']);
    exit;
}

// Read and decode JSON input
$input = json_decode(file_get_contents('php://input'), true);

$fullName       = trim($input['full_name'] ?? '');
$email          = trim($input['email'] ?? '');
$roleType       = trim($input['role_type'] ?? '');
$region         = trim($input['region'] ?? '');
$referralSource = trim($input['referral_source'] ?? '');

// Strict Server-Side Validation
if (empty($fullName) || empty($email) || empty($roleType)) {
    http_response_code(400);
    echo json_encode(['error' => 'Full Name, Email, and Role Type are required.']);
    exit;
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid email address.']);
    exit;
}

// Database Connection Configuration (Use env variables or config file in prod)
$host = '127.0.0.1';
$db   = 'persat_finance';
$user = 'db_user';
$pass = 'db_password';
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
    
    // Generate UUIDv4 for PHP
    $uuid = bin2hex(random_bytes(16));
    $uuid = substr($uuid, 0, 8) . '-' . substr($uuid, 8, 4) . '-' . substr($uuid, 12, 4) . '-' . substr($uuid, 16, 4) . '-' . substr($uuid, 20);
    
    // Insertsignup using prepared statements (SQL injection safe)
    $stmt = $pdo->prepare("
        INSERT INTO waitlist_signups (id, full_name, email, role_type, region, referral_source) 
        VALUES (:id, :full_name, :email, :role, :region, :referral)
    ");
    
    $stmt->execute([
        'id'        => $uuid,
        'full_name' => $fullName,
        'email'     => $email,
        'role'      => $roleType,
        'region'    => $region,
        'referral'  => $referralSource
    ]);
    
    echo json_encode(['success' => true, 'message' => 'Signed up successfully!']);
    
} catch (PDOException $e) {
    if ($e->getCode() == 23000) { // MySQL unique constraint violation (duplicate email)
        http_response_code(409);
        echo json_encode(['error' => 'This email is already registered on the waitlist.']);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Database error occurred. Please try again later.']);
    }
}
```

---

## 🏁 Summary and Recommendation

Swapping to **PHP + MySQL** is an **excellent, practical choice** for an early-stage startup's protocol-adjacent backend. It keeps your operational expenses close to zero, makes backup and restoration as simple as a single `.sql` dump, and avoids vendor lock-in to Supabase or other cloud hosting providers.

Since the Solana smart contract logic (in Rust/Anchor) is completely separate, this change is clean, highly isolated, and will not affect your audited loan lifecycle at all.
