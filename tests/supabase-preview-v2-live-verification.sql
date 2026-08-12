-- V2 live verification for psql.
--
-- Required runtime variables (never put real values in this file):
--   -v live_phase=<phase> -v run_id=<UTC-run-id>
--   -v qa_user_a=<uuid> -v qa_user_b=<uuid>
--   -v qa_marker=QA-V2-RECURRING-<yyyyMMdd-HHmmss>
--
-- Run auth_gate after login/project confirmation and before the write-free gate
-- or V2 setup. Every other phase requires the write-free gate and successful V2
-- setup described in docs/TEST_PLAN.md. Use --csv or redirected stdout for
-- evidence. Every phase that creates or changes a fixture rolls back. The
-- snapshot phase is run before and after a separately controlled setup-SQL safe
-- rerun and its two outputs are compared outside this script.
--
-- Task 13's isolated PostgreSQL 17 harness is the sole place that forces the
-- seed and full-state RPC to overlap. Reproducing that race live would require
-- changing the completed marker or V2 seed data, so this script never does it.
--
-- LIMITATION: these rollback-only phases do not prove a cross-session committed
-- winner for stale CAS or same-ID inserts. That live concurrency result remains
-- PENDING until a separately approved runner records every created ID in the
-- append-only QA ledger, commits only the controlled winner, and completes exact
-- ID plus marker-prefix cleanup. Never mark that gate complete from this file.

\set ON_ERROR_STOP on

\if :{?live_phase}
\else
  \echo 'missing required psql variable: live_phase'
  \quit 3
\endif
\if :{?run_id}
\else
  \echo 'missing required psql variable: run_id'
  \quit 3
\endif
\if :{?qa_user_a}
\else
  \echo 'missing required psql variable: qa_user_a'
  \quit 3
\endif
\if :{?qa_user_b}
\else
  \echo 'missing required psql variable: qa_user_b'
  \quit 3
\endif
\if :{?qa_marker}
\else
  \echo 'missing required psql variable: qa_marker'
  \quit 3
\endif

set timezone to 'UTC';
set statement_timeout = '30s';
set lock_timeout = '5s';
set idle_in_transaction_session_timeout = '60s';

select set_config('preview_v2.live.phase', :'live_phase', false);
select set_config('preview_v2.live.run_id', :'run_id', false);
select set_config('preview_v2.live.qa_user_a', :'qa_user_a', false);
select set_config('preview_v2.live.qa_user_b', :'qa_user_b', false);
select set_config('preview_v2.live.qa_marker', :'qa_marker', false);
select set_config(
  'application_name',
  left(
    'preview-v2-live-' || current_setting('preview_v2.live.run_id')
      || '-' || current_setting('preview_v2.live.phase'),
    63
  ),
  false
);

do $validate_runtime_inputs$
declare
  v_phase text := current_setting('preview_v2.live.phase');
  v_run_id text := current_setting('preview_v2.live.run_id');
  v_user_a uuid;
  v_user_b uuid;
  v_marker text := current_setting('preview_v2.live.qa_marker');
begin
  if v_run_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$' then
    raise exception 'run_id must be 1-80 safe ASCII characters' using errcode = '22023';
  end if;
  begin
    v_user_a := current_setting('preview_v2.live.qa_user_a')::uuid;
    v_user_b := current_setting('preview_v2.live.qa_user_b')::uuid;
  exception when invalid_text_representation then
    raise exception 'qa_user_a and qa_user_b must both be UUIDs' using errcode = '22023';
  end;

  if v_user_a = v_user_b then
    raise exception 'qa_user_a and qa_user_b must be different users' using errcode = '22023';
  end if;
  if v_marker !~ '^QA-V2-RECURRING-[0-9]{8}-[0-9]{6}$' then
    raise exception 'qa_marker does not match the immutable run marker contract' using errcode = '22023';
  end if;
  if v_phase not in (
    'auth_gate', 'preflight', 'seed_canonical', 'snapshot', 'permissions',
    'rls_a', 'rls_b', 'cas_a', 'cas_b', 'duplicate_scope'
  ) then
    raise exception 'unknown live_phase: %', v_phase using errcode = '22023';
  end if;
