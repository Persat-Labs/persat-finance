-- Faucet claims with 24h cooldown to prevent abuse under pump
create table if not exists faucet_claims (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  asset text not null,
  claimed_at timestamptz not null default now()
);
create index if not exists faucet_claims_wallet_asset_time on faucet_claims(wallet, asset, claimed_at desc);
create index if not exists faucet_claims_recent on faucet_claims(claimed_at desc) where claimed_at > now() - interval '7 days';
