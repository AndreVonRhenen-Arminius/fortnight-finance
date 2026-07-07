-- Fortnight Finance cloud schema
-- Run this entire file in Supabase: SQL Editor > New query > Run.

create table if not exists public.finance_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

alter table public.finance_state enable row level security;

drop policy if exists "Users can read only their finance state" on public.finance_state;
drop policy if exists "Users can insert only their finance state" on public.finance_state;
drop policy if exists "Users can update only their finance state" on public.finance_state;
drop policy if exists "Users can delete only their finance state" on public.finance_state;

revoke all on table public.finance_state from anon;
grant select, insert, update, delete on table public.finance_state to authenticated;

create policy "Users can read only their finance state"
on public.finance_state for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "Users can insert only their finance state"
on public.finance_state for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "Users can update only their finance state"
on public.finance_state for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "Users can delete only their finance state"
on public.finance_state for delete
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create index if not exists finance_state_updated_at_idx
on public.finance_state(updated_at desc);