end;
$validate_runtime_inputs$;

select
  :'live_phase' = 'auth_gate' as phase_auth_gate,
  :'live_phase' = 'preflight' as phase_preflight,
  :'live_phase' = 'seed_canonical' as phase_seed_canonical,
  :'live_phase' = 'snapshot' as phase_snapshot,
  :'live_phase' = 'permissions' as phase_permissions,
  :'live_phase' = 'rls_a' as phase_rls_a,
  :'live_phase' = 'rls_b' as phase_rls_b,
  :'live_phase' in ('rls_a', 'rls_b') as phase_rls,
  :'live_phase' = 'cas_a' as phase_cas_a,
  :'live_phase' = 'cas_b' as phase_cas_b,
  :'live_phase' in ('cas_a', 'cas_b') as phase_cas,
  :'live_phase' = 'duplicate_scope' as phase_duplicate_scope
\gset

select
  current_setting('preview_v2.live.run_id') as run_id,
  current_setting('preview_v2.live.phase') as live_phase,
  current_setting('preview_v2.live.qa_marker') as qa_marker,
  current_setting('preview_v2.live.qa_user_a')::uuid as qa_user_a,
  current_setting('preview_v2.live.qa_user_b')::uuid as qa_user_b,
  to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as observed_at_utc;

-- Pre-setup read-only hard gate. This phase requires only auth.users, so it can
-- prove that both distinct QA accounts already exist before any setup SQL runs.
\if :phase_auth_gate
do $auth_gate$
declare
  v_user_a_count bigint;
  v_user_b_count bigint;
begin
  select
    count(*) filter (where id = current_setting('preview_v2.live.qa_user_a')::uuid),
    count(*) filter (where id = current_setting('preview_v2.live.qa_user_b')::uuid)
  into v_user_a_count, v_user_b_count
  from auth.users;

  if v_user_a_count <> 1 or v_user_b_count <> 1 then
    raise exception 'each existing QA user must occur exactly once in auth.users'
      using errcode = '55000';
  end if;
end;
$auth_gate$;

select
  'auth_gate' as evidence_type,
  count(*) filter (where id = current_setting('preview_v2.live.qa_user_a')::uuid) as qa_user_a_count,
  count(*) filter (where id = current_setting('preview_v2.live.qa_user_b')::uuid) as qa_user_b_count
from auth.users;
\endif

-- Read-only object, marker, and QA-account gate. This intentionally selects no
-- email or credential fields from auth.users.
\if :phase_preflight
do $preflight$
declare
  v_missing text[];
  v_user_count integer;
  v_marker_count integer;
begin
  select array_agg(required_relation order by required_relation)
  into v_missing
  from unnest(array[
    'public.budget_settings',
    'public.transactions',
    'public.preview_budget_settings',
    'public.preview_transactions',
    'public.preview_v2_budget_settings',
    'public.preview_v2_transactions',
    'public.preview_v2_seed_metadata'
  ]) as required_relation
  where to_regclass(required_relation) is null;

  if coalesce(cardinality(v_missing), 0) <> 0 then
    raise exception 'required live relations are missing: %', v_missing using errcode = '55000';
  end if;

  select count(*)
  into v_user_count
  from auth.users
  where id in (
    current_setting('preview_v2.live.qa_user_a')::uuid,
    current_setting('preview_v2.live.qa_user_b')::uuid
  );
  if v_user_count <> 2 then
    raise exception 'both existing QA users must be present in auth.users' using errcode = '55000';
  end if;

  select count(*)
  into v_marker_count
  from public.preview_v2_seed_metadata
  where seed_key = 'production_snapshot_v2';
  if v_marker_count <> 1 then
    raise exception 'production_snapshot_v2 marker must exist exactly once' using errcode = '55000';
  end if;
end;
$preflight$;

