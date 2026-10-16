const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { buildProject } = require('../tasker/build-project.cjs');

const config = () => ({
  endpoint:'https://test.supabase.co/rest/v1/rpc/receive_phone_event',
  public_key:'sb_publishable_test', device_token:'a'.repeat(64), connection_id:'b'.repeat(64)
});
function phone(answer = JSON.stringify(config())) {
  const globals = {};
  const messages = [];
  const calls = [];
  const context = vm.createContext({
    global:n => globals[n] || '', setGlobal:(n,v) => {globals[n] = String(v);},
    setLocal:(n,v) => {context[n] = String(v);},
    prompt:() => answer, confirm:() => true, flashLong:t => messages.push(t),
    performTask:(...args) => {calls.push(args); return true;},
    sendIntent:() => true,
    evtprm:['케이뱅크','카드 승인','[합성] 쿠팡 주식회사 18,900원'],
    BudgetPhoneImport:require('../js/phone-import.js')
  });
  const run = source => vm.runInContext(source, context);
  return {globals, messages, calls, context, run};
}
test('가져오기 링크가 원본 프로젝트로 복원되고 모든 코드가 파일 없이 포함된다', () => {
  const project = buildProject();
  assert.equal(zlib.gunzipSync(Buffer.from(project.uri.slice('taskerproject://'.length),'base64')).toString(),project.xml);
  assert.equal((project.xml.match(/<Project /g)||[]).length,1);
  assert.equal((project.xml.match(/<Profile /g)||[]).length,3);
  assert.ok(project.xml.includes('<repval>15</repval>'));
  assert.ok(project.xml.includes('<appPkg>com.kbankwith.smartbank</appPkg>'));
  assert.ok(project.xml.includes('<appPkg>com.coupang.mobile.eats</appPkg>'));
  assert.ok(!project.xml.includes('file:///'));
  assert.ok(!project.xml.includes('sb_publishable_test'));
  assert.ok(!/<(?:Setting|Variable|Backup) /.test(project.xml));
  for (const source of Object.values(project.scripts)) new vm.Script(source);
});
test('설정 한 번으로 시험만 대기시키고 실제 응답 전에는 수집하지 않는다', () => {
  const p = phone(); const project = buildProject();
  p.run(project.scripts.setup);
  const queue = JSON.parse(p.globals.BUDGETOUTBOX);
  assert.equal(queue.length,1);
  assert.equal(queue[0].kind,'eats_notification');
  assert.ok(queue[0].text.includes('실제 결제가 아닙니다'));
  assert.equal(p.globals.BUDGETREADY,'');
  assert.equal(p.calls[0][0],'BB 보내기');
  p.run(project.scripts.bank);
  assert.equal(JSON.parse(p.globals.BUDGETOUTBOX).length,1);
});
test('동일한 연결을 재시도해도 시험이 중복되지 않는다', () => {
  const p = phone(); const script = buildProject().scripts.setup;
  p.run(script); const id = JSON.parse(p.globals.BUDGETOUTBOX)[0].event_id;
  p.run(script);
  assert.equal(JSON.parse(p.globals.BUDGETOUTBOX).length,1);
  assert.equal(JSON.parse(p.globals.BUDGETOUTBOX)[0].event_id,id);
});
test('취소·변조 URL·누락 키는 설정과 대기열을 바꾸지 않는다', () => {
  for (const answer of [null,'no json',JSON.stringify({...config(),endpoint:'https://evil.example/receive'}),
    JSON.stringify({...config(),device_token:'short'})]) {
    const p = phone(answer); p.globals.BUDGETOUTBOX='[]';
    p.run(buildProject().scripts.setup);
    assert.equal(p.globals.BUDGETCONFIG,undefined);
    assert.equal(p.globals.BUDGETOUTBOX,'[]');
    assert.equal(p.calls.length,0);
  }
});
test('기존 연결의 미전송 알림을 새 연결로 옮기지 않는다', () => {
  const p = phone(JSON.stringify({...config(),connection_id:'c'.repeat(64)}));
  p.globals.BUDGETCONFIG=JSON.stringify(config());
  p.globals.BUDGETOUTBOX=JSON.stringify([{connection_id:config().connection_id,event_id:'old'}]);
  const before={...p.globals};
  p.run(buildProject().scripts.setup);
  assert.deepEqual(p.globals,before);
  assert.equal(p.calls.length,0);
});
test('실제 시험 응답을 확인한 뒤 수집을 켜고 잔액을 가린다', () => {
  const p = phone(); const project=buildProject(); p.run(project.scripts.setup);
  const id=JSON.parse(p.globals.BUDGETOUTBOX)[0].event_id;
  p.context.budget_ack='0';p.context.budget_event_id=id;
  p.run(project.scripts.connectionStatus);
  assert.equal(p.globals.BUDGETREADY,'');
  p.context.budget_ack='1';p.context.budget_event_id='wrong';
  p.run(project.scripts.connectionStatus);
  assert.equal(p.globals.BUDGETREADY,'');
  p.context.budget_event_id=id;
  p.run(project.scripts.connectionStatus);
  assert.equal(p.globals.BUDGETREADY,config().connection_id);
  p.globals.BUDGETOUTBOX='[]';
  p.context.evtprm=['케이뱅크','카드 승인','[합성] 18,900원 잔액 50,000원'];
  p.run(project.scripts.bank);
  const queue=JSON.parse(p.globals.BUDGETOUTBOX);
  assert.equal(queue.length,1);assert.ok(!queue[0].text.includes('50,000'));
});
test('쿠팡이츠 이외의 화면과 사용자가 취소한 화면은 수집하지 않는다', () => {
  const project=buildProject();
  for(const [app,confirm] of [['com.example.private',true],['com.coupang.mobile.eats',false]]) {
    const p=phone();p.globals.BUDGETCONFIG=JSON.stringify(config());p.globals.BUDGETREADY=config().connection_id;
    p.context.ai_app_package=app;p.context.ai_texts='[{"text":"주문 상세"}]';p.context.confirm=()=>confirm;
    p.run(project.scripts.screen);
    assert.equal(p.globals.BUDGETOUTBOX,undefined);
  }
});
test('Tasker처럼 액션 사이에만 지역 변수를 전달해도 시험 응답과 재시도가 동작한다', () => {
  const project=buildProject(), globals={}, locals={}, calls=[];
  const run=source=>{
    // setLocal updates Tasker's variables, not the current JavaScript scope.
    const context=vm.createContext({...locals,global:n=>globals[n]||'',
      setGlobal:(n,v)=>{globals[n]=String(v);},setLocal:(n,v)=>{locals[n]=String(v);},
      prompt:()=>JSON.stringify(config()),flashLong:()=>{},performTask:(...a)=>calls.push(a),
      confirm:()=>true,evtprm:['케이뱅크','카드 승인','[합성] 10,000원']});
    vm.runInContext(source,context);
  };
  run(project.scripts.setup);
  run(project.scripts.prepare);
  const event=JSON.parse(locals.budget_body).p_event;
  locals.http_data=JSON.stringify({ok:true,event_id:'wrong'});
  locals.http_response_code='200';
  run(project.scripts.acknowledge);run(project.scripts.connectionStatus);
  assert.equal(globals.BUDGETREADY,'');
  assert.equal(JSON.parse(globals.BUDGETOUTBOX).length,1);
  run(project.scripts.prepare);
  assert.equal(locals.http_data,'');
  assert.equal(locals.http_response_code,'0');
  assert.equal(JSON.parse(locals.budget_body).p_event.event_id,event.event_id);
  locals.http_data=JSON.stringify({ok:true,event_id:event.event_id});locals.http_response_code='200';
  run(project.scripts.acknowledge);run(project.scripts.connectionStatus);
  assert.equal(globals.BUDGETREADY,config().connection_id);
  assert.equal(JSON.parse(globals.BUDGETOUTBOX).length,0);
  run(project.scripts.bank);
  assert.equal(JSON.parse(globals.BUDGETOUTBOX).length,1);
  assert.equal(calls.length,2);
});
test('전송은 인증서 검증·리다이렉트 차단을 유지하고 HTTP 오류 뒤에도 확인 단계를 수행한다', () => {
  const xml=buildProject().xml;
  const sender=xml.match(/<Task sr="task5204">([\s\S]*?)<\/Task>/)[1];
  assert.ok(!sender.includes('<rty>2</rty>'));
  const http=sender.match(/<Action[^>]*><code>339<\/code>([\s\S]*?)<\/Action>/)[1];
  assert.ok(http.includes('<se>false</se>'));
  assert.ok(http.includes('<Int sr="arg9" val="0"/>'));
  assert.ok(http.includes('<Int sr="arg10" val="0"/>'));
  assert.ok(http.includes('<Int sr="arg11" val="0"/>'));
  assert.equal((sender.match(/<code>129<\/code>/g)||[]).length,3);
});
