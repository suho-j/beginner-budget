const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('../.tmp/phone-tests/node_modules/@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values
      ('11111111-1111-4111-8111-111111111111'),
      ('22222222-2222-4222-8222-222222222222');
    create table public.transactions (
      id text primary key, user_id uuid not null, date date not null,
      type text not null, category text not null, amount integer not null,
      memo text not null, source text not null);
    create table public.preview_v2_transactions (like public.transactions including all);
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../docs/supabase-phone-import.sql'), 'utf8'));
  const user = '11111111-1111-4111-8111-111111111111';
  const token = 'a'.repeat(64);
  const hash = require('node:crypto').createHash('sha256').update(token).digest('hex');
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)`);
  await db.query('select public.register_phone_device($1, $2)', [hash, 'preview-v2']);
  await db.exec('reset role; set role anon');
  const event = {
    version:1, event_id:'event-1', kind:'kbank_notification',
    package_name:'com.kbankwith.smartbank', captured_at:'2026-10-16T01:30:00.000Z',
    text:'[합성 테스트] 카드 승인 쿠팡 주식회사 18,900원'
  };
  let result = await db.query('select public.receive_phone_event($1, $2::jsonb) as result', [token, JSON.stringify(event)]);
  assert.equal(result.rows[0].result.duplicate, false);
  result = await db.query('select public.receive_phone_event($1, $2::jsonb) as result', [token, JSON.stringify(event)]);
  assert.equal(result.rows[0].result.duplicate, true);
  await assert.rejects(db.query('select * from public.phone_inbox'));
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)`);
  assert.equal((await db.query('select * from public.phone_inbox')).rows.length, 1);
  await db.exec('reset role');
  assert.equal((await db.query('select * from public.transactions')).rows.length, 0);
  console.log('PASS: device-scoped receipt, retry deduplication, no automatic ledger mutation');

  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)`);
  const transaction = { date:'2026-10-16', amount:18900, category:'배달비', memo:'테스트 식당 · 비빔밥' };
  const accept = () => db.query('select public.record_phone_event($1, $2, $3::jsonb) as result',
    ['preview-v2', event.event_id, JSON.stringify(transaction)]);
  const recorded = await accept();
  assert.equal(recorded.rows[0].result.already_recorded, false);
  assert.equal((await accept()).rows[0].result.already_recorded, true);
  await db.exec('reset role');
  assert.equal((await db.query('select * from public.preview_v2_transactions')).rows.length, 1);
  assert.equal((await db.query('select * from public.transactions')).rows.length, 0);
  console.log('PASS: review records exactly one expense in its original environment');


  const otherUser = '22222222-2222-4222-8222-222222222222';
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${otherUser}', false)`);
  assert.equal((await db.query('select * from public.phone_inbox')).rows.length, 0);
  await assert.rejects(accept());
  await assert.rejects(db.query("insert into public.phone_inbox(user_id) values ($1)", [otherUser]));
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select public.register_phone_device($1,$2)', [hash, 'production']));
  await assert.rejects(db.query('select public.receive_phone_event($1,$2::jsonb)', ['b'.repeat(64), JSON.stringify(event)]));
  await assert.rejects(db.query('select public.receive_phone_event($1,$2::jsonb)', [token, JSON.stringify({...event, text:'다른 금액'})]));
  for (const patch of [{version:2}, {kind:'unknown'}, {text:''}, {text:'인증번호 123456'}, {text:'x'.repeat(6001)},
    {package_name:'com.other.app'}, {captured_at:'2026-02-31T00:00:00.000Z'}, {user_id:otherUser}, {environment:'production'}]) {
    await assert.rejects(db.query('select public.receive_phone_event($1,$2::jsonb)',
      [token, JSON.stringify({...event, event_id:'invalid', ...patch})]));
  }
  const refund = {...event, event_id:'refund-1', text:'카드 승인 취소 18,900원'};
  await db.query('select public.receive_phone_event($1,$2::jsonb)', [token, JSON.stringify(refund)]);
  const eats = {...event, event_id:'eats-1', kind:'eats_notification', package_name:'com.coupang.mobile.eats', text:'주문이 수락되었습니다'};
  await db.query('select public.receive_phone_event($1,$2::jsonb)', [token, JSON.stringify(eats)]);
  const sensitive = {...event, event_id:'masked-1', text:'승인 18,900원 잔액 999,999원 계좌번호: 123-456-789012'};
  await db.query('select public.receive_phone_event($1,$2::jsonb)', [token, JSON.stringify(sensitive)]);
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)`);
  for (const id of ['refund-1','eats-1']) {
    await assert.rejects(db.query('select public.record_phone_event($1,$2,$3::jsonb)', ['preview-v2', id, JSON.stringify(transaction)]));
  }
  const masked = (await db.query("select text from public.phone_inbox where event_id = 'masked-1'")).rows[0].text;
  assert.ok(!masked.includes('999,999') && !masked.includes('123-456-789012') && masked.includes('18,900'));
  await db.query('select public.revoke_phone_device($1)', ['preview-v2']);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select public.receive_phone_event($1,$2::jsonb)', [token, JSON.stringify({...event, event_id:'after-revoke'})]));
  await db.exec('reset role');
  assert.equal((await db.query('select * from public.preview_v2_transactions')).rows.length, 1);
  assert.equal((await db.query('select * from public.transactions')).rows.length, 0);
  console.log('PASS: owner RLS, unauthenticated limits, token revocation, invalid payloads, privacy filters, refund/order guards');

  await db.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
