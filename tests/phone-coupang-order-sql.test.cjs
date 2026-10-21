const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('../.tmp/phone-tests/node_modules/@electric-sql/pglite');
(async()=>{
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth,storage to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
  create table public.transactions(id text primary key,user_id uuid not null,date date not null,type text not null,category text not null,amount integer not null,memo text not null,source text not null);
  create table public.preview_v2_transactions(like public.transactions including all);
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,metadata jsonb);
  alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;
  insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`);
  for(const filename of ['supabase-phone-import.sql','supabase-phone-decisions.sql','supabase-phone-order-link.sql','supabase-coupang-order.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../docs',filename),'utf8'));

  const user='11111111-1111-4111-8111-111111111111';
  const phoneToken='a'.repeat(64),collectorToken='d'.repeat(64);
  const hashOf=token=>crypto.createHash('sha256').update(token).digest('hex');
  const as=async who=>db.exec(`reset role;set role ${who?'authenticated':'anon'};select set_config('request.jwt.claim.sub','${who||''}',false)`);
  // Plan A: registering a second device must not invalidate the first one.
  await as(user);
  await db.query('select public.register_phone_device($1,$2)',[hashOf(phoneToken),'preview-v2']);
  await db.query('select public.register_phone_device($1,$2)',[hashOf(collectorToken),'preview-v2']);
  await db.query('select public.register_phone_device($1,$2)',[hashOf(collectorToken),'preview-v2']);
  await db.exec('reset role');
  assert.equal((await db.query("select count(*)::int as n from public.phone_devices where environment='preview-v2'")).rows[0].n,2);

  const orderText=['주문 상세','주문번호 20000009999999','주문일시 2026-10-21 20:31','판매자 로켓배송',
    '합성 세제 리필 2L · 2개','상품 금액 21,900원','배송비 0원','할인 -3,000원','쿠팡캐시 사용 -0원',
    '총 결제 금액 18,900원','카드 결제 금액 18,900원','주문 상태 배송완료'].join('\n');
  const receive=async(token,event)=>{
    await as(null);
    const result=await db.query('select public.receive_phone_event($1,$2::jsonb) as result',[token,JSON.stringify(event)]);
    await as(user);return result.rows[0].result;
  };
  const bankEvent={version:1,event_id:'bank-1',kind:'kbank_notification',package_name:'com.kbankwith.smartbank',captured_at:'2026-10-21T11:31:00.000Z',text:'케이뱅크\n체크카드 승인\n쿠팡 주식회사 18,900원'};
  assert.equal((await receive(phoneToken,bankEvent)).duplicate,false);
  const orderEvent={version:1,event_id:'coupang-20000009999999',kind:'coupang_order',package_name:'www.coupang.com',captured_at:'2026-10-21T11:31:00.000Z',text:orderText};
  assert.equal((await receive(collectorToken,orderEvent)).duplicate,false);
  assert.equal((await receive(collectorToken,orderEvent)).duplicate,true);
  // The first device token still works after the second one was registered.
  assert.equal((await receive(phoneToken,{...bankEvent,event_id:'bank-2'})).duplicate,false);
  // Kind/package pairs stay strict in both directions.
  await assert.rejects(receive(collectorToken,{...orderEvent,event_id:'coupang-bad-1',package_name:'com.coupang.mobile.eats'}));
  await assert.rejects(receive(collectorToken,{...orderEvent,event_id:'coupang-bad-2',kind:'eats_screen'}));
  await assert.rejects(receive(collectorToken,{...orderEvent,text:orderText+'\n다른 내용'}),{code:'23505'});
  console.log('PASS: per-device tokens coexist; coupang_order receipt is paired, deterministic and deduplicated');

  // Link a Coupang web order to an existing transaction; amount is preserved.
  await db.exec(`reset role;insert into preview_v2_transactions values('existing','${user}','2026-10-21','expense','생활비',18900,'쿠팡 주식회사','user'),('existing-eats','${user}','2026-10-20','expense','생활비',26000,'쿠팡 주식회사','user');`);
  await as(user);
  const decision={action:'link',target_kind:'transaction',target_id:'existing',expected_memo:'쿠팡 주식회사',date:'2026-10-21',amount:18900,category:'생활비',memo:'쿠팡 · 합성 세제 리필 2L · 2개',remark:'',include_balance:false,balance_amount:null,account_label:'생활비 계좌',attachments:[]};
  const link=(id,patch={})=>db.query('select public.link_phone_order($1,$2,$3::jsonb) as result',['preview-v2',id,JSON.stringify({...decision,...patch})]);
  const linked=await link('coupang-20000009999999');
  assert.equal(linked.rows[0].result.linked,true);
  assert.equal((await link('coupang-20000009999999')).rows[0].result.already_recorded,true);
  await db.exec('reset role');
  let tx=(await db.query("select * from preview_v2_transactions where id='existing'")).rows[0];
  assert.equal(tx.amount,18900);assert.equal(tx.memo,decision.memo);assert.equal(tx.category,'생활비');

  // Existing Eats linking keeps working after the function replacement.
  await receive(phoneToken,{version:1,event_id:'order-eats',kind:'eats_screen',package_name:'com.coupang.mobile.eats',captured_at:'2026-10-20T14:28:28.000Z',text:'주문 상세\n테스트 식당\n2026-10-20 오후 11:28\n총 결제금액 26,000원'});
  await as(user);
  const eats=await link('order-eats',{target_id:'existing-eats',date:'2026-10-20',amount:26000,category:'배달비',memo:'쿠팡이츠 · 테스트 식당'});
  assert.equal(eats.rows[0].result.linked,true);

  // Cancelled orders are received for the record but can never be linked.
  await receive(collectorToken,{...orderEvent,event_id:'coupang-20000007777777',text:orderText.replace('주문 상태 배송완료','주문 상태 주문 취소')});
  await as(user);
  await assert.rejects(link('coupang-20000007777777'),{code:'22023'});
  await db.exec('reset role');
  assert.equal((await db.query("select status from phone_inbox where event_id='coupang-20000007777777'")).rows[0].status,'pending');
  console.log('PASS: coupang_order links like Eats, preserves amounts, and cancelled orders are refused');

  // Revoking one device by hash leaves the other device working.
  await as(user);
  await db.query('select public.revoke_phone_device($1,$2)',['preview-v2',hashOf(collectorToken)]);
  await assert.rejects(receive(collectorToken,{...orderEvent,event_id:'coupang-after-revoke'}),{code:'42501'});
  assert.equal((await receive(phoneToken,{...bankEvent,event_id:'bank-3'})).duplicate,false);
  // The previous one-argument call still revokes everything in the environment.
  await as(user);
  await db.query('select public.revoke_phone_device($1)',['preview-v2']);
  await assert.rejects(receive(phoneToken,{...bankEvent,event_id:'bank-4'}),{code:'42501'});
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from public.transactions')).rows[0].n,0);
  await db.close();console.log('PASS: per-device revocation by token hash; legacy revoke-all still works');
})().catch(e=>{console.error(e);process.exitCode=1;});
