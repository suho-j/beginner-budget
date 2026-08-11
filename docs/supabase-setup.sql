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

-- Atomically replace one authenticated user's settings and transaction rows.
drop function if exists public.replace_budget_state(integer, jsonb, jsonb);

create or replace function public.replace_budget_state(
  p_monthly_budget integer,
  p_category_budgets jsonb,
  p_transactions jsonb,
  p_expected_updated_at timestamptz,
  p_expected_transactions jsonb
)
returns table (uploaded_count integer, updated_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_settings_exists boolean := false;
  v_current_updated_at timestamptz;
  v_current_transactions jsonb;
  v_new_updated_at timestamptz := clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_monthly_budget is null or p_monthly_budget <= 0 then
    raise exception 'monthly budget must be a positive integer' using errcode = '22023';
  end if;
  if p_category_budgets is null or jsonb_typeof(p_category_budgets) <> 'object' then
    raise exception 'category budgets must be a JSON object' using errcode = '22023';
  end if;
  if p_transactions is null or jsonb_typeof(p_transactions) <> 'array' then
    raise exception 'transactions must be a JSON array' using errcode = '22023';
  end if;
  if p_expected_transactions is null or jsonb_typeof(p_expected_transactions) <> 'array' then
    raise exception 'expected transactions must be a JSON array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_each(p_category_budgets) as category_entry(key, value)
    where left(category_entry.key, 2) <> '__'
      and not (
        jsonb_typeof(category_entry.value) = 'number'
        and category_entry.value::text ~ '^[0-9]+$'
        and (category_entry.value::text)::numeric between 1 and 2147483647
      )
  ) then
    raise exception 'category budget amounts must be positive integers' using errcode = '22023';
  end if;

  if p_category_budgets ? '__month_start_day' and not (
    jsonb_typeof(p_category_budgets -> '__month_start_day') = 'number'
    and (p_category_budgets -> '__month_start_day')::text ~ '^[0-9]+$'
    and ((p_category_budgets -> '__month_start_day')::text)::integer between 1 and 31
  ) then
    raise exception 'month start day must be between 1 and 31' using errcode = '22023';
  end if;

  if p_category_budgets ? '__monthly_budgets'
    and jsonb_typeof(p_category_budgets -> '__monthly_budgets') <> 'object' then
    raise exception 'monthly budgets must be a JSON object' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_transactions || p_expected_transactions) as transaction_row
    where jsonb_typeof(transaction_row) <> 'object'
      or jsonb_typeof(transaction_row -> 'id') <> 'string'
      or nullif(btrim(transaction_row ->> 'id'), '') is null
      or jsonb_typeof(transaction_row -> 'date') <> 'string'
      or coalesce(transaction_row ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char(to_date(transaction_row ->> 'date', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> transaction_row ->> 'date'
      or jsonb_typeof(transaction_row -> 'type') <> 'string'
      or coalesce(transaction_row ->> 'type', '') not in ('income', 'expense')
      or jsonb_typeof(transaction_row -> 'category') <> 'string'
      or nullif(btrim(transaction_row ->> 'category'), '') is null
      or jsonb_typeof(transaction_row -> 'amount') <> 'number'
      or coalesce(transaction_row ->> 'amount', '') !~ '^[0-9]+$'
      or (transaction_row ->> 'amount')::numeric not between 1 and 2147483647
      or (transaction_row ? 'source' and jsonb_typeof(transaction_row -> 'source') <> 'string')
      or coalesce(transaction_row ->> 'source', 'user') not in ('user', 'sample')
      or (transaction_row ? 'memo' and jsonb_typeof(transaction_row -> 'memo') <> 'string')
      or char_length(coalesce(transaction_row ->> 'memo', '')) > 80
  ) then
    raise exception 'transaction rows are invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_transactions) as transaction_row
    group by transaction_row ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'duplicate transaction ids are not allowed' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_expected_transactions) as transaction_row
    group by transaction_row ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'duplicate expected transaction ids are not allowed' using errcode = '22023';
  end if;

  select settings.updated_at
  into v_current_updated_at
  from public.budget_settings as settings
  where settings.user_id = v_user_id
  for update;
  v_settings_exists := found;

  if (v_settings_exists and v_current_updated_at is distinct from p_expected_updated_at)
    or (not v_settings_exists and p_expected_updated_at is not null) then
    raise exception '다른 브라우저에서 가계부 데이터가 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.'
      using errcode = '40001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', transaction_row.id,
        'date', to_char(transaction_row.date, 'YYYY-MM-DD'),
        'type', transaction_row.type,
        'category', transaction_row.category,
        'amount', transaction_row.amount,
        'memo', coalesce(transaction_row.memo, ''),
        'source', coalesce(transaction_row.source, 'user')
      ) order by transaction_row.id collate "C"
    ),
    '[]'::jsonb
  )
  into v_current_transactions
  from public.transactions as transaction_row
  where transaction_row.user_id = v_user_id;

  if v_current_transactions is distinct from p_expected_transactions then
    raise exception '다른 브라우저에서 가계부 데이터가 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.'
      using errcode = '40001';
  end if;

  if v_settings_exists then
    update public.budget_settings as settings
    set
      monthly_budget = p_monthly_budget,
      category_budgets = p_category_budgets,
      updated_at = v_new_updated_at
    where settings.user_id = v_user_id
      and settings.updated_at = p_expected_updated_at;
    if not found then
      raise exception '다른 브라우저에서 가계부 데이터가 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.'
        using errcode = '40001';
    end if;
  else
    insert into public.budget_settings (
      user_id,
      monthly_budget,
      category_budgets,
      updated_at
    ) values (
      v_user_id,
      p_monthly_budget,
      p_category_budgets,
      v_new_updated_at
    )
    on conflict (user_id) do nothing;
    if not found then
      raise exception '다른 브라우저에서 가계부 데이터가 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.'
        using errcode = '40001';
    end if;
  end if;

  delete from public.transactions
  where user_id = v_user_id;

  insert into public.transactions (
    id,
    user_id,
    date,
    type,
    category,
    amount,
    memo,
    source
  )
  select
    transaction_row.id,
    v_user_id,
    transaction_row.date,
    transaction_row.type,
    transaction_row.category,
    transaction_row.amount,
    coalesce(transaction_row.memo, ''),
    coalesce(transaction_row.source, 'user')
  from jsonb_to_recordset(p_transactions) as transaction_row(
    id text,
    date date,
    type text,
    category text,
    amount integer,
    memo text,
    source text
  );

  return query select jsonb_array_length(p_transactions)::integer, v_new_updated_at;
