-- Supabase V2 preview data isolation for beginner-budget.
-- Apply this file as one unit in the existing Supabase project's SQL Editor.
-- Production tables are read-only, consistently locked snapshot sources in the seed section.

create table if not exists public.preview_v2_budget_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget integer not null default 500000,
  category_budgets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint preview_v2_budget_settings_monthly_budget_positive
    check (monthly_budget > 0)
);

create table if not exists public.preview_v2_transactions (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null,
  category text not null,
  amount integer not null,
  memo text not null default '',
  source text not null default 'user',
  created_at timestamptz not null default now(),
  constraint preview_v2_transactions_id_canonical
    check (id ~ '^[A-Za-z0-9._:-]+$'),
  constraint preview_v2_transactions_type_allowed
    check (type in ('income', 'expense')),
  constraint preview_v2_transactions_amount_positive
    check (amount > 0),
  constraint preview_v2_transactions_user_id_id_pkey
    primary key (user_id, id)
);

create table if not exists public.preview_v2_seed_metadata (
  seed_key text primary key,
  completed_at timestamptz not null default clock_timestamp(),
  source_settings_count bigint not null,
  source_transactions_count bigint not null,
  constraint preview_v2_seed_metadata_source_settings_nonnegative
    check (source_settings_count >= 0),
  constraint preview_v2_seed_metadata_source_transactions_nonnegative
    check (source_transactions_count >= 0)
);

-- CREATE TABLE IF NOT EXISTS does not repair an older or partial table. Fail closed
-- before preflight reads, privileges, or seed work if any critical V2 shape drifted.
do $schema_guard$
declare
  v_columns text[];
  v_primary_key_columns text[];
  v_policy_count bigint;
  v_has_policy_drift boolean;
  v_unique_index_count bigint;
  v_has_unique_index_drift boolean;