select
  'preflight' as evidence_type,
  to_regclass('public.preview_v2_budget_settings')::text as settings_relation,
  to_regclass('public.preview_v2_transactions')::text as transactions_relation,
  to_regclass('public.preview_v2_seed_metadata')::text as metadata_relation,
  (select count(*) from auth.users where id in (
    current_setting('preview_v2.live.qa_user_a')::uuid,
    current_setting('preview_v2.live.qa_user_b')::uuid
  )) as qa_user_count,
  (select count(*) from public.preview_v2_seed_metadata
   where seed_key = 'production_snapshot_v2') as marker_count;
\endif

-- A/A' only: run immediately after the first successful seed and before any V2
-- QA mutation. Do not use this phase as a B safe-rerun acceptance condition.
\if :phase_seed_canonical
do $seed_canonical_assertions$
declare
  v_difference_count bigint;
  v_marker_count bigint;
  v_source_settings_count bigint;
  v_source_transactions_count bigint;
begin
  select count(*), max(source_settings_count), max(source_transactions_count)
  into v_marker_count, v_source_settings_count, v_source_transactions_count
  from public.preview_v2_seed_metadata
  where seed_key = 'production_snapshot_v2';

  if v_marker_count <> 1
    or v_source_settings_count <> (select count(*) from public.budget_settings)
    or v_source_transactions_count <> (select count(*) from public.transactions) then
    raise exception 'fresh seed marker counts do not match production' using errcode = '40001';
  end if;

  with production_minus_preview as (
    select user_id, monthly_budget, category_budgets
    from public.budget_settings
    except
    select user_id, monthly_budget, category_budgets
    from public.preview_v2_budget_settings
  ),
  preview_minus_production as (
    select user_id, monthly_budget, category_budgets
    from public.preview_v2_budget_settings
    except
    select user_id, monthly_budget, category_budgets
    from public.budget_settings
  )
  select count(*) into v_difference_count
  from (
    select 1 from production_minus_preview
    union all
    select 1 from preview_minus_production
  ) as differences;
  if v_difference_count <> 0 then
    raise exception 'fresh V2 settings seed is not canonical' using errcode = '40001';
  end if;

  with production_candidates as (
    select
      case
        when id ~ '^[A-Za-z0-9._:-]+$' then id
        else 'tx-migrated-' || md5(user_id::text || ':' || id)
      end as id,
      user_id, date, type, category, amount, memo, source, created_at
    from public.transactions
  ),
  production_minus_preview as (
    select id, user_id, date, type, category, amount, memo, source, created_at
    from production_candidates
    except
    select id, user_id, date, type, category, amount, memo, source, created_at
    from public.preview_v2_transactions
  ),
  preview_minus_production as (
    select id, user_id, date, type, category, amount, memo, source, created_at
    from public.preview_v2_transactions
    except
    select id, user_id, date, type, category, amount, memo, source, created_at
    from production_candidates
  )
  select count(*) into v_difference_count
  from (
    select 1 from production_minus_preview
    union all
    select 1 from preview_minus_production
  ) as differences;
  if v_difference_count <> 0 then
    raise exception 'fresh V2 transaction seed is not canonical' using errcode = '40001';
  end if;
end;
$seed_canonical_assertions$;

with settings_differences as (
  (select user_id, monthly_budget, category_budgets from public.budget_settings
   except
   select user_id, monthly_budget, category_budgets from public.preview_v2_budget_settings)
  union all
  (select user_id, monthly_budget, category_budgets from public.preview_v2_budget_settings
   except
   select user_id, monthly_budget, category_budgets from public.budget_settings)
)
select 'seed_canonical.settings' as evidence_type, count(*) as difference_count
from settings_differences;
\endif

