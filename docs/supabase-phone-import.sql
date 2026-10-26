-- Phone capture inbox. Apply once in Supabase SQL Editor after the base schema.
-- Does not seed, replace, or update existing ledger rows.
begin;

create table public.phone_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('production', 'preview-v2')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, environment)
);
create table public.phone_inbox (
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('production', 'preview-v2')),
  event_id text not null check (event_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  kind text not null check (kind in ('kbank_notification', 'eats_notification', 'eats_screen')),
  package_name text not null,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  text text not null check (char_length(text) between 1 and 6000),
  event_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'recorded', 'ignored')),
  transaction_id text,
  primary key (user_id, environment, event_id)
);
create index phone_inbox_recent on public.phone_inbox(user_id, environment, received_at desc);
alter table public.phone_devices enable row level security;
alter table public.phone_inbox enable row level security;
revoke all on public.phone_devices, public.phone_inbox from public, anon, authenticated;
grant select on public.phone_inbox to authenticated;
create policy phone_inbox_owner on public.phone_inbox for select to authenticated
  using (user_id = (select auth.uid()));

create function public.register_phone_device(p_token_hash text, p_environment text)
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
    on conflict (user_id, environment) do update
      set token_hash = excluded.token_hash, created_at = now();
end;
$$;

create function public.revoke_phone_device(p_environment text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  delete from public.phone_devices where user_id = auth.uid() and environment = p_environment;
end;
$$;

create function public.receive_phone_event(p_token text, p_event jsonb)
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
      where key not in ('version', 'event_id', 'kind', 'package_name', 'captured_at', 'text'))
    or (p_event->>'text') ~* '(인증[[:space:]]*번호|일회용[[:space:]]*비밀번호|OTP|보안[[:space:]]*코드)' then
    raise exception 'invalid event' using errcode = '22023';
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
  insert into public.phone_inbox(user_id, environment, event_id, kind, package_name, captured_at, text, event_hash)
    values (v_device.user_id, v_device.environment, p_event->>'event_id', p_event->>'kind',
      p_event->>'package_name', v_captured, v_text, v_hash);
  return jsonb_build_object('ok', true, 'event_id', p_event->>'event_id', 'duplicate', false);
end;
$$;

revoke all on function public.register_phone_device(text, text) from public, anon, authenticated;
revoke all on function public.revoke_phone_device(text) from public, anon, authenticated;
revoke all on function public.receive_phone_event(text, jsonb) from public, anon, authenticated;
grant execute on function public.register_phone_device(text, text) to authenticated;
grant execute on function public.revoke_phone_device(text) to authenticated;
-- The random device token authorizes this one write-only entry point.
grant execute on function public.receive_phone_event(text, jsonb) to anon, authenticated;

create function public.record_phone_event(p_environment text, p_event_id text, p_transaction jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_event public.phone_inbox%rowtype;
  v_id text;
  v_date date;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v_event from public.phone_inbox
    where user_id = auth.uid() and environment = p_environment and event_id = p_event_id for update;
  if not found or v_event.kind <> 'kbank_notification' then
    raise exception 'payment notification not found' using errcode = '22023';
  end if;
  if v_event.status = 'recorded' then
    return jsonb_build_object('id', v_event.transaction_id, 'already_recorded', true);
  end if;
  -- Receipt is not spending. Keep this conservative gate aligned with paymentDraft.
  -- Unrecognized real-world formats stay in the inbox until independently verified.
  if v_event.status <> 'pending'
    or v_event.text ~ '(취소|환불|반환|이자|캐시백|리워드|적립|플러스[[:space:]]*박스|\+[[:space:]]*박스|이체|송금|입금|출금|인출|거절|실패|예정|요청|신청|대기|안내|발급|등록|결제일|혜택)'
    or v_event.text !~ '카드[[:space:]:：]*(승인([[:space:]]*완료)?|결제[[:space:]]*완료)($|[[:space:]:：0-9])'
    or v_event.text !~ '[0-9][0-9,]*[[:space:]]*원' then
    raise exception 'only explicit card payment candidates can be reviewed as expenses' using errcode = '22023';
  end if;
  if p_transaction is null or jsonb_typeof(p_transaction) <> 'object' then
    raise exception 'invalid transaction' using errcode = '22023';
  end if;
  if jsonb_typeof(p_transaction->'date') is distinct from 'string'
    or (p_transaction->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_transaction->'amount') is distinct from 'number'
    or (p_transaction->>'amount') !~ '^[0-9]+$'
    or (p_transaction->>'amount')::numeric not between 1 and 2147483647
    or coalesce(p_transaction->>'category', '') not in ('생활비', '배달비', '의류비', '비상금', '휴가비')
    or jsonb_typeof(p_transaction->'memo') is distinct from 'string'
    or char_length(p_transaction->>'memo') > 80
    or exists (select 1 from jsonb_object_keys(p_transaction) key
      where key not in ('date', 'amount', 'category', 'memo')) then
    raise exception 'invalid transaction' using errcode = '22023';
  end if;
  v_date := (p_transaction->>'date')::date;
  if to_char(v_date, 'YYYY-MM-DD') <> p_transaction->>'date' then
    raise exception 'invalid transaction date' using errcode = '22023';
  end if;
  v_id := 'phone-' || md5(auth.uid()::text || ':' || p_environment || ':' || p_event_id);
  if p_environment = 'production' then
    insert into public.transactions(id, user_id, date, type, category, amount, memo, source)
      values (v_id, auth.uid(), v_date, 'expense', p_transaction->>'category',
        (p_transaction->>'amount')::integer, p_transaction->>'memo', 'user');
  elsif p_environment = 'preview-v2' then
    insert into public.preview_v2_transactions(id, user_id, date, type, category, amount, memo, source)
      values (v_id, auth.uid(), v_date, 'expense', p_transaction->>'category',
        (p_transaction->>'amount')::integer, p_transaction->>'memo', 'user');
  else
    raise exception 'invalid environment' using errcode = '22023';
  end if;
  update public.phone_inbox set status = 'recorded', transaction_id = v_id
    where user_id = auth.uid() and environment = p_environment and event_id = p_event_id;
  return jsonb_build_object('id', v_id, 'already_recorded', false);
end;
$$;
revoke all on function public.record_phone_event(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_phone_event(text, text, jsonb) to authenticated;

commit;
