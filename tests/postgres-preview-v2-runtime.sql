\set ON_ERROR_STOP on

create schema if not exists auth;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end;
$roles$;

create table auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $function$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;

grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.budget_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget integer not null default 500000 check (monthly_budget > 0),
  category_budgets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.transactions (
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

create table public.preview_budget_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget integer not null,
  category_budgets jsonb not null,
  updated_at timestamptz not null
);

create table public.preview_transactions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null,
  category text not null,
  amount integer not null,
  memo text not null,
  source text not null,
  created_at timestamptz not null
);

create table public.preview_seed_metadata (
  seed_key text primary key,
  completed_at timestamptz not null,
  source_settings_count bigint not null,
  source_transactions_count bigint not null
);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2');

insert into public.budget_settings (user_id, monthly_budget, category_budgets, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 600000, '{"생활비":300000}'::jsonb, '2026-08-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000b2', 700000, '{"배달비":120000}'::jsonb, '2026-08-01T00:00:01Z');

insert into public.transactions (id, user_id, date, type, category, amount, memo, source, created_at) values
  ('prod-a', '00000000-0000-0000-0000-0000000000a1', '2026-08-02', 'expense', '생활비', 10000, 'A fixture', 'user', '2026-08-02T00:00:00Z'),
  ('prod-b', '00000000-0000-0000-0000-0000000000b2', '2026-08-03', 'income', '월급', 2000000, 'B fixture', 'user', '2026-08-03T00:00:00Z');

insert into public.preview_budget_settings
select * from public.budget_settings;

insert into public.preview_transactions
select * from public.transactions;

insert into public.preview_seed_metadata values (
  'production_snapshot_v1',
  '2026-08-01T00:00:02Z',
  2,
  2
);

create table public.preview_v2_test_invariants (
  name text primary key,
  value text not null
);

create or replace function public.preview_v2_test_hash(p_table regclass)
returns text
language plpgsql
as $function$
declare
  v_hash text;
