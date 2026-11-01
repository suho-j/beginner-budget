-- Web Push subscriptions + sender RPCs. Apply once in Supabase SQL Editor
-- after supabase-setup.sql and supabase-phone-import.sql.
-- Re-running is safe: table/policies are idempotent and the sender key row is upserted.
-- Only the SHA-256 hash of the sender secret lives here; the raw secret stays
-- in the sender script's private .env (never in this repo).
begin;

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 1 and 1024),
  p256dh text not null check (char_length(p256dh) between 1 and 256),
  auth text not null check (char_length(auth) between 1 and 128),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant usage, select on sequence public.push_subscriptions_id_seq to authenticated;
drop policy if exists push_subscriptions_owner on public.push_subscriptions;
create policy push_subscriptions_owner on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sender key: hash only. No role may read this table directly; only the
-- security definer functions below compare against it.
create table if not exists public.push_sender_keys (
  id boolean primary key default true check (id),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);
alter table public.push_sender_keys enable row level security;
revoke all on public.push_sender_keys from public, anon, authenticated;
insert into public.push_sender_keys(id, secret_hash)
  values (true, 'bdb4cec1736709f078d143dceb34b4012414760c554eeacf8c8760ee01886448')
  on conflict (id) do update
    set secret_hash = excluded.secret_hash, updated_at = now();

-- Sender-only subscription lookup. The caller passes the raw sender secret;
-- it is hashed here and compared with the stored hash (same pattern as
-- receive_phone_event's device token). anon gets execute only, never table access.
create or replace function public.list_push_subscriptions(p_secret text)
returns table(endpoint text, p256dh text, auth_key text)
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$'
    or encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
       is distinct from (select k.secret_hash from public.push_sender_keys k where k.id) then
    raise exception 'invalid sender secret' using errcode = '42501';
  end if;
  return query
    select s.endpoint, s.p256dh, s.auth
    from public.push_subscriptions s
    order by s.created_at asc;
end;
$$;
revoke all on function public.list_push_subscriptions(text) from public, anon, authenticated;
grant execute on function public.list_push_subscriptions(text) to anon, authenticated;

-- Sender-only inbox read for new-event pushes: production rows received after
-- the caller's watermark, oldest first. Same secret check as above.
create or replace function public.list_new_phone_events(p_secret text, p_after timestamptz, p_limit integer default 50)
returns table(event_id text, kind text, captured_at timestamptz, received_at timestamptz, text text, status text)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$'
    or encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
       is distinct from (select k.secret_hash from public.push_sender_keys k where k.id) then
    raise exception 'invalid sender secret' using errcode = '42501';
  end if;
  if p_after is null then
    raise exception 'watermark required' using errcode = '22023';
  end if;
  return query
    select i.event_id, i.kind, i.captured_at, i.received_at, i.text, i.status
    from public.phone_inbox i
    where i.environment = 'production' and i.received_at > p_after
    order by i.received_at asc
    limit v_limit;
end;
$$;
revoke all on function public.list_new_phone_events(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.list_new_phone_events(text, timestamptz, integer) to anon, authenticated;

commit;
