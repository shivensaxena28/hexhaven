-- HexHaven database schema.
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query)
-- or with the Supabase CLI: supabase db push.

-- One row per game/lobby, keyed by the 6-character lobby code. The whole
-- canonical game state lives in the `state` JSON column; the host writes it
-- after every validated action so players can reconnect and resume.
create table if not exists public.games (
  code       text primary key check (code ~ '^[A-Z0-9]{6}$'),
  state      jsonb not null,
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Row Level Security is enabled on every table. HexHaven has no accounts by
-- design (players are identified by a display name and an ephemeral client
-- id), so the policies below deliberately allow the anon role to read and
-- write game rows — the lobby code is the only shared secret. Delete is NOT
-- granted; cleanup happens via the scheduled job below or manually.
alter table public.games enable row level security;

drop policy if exists "anon can read games" on public.games;
create policy "anon can read games"
  on public.games for select
  to anon
  using (true);

drop policy if exists "anon can create games" on public.games;
create policy "anon can create games"
  on public.games for insert
  to anon
  with check (true);

drop policy if exists "anon can update games" on public.games;
create policy "anon can update games"
  on public.games for update
  to anon
  using (true)
  with check (true);

-- Optional housekeeping: remove games untouched for 7 days.
-- Requires the pg_cron extension (Dashboard -> Database -> Extensions).
-- select cron.schedule(
--   'purge-stale-games',
--   '0 4 * * *',
--   $$delete from public.games where updated_at < now() - interval '7 days'$$
-- );