begin
  select array_agg(
    attribute_record.attname
      || ':' || pg_catalog.format_type(attribute_record.atttypid, attribute_record.atttypmod)
      || ':' || case when attribute_record.attnotnull then 'true' else 'false' end
    order by attribute_record.attnum
  )
  into v_columns
  from pg_catalog.pg_attribute as attribute_record
  join pg_catalog.pg_class as class_record
    on class_record.oid = attribute_record.attrelid
  join pg_catalog.pg_namespace as namespace_record
    on namespace_record.oid = class_record.relnamespace
  where namespace_record.nspname = 'public'
    and class_record.relname = 'preview_v2_budget_settings'
    and class_record.relkind = 'r'
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;

  if v_columns is distinct from array['user_id:uuid:true', 'monthly_budget:integer:true', 'category_budgets:jsonb:true', 'updated_at:timestamp with time zone:true']::text[] then
    raise exception 'preview_v2_budget_settings column contract drifted' using errcode = '55000';
  end if;

  select array_agg(attribute_record.attname::text order by key_column.ordinality)
  into v_primary_key_columns
  from pg_catalog.pg_constraint as constraint_record
  cross join lateral unnest(constraint_record.conkey)
    with ordinality as key_column(attnum, ordinality)
  join pg_catalog.pg_attribute as attribute_record
    on attribute_record.attrelid = constraint_record.conrelid
    and attribute_record.attnum = key_column.attnum
  where constraint_record.conrelid = 'public.preview_v2_budget_settings'::regclass
    and constraint_record.contype = 'p';

  if v_primary_key_columns is distinct from array['user_id']::text[] then
    raise exception 'preview_v2_budget_settings primary key contract drifted' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.preview_v2_budget_settings'::regclass
      and constraint_record.contype = 'f'
      and constraint_record.convalidated
      and constraint_record.confrelid = 'auth.users'::regclass
      and constraint_record.confdeltype = 'c'
      and (
        select array_agg(attribute_record.attname::text order by key_column.ordinality)
        from unnest(constraint_record.conkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute as attribute_record
          on attribute_record.attrelid = constraint_record.conrelid
          and attribute_record.attnum = key_column.attnum
      ) = array['user_id']::text[]
      and (
        select array_agg(attribute_record.attname::text order by key_column.ordinality)
        from unnest(constraint_record.confkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute as attribute_record
          on attribute_record.attrelid = constraint_record.confrelid
          and attribute_record.attnum = key_column.attnum
      ) = array['id']::text[]
  ) then
    raise exception 'preview_v2_budget_settings auth.users foreign key drifted' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.preview_v2_budget_settings'::regclass
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and constraint_record.conname = 'preview_v2_budget_settings_monthly_budget_positive'
      and regexp_replace(
        pg_catalog.pg_get_constraintdef(constraint_record.oid, true),
        '\s+',
        '',
        'g'
      ) in ('CHECK(monthly_budget>0)', 'CHECK((monthly_budget>0))')
  ) then
    raise exception 'preview_v2_budget_settings budget check drifted' using errcode = '55000';
  end if;

  select array_agg(
    attribute_record.attname
      || ':' || pg_catalog.format_type(attribute_record.atttypid, attribute_record.atttypmod)
      || ':' || case when attribute_record.attnotnull then 'true' else 'false' end
    order by attribute_record.attnum
  )
  into v_columns
  from pg_catalog.pg_attribute as attribute_record
  join pg_catalog.pg_class as class_record
    on class_record.oid = attribute_record.attrelid
  join pg_catalog.pg_namespace as namespace_record
    on namespace_record.oid = class_record.relnamespace
  where namespace_record.nspname = 'public'
    and class_record.relname = 'preview_v2_transactions'
    and class_record.relkind = 'r'
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;

  if v_columns is distinct from array['id:text:true', 'user_id:uuid:true', 'date:date:true', 'type:text:true', 'category:text:true', 'amount:integer:true', 'memo:text:true', 'source:text:true', 'created_at:timestamp with time zone:true']::text[] then
    raise exception 'preview_v2_transactions column contract drifted' using errcode = '55000';
  end if;

  select array_agg(attribute_record.attname::text order by key_column.ordinality)
  into v_primary_key_columns
  from pg_catalog.pg_constraint as constraint_record
  cross join lateral unnest(constraint_record.conkey)
    with ordinality as key_column(attnum, ordinality)
  join pg_catalog.pg_attribute as attribute_record
    on attribute_record.attrelid = constraint_record.conrelid
    and attribute_record.attnum = key_column.attnum
  where constraint_record.conrelid = 'public.preview_v2_transactions'::regclass
    and constraint_record.contype = 'p';

  if v_primary_key_columns is distinct from array['user_id', 'id']::text[] then
    raise exception 'preview_v2_transactions primary key must be (user_id, id)' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.preview_v2_transactions'::regclass
      and constraint_record.contype = 'f'
      and constraint_record.convalidated
      and constraint_record.confrelid = 'auth.users'::regclass
      and constraint_record.confdeltype = 'c'
      and (
        select array_agg(attribute_record.attname::text order by key_column.ordinality)
        from unnest(constraint_record.conkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute as attribute_record
          on attribute_record.attrelid = constraint_record.conrelid
          and attribute_record.attnum = key_column.attnum
      ) = array['user_id']::text[]
      and (
        select array_agg(attribute_record.attname::text order by key_column.ordinality)
        from unnest(constraint_record.confkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute as attribute_record
          on attribute_record.attrelid = constraint_record.confrelid
          and attribute_record.attnum = key_column.attnum
      ) = array['id']::text[]
  ) then
    raise exception 'preview_v2_transactions auth.users foreign key drifted' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.preview_v2_transactions'::regclass
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and constraint_record.conname = 'preview_v2_transactions_id_canonical'
      and regexp_replace(
        replace(pg_catalog.pg_get_constraintdef(constraint_record.oid, true), '::text', ''),
        '\s+',
        '',
        'g'
      ) in (
        'CHECK(id~''^[A-Za-z0-9._:-]+$'')',
        'CHECK((id~''^[A-Za-z0-9._:-]+$''))'
      )
  ) then
    raise exception 'preview_v2_transactions canonical ID check drifted' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.preview_v2_transactions'::regclass
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and constraint_record.conname = 'preview_v2_transactions_type_allowed'
      and regexp_replace(
        replace(pg_catalog.pg_get_constraintdef(constraint_record.oid, true), '::text', ''),
        '\s+',
        '',
        'g'
      ) in (
        'CHECK(type=ANY(ARRAY[''income'',''expense'']))',
        'CHECK((type=ANY(ARRAY[''income'',''expense''])))'
      )
  ) then
    raise exception 'preview_v2_transactions type check drifted' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.preview_v2_transactions'::regclass
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and constraint_record.conname = 'preview_v2_transactions_amount_positive'
      and regexp_replace(
        pg_catalog.pg_get_constraintdef(constraint_record.oid, true),
        '\s+',
        '',
        'g'
      ) in ('CHECK(amount>0)', 'CHECK((amount>0))')
  ) then
    raise exception 'preview_v2_transactions amount check drifted' using errcode = '55000';
  end if;

  select array_agg(
    attribute_record.attname
      || ':' || pg_catalog.format_type(attribute_record.atttypid, attribute_record.atttypmod)
      || ':' || case when attribute_record.attnotnull then 'true' else 'false' end
    order by attribute_record.attnum
  )
  into v_columns
  from pg_catalog.pg_attribute as attribute_record
  join pg_catalog.pg_class as class_record
    on class_record.oid = attribute_record.attrelid
  join pg_catalog.pg_namespace as namespace_record
    on namespace_record.oid = class_record.relnamespace
  where namespace_record.nspname = 'public'
    and class_record.relname = 'preview_v2_seed_metadata'
    and class_record.relkind = 'r'
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;

  if v_columns is distinct from array['seed_key:text:true', 'completed_at:timestamp with time zone:true', 'source_settings_count:bigint:true', 'source_transactions_count:bigint:true']::text[] then
    raise exception 'preview_v2_seed_metadata column contract drifted' using errcode = '55000';
  end if;

  select array_agg(attribute_record.attname::text order by key_column.ordinality)
  into v_primary_key_columns
  from pg_catalog.pg_constraint as constraint_record
  cross join lateral unnest(constraint_record.conkey)
    with ordinality as key_column(attnum, ordinality)
  join pg_catalog.pg_attribute as attribute_record
    on attribute_record.attrelid = constraint_record.conrelid
    and attribute_record.attnum = key_column.attnum
  where constraint_record.conrelid = 'public.preview_v2_seed_metadata'::regclass
    and constraint_record.contype = 'p';

  if v_primary_key_columns is distinct from array['seed_key']::text[] then
    raise exception 'preview_v2_seed_metadata primary key contract drifted' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.preview_v2_seed_metadata'::regclass
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and constraint_record.conname = 'preview_v2_seed_metadata_source_settings_nonnegative'
      and regexp_replace(
        pg_catalog.pg_get_constraintdef(constraint_record.oid, true),
        '\s+',
        '',
        'g'
      ) in (
        'CHECK(source_settings_count>=0)',
        'CHECK((source_settings_count>=0))'
      )
  ) then
    raise exception 'preview_v2_seed_metadata settings count check drifted' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.preview_v2_seed_metadata'::regclass
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and constraint_record.conname = 'preview_v2_seed_metadata_source_transactions_nonnegative'
      and regexp_replace(
        pg_catalog.pg_get_constraintdef(constraint_record.oid, true),
        '\s+',
        '',
        'g'
      ) in (
        'CHECK(source_transactions_count>=0)',
        'CHECK((source_transactions_count>=0))'
      )
  ) then
    raise exception 'preview_v2_seed_metadata transaction count check drifted' using errcode = '55000';
  end if;

  with actual_unique_indexes as (
    select
      table_record.relname::text as table_name,
      index_record.indisprimary,
      index_record.indisvalid,
      index_record.indisready,
      index_record.indisexclusion,
      index_record.indexprs is null as has_no_expressions,
      index_record.indpred is null as has_no_predicate,
      index_record.indnkeyatts::integer as key_attribute_count,
      index_record.indnatts::integer as total_attribute_count,
      coalesce((
        select array_agg(attribute_record.attname::text order by key_column.ordinality)
        from unnest(index_record.indkey::smallint[])
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute as attribute_record
          on attribute_record.attrelid = index_record.indrelid
          and attribute_record.attnum = key_column.attnum
        where key_column.ordinality <= index_record.indnkeyatts
          and key_column.attnum > 0
      ), array[]::text[]) as key_columns
    from pg_catalog.pg_index as index_record
    join pg_catalog.pg_class as table_record
      on table_record.oid = index_record.indrelid
    join pg_catalog.pg_namespace as namespace_record
      on namespace_record.oid = table_record.relnamespace
    where index_record.indisunique
      and namespace_record.nspname = 'public'
      and table_record.relname in (
        'preview_v2_budget_settings',
        'preview_v2_transactions',
        'preview_v2_seed_metadata'
      )
  ),
  expected_unique_indexes (
    table_name,
    indisprimary,
    indisvalid,
    indisready,
    indisexclusion,
    has_no_expressions,
    has_no_predicate,
    key_attribute_count,
    total_attribute_count,
    key_columns
  ) as (
    values
      ('preview_v2_budget_settings', true, true, true, false, true, true, 1, 1, array['user_id']::text[]),
      ('preview_v2_transactions', true, true, true, false, true, true, 2, 2, array['user_id', 'id']::text[]),
      ('preview_v2_seed_metadata', true, true, true, false, true, true, 1, 1, array['seed_key']::text[])
  ),
  actual_unique_index_differences as (
    select * from actual_unique_indexes
    except
    select * from expected_unique_indexes
  ),
  expected_unique_index_differences as (
    select * from expected_unique_indexes
    except
    select * from actual_unique_indexes
  ),
  unique_index_differences as (
    select * from actual_unique_index_differences
    union all
    select * from expected_unique_index_differences
  )
  select
    (select count(*) from actual_unique_indexes),
    exists (select 1 from unique_index_differences)
  into v_unique_index_count, v_has_unique_index_drift;

  if v_unique_index_count <> 3 or v_has_unique_index_drift then
    raise exception 'preview V2 unique index contract drifted' using errcode = '55000';
  end if;

  with actual_policies as (
    select
      table_record.relname::text as table_name,
      policy_record.polname::text as policy_name,
      policy_record.polcmd::text as command,
      policy_record.polpermissive as is_permissive,
      coalesce((
        select array_agg(role_record.rolname::text order by role_record.rolname::text)
        from unnest(policy_record.polroles) as policy_role(role_oid)
        join pg_catalog.pg_roles as role_record
          on role_record.oid = policy_role.role_oid
      ), array[]::text[]) as roles,
      coalesce(
        trim(both '()' from regexp_replace(
          pg_catalog.pg_get_expr(policy_record.polqual, policy_record.polrelid),
          '\s+',
          '',
          'g'
        )),
        ''
      ) as using_expression,
      coalesce(
        trim(both '()' from regexp_replace(
          pg_catalog.pg_get_expr(policy_record.polwithcheck, policy_record.polrelid),
          '\s+',
          '',
          'g'
        )),
        ''
      ) as check_expression
    from pg_catalog.pg_policy as policy_record
    join pg_catalog.pg_class as table_record
      on table_record.oid = policy_record.polrelid
    join pg_catalog.pg_namespace as namespace_record
      on namespace_record.oid = table_record.relnamespace
    where namespace_record.nspname = 'public'
      and table_record.relname in (
        'preview_v2_budget_settings',
        'preview_v2_transactions',
        'preview_v2_seed_metadata'
      )
  ),
  expected_policies (
    table_name,
    policy_name,
    command,
    is_permissive,
    roles,
    using_expression,
    check_expression
  ) as (
    values
      ('preview_v2_budget_settings', 'Preview V2 users can select own settings', 'r', true, array['authenticated']::text[], 'auth.uid()=user_id', ''),
      ('preview_v2_budget_settings', 'Preview V2 users can insert own settings', 'a', true, array['authenticated']::text[], '', 'auth.uid()=user_id'),
      ('preview_v2_budget_settings', 'Preview V2 users can update own settings', 'w', true, array['authenticated']::text[], 'auth.uid()=user_id', 'auth.uid()=user_id'),
      ('preview_v2_transactions', 'Preview V2 users can select own transactions', 'r', true, array['authenticated']::text[], 'auth.uid()=user_id', ''),
      ('preview_v2_transactions', 'Preview V2 users can insert own transactions', 'a', true, array['authenticated']::text[], '', 'auth.uid()=user_id'),
      ('preview_v2_transactions', 'Preview V2 users can update own transactions', 'w', true, array['authenticated']::text[], 'auth.uid()=user_id', 'auth.uid()=user_id'),
      ('preview_v2_transactions', 'Preview V2 users can delete own transactions', 'd', true, array['authenticated']::text[], 'auth.uid()=user_id', '')
  ),
  actual_policy_differences as (
    select * from actual_policies
    except
    select * from expected_policies
  ),
  expected_policy_differences as (
    select * from expected_policies
    except
    select * from actual_policies
  ),
  policy_differences as (
    select * from actual_policy_differences
    union all
    select * from expected_policy_differences
  )
  select
    (select count(*) from actual_policies),
    exists (select 1 from policy_differences)
  into v_policy_count, v_has_policy_drift;

  if v_policy_count <> 0 and (v_policy_count <> 7 or v_has_policy_drift) then
    raise exception 'preview V2 RLS policy contract drifted' using errcode = '55000';
  end if;