end;
$function$;

revoke all on function public.replace_budget_state(integer, jsonb, jsonb, timestamptz, jsonb) from public;
revoke all on function public.replace_budget_state(integer, jsonb, jsonb, timestamptz, jsonb) from anon;
grant execute on function public.replace_budget_state(integer, jsonb, jsonb, timestamptz, jsonb) to authenticated;

-- Atomically replace sample rows inside one validated budget period.
create or replace function public.replace_budget_samples(
  p_period_start date,
  p_period_end date,
  p_transactions jsonb
)
returns table (replaced_count integer)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_period_start is null
    or p_period_end is null
    or p_period_end < p_period_start
    or (p_period_end - p_period_start) not between 27 and 30 then
    raise exception 'sample period must contain 28 to 31 days' using errcode = '22023';
  end if;
  if p_transactions is null
    or jsonb_typeof(p_transactions) <> 'array'
    or jsonb_array_length(p_transactions) <> 6 then
    raise exception 'exactly six sample transactions are required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_transactions) as transaction_row
    where jsonb_typeof(transaction_row) <> 'object'
      or jsonb_typeof(transaction_row -> 'id') <> 'string'
      or nullif(btrim(transaction_row ->> 'id'), '') is null
      or jsonb_typeof(transaction_row -> 'date') <> 'string'
      or coalesce(transaction_row ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char(to_date(transaction_row ->> 'date', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> transaction_row ->> 'date'
      or (transaction_row ->> 'date')::date not between p_period_start and p_period_end
      or jsonb_typeof(transaction_row -> 'type') <> 'string'
      or coalesce(transaction_row ->> 'type', '') not in ('income', 'expense')
      or jsonb_typeof(transaction_row -> 'category') <> 'string'
      or nullif(btrim(transaction_row ->> 'category'), '') is null
      or jsonb_typeof(transaction_row -> 'amount') <> 'number'
      or coalesce(transaction_row ->> 'amount', '') !~ '^[0-9]+$'
      or (transaction_row ->> 'amount')::numeric not between 1 and 2147483647
      or jsonb_typeof(transaction_row -> 'source') <> 'string'
      or coalesce(transaction_row ->> 'source', '') <> 'sample'
      or (transaction_row ? 'memo' and jsonb_typeof(transaction_row -> 'memo') <> 'string')
      or char_length(coalesce(transaction_row ->> 'memo', '')) > 80
  ) then
    raise exception 'sample transaction rows are invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_transactions) as transaction_row
    group by transaction_row ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'duplicate transaction ids are not allowed' using errcode = '22023';
  end if;

  delete from public.transactions
  where user_id = v_user_id
    and source = 'sample'
    and date between p_period_start and p_period_end;

  insert into public.transactions (
    id,
    user_id,
    date,
    type,
    category,
    amount,
    memo,
    source
  )
  select
    transaction_row.id,
    v_user_id,
    transaction_row.date,
    transaction_row.type,
    transaction_row.category,
    transaction_row.amount,
    coalesce(transaction_row.memo, ''),
    'sample'
  from jsonb_to_recordset(p_transactions) as transaction_row(
    id text,
    date date,
    type text,
    category text,
    amount integer,
    memo text,
    source text
  );

  return query select jsonb_array_length(p_transactions)::integer;
end;
$function$;

revoke all on function public.replace_budget_samples(date, date, jsonb) from public;
revoke all on function public.replace_budget_samples(date, date, jsonb) from anon;
grant execute on function public.replace_budget_samples(date, date, jsonb) to authenticated;