begin
  execute format(
    'select md5(coalesce(string_agg(row_to_json(t)::text, E''\n'' order by row_to_json(t)::text collate "C"), '''')) from %s t',
    p_table
  ) into v_hash;
  return v_hash;
end;
$function$;

insert into public.preview_v2_test_invariants (name, value) values
  ('production-settings', public.preview_v2_test_hash('public.budget_settings')),
  ('production-transactions', public.preview_v2_test_hash('public.transactions')),
  ('v1-settings', public.preview_v2_test_hash('public.preview_budget_settings')),
  ('v1-transactions', public.preview_v2_test_hash('public.preview_transactions')),
  ('v1-marker', public.preview_v2_test_hash('public.preview_seed_metadata'));

\ir ../docs/supabase-preview-v2-setup.sql

create or replace function public.preview_v2_assert(p_condition boolean, p_message text)
returns void
language plpgsql
as $function$
begin
  if not coalesce(p_condition, false) then
    raise exception 'assertion failed: %', p_message using errcode = 'P0001';
  end if;
end;
$function$;

select public.preview_v2_assert(
  not exists (
    (select user_id, monthly_budget, category_budgets from public.budget_settings
     except
     select user_id, monthly_budget, category_budgets from public.preview_v2_budget_settings)
    union all
    (select user_id, monthly_budget, category_budgets from public.preview_v2_budget_settings
     except
     select user_id, monthly_budget, category_budgets from public.budget_settings)
  ),
  'initial seed settings must be canonical in both directions'
);

select public.preview_v2_assert(
  not exists (
    (select id, user_id, date, type, category, amount, memo, source, created_at from public.transactions
     except
     select id, user_id, date, type, category, amount, memo, source, created_at from public.preview_v2_transactions)
    union all
    (select id, user_id, date, type, category, amount, memo, source, created_at from public.preview_v2_transactions
     except
     select id, user_id, date, type, category, amount, memo, source, created_at from public.transactions)
  ),
  'initial seed transactions must be canonical in both directions'
);

select public.preview_v2_assert(
  (select source_settings_count = 2 and source_transactions_count = 2
   from public.preview_v2_seed_metadata where seed_key = 'production_snapshot_v2'),
  'seed marker must record canonical counts'
);

update public.budget_settings
set monthly_budget = 610000
where user_id = '00000000-0000-0000-0000-0000000000a1';

update public.preview_v2_budget_settings
set monthly_budget = 620000
where user_id = '00000000-0000-0000-0000-0000000000a1';

delete from public.preview_v2_transactions
where user_id = '00000000-0000-0000-0000-0000000000a1'
  and id = 'prod-a';

create temporary table preview_v2_before_rerun as
select
  public.preview_v2_test_hash('public.preview_v2_budget_settings') as settings_hash,
  public.preview_v2_test_hash('public.preview_v2_transactions') as transactions_hash,
  public.preview_v2_test_hash('public.preview_v2_seed_metadata') as marker_hash;

\ir ../docs/supabase-preview-v2-setup.sql

select public.preview_v2_assert(
  (select settings_hash = public.preview_v2_test_hash('public.preview_v2_budget_settings')
       and transactions_hash = public.preview_v2_test_hash('public.preview_v2_transactions')
       and marker_hash = public.preview_v2_test_hash('public.preview_v2_seed_metadata')
   from preview_v2_before_rerun),
  'marker rerun must preserve modified V2 byte-for-byte'
);

select public.preview_v2_assert(
  not has_function_privilege('public', 'public.replace_preview_v2_budget_state(integer,jsonb,jsonb,timestamptz,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.replace_preview_v2_budget_state(integer,jsonb,jsonb,timestamptz,jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.replace_preview_v2_budget_state(integer,jsonb,jsonb,timestamptz,jsonb)', 'EXECUTE'),
  'RPC execute privileges must exclude public and anon'
);

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;

select public.preview_v2_assert(
  (select count(*) = 1 from public.preview_v2_budget_settings),
  'RLS must expose only user A settings'
);
select public.preview_v2_assert(
  not exists (select 1 from public.preview_v2_budget_settings where user_id = '00000000-0000-0000-0000-0000000000b2'),
  'RLS must hide user B settings from user A'
);
select public.preview_v2_assert(
  not exists (select 1 from public.preview_v2_transactions where user_id = '00000000-0000-0000-0000-0000000000b2'),
  'RLS must hide user B transactions from user A'
);

do $rls_dml$
begin
  begin
    insert into public.preview_v2_transactions (
      id, user_id, date, type, category, amount, memo, source
    ) values (
      'rls-forbidden', '00000000-0000-0000-0000-0000000000b2', '2026-08-20',
      'expense', '생활비', 1, '', 'user'
    );
    raise exception 'cross-user insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$rls_dml$;
rollback;

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;

do $monotonic$
declare
  v_before timestamptz;
  v_returned timestamptz;
  v_stored timestamptz;
begin
  select updated_at into v_before
  from public.preview_v2_budget_settings
  where user_id = auth.uid();

  select updated_at into v_returned
  from public.replace_preview_v2_budget_state(
    630000,
    '{"생활비":310000}'::jsonb,
    '[]'::jsonb,
    v_before,
    '[]'::jsonb
  );

  select updated_at into v_stored
  from public.preview_v2_budget_settings
  where user_id = auth.uid();

  perform public.preview_v2_assert(v_returned = v_stored, 'RETURNING token must equal stored token');
  perform public.preview_v2_assert(v_returned > v_before, 'settings token must increase monotonically');
end;
$monotonic$;
rollback;

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;

do $stale$
declare
  v_settings_before text;
  v_transactions_before text;
begin
  select public.preview_v2_test_hash('public.preview_v2_budget_settings'),
         public.preview_v2_test_hash('public.preview_v2_transactions')
  into v_settings_before, v_transactions_before;

  begin
    perform * from public.replace_preview_v2_budget_state(
      640000,
      '{}'::jsonb,
      '[]'::jsonb,
      '2000-01-01T00:00:00Z'::timestamptz,
      '[]'::jsonb
    );
    raise exception 'stale settings token unexpectedly succeeded';
  exception when serialization_failure then
    null;
  end;

  perform public.preview_v2_assert(
    v_settings_before = public.preview_v2_test_hash('public.preview_v2_budget_settings')
      and v_transactions_before = public.preview_v2_test_hash('public.preview_v2_transactions'),
    'stale token failure must preserve all rows'
  );

  begin
    perform * from public.replace_preview_v2_budget_state(
      640000,
      '{}'::jsonb,
      '[]'::jsonb,
      (select updated_at from public.preview_v2_budget_settings where user_id = auth.uid()),
      '[{"id":"not-current","date":"2026-08-01","type":"expense","category":"생활비","amount":1,"memo":"","source":"user"}]'::jsonb
    );
    raise exception 'stale transaction snapshot unexpectedly succeeded';
  exception when serialization_failure then
    null;
  end;

  perform public.preview_v2_assert(
    v_settings_before = public.preview_v2_test_hash('public.preview_v2_budget_settings')
      and v_transactions_before = public.preview_v2_test_hash('public.preview_v2_transactions'),
    'stale transaction failure must preserve all rows'
  );
end;
$stale$;
rollback;

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
insert into public.preview_v2_transactions (
  id, user_id, date, type, category, amount, memo, source
) values (
  'tx-recurring-runtime-2026-08', auth.uid(), '2026-08-25', 'expense', '생활비', 1000, '', 'user'
);
do $same_user_duplicate$
begin
  begin
    insert into public.preview_v2_transactions (
      id, user_id, date, type, category, amount, memo, source
    ) values (
      'tx-recurring-runtime-2026-08', auth.uid(), '2026-08-25', 'expense', '생활비', 1000, '', 'user'
    );
    raise exception 'same-user duplicate unexpectedly succeeded';
  exception when unique_violation then
    null;
  end;
end;
$same_user_duplicate$;
commit;

select public.preview_v2_assert(
  (select count(*) = 1 from public.preview_v2_transactions
   where user_id = '00000000-0000-0000-0000-0000000000a1'
     and id = 'tx-recurring-runtime-2026-08'),
  'same-user duplicate inserts must leave exactly one row after 23505'
);

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
insert into public.preview_v2_transactions (
  id, user_id, date, type, category, amount, memo, source
) values (
  'tx-recurring-cross-user-2026-08', auth.uid(), '2026-08-25', 'expense', '생활비', 1000, '', 'user'
);
commit;

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
set local role authenticated;
insert into public.preview_v2_transactions (
  id, user_id, date, type, category, amount, memo, source
) values (
  'tx-recurring-cross-user-2026-08', auth.uid(), '2026-08-25', 'expense', '생활비', 1000, '', 'user'
);
commit;

select public.preview_v2_assert(
  (select count(*) = 2 from public.preview_v2_transactions
   where id = 'tx-recurring-cross-user-2026-08'
     and user_id in (
       '00000000-0000-0000-0000-0000000000a1',
       '00000000-0000-0000-0000-0000000000b2'
     )),
  'different users must each retain the same deterministic ID once'
);

select public.preview_v2_assert(
  (select value = public.preview_v2_test_hash('public.preview_budget_settings')
   from public.preview_v2_test_invariants where name = 'v1-settings')
  and (select value = public.preview_v2_test_hash('public.preview_transactions')
       from public.preview_v2_test_invariants where name = 'v1-transactions')
  and (select value = public.preview_v2_test_hash('public.preview_seed_metadata')
       from public.preview_v2_test_invariants where name = 'v1-marker'),
  'V1 fixtures must remain invariant'
);

-- Production was deliberately changed for the marker-rerun test. Capture the post-change
-- invariant, then require the concurrent seed/RPC phase to preserve it byte-for-byte.
delete from public.transactions;
update public.preview_v2_test_invariants set value = public.preview_v2_test_hash('public.budget_settings')
where name = 'production-settings';
update public.preview_v2_test_invariants set value = public.preview_v2_test_hash('public.transactions')
where name = 'production-transactions';

create table public.preview_v2_runtime_barrier (
  participant text primary key,
  ready boolean not null default false,
  finished boolean not null default false,
  duplicate_ready boolean not null default false,
  duplicate_result text
);

insert into public.preview_v2_runtime_barrier (participant) values ('seed'), ('rpc');

-- Prepare an isolated concurrency replay: preserve the callable RPC, remove only V2
-- seed state, and let the setup seed race the RPC in session-a/session-b.
truncate table public.preview_v2_seed_metadata;
truncate table public.preview_v2_transactions;
truncate table public.preview_v2_budget_settings;

\echo preview-v2 PostgreSQL base runtime assertions passed