end;
$schema_guard$;

-- Preflight 1: deterministic legacy ID mapping.
select
  user_id,
  id as production_id,
  'tx-migrated-' || md5(user_id::text || ':' || id) as preview_id
from public.transactions
where id !~ '^[A-Za-z0-9._:-]+$'
order by user_id, id;

-- Preflight 2: user-scoped mapped-to-mapped collision audit; expected result is zero rows.
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
  user_id,
  preview_id,
  count(*) as candidate_count,
  array_agg(production_id order by production_id) as production_ids
from preview_candidates
group by user_id, preview_id
having count(*) > 1
order by user_id, preview_id;

-- Preflight 3: user-scoped mapped-to-existing collision audit; expected result is zero rows.
with preview_candidates as (
  select
    user_id,
    case
      when id ~ '^[A-Za-z0-9._:-]+$' then id
      else 'tx-migrated-' || md5(user_id::text || ':' || id)
    end as preview_id,
    date,
    type,
    category,
    amount,
    memo,
    source,
    created_at
  from public.transactions
)
select
  candidate.user_id,
  candidate.preview_id,
  existing.id as existing_id
from preview_candidates as candidate
join public.preview_v2_transactions as existing
  on existing.user_id = candidate.user_id
  and existing.id = candidate.preview_id
