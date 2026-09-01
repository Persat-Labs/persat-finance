-- Persat Finance — user_profiles (Postgres-style migration for Node sidecar)
-- The authoritative MySQL schema is backend/php-deploy/schema.sql; this mirrors it
-- for the Node backend when PERSAT_DATABASE_URL points at Postgres.
-- NOTE: id is the opaque stable profile id (UUID). Primary identity remains the
-- Solana wallet address (wallet). username is UNIQUE across wallets.

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  wallet text not null unique,
  username text not null unique,
  display_name text not null,
  bio text,
  avatar_seed text,
  reputation_score integer not null default 100,
  total_deals integer not null default 0,
  active_loans integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_len check (char_length(username) between 3 and 20),
  constraint username_chars check (username ~ '^[a-z0-9_]+$')
);
create index if not exists user_profiles_username_lookup on user_profiles(username);