-- Read-only evidence snapshot. Run with identical psql formatting before and
-- after a separately controlled setup-SQL safe rerun, then compare the outputs.
\if :phase_snapshot
select
  'production.settings' as evidence_type,
  user_id,
  count(*) as row_count,
  md5(coalesce(string_agg(
    jsonb_build_array(
      user_id, monthly_budget, category_budgets,
      to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text,
    E'\n' order by user_id, updated_at
  ), '')) as invariant_hash
from public.budget_settings
group by user_id
order by user_id;

select
  'production.transactions' as evidence_type,
  user_id,
  count(*) as row_count,
  md5(coalesce(string_agg(
    jsonb_build_array(
      id, user_id, date, type, category, amount, memo, source,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text,
    E'\n' order by id, date, type, category, amount, memo, source, created_at
  ), '')) as invariant_hash
from public.transactions
group by user_id
order by user_id;

select
  'production.total' as evidence_type,
  (select count(*) from public.budget_settings) as settings_total,
  (select count(*) from public.transactions) as transactions_total;

select
  'preview_v1.settings' as evidence_type,
  user_id,
  count(*) as row_count,
  md5(coalesce(string_agg(to_jsonb(row_value)::text, E'\n'
    order by to_jsonb(row_value)::text), '')) as invariant_hash
from public.preview_budget_settings as row_value
group by user_id
order by user_id;

select
  'preview_v1.transactions' as evidence_type,
  user_id,
  count(*) as row_count,
  md5(coalesce(string_agg(to_jsonb(row_value)::text, E'\n'
    order by to_jsonb(row_value)::text), '')) as invariant_hash
from public.preview_transactions as row_value
group by user_id
order by user_id;

select
  'preview_v1.total' as evidence_type,
  (select count(*) from public.preview_budget_settings) as settings_total,
  (select count(*) from public.preview_transactions) as transactions_total;

select
  'preview_v2.settings' as evidence_type,
  count(*) as row_count,
  md5(coalesce(string_agg(to_jsonb(row_value)::text, E'\n'
    order by to_jsonb(row_value)::text), '')) as full_hash
from public.preview_v2_budget_settings as row_value;

select
  'preview_v2.transactions' as evidence_type,
  count(*) as row_count,
  md5(coalesce(string_agg(to_jsonb(row_value)::text, E'\n'
    order by to_jsonb(row_value)::text), '')) as full_hash
from public.preview_v2_transactions as row_value;

select
  'preview_v2.seed_metadata' as evidence_type,
  count(*) as row_count,
  md5(coalesce(string_agg(to_jsonb(row_value)::text, E'\n'
    order by to_jsonb(row_value)::text), '')) as full_hash
from public.preview_v2_seed_metadata as row_value;

select
  'preview_v2.seed_marker' as evidence_type,
  seed_key,
  to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as completed_at_utc,
  source_settings_count,
  source_transactions_count
from public.preview_v2_seed_metadata
where seed_key = 'production_snapshot_v2';
\endif

-- PUBLIC is a pseudo-role and is verified by ACL inspection. anon is also
-- exercised as an actual role. The expected denial is caught inside rollback.
-- rollback-only permissions phase begin
\if :phase_permissions
begin;
do $permission_contract$
begin
  if has_function_privilege(
    'public',
    'public.replace_preview_v2_budget_state(integer,jsonb,jsonb,timestamptz,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'public unexpectedly has V2 RPC execute privilege' using errcode = '42501';
  end if;
  if has_function_privilege(
    'anon',
    'public.replace_preview_v2_budget_state(integer,jsonb,jsonb,timestamptz,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'anon unexpectedly has V2 RPC execute privilege' using errcode = '42501';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.replace_preview_v2_budget_state(integer,jsonb,jsonb,timestamptz,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'authenticated is missing V2 RPC execute privilege' using errcode = '42501';
  end if;
end;
$permission_contract$;

set local role anon;
do $anon_execute_denied$
declare
  v_denied boolean := false;
begin
  begin
    perform * from public.replace_preview_v2_budget_state(
      1, '{}'::jsonb, '[]'::jsonb, null, '[]'::jsonb
    );
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'anon V2 RPC execution was not denied' using errcode = '42501';
  end if;
end;
$anon_execute_denied$;
rollback;
\endif
-- rollback-only permissions phase end

-- RLS A/B phases create both users' rows as the administrative session, then
-- switch to exactly one authenticated claim for all assertions. Nothing commits.
-- rollback-only rls phase begin
\if :phase_rls
  \if :phase_rls_a
select set_config('preview_v2.live.session_user', current_setting('preview_v2.live.qa_user_a'), false);
select set_config('preview_v2.live.other_user', current_setting('preview_v2.live.qa_user_b'), false);
  \else
select set_config('preview_v2.live.session_user', current_setting('preview_v2.live.qa_user_b'), false);
select set_config('preview_v2.live.other_user', current_setting('preview_v2.live.qa_user_a'), false);
  \endif

begin;
insert into public.preview_v2_budget_settings (user_id, monthly_budget, category_budgets)
values
  (current_setting('preview_v2.live.session_user')::uuid, 500000, '{}'::jsonb),
  (current_setting('preview_v2.live.other_user')::uuid, 500000, '{}'::jsonb)
on conflict (user_id) do nothing;

insert into public.preview_v2_transactions (
  id, user_id, date, type, category, amount, memo, source
)
values
  (
    'tx-live-rls-own-' || lower(current_setting('preview_v2.live.qa_marker')),
    current_setting('preview_v2.live.session_user')::uuid,
    current_date, 'expense', '생활비', 1,
    current_setting('preview_v2.live.qa_marker') || '-rls-own', 'user'
  ),
  (
    'tx-live-rls-other-' || lower(current_setting('preview_v2.live.qa_marker')),
    current_setting('preview_v2.live.other_user')::uuid,
    current_date, 'expense', '생활비', 1,
    current_setting('preview_v2.live.qa_marker') || '-rls-other', 'user'
  );

select set_config('request.jwt.claim.sub', current_setting('preview_v2.live.session_user'), true);
set local role authenticated;

do $rls_assertions$
declare
  v_changed bigint;
  v_cross_insert_denied boolean := false;
begin
  if not exists (
    select 1 from public.preview_v2_budget_settings
    where user_id = current_setting('preview_v2.live.session_user')::uuid
  ) then
    raise exception 'RLS hid the authenticated user settings' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.preview_v2_transactions
    where user_id = current_setting('preview_v2.live.session_user')::uuid
      and id = 'tx-live-rls-own-' || lower(current_setting('preview_v2.live.qa_marker'))
  ) then
    raise exception 'RLS hid the authenticated user transaction' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.preview_v2_budget_settings
    where user_id = current_setting('preview_v2.live.other_user')::uuid
  ) or exists (
    select 1 from public.preview_v2_transactions
    where user_id = current_setting('preview_v2.live.other_user')::uuid
  ) then
    raise exception 'RLS cross-user SELECT leaked a row' using errcode = '42501';
  end if;

  update public.preview_v2_transactions
  set memo = current_setting('preview_v2.live.qa_marker') || '-forbidden-update'
  where user_id = current_setting('preview_v2.live.other_user')::uuid
    and id = 'tx-live-rls-other-' || lower(current_setting('preview_v2.live.qa_marker'));
  get diagnostics v_changed = row_count;
  if v_changed <> 0 then
    raise exception 'RLS cross-user UPDATE changed a row' using errcode = '42501';
  end if;

  update public.preview_v2_transactions
  set memo = current_setting('preview_v2.live.qa_marker') || '-rls-own-updated'
  where user_id = current_setting('preview_v2.live.session_user')::uuid
    and id = 'tx-live-rls-own-' || lower(current_setting('preview_v2.live.qa_marker'));
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'RLS own UPDATE did not change exactly one row' using errcode = '42501';
  end if;

  begin
    insert into public.preview_v2_transactions (
      id, user_id, date, type, category, amount, memo, source
    ) values (
      'tx-live-rls-forbidden-' || lower(current_setting('preview_v2.live.qa_marker')),
      current_setting('preview_v2.live.other_user')::uuid,
      current_date, 'expense', '생활비', 1,
      current_setting('preview_v2.live.qa_marker') || '-forbidden-insert', 'user'
    );
  exception when sqlstate '42501' then
    v_cross_insert_denied := true;
  end;
  if not v_cross_insert_denied then
    raise exception 'RLS cross-user INSERT was not denied' using errcode = '42501';
  end if;

  delete from public.preview_v2_transactions
  where user_id = current_setting('preview_v2.live.session_user')::uuid
    and id = 'tx-live-rls-own-' || lower(current_setting('preview_v2.live.qa_marker'));
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'RLS own DELETE did not remove exactly one row' using errcode = '42501';
  end if;
end;
$rls_assertions$;
rollback;
\endif
-- rollback-only rls phase end

-- Each QA user gets an independent single-session stale-settings and
-- stale-full-state run. The deliberate token bump and every RPC attempt are
-- rolled back together; this does not prove a cross-session commit winner.
-- rollback-only cas phase begin
\if :phase_cas
  \if :phase_cas_a
select set_config('preview_v2.live.session_user', current_setting('preview_v2.live.qa_user_a'), false);
  \else
select set_config('preview_v2.live.session_user', current_setting('preview_v2.live.qa_user_b'), false);
  \endif

begin;
insert into public.preview_v2_budget_settings (user_id, monthly_budget, category_budgets)
values (current_setting('preview_v2.live.session_user')::uuid, 500000, '{}'::jsonb)
on conflict (user_id) do nothing;

select set_config('request.jwt.claim.sub', current_setting('preview_v2.live.session_user'), true);
set local role authenticated;

do $cas_assertions$
declare
  v_budget integer;
  v_categories jsonb;
  v_stale_token timestamptz;
  v_current_token timestamptz;
  v_current_transactions jsonb;
  v_wrong_expected jsonb;
  v_settings_before text;
  v_transactions_before text;
  v_settings_after text;
  v_transactions_after text;
  v_caught boolean;
begin
  select monthly_budget, category_budgets, updated_at
  into v_budget, v_categories, v_stale_token
  from public.preview_v2_budget_settings
  where user_id = auth.uid();

  update public.preview_v2_budget_settings
  set monthly_budget = monthly_budget
  where user_id = auth.uid()
  returning updated_at into v_current_token;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', transaction_row.id,
      'date', to_char(transaction_row.date, 'YYYY-MM-DD'),
      'type', transaction_row.type,
      'category', transaction_row.category,
      'amount', transaction_row.amount,
      'memo', coalesce(transaction_row.memo, ''),
      'source', coalesce(transaction_row.source, 'user')
    ) order by transaction_row.id collate "C"
  ), '[]'::jsonb)
  into v_current_transactions
  from public.preview_v2_transactions as transaction_row
  where transaction_row.user_id = auth.uid();

  select md5(to_jsonb(settings)::text)
  into v_settings_before
  from public.preview_v2_budget_settings as settings
  where settings.user_id = auth.uid();
  select md5(coalesce(string_agg(to_jsonb(transaction_row)::text, E'\n'
    order by transaction_row.id), ''))
  into v_transactions_before
  from public.preview_v2_transactions as transaction_row
  where transaction_row.user_id = auth.uid();

  v_caught := false;
  begin
    perform * from public.replace_preview_v2_budget_state(
      v_budget, v_categories, v_current_transactions,
      v_stale_token, v_current_transactions
    );
  exception when sqlstate '40001' then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'stale settings token did not raise 40001' using errcode = '40001';
  end if;

  select md5(to_jsonb(settings)::text)
  into v_settings_after
  from public.preview_v2_budget_settings as settings
  where settings.user_id = auth.uid();
  select md5(coalesce(string_agg(to_jsonb(transaction_row)::text, E'\n'
    order by transaction_row.id), ''))
  into v_transactions_after
  from public.preview_v2_transactions as transaction_row
  where transaction_row.user_id = auth.uid();
  if v_settings_after is distinct from v_settings_before
    or v_transactions_after is distinct from v_transactions_before then
    raise exception 'stale settings failure changed V2 rows' using errcode = '40001';
  end if;

  v_wrong_expected := v_current_transactions || jsonb_build_array(jsonb_build_object(
    'id', 'tx-live-cas-missing-' || lower(current_setting('preview_v2.live.qa_marker')),
    'date', to_char(current_date, 'YYYY-MM-DD'),
    'type', 'expense',
    'category', '생활비',
    'amount', 1,
    'memo', current_setting('preview_v2.live.qa_marker') || '-cas-missing',
    'source', 'user'
  ));

  v_caught := false;
  begin
    perform * from public.replace_preview_v2_budget_state(
      v_budget, v_categories, v_current_transactions,
      v_current_token, v_wrong_expected
    );
  exception when sqlstate '40001' then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'stale transaction snapshot did not raise 40001' using errcode = '40001';
  end if;

  select md5(to_jsonb(settings)::text)
  into v_settings_after
  from public.preview_v2_budget_settings as settings
  where settings.user_id = auth.uid();
  select md5(coalesce(string_agg(to_jsonb(transaction_row)::text, E'\n'
    order by transaction_row.id), ''))
  into v_transactions_after
  from public.preview_v2_transactions as transaction_row
  where transaction_row.user_id = auth.uid();
  if v_settings_after is distinct from v_settings_before
    or v_transactions_after is distinct from v_transactions_before then
    raise exception 'stale transaction failure changed V2 rows' using errcode = '40001';
  end if;