where row(
  existing.date,
  existing.type,
  existing.category,
  existing.amount,
  existing.memo,
  existing.source,
  existing.created_at
) is distinct from row(
  candidate.date,
  candidate.type,
  candidate.category,
  candidate.amount,
  candidate.memo,
  candidate.source,
  candidate.created_at
)
order by candidate.user_id, candidate.preview_id;

create or replace function public.set_preview_v2_budget_settings_updated_at()
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

revoke all on function public.set_preview_v2_budget_settings_updated_at() from public;
revoke all on function public.set_preview_v2_budget_settings_updated_at() from anon;
revoke all on function public.set_preview_v2_budget_settings_updated_at() from authenticated;

drop trigger if exists set_preview_v2_budget_settings_updated_at on public.preview_v2_budget_settings;
create trigger set_preview_v2_budget_settings_updated_at
before insert or update on public.preview_v2_budget_settings
for each row
execute function public.set_preview_v2_budget_settings_updated_at();

alter table public.preview_v2_budget_settings enable row level security;
alter table public.preview_v2_transactions enable row level security;
alter table public.preview_v2_seed_metadata enable row level security;

drop policy if exists "Preview V2 users can select own settings" on public.preview_v2_budget_settings;
drop policy if exists "Preview V2 users can insert own settings" on public.preview_v2_budget_settings;
drop policy if exists "Preview V2 users can update own settings" on public.preview_v2_budget_settings;
drop policy if exists "Preview V2 users can select own transactions" on public.preview_v2_transactions;
drop policy if exists "Preview V2 users can insert own transactions" on public.preview_v2_transactions;
drop policy if exists "Preview V2 users can update own transactions" on public.preview_v2_transactions;
drop policy if exists "Preview V2 users can delete own transactions" on public.preview_v2_transactions;

