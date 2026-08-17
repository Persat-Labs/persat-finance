-- Persat Finance waitlist database schema
-- Run this entire file in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  role_type text not null,
  region text,
  referral_source text,
  created_at timestamptz not null default now(),
  constraint waitlist_signups_email_key unique (email)
);

-- The public client can submit, but it cannot read, edit, or delete waitlist rows.
alter table public.waitlist_signups enable row level security;
revoke all on table public.waitlist_signups from anon, authenticated;
grant insert on table public.waitlist_signups to anon, authenticated;

drop policy if exists "Public can submit waitlist signups" on public.waitlist_signups;
create policy "Public can submit waitlist signups"
on public.waitlist_signups
for insert
to anon, authenticated
with check (true);

-- Admin access is an explicit allowlist. The dashboard uses Supabase Auth
-- email/password sessions; only rows listed here can read the waitlist.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;
grant select on table public.admin_users to authenticated;

drop policy if exists "Admins can see their own allowlist record" on public.admin_users;
create policy "Admins can see their own allowlist record"
on public.admin_users
for select
to authenticated
using (user_id = auth.uid());

-- This is the only SELECT policy on the waitlist table. It is available to
-- authenticated users only when their auth.uid() appears in admin_users.
grant select on table public.waitlist_signups to authenticated;
drop policy if exists "Approved admins can read waitlist signups" on public.waitlist_signups;
create policy "Approved admins can read waitlist signups"
on public.waitlist_signups
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = auth.uid()
  )
);

-- Enable Supabase Realtime for INSERT notifications used by the dashboard.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'waitlist_signups'
  ) then
    alter publication supabase_realtime add table public.waitlist_signups;
  end if;
end
$$;

-- A data-free read-only RPC gives the GitHub keep-alive workflow a safe GET
-- endpoint. It touches Postgres without granting public SELECT on signups.
create or replace function public.keep_alive()
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object('ok', true);
$$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
