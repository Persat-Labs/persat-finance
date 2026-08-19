-- Persat Finance backend state. This stores no funds and never stores raw deal-link tokens.
create table if not exists deal_links (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null unique,
  token_hash text not null unique,
  initiator_wallet text not null,
  claimed_by_wallet text,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint single_claim check ((claimed_at is null and claimed_by_wallet is null) or (claimed_at is not null and claimed_by_wallet is not null))
);
create index if not exists deal_links_active_lookup on deal_links(token_hash) where claimed_at is null;

create table if not exists marketplace_proposals (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null,
  proposer_wallet text not null,
  principal_atoms numeric(39, 0) not null check (principal_atoms > 0),
  loan_mint text not null check (loan_mint in ('USDC', 'USDT')),
  rate_bps integer not null check (rate_bps between 1 and 100000),
  duration_months integer not null check (duration_months in (6, 12, 24)),
  collateral_ltv_bps integer not null check (collateral_ltv_bps between 1 and 5000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'superseded')),
  created_at timestamptz not null default now()
);
create index if not exists marketplace_proposals_listing_status on marketplace_proposals(listing_id, status);
-- Deliberately no message, description, URL, social handle, or contact column exists.

create table if not exists wallet_auth_challenges (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  nonce_hash text not null unique,
  message text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists wallet_auth_challenges_lookup on wallet_auth_challenges(wallet, expires_at) where used_at is null;

create table if not exists wallet_sessions (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists wallet_sessions_lookup on wallet_sessions(token_hash) where revoked_at is null;