end;
$cas_assertions$;
rollback;
\endif
-- rollback-only cas phase end

-- One rollback-only transaction checks that the composite PK permits the same
-- deterministic ID for A and B, while a second insert for B is exactly 23505.
-- It does not prove the two-session same-ID winner race, which remains PENDING.
-- rollback-only duplicate_scope phase begin
\if :phase_duplicate_scope
begin;
select set_config('request.jwt.claim.sub', current_setting('preview_v2.live.qa_user_a'), true);
set local role authenticated;
insert into public.preview_v2_transactions (
  id, user_id, date, type, category, amount, memo, source
)
values (
  'tx-live-shared-' || lower(current_setting('preview_v2.live.qa_marker')),
  auth.uid(), current_date, 'expense', '생활비', 1,
  current_setting('preview_v2.live.qa_marker') || '-shared-a', 'user'
);

reset role;
select set_config('request.jwt.claim.sub', current_setting('preview_v2.live.qa_user_b'), true);
set local role authenticated;
insert into public.preview_v2_transactions (
  id, user_id, date, type, category, amount, memo, source
)
values (
  'tx-live-shared-' || lower(current_setting('preview_v2.live.qa_marker')),
  auth.uid(), current_date, 'expense', '생활비', 1,
  current_setting('preview_v2.live.qa_marker') || '-shared-b', 'user'
);