create policy "Preview V2 users can select own settings"
on public.preview_v2_budget_settings
for select
to authenticated
using (auth.uid() = user_id);

create policy "Preview V2 users can insert own settings"
on public.preview_v2_budget_settings
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Preview V2 users can update own settings"
on public.preview_v2_budget_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Preview V2 users can select own transactions"
on public.preview_v2_transactions
for select
to authenticated
using (auth.uid() = user_id);

create policy "Preview V2 users can insert own transactions"
on public.preview_v2_transactions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Preview V2 users can update own transactions"
on public.preview_v2_transactions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Preview V2 users can delete own transactions"
on public.preview_v2_transactions
for delete
to authenticated
using (auth.uid() = user_id);

revoke all on table public.preview_v2_budget_settings from public;
revoke all on table public.preview_v2_budget_settings from anon;
revoke all on table public.preview_v2_budget_settings from authenticated;
revoke all on table public.preview_v2_transactions from public;
revoke all on table public.preview_v2_transactions from anon;
revoke all on table public.preview_v2_transactions from authenticated;
revoke all on table public.preview_v2_seed_metadata from public;
revoke all on table public.preview_v2_seed_metadata from anon;
revoke all on table public.preview_v2_seed_metadata from authenticated;
grant select, insert, update on table public.preview_v2_budget_settings to authenticated;
grant select, insert, update, delete on table public.preview_v2_transactions to authenticated;

