-- Order details enrich a single owned payment. They never create a second expense.
begin;
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
  if not found or v_order.kind not in ('eats_screen','eats_notification') then raise exception 'order not found' using errcode='22023'; end if;
  if v_order.status<>'pending' then return jsonb_build_object('id',v_order.transaction_id,'already_recorded',true); end if;
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
