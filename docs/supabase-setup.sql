-- Supabase SQL setup for beginner-budget
-- Run this in Supabase Dashboard → SQL Editor.

create table if not exists public.budget_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget integer not null default 500000 check (monthly_budget > 0),
  category_budgets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('income', 'expense')),
  category text not null,
  amount integer not null check (amount > 0),
  memo text not null default '',
  source text not null default 'user',
  created_at timestamptz not null default now()
);

alter table public.budget_settings enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "Users can read own settings" on public.budget_settings;
drop policy if exists "Users can insert own settings" on public.budget_settings;
drop policy if exists "Users can update own settings" on public.budget_settings;
drop policy if exists "Users can read own transactions" on public.transactions;
drop policy if exists "Users can insert own transactions" on public.transactions;
drop policy if exists "Users can update own transactions" on public.transactions;
drop policy if exists "Users can delete own transactions" on public.transactions;

create policy "Users can read own settings"
on public.budget_settings
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own settings"
on public.budget_settings
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own settings"
on public.budget_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can read own transactions"
on public.transactions
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own transactions"
on public.transactions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own transactions"
on public.transactions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own transactions"
on public.transactions
for delete
to authenticated
using (auth.uid() = user_id);