-- Atomic one-time V2 production snapshot.
-- Production changes and V2 preview edits, deletions, or additions remain byte-for-byte unchanged on rerun.
-- Explicit reseed requires a separate reviewed procedure; never remove the marker in this setup file.
-- First application only: pause every production, V1 preview, V2 preview, and local authenticated writer.
-- READ COMMITTED lets a waiter see a marker committed by the preceding seed.
-- The seed locks transaction tables before settings tables, matching the whole-state RPC.
begin isolation level read committed;

lock table public.preview_v2_seed_metadata in share row exclusive mode;

do $seed$
declare
  v_source_settings_count bigint;
  v_source_transactions_count bigint;
begin
  if exists (
    select 1
    from public.preview_v2_seed_metadata
    where seed_key = 'production_snapshot_v2'
  ) then
    return;
  end if;

  lock table public.transactions in share mode;
  lock table public.preview_v2_transactions in share row exclusive mode;
  lock table public.budget_settings in share mode;
  lock table public.preview_v2_budget_settings in share row exclusive mode;

  if exists (
    with production_candidates as (
      select
        production.user_id,
        case
          when production.id ~ '^[A-Za-z0-9._:-]+$' then production.id
          else 'tx-migrated-' || md5(production.user_id::text || ':' || production.id)
        end as preview_id
      from public.transactions as production
    )
    select 1
    from production_candidates
    group by user_id, preview_id
    having count(*) > 1
  ) then
    raise exception 'preview V2 seed candidate ID collision' using errcode = '23505';
  end if;

  if exists (
    with preview_conflicts as (
      select
        preview.user_id,
        preview.monthly_budget,
        preview.category_budgets
      from public.preview_v2_budget_settings as preview
      except
      select
        production.user_id,
        production.monthly_budget,
        production.category_budgets
      from public.budget_settings as production
    )
    select 1 from preview_conflicts
  ) then
    raise exception 'existing preview V2 settings conflict' using errcode = '23505';
  end if;

  if exists (
    with production_candidates as (
      select
        production.user_id,
        case
          when production.id ~ '^[A-Za-z0-9._:-]+$' then production.id
          else 'tx-migrated-' || md5(production.user_id::text || ':' || production.id)
        end as preview_id,
        production.date,
        production.type,
        production.category,
        production.amount,
        production.memo,
        production.source,
        production.created_at
      from public.transactions as production
    )
    select 1
    from production_candidates as candidate
    join public.preview_v2_transactions as existing
      on existing.user_id = candidate.user_id
      and existing.id = candidate.preview_id
    where row(
      existing.date,
      existing.type,
      existing.category,
      existing.amount,
      existing.memo,
      existing.source,
      existing.created_at
    ) is distinct from row(
      candidate.date,
      candidate.type,
      candidate.category,
      candidate.amount,
      candidate.memo,
      candidate.source,
      candidate.created_at
    )
  ) then
    raise exception 'existing preview V2 transaction conflict' using errcode = '23505';
  end if;

  if exists (
    with production_candidates as (
      select
        case
          when production.id ~ '^[A-Za-z0-9._:-]+$' then production.id
          else 'tx-migrated-' || md5(production.user_id::text || ':' || production.id)
        end as id,
        production.user_id,
        production.date,
        production.type,
        production.category,
        production.amount,
        production.memo,
        production.source,
        production.created_at
      from public.transactions as production
    ),
    preview_conflicts as (
      select
        preview.id,
        preview.user_id,
        preview.date,
        preview.type,
        preview.category,
        preview.amount,
        preview.memo,
        preview.source,
        preview.created_at
      from public.preview_v2_transactions as preview
      except
      select
        production.id,
        production.user_id,
        production.date,
        production.type,
        production.category,
        production.amount,
        production.memo,
        production.source,
        production.created_at
      from production_candidates as production
    )
    select 1 from preview_conflicts
  ) then
    raise exception 'existing preview V2 transaction conflict' using errcode = '23505';
  end if;

  insert into public.preview_v2_budget_settings (
    user_id,
    monthly_budget,
    category_budgets
  )
  select
    production.user_id,
    production.monthly_budget,
    production.category_budgets
  from public.budget_settings as production
  where not exists (
    select 1
    from public.preview_v2_budget_settings as preview
    where preview.user_id = production.user_id
  );

  insert into public.preview_v2_transactions (
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
      when production.id ~ '^[A-Za-z0-9._:-]+$' then production.id
      else 'tx-migrated-' || md5(production.user_id::text || ':' || production.id)
    end,
    production.user_id,
    production.date,
    production.type,
    production.category,
    production.amount,
    production.memo,
    production.source,
    production.created_at
  from public.transactions as production
  where not exists (
    select 1
    from public.preview_v2_transactions as preview
    where preview.user_id = production.user_id
      and preview.id = case
        when production.id ~ '^[A-Za-z0-9._:-]+$' then production.id
        else 'tx-migrated-' || md5(production.user_id::text || ':' || production.id)
      end
  );

  if exists (
    with production_minus_preview as (
      select
        production.user_id,
        production.monthly_budget,
        production.category_budgets
      from public.budget_settings as production
      except
      select
        preview.user_id,
        preview.monthly_budget,
        preview.category_budgets
      from public.preview_v2_budget_settings as preview
    ),
    preview_minus_production as (
      select
        preview.user_id,
        preview.monthly_budget,
        preview.category_budgets
      from public.preview_v2_budget_settings as preview
      except
      select
        production.user_id,
        production.monthly_budget,
        production.category_budgets
      from public.budget_settings as production
    ),
    settings_differences as (
      select 1 from production_minus_preview
      union all
      select 1 from preview_minus_production
    )
    select 1 from settings_differences
  ) then
    raise exception 'preview V2 settings canonical comparison failed' using errcode = '40001';
  end if;

  if exists (
    with production_candidates as (
      select
        case
          when production.id ~ '^[A-Za-z0-9._:-]+$' then production.id
          else 'tx-migrated-' || md5(production.user_id::text || ':' || production.id)
        end as id,
        production.user_id,
        production.date,
        production.type,
        production.category,
        production.amount,
        production.memo,
        production.source,
        production.created_at
      from public.transactions as production
    ),
    production_minus_preview as (
      select
        production.id,
        production.user_id,
        production.date,
        production.type,
        production.category,
        production.amount,
        production.memo,
        production.source,
        production.created_at
      from production_candidates as production
      except
      select
        preview.id,
        preview.user_id,
        preview.date,
        preview.type,
        preview.category,
        preview.amount,
        preview.memo,
        preview.source,
        preview.created_at
      from public.preview_v2_transactions as preview
    ),
    preview_minus_production as (
      select
        preview.id,
        preview.user_id,
        preview.date,
        preview.type,
        preview.category,
        preview.amount,
        preview.memo,
        preview.source,
        preview.created_at
      from public.preview_v2_transactions as preview
      except
      select
        production.id,
        production.user_id,
        production.date,
        production.type,
        production.category,
        production.amount,
        production.memo,
        production.source,
        production.created_at
      from production_candidates as production
    ),
    transaction_differences as (
      select 1 from production_minus_preview
      union all
      select 1 from preview_minus_production
    )
    select 1 from transaction_differences
  ) then
    raise exception 'preview V2 transactions canonical comparison failed' using errcode = '40001';
  end if;

  select count(*) into v_source_settings_count from public.budget_settings;
  select count(*) into v_source_transactions_count from public.transactions;

  insert into public.preview_v2_seed_metadata (
    seed_key,
    completed_at,
    source_settings_count,
    source_transactions_count
  ) values (
    'production_snapshot_v2',
    clock_timestamp(),
    v_source_settings_count,
    v_source_transactions_count
  );
end;
$seed$;

commit;

-- Atomically replace one authenticated user's V2 preview settings and transactions.
drop function if exists public.replace_preview_v2_budget_state(integer, jsonb, jsonb);
drop function if exists public.replace_preview_v2_budget_state(integer, jsonb, jsonb, timestamptz);

create or replace function public.replace_preview_v2_budget_state(
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

  if p_category_budgets ? '__recurring_expense_templates'
    and jsonb_typeof(p_category_budgets -> '__recurring_expense_templates') <> 'array' then
    raise exception 'recurring expense templates must be a JSON array' using errcode = '22023';
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
    group by v_user_id, transaction_row ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'duplicate transaction ids are not allowed' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_expected_transactions) as transaction_row
    group by v_user_id, transaction_row ->> 'id'
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

  lock table public.preview_v2_transactions in share row exclusive mode;

  select settings.updated_at
  into v_current_updated_at
  from public.preview_v2_budget_settings as settings
  where settings.user_id = v_user_id
  for update;
  v_settings_exists := found;

  if (v_settings_exists and v_current_updated_at is distinct from p_expected_updated_at)
    or (not v_settings_exists and p_expected_updated_at is not null) then
    raise exception 'state changed in another browser; download the latest data and retry'
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
  from public.preview_v2_transactions as transaction_row
  where transaction_row.user_id = v_user_id;

  if v_current_transactions is distinct from v_expected_transactions then
    raise exception 'state changed in another browser; download the latest data and retry'
      using errcode = '40001';
  end if;

  if v_settings_exists then
    update public.preview_v2_budget_settings as settings
    set
      monthly_budget = p_monthly_budget,
      category_budgets = p_category_budgets
    where settings.user_id = v_user_id
      and settings.updated_at = p_expected_updated_at
    returning settings.updated_at into v_new_updated_at;
    if not found then
      raise exception 'state changed in another browser; download the latest data and retry'
        using errcode = '40001';
    end if;
  else
    insert into public.preview_v2_budget_settings as settings (
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
      raise exception 'state changed in another browser; download the latest data and retry'
        using errcode = '40001';
    end if;
  end if;

  delete from public.preview_v2_transactions
  where user_id = v_user_id;

  insert into public.preview_v2_transactions (
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

revoke all on function public.replace_preview_v2_budget_state(integer, jsonb, jsonb, timestamptz, jsonb) from public;
revoke all on function public.replace_preview_v2_budget_state(integer, jsonb, jsonb, timestamptz, jsonb) from anon;
revoke all on function public.replace_preview_v2_budget_state(integer, jsonb, jsonb, timestamptz, jsonb) from authenticated;
grant execute on function public.replace_preview_v2_budget_state(integer, jsonb, jsonb, timestamptz, jsonb) to authenticated;

-- Remove obsolete V2 preview sample-only replacement RPC overloads.
drop function if exists public.replace_preview_v2_budget_samples(date, date, jsonb);
drop function if exists public.replace_preview_v2_budget_samples(date, date, jsonb, jsonb);

-- Verification queries: these are read-only and may be reviewed after the setup succeeds.
select
  c.relname as table_name,
  c.relrowsecurity as row_security
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('preview_v2_budget_settings', 'preview_v2_transactions', 'preview_v2_seed_metadata')
order by c.relname;

select
  seed_key,
  completed_at,
  source_settings_count,
  source_transactions_count
from public.preview_v2_seed_metadata
where seed_key = 'production_snapshot_v2';

select
  routine_name,
  security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('set_preview_v2_budget_settings_updated_at', 'replace_preview_v2_budget_state')
order by routine_name;
