-- Supabase preview data isolation for beginner-budget.
-- Apply this file manually in the existing Supabase project's SQL Editor.
-- Production tables are read-only snapshot sources in the seed section below.

create table if not exists public.preview_budget_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget integer not null default 500000 check (monthly_budget > 0),
  category_budgets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.preview_transactions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('income', 'expense')),
  category text not null,
  amount integer not null check (amount > 0),
  memo text not null default '',
  source text not null default 'user',
  created_at timestamptz not null default now(),
  constraint preview_transactions_id_canonical
    check (id ~ '^[A-Za-z0-9._:-]+$')
);

create or replace function public.set_preview_budget_settings_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT' then
    new.updated_at := clock_timestamp();
  else
    new.updated_at := greatest(
      clock_timestamp(),
      old.updated_at + interval '1 microsecond'
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.set_preview_budget_settings_updated_at() from public;
revoke all on function public.set_preview_budget_settings_updated_at() from anon;
grant execute on function public.set_preview_budget_settings_updated_at() to authenticated;

drop trigger if exists set_preview_budget_settings_updated_at on public.preview_budget_settings;
create trigger set_preview_budget_settings_updated_at
before insert or update on public.preview_budget_settings
for each row
execute function public.set_preview_budget_settings_updated_at();

alter table public.preview_budget_settings enable row level security;
alter table public.preview_transactions enable row level security;

drop policy if exists "Preview users can select own settings" on public.preview_budget_settings;
drop policy if exists "Preview users can insert own settings" on public.preview_budget_settings;
drop policy if exists "Preview users can update own settings" on public.preview_budget_settings;
drop policy if exists "Preview users can select own transactions" on public.preview_transactions;
drop policy if exists "Preview users can insert own transactions" on public.preview_transactions;
drop policy if exists "Preview users can update own transactions" on public.preview_transactions;
drop policy if exists "Preview users can delete own transactions" on public.preview_transactions;

create policy "Preview users can select own settings"
on public.preview_budget_settings
for select
to authenticated
using (auth.uid() = user_id);

create policy "Preview users can insert own settings"
on public.preview_budget_settings
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Preview users can update own settings"
on public.preview_budget_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Preview users can select own transactions"
on public.preview_transactions
for select
to authenticated
using (auth.uid() = user_id);

create policy "Preview users can insert own transactions"
on public.preview_transactions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Preview users can update own transactions"
on public.preview_transactions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Preview users can delete own transactions"
on public.preview_transactions
for delete
to authenticated
using (auth.uid() = user_id);

revoke all on table public.preview_budget_settings from public;
revoke all on table public.preview_budget_settings from anon;
revoke all on table public.preview_budget_settings from authenticated;
revoke all on table public.preview_transactions from public;
revoke all on table public.preview_transactions from anon;
revoke all on table public.preview_transactions from authenticated;
grant select, insert, update on table public.preview_budget_settings to authenticated;
grant select, insert, update, delete on table public.preview_transactions to authenticated;

-- Run the three preflight queries separately and review their results before
-- executing the snapshot inserts. Production objects below are SELECT sources only.

-- Preflight 1: deterministic legacy ID mapping.
select
  user_id,
  id as production_id,
  'tx-migrated-' || md5(user_id::text || ':' || id) as preview_id
from public.transactions
where id !~ '^[A-Za-z0-9._:-]+$'
order by user_id, id;

-- Preflight 2: candidate ID collision audit; expected result is zero rows.
with preview_candidates as (
  select
    user_id,
    id as production_id,
    case
      when id ~ '^[A-Za-z0-9._:-]+$' then id
      else 'tx-migrated-' || md5(user_id::text || ':' || id)
    end as preview_id
  from public.transactions
)
select
  preview_id,
  count(*) as candidate_count,
  array_agg(production_id order by production_id) as production_ids
from preview_candidates
group by preview_id
having count(*) > 1
order by preview_id;

-- Preflight 3: existing preview row collision audit.
-- Zero rows are expected before the first seed. On a re-run, rows intentionally
-- edited in preview can appear here; ON CONFLICT DO NOTHING preserves those edits.
with preview_candidates as (
  select
    case
      when id ~ '^[A-Za-z0-9._:-]+$' then id
      else 'tx-migrated-' || md5(user_id::text || ':' || id)
    end as preview_id,
    user_id,
    date,
    type,
    category,
    amount,
    memo,
    source
  from public.transactions
)
select
  candidate.preview_id,
  candidate.user_id as production_user_id,
  existing.user_id as preview_user_id
from preview_candidates as candidate
join public.preview_transactions as existing
  on existing.id = candidate.preview_id
where row(
  existing.user_id,
  existing.date,
  existing.type,
  existing.category,
  existing.amount,
  existing.memo,
  existing.source
) is distinct from row(
  candidate.user_id,
  candidate.date,
  candidate.type,
  candidate.category,
  candidate.amount,
  candidate.memo,
  candidate.source
)
order by candidate.preview_id;

-- One-time production snapshot. Re-running is safe: existing preview rows are
-- never overwritten, including rows changed after the first copy.
insert into public.preview_budget_settings (
  user_id,
  monthly_budget,
  category_budgets,
  updated_at
)
select
  user_id,
  monthly_budget,
  category_budgets,
  updated_at
from public.budget_settings
on conflict (user_id) do nothing;

insert into public.preview_transactions (
  id,
  user_id,
  date,
  type,
  category,
  amount,
  memo,
  source,
  created_at
)
select
  case
    when id ~ '^[A-Za-z0-9._:-]+$' then id
    else 'tx-migrated-' || md5(user_id::text || ':' || id)
  end,
  user_id,
  date,
  type,
  category,
  amount,
  memo,
  source,
  created_at
from public.transactions
on conflict (id) do nothing;

-- Atomically replace one authenticated user's preview settings and transactions.
drop function if exists public.replace_preview_budget_state(integer, jsonb, jsonb);

create or replace function public.replace_preview_budget_state(
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
  v_expected_transactions jsonb;
  v_current_transactions jsonb;
  v_new_updated_at timestamptz;
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
      or (transaction_row ->> 'id') !~ '^[A-Za-z0-9._:-]+$'
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
  into v_expected_transactions
  from jsonb_to_recordset(p_expected_transactions) as transaction_row(
    id text,
    date date,
    type text,
    category text,
    amount integer,
    memo text,
    source text
  );

  select settings.updated_at
  into v_current_updated_at
  from public.preview_budget_settings as settings
  where settings.user_id = v_user_id
  for update;
  v_settings_exists := found;

  if (v_settings_exists and v_current_updated_at is distinct from p_expected_updated_at)
    or (not v_settings_exists and p_expected_updated_at is not null) then
    raise exception '다른 브라우저에서 가계부 데이터가 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.'
      using errcode = '40001';
  end if;

  lock table public.preview_transactions in share row exclusive mode;

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
  from public.preview_transactions as transaction_row
  where transaction_row.user_id = v_user_id;

  if v_current_transactions is distinct from v_expected_transactions then
    raise exception '다른 브라우저에서 가계부 데이터가 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.'
      using errcode = '40001';
  end if;

  if v_settings_exists then
    update public.preview_budget_settings as settings
    set
      monthly_budget = p_monthly_budget,
      category_budgets = p_category_budgets
    where settings.user_id = v_user_id
      and settings.updated_at = p_expected_updated_at
    returning settings.updated_at into v_new_updated_at;
    if not found then
      raise exception '다른 브라우저에서 가계부 데이터가 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.'
        using errcode = '40001';
    end if;
  else
    insert into public.preview_budget_settings as settings (
      user_id,
      monthly_budget,
      category_budgets
    ) values (
      v_user_id,
      p_monthly_budget,
      p_category_budgets
    )
    on conflict (user_id) do nothing
    returning settings.updated_at into v_new_updated_at;
    if not found then
      raise exception '다른 브라우저에서 가계부 데이터가 변경됐어요. 클라우드 데이터를 다시 불러와 주세요.'
        using errcode = '40001';
    end if;
  end if;

  delete from public.preview_transactions
  where user_id = v_user_id;

  insert into public.preview_transactions (
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

revoke all on function public.replace_preview_budget_state(integer, jsonb, jsonb, timestamptz, jsonb) from public;
revoke all on function public.replace_preview_budget_state(integer, jsonb, jsonb, timestamptz, jsonb) from anon;
grant execute on function public.replace_preview_budget_state(integer, jsonb, jsonb, timestamptz, jsonb) to authenticated;

-- Remove obsolete preview sample-only replacement RPC overloads.
drop function if exists public.replace_preview_budget_samples(date, date, jsonb);
drop function if exists public.replace_preview_budget_samples(date, date, jsonb, jsonb);
