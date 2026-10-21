-- Coupang web order import. Apply after supabase-phone-order-link.sql.
-- Allows the coupang_order inbox kind, separates device tokens per device (plan A),
-- and lets order linking use Coupang web orders. Existing rows are preserved.
begin;

-- 1. Allow the new inbox kind.
alter table public.phone_inbox drop constraint if exists phone_inbox_kind_check;
alter table public.phone_inbox add constraint phone_inbox_kind_check
  check (kind in ('kbank_notification', 'eats_notification', 'eats_screen', 'coupang_order'));

-- 2. Devices are keyed per token so several senders can coexist (plan A).
--    Registering a new token no longer invalidates the tokens of other devices.
alter table public.phone_devices drop constraint if exists phone_devices_pkey;
alter table public.phone_devices add constraint phone_devices_pkey
  primary key (user_id, environment, token_hash);

create or replace function public.register_phone_device(p_token_hash text, p_environment text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_environment is null or p_environment not in ('production', 'preview-v2') then
    raise exception 'invalid device configuration' using errcode = '22023';
  end if;
  insert into public.phone_devices(user_id, environment, token_hash)
    values (auth.uid(), p_environment, p_token_hash)
    on conflict (token_hash) do nothing;
  if not exists (select 1 from public.phone_devices
    where token_hash = p_token_hash and user_id = auth.uid() and environment = p_environment) then
    raise exception 'invalid device configuration' using errcode = '22023';
  end if;
end;
$$;

drop function if exists public.revoke_phone_device(text);
create function public.revoke_phone_device(p_environment text, p_token_hash text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_environment is null or p_environment not in ('production', 'preview-v2')
    or (p_token_hash is not null and p_token_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid device configuration' using errcode = '22023';
  end if;
  -- With a token hash, revoke only that device; without one, revoke every
  -- device the caller owns in the environment (previous behaviour).
  delete from public.phone_devices
    where user_id = auth.uid() and environment = p_environment
      and (p_token_hash is null or token_hash = p_token_hash);
end;
$$;

revoke all on function public.register_phone_device(text, text) from public, anon, authenticated;
revoke all on function public.revoke_phone_device(text, text) from public, anon, authenticated;
grant execute on function public.register_phone_device(text, text) to authenticated;
grant execute on function public.revoke_phone_device(text, text) to authenticated;

-- 3. receive_phone_event: identical to the supabase-phone-decisions.sql version,
--    plus the coupang_order <-> www.coupang.com kind/package pair.
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
      or ((p_event->>'kind') in ('eats_notification', 'eats_screen') and (p_event->>'package_name') = 'com.coupang.mobile.eats')
      or ((p_event->>'kind') = 'coupang_order' and (p_event->>'package_name') = 'www.coupang.com'), false)
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
  v_text := regexp_replace(btrim(p_event->>'text'),
    '(잔액|잔여한도|누적사용액)[[:space:]]*[:：]?[[:space:]]*-?[0-9,.]+[[:space:]]*원?', '[잔액 숨김]', 'g');
  v_text := regexp_replace(v_text, '(계좌번호|카드번호)[[:space:]]*[:：]?[[:space:]]*[0-9* -]{8,}', '[번호 숨김]', 'g');
  v_text := regexp_replace(v_text, '\m[0-9]{3,6}-[0-9]{2,6}-[0-9]{3,8}\M', '[번호 숨김]', 'g');
  v_text := regexp_replace(v_text, '\m([0-9][ -]?){15}[0-9]\M', '[번호 숨김]', 'g');
  insert into public.phone_inbox(user_id, environment, event_id, kind, package_name, captured_at, text, event_hash, balance_amount)
    values (v_device.user_id, v_device.environment, p_event->>'event_id', p_event->>'kind',
      p_event->>'package_name', v_captured, v_text, v_hash, (p_event->>'balance_amount')::integer);
  return jsonb_build_object('ok', true, 'event_id', p_event->>'event_id', 'duplicate', false);
end;
$$;

revoke all on function public.receive_phone_event(text, jsonb) from public, anon, authenticated;
-- The random device token authorizes this one write-only entry point.
grant execute on function public.receive_phone_event(text, jsonb) to anon, authenticated;

-- 4. link_phone_order: accept coupang_order as an order kind and refuse to link
--    cancelled or refunded orders. Everything else matches supabase-phone-order-link.sql.
create schema if not exists budget_private;
revoke all on schema budget_private from public,anon;
grant usage on schema budget_private to authenticated;
create or replace function budget_private.link_phone_order(p_environment text,p_event_id text,p_decision jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_order public.phone_inbox%rowtype;
  v_payment public.phone_inbox%rowtype;
  v_tx record;
  v_id text;
  v_table regclass;
  v_date date;
  v_payment_date date;
  v_numbers text[];
  v_parts text[];
  v_before jsonb;
  v_base jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_environment is null or p_environment not in ('production','preview-v2') then raise exception 'invalid environment' using errcode='22023'; end if;
  select * into v_order from public.phone_inbox where user_id=auth.uid() and environment=p_environment and event_id=p_event_id for update;
  if not found or v_order.kind not in ('eats_screen','eats_notification','coupang_order') then raise exception 'order not found' using errcode='22023'; end if;
  if v_order.status<>'pending' then return jsonb_build_object('id',v_order.transaction_id,'already_recorded',true); end if;
  if v_order.text ~ '(취소|환불|반환)' then raise exception 'cancelled orders cannot be linked' using errcode='22023'; end if;
  if p_decision is null or jsonb_typeof(p_decision)<>'object'
    or p_decision->>'action' is distinct from 'link'
    or p_decision->'include_balance' is distinct from 'false'::jsonb
    or coalesce(p_decision->>'target_kind','') not in ('transaction','notification')
    or jsonb_typeof(p_decision->'target_id') is distinct from 'string' or (p_decision->>'target_id') !~ '^[A-Za-z0-9._:-]{1,128}$'
    or jsonb_typeof(p_decision->'expected_memo') is distinct from 'string' or char_length(p_decision->>'expected_memo')>80
    or jsonb_typeof(p_decision->'date') is distinct from 'string' or (p_decision->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_decision->'amount') is distinct from 'number' or (p_decision->>'amount') !~ '^[0-9]+$'
    or (p_decision->>'amount')::numeric not between 1 and 2147483647
    or coalesce(p_decision->>'category','') not in ('생활비','배달비','의류비','비상금','휴가비') then
    raise exception 'invalid order decision' using errcode='22023';
  end if;
  v_date := (p_decision->>'date')::date;
  if to_char(v_date,'YYYY-MM-DD')<>p_decision->>'date' then raise exception 'invalid date' using errcode='22023'; end if;
  v_table := case when p_environment='production' then 'public.transactions'::regclass else 'public.preview_v2_transactions'::regclass end;
  -- Reuse the established field, private-image and owner validators; transaction rollback
  -- restores this dismissal if any target check fails later in this function.
  v_base := (p_decision - array['target_kind','target_id','expected_memo']) || jsonb_build_object('action','ignore');
  perform public.resolve_phone_event(p_environment,p_event_id,v_base);
  if p_decision->>'target_kind'='notification' then
    select * into v_payment from public.phone_inbox where user_id=auth.uid() and environment=p_environment and event_id=p_decision->>'target_id' for update;
    if not found or v_payment.kind<>'kbank_notification' or v_payment.status<>'pending'
      or v_payment.text !~* '(쿠팡|coupang)' or v_payment.text ~ '(취소|환불|반환|거절|실패)' then
      raise exception 'payment changed or unavailable' using errcode='40001';
    end if;
    select array_agg(distinct replace(m[1],',','')) into v_numbers from regexp_matches(v_payment.text,
      '(?:^|\n)(?:체크카드[[:space:]]*|카드[[:space:]]*)?(?:승인|출금|결제[[:space:]]*완료)[[:space:]]*[:：]?[[:space:]]*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)[[:space:]]*원','g') m;
    if coalesce(array_length(v_numbers,1),0)<>1 or v_numbers[1]::numeric<>(p_decision->>'amount')::numeric then
      raise exception 'payment amount mismatch' using errcode='40001';
    end if;
    v_payment_date := (v_payment.captured_at at time zone 'Asia/Seoul')::date;
    v_parts := regexp_match(v_payment.text,'(20[0-9]{2})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})');
    if v_parts is not null then v_payment_date:=make_date(v_parts[1]::integer,v_parts[2]::integer,v_parts[3]::integer);
    else
      v_parts:=regexp_match(v_payment.text,'\m([0-9]{1,2})/([0-9]{1,2})\M');
      if v_parts is not null then
        v_payment_date:=make_date(extract(year from v_date)::integer,v_parts[1]::integer,v_parts[2]::integer);
        if abs(v_payment_date-(v_payment.captured_at at time zone 'Asia/Seoul')::date)>7 then raise exception 'payment date mismatch' using errcode='40001'; end if;
      end if;
    end if;
    if v_payment_date<>v_date then raise exception 'payment date mismatch' using errcode='40001'; end if;
    v_result:=public.resolve_phone_event(p_environment,v_payment.event_id,
      jsonb_build_object('action','expense','date',p_decision->>'date','amount',p_decision->'amount','category',p_decision->>'category',
        'memo',p_decision->>'memo','remark','','include_balance',false,'balance_amount',null,'account_label','','attachments','[]'::jsonb));
    if v_result->'already_recorded'='true'::jsonb then raise exception 'payment already recorded' using errcode='40001'; end if;
    v_id:=v_result->>'id';
    update public.phone_inbox set decision=decision||jsonb_build_object('order_event_id',p_event_id) where user_id=auth.uid() and environment=p_environment and event_id=v_payment.event_id;
  else
    v_id:=p_decision->>'target_id';
    execute format('select id,date,type,amount,memo,category from %s where user_id=$1 and id=$2 for update',v_table) into v_tx using auth.uid(),v_id;
    if v_tx.id is null or v_tx.type<>'expense' or v_tx.date<>v_date or v_tx.amount<>(p_decision->>'amount')::integer
      or v_tx.memo is distinct from p_decision->>'expected_memo' or v_tx.memo !~* '(쿠팡|coupang)' then
      raise exception 'payment changed or unavailable' using errcode='40001';
    end if;
    if exists(select 1 from public.phone_inbox where user_id=auth.uid() and environment=p_environment
      and transaction_id=v_id and event_id<>p_event_id and decision->>'action'='link') then
      raise exception 'payment already linked to an order' using errcode='40001';
    end if;
    v_before:=jsonb_build_object('memo',v_tx.memo,'category',v_tx.category);
    execute format('update %s set memo=$1,category=$2 where user_id=$3 and id=$4',v_table)
      using p_decision->>'memo',p_decision->>'category',auth.uid(),v_id;
  end if;
  update public.phone_inbox set status='recorded',transaction_id=v_id,
    decision=p_decision||jsonb_build_object('decided_at',now(),'previous',v_before)
    where user_id=auth.uid() and environment=p_environment and event_id=p_event_id;
  return jsonb_build_object('id',v_id,'already_recorded',false,'linked',true,'payment_event_id',v_payment.event_id);
end;
$$;
revoke all on function budget_private.link_phone_order(text,text,jsonb) from public,anon,authenticated;
grant execute on function budget_private.link_phone_order(text,text,jsonb) to authenticated;
create or replace function public.link_phone_order(p_environment text,p_event_id text,p_decision jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select budget_private.link_phone_order(p_environment,p_event_id,p_decision);
$$;
revoke all on function public.link_phone_order(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.link_phone_order(text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
