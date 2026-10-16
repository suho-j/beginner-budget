const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { taskerRuntime } = require('./helpers/tasker-runtime.cjs');
function phoneContext() {
  const globals = { BUDGETCONFIG:JSON.stringify({endpoint:'https://test.supabase.co/rest/v1/rpc/receive_phone_event', public_key:'sb_publishable_test', device_token:'a'.repeat(64), connection_id:'b'.repeat(64)}) };
  const locals = {};
  const context = {
    budget_kind:'kbank_notification', evtprm:['케이뱅크','카드 승인','[합성] 쿠팡 주식회사 18,900원 잔액 500,000원'],
    confirm:() => true, flashLong:() => {},
    BudgetPhoneImport:require('../js/phone-import.js')
  };
  const runtime=taskerRuntime(globals,locals);
  const run = name => runtime.run(fs.readFileSync(path.join(__dirname, '../tasker/' + name + '.js'), 'utf8'),context);
  return {globals, locals, context, run};
}
test('알림을 먼저 보관하고 실패하면 남겨두며 같은 ID의 성공 응답에서만 지운다', () => {
  const phone = phoneContext();
  phone.run('capture');
  const queue = JSON.parse(phone.globals.BUDGETOUTBOX);
  assert.equal(queue.length, 1);
  assert.ok(!queue[0].text.includes('500,000'));
  phone.run('prepare-send');
  const firstBody = JSON.parse(phone.locals.budget_body);
  assert.equal(firstBody.p_event.event_id, queue[0].event_id);
  phone.context.http_response_code = '500'; phone.context.http_data = '{}';
  phone.run('acknowledge');
  assert.equal(JSON.parse(phone.globals.BUDGETOUTBOX).length, 1);
  phone.run('prepare-send');
  assert.equal(JSON.parse(phone.locals.budget_body).p_event.event_id, firstBody.p_event.event_id);
  phone.context.http_response_code = '200';
  phone.context.http_data = JSON.stringify({ok:true, event_id:queue[0].event_id});
  phone.run('acknowledge');
  assert.equal(JSON.parse(phone.globals.BUDGETOUTBOX).length, 0);
  phone.run('prepare-send');
  assert.equal(phone.locals.budget_send,'0');
  assert.equal(phone.locals.budget_body,'');
});

test('연결을 바꾸면 이전 연결의 대기 알림을 다른 가계부로 보내지 않는다', () => {
  const phone = phoneContext();
  phone.run('capture');
  const config = JSON.parse(phone.globals.BUDGETCONFIG);
  config.connection_id = 'c'.repeat(64);
  phone.globals.BUDGETCONFIG = JSON.stringify(config);
  assert.throws(() => phone.run('prepare-send'));
  assert.equal(JSON.parse(phone.globals.BUDGETOUTBOX).length, 1);
});