do $same_user_duplicate$
declare
  v_duplicate boolean := false;
begin
  begin
    insert into public.preview_v2_transactions (
      id, user_id, date, type, category, amount, memo, source
    ) values (
      'tx-live-shared-' || lower(current_setting('preview_v2.live.qa_marker')),
      auth.uid(), current_date, 'expense', '생활비', 1,
      current_setting('preview_v2.live.qa_marker') || '-shared-b-duplicate', 'user'
    );
  exception when sqlstate '23505' then
    v_duplicate := true;
  end;
  if not v_duplicate then
    raise exception 'same QA user duplicate did not raise 23505' using errcode = '23505';
  end if;
end;
$same_user_duplicate$;

reset role;
do $user_scoped_primary_key$
begin
  if (
    select count(*)
    from public.preview_v2_transactions
    where id = 'tx-live-shared-' || lower(current_setting('preview_v2.live.qa_marker'))
      and user_id in (
        current_setting('preview_v2.live.qa_user_a')::uuid,
        current_setting('preview_v2.live.qa_user_b')::uuid
      )
  ) <> 2 then
    raise exception 'different QA users must each retain the deterministic ID' using errcode = '23505';
  end if;
end;
$user_scoped_primary_key$;
rollback;
\endif
-- rollback-only duplicate_scope phase end

\echo 'preview-v2 live verification phase completed: ' :live_phase
