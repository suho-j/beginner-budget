-- Apply after supabase-phone-import.sql. Existing rows and pairing keys are preserved.
-- All ledger/balance mutations require an authenticated user's explicit decision.
begin;
alter table public.phone_inbox add column if not exists balance_amount integer;
alter table public.phone_inbox add column if not exists decision jsonb;
create table if not exists public.phone_account_balances (
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('production','preview-v2')),
  account_label text not null check (char_length(btrim(account_label)) between 1 and 40),
  balance_amount integer not null,
  captured_at timestamptz not null,
  source_event_id text not null,
  updated_at timestamptz not null default now(),
  primary key(user_id,environment,account_label)
);
alter table public.phone_account_balances enable row level security;
revoke all on public.phone_account_balances from public,anon,authenticated;
grant select on public.phone_account_balances to authenticated;
drop policy if exists phone_balance_owner on public.phone_account_balances;
create policy phone_balance_owner on public.phone_account_balances for select to authenticated using(user_id=(select auth.uid()));

create or replace function public.receive_phone_event(p_token text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_device public.phone_devices%rowtype;
  v_existing_hash text;
  v_hash text;
  v_captured timestamptz;
  v_text text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid device token' using errcode = '42501';
  end if;
  select * into v_device from public.phone_devices
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found then
    raise exception 'invalid device token' using errcode = '42501';
  end if;
  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  if (p_event->'version') is distinct from '1'::jsonb
    or jsonb_typeof(p_event->'event_id') is distinct from 'string'
    or (p_event->>'event_id') !~ '^[A-Za-z0-9._:-]{1,128}$'
    or jsonb_typeof(p_event->'text') is distinct from 'string'
    or char_length(btrim(p_event->>'text')) not between 1 and 6000
    or jsonb_typeof(p_event->'captured_at') is distinct from 'string'
    or (p_event->>'captured_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or not coalesce(
      ((p_event->>'kind') = 'kbank_notification' and (p_event->>'package_name') = 'com.kbankwith.smartbank')
      or ((p_event->>'kind') in ('eats_notification', 'eats_screen') and (p_event->>'package_name') = 'com.coupang.mobile.eats'), false)
    or exists (select 1 from jsonb_object_keys(p_event) key
      where key not in ('version', 'event_id', 'kind', 'package_name', 'captured_at', 'text', 'balance_amount'))
    or (p_event->>'text') ~* '(인증[[:space:]]*번호|일회용[[:space:]]*비밀번호|OTP|보안[[:space:]]*코드)' then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  if p_event ? 'balance_amount' and (jsonb_typeof(p_event->'balance_amount') is distinct from 'number'
    or (p_event->>'balance_amount') !~ '^-?[0-9]+$'
    or (p_event->>'balance_amount')::numeric not between -2147483647 and 2147483647
    or p_event->>'kind' <> 'kbank_notification') then
    raise exception 'invalid balance' using errcode = '22023';
  end if;
  v_captured := (p_event->>'captured_at')::timestamptz;
  if to_char(v_captured at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> p_event->>'captured_at' then
    raise exception 'invalid captured time' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_event::text, 'UTF8')), 'hex');
  select event_hash into v_existing_hash from public.phone_inbox
    where user_id = v_device.user_id and environment = v_device.environment
      and event_id = p_event->>'event_id';
  if found then
    if v_existing_hash <> v_hash then
      raise exception 'event id already used for another payload' using errcode = '23505';
    end if;
    return jsonb_build_object('ok', true, 'event_id', p_event->>'event_id', 'duplicate', true);
  end if;
  if (select count(*) from public.phone_inbox where user_id = v_device.user_id
    and environment = v_device.environment and received_at > now() - interval '1 day') >= 1000 then
    raise exception 'daily capture limit reached' using errcode = '54000';
  end if;
  v_text := btrim(p_event->>'text');
  insert into public.phone_inbox(user_id, environment, event_id, kind, package_name, captured_at, text, event_hash, balance_amount)
    values (v_device.user_id, v_device.environment, p_event->>'event_id', p_event->>'kind',
      p_event->>'package_name', v_captured, v_text, v_hash, (p_event->>'balance_amount')::integer);
  return jsonb_build_object('ok', true, 'event_id', p_event->>'event_id', 'duplicate', false);
