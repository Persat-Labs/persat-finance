-- =====================================================
-- Persat Finance — MySQL 8.0+ Schema
-- Generated from docs/php-mysql-backend-blueprint.md
-- =====================================================

CREATE DATABASE IF NOT EXISTS persat_finance
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE persat_finance;

-- 1. Deal Links Table
CREATE TABLE IF NOT EXISTS deal_links (
  id VARCHAR(36) PRIMARY KEY,
  deal_id VARCHAR(255) NOT NULL UNIQUE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  initiator_wallet VARCHAR(44) NOT NULL,
  claimed_by_wallet VARCHAR(44) NULL,
  terms_json JSON NULL,
  expires_at DATETIME NOT NULL,
  claimed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token_hash (token_hash),
  INDEX idx_initiator (initiator_wallet)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Marketplace Proposals Table
CREATE TABLE IF NOT EXISTS marketplace_proposals (
  id VARCHAR(36) PRIMARY KEY,
  listing_id VARCHAR(255) NOT NULL,
  proposer_wallet VARCHAR(44) NOT NULL,
  principal_atoms DECIMAL(39, 0) NOT NULL,
  loan_mint VARCHAR(10) NOT NULL,
  rate_bps INT NOT NULL,
  duration_months INT NOT NULL,
  collateral_ltv_bps INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_listing_status (listing_id, status),
  CONSTRAINT chk_loan_mint CHECK (loan_mint IN ('USDC', 'USDT')),
  CONSTRAINT chk_rate_bps CHECK (rate_bps BETWEEN 1 AND 100000),
  CONSTRAINT chk_duration_months CHECK (duration_months BETWEEN 1 AND 60),
  CONSTRAINT chk_collateral_ltv_bps CHECK (collateral_ltv_bps BETWEEN 1 AND 5000),
  CONSTRAINT chk_proposal_status CHECK (status IN ('pending', 'accepted', 'declined', 'superseded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Wallet Auth Challenges Table
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

-- 4. Wallet Sessions Table
CREATE TABLE IF NOT EXISTS wallet_sessions (
  id VARCHAR(36) PRIMARY KEY,
  wallet VARCHAR(44) NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. User Profiles Table (Usernames, Reputation, Bio)
CREATE TABLE IF NOT EXISTS user_profiles (
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
  INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Direct Messages & Negotiation Table
CREATE TABLE IF NOT EXISTS direct_messages (
  id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(90) NOT NULL,
  sender_wallet VARCHAR(44) NOT NULL,
  recipient_wallet VARCHAR(44) NOT NULL,
  message_text TEXT NOT NULL,
  deal_proposal_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  INDEX idx_conversation (conversation_id, created_at),
  INDEX idx_recipient (recipient_wallet, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