end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('budget-phone-evidence','budget-phone-evidence',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists phone_evidence_select on storage.objects;
create policy phone_evidence_select on storage.objects for select to authenticated
using(bucket_id='budget-phone-evidence' and split_part(name,'/',1)=(select auth.uid())::text);
drop policy if exists phone_evidence_insert on storage.objects;
create policy phone_evidence_insert on storage.objects for insert to authenticated
with check(bucket_id='budget-phone-evidence' and split_part(name,'/',1)=(select auth.uid())::text
  and split_part(name,'/',2) in ('production','preview-v2') and split_part(name,'/',3) ~ '^[0-9a-f]{64}$'
  and split_part(name,'/',4) ~ '^[0-9a-f-]{36}\.(png|jpg|webp)$' and array_length(string_to_array(name,'/'),1)=4);
drop policy if exists phone_evidence_delete on storage.objects;
create policy phone_evidence_delete on storage.objects for delete to authenticated
using(bucket_id='budget-phone-evidence' and split_part(name,'/',1)=(select auth.uid())::text);

create or replace function public.resolve_phone_event(p_environment text,p_event_id text,p_decision jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_event public.phone_inbox%rowtype;
  v_action text;
  v_id text;
  v_date date;
  v_path text;
  v_account text;
  v_balance_applied boolean := false;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_environment is null or p_environment not in ('production','preview-v2') then
    raise exception 'invalid environment' using errcode='22023';
  end if;
  select * into v_event from public.phone_inbox
    where user_id=auth.uid() and environment=p_environment and event_id=p_event_id for update;
  if not found then raise exception 'notification not found' using errcode='22023'; end if;
  if v_event.status <> 'pending' then
    return jsonb_build_object('id',v_event.transaction_id,'already_recorded',true,'decision',v_event.decision);
  end if;
  if p_decision is null or jsonb_typeof(p_decision) <> 'object' then
    raise exception 'invalid decision' using errcode='22023';
  end if;
  v_action := p_decision->>'action';
  if v_action is null or v_action not in ('expense','income','transfer','balance','ignore')
    or jsonb_typeof(p_decision->'memo') is distinct from 'string' or char_length(p_decision->>'memo')>80
    or jsonb_typeof(p_decision->'remark') is distinct from 'string' or char_length(p_decision->>'remark')>1000
    or jsonb_typeof(p_decision->'include_balance') is distinct from 'boolean'
    or jsonb_typeof(p_decision->'attachments') is distinct from 'array'
    or exists(select 1 from jsonb_object_keys(p_decision) key where key not in
      ('action','date','amount','category','memo','remark','include_balance','balance_amount','account_label','attachments')) then
    raise exception 'invalid decision' using errcode='22023';
  end if;
  if jsonb_array_length(p_decision->'attachments')>3 then raise exception 'too many attachments' using errcode='22023'; end if;
  for v_path in select jsonb_array_elements_text(p_decision->'attachments') loop
    if char_length(v_path)>300 or split_part(v_path,'/',1)<>auth.uid()::text
      or split_part(v_path,'/',2)<>p_environment
      or split_part(v_path,'/',3)<>encode(sha256(convert_to(p_event_id,'UTF8')),'hex')
      or not exists(select 1 from storage.objects where bucket_id='budget-phone-evidence' and name=v_path
        and metadata->>'mimetype' in ('image/png','image/jpeg','image/webp')
        and (metadata->>'size')::numeric between 1 and 5242880) then
      raise exception 'invalid attachment' using errcode='22023';
    end if;
  end loop;
  if (v_action='balance' and p_decision->'include_balance'<>'true'::jsonb)
    or (v_action='ignore' and p_decision->'include_balance'='true'::jsonb) then
    raise exception 'invalid balance selection' using errcode='22023';
  end if;
  if p_decision->'include_balance'='true'::jsonb then
    v_account := btrim(p_decision->>'account_label');
    if jsonb_typeof(p_decision->'account_label') is distinct from 'string'
      or char_length(v_account) not between 1 and 40
      or jsonb_typeof(p_decision->'balance_amount') is distinct from 'number'
      or (p_decision->>'balance_amount') !~ '^-?[0-9]+$'
      or (p_decision->>'balance_amount')::numeric not between -2147483647 and 2147483647 then
      raise exception 'invalid account balance' using errcode='22023';
    end if;
    insert into public.phone_account_balances(user_id,environment,account_label,balance_amount,captured_at,source_event_id)
      values(auth.uid(),p_environment,v_account,(p_decision->>'balance_amount')::integer,v_event.captured_at,p_event_id)
      on conflict(user_id,environment,account_label) do update set
        balance_amount=excluded.balance_amount,captured_at=excluded.captured_at,source_event_id=excluded.source_event_id,updated_at=now()
      where excluded.captured_at >= phone_account_balances.captured_at;
    v_balance_applied := found;
  end if;
  if v_action in ('expense','income') then
    if jsonb_typeof(p_decision->'date') is distinct from 'string' or (p_decision->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(p_decision->'amount') is distinct from 'number' or (p_decision->>'amount') !~ '^[0-9]+$'
      or (p_decision->>'amount')::numeric not between 1 and 2147483647
      or coalesce(p_decision->>'category','') not in ('생활비','배달비','의류비','비상금','휴가비','월급','용돈','부수입','기타')
      or (v_action='expense' and p_decision->>'category' not in ('생활비','배달비','의류비','비상금','휴가비'))
      or (v_action='income' and p_decision->>'category' not in ('월급','용돈','부수입','기타')) then
      raise exception 'invalid transaction' using errcode='22023';
    end if;
    v_date := (p_decision->>'date')::date;
    if to_char(v_date,'YYYY-MM-DD')<>p_decision->>'date' then raise exception 'invalid date' using errcode='22023'; end if;
    v_id := 'phone-' || md5(auth.uid()::text || ':' || p_environment || ':' || p_event_id);
    if p_environment='production' then
      insert into public.transactions(id,user_id,date,type,category,amount,memo,source)
        values(v_id,auth.uid(),v_date,v_action,p_decision->>'category',(p_decision->>'amount')::integer,p_decision->>'memo','user');
    else
      insert into public.preview_v2_transactions(id,user_id,date,type,category,amount,memo,source)
        values(v_id,auth.uid(),v_date,v_action,p_decision->>'category',(p_decision->>'amount')::integer,p_decision->>'memo','user');
    end if;
  end if;
  update public.phone_inbox set status=case when v_id is null then 'ignored' else 'recorded' end,transaction_id=v_id,
    decision=p_decision || jsonb_build_object('decided_at',now(),'balance_applied',v_balance_applied)
    where user_id=auth.uid() and environment=p_environment and event_id=p_event_id;
  return jsonb_build_object('id',v_id,'already_recorded',false,'balance_applied',v_balance_applied);
end;
$$;
revoke all on function public.resolve_phone_event(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.resolve_phone_event(text,text,jsonb) to authenticated;

-- Only a no-effect dismissal can be reopened. Recorded ledger entries remain editable in History.
create or replace function public.reopen_phone_event(p_environment text,p_event_id text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  update public.phone_inbox set status='pending' where user_id=auth.uid()
    and environment=p_environment and event_id=p_event_id and status='ignored'
    and decision->>'action'='ignore' and decision->'include_balance'='false'::jsonb;
  if not found then raise exception 'only a dismissal can be reopened' using errcode='22023'; end if;
end;
$$;
revoke all on function public.reopen_phone_event(text,text) from public,anon,authenticated;
grant execute on function public.reopen_phone_event(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
