const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { buildProject, buildStatusProject } = require('../tasker/build-project.cjs');

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

test('상태 팝업이 없어도 연결 상태를 비밀키 없이 읽을 수 있고 기존 설정을 바꾸지 않는다', () => {
  const p=phone();
  p.globals.BUDGETCONFIG=JSON.stringify(config());
  p.globals.BUDGETREADY=config().connection_id;
  p.globals.BUDGETOUTBOX=JSON.stringify([{text:'PRIVATE-NOTIFICATION',event_id:'pending'}]);
  p.globals.BUDGETSTATUS='마지막 전송 성공: 2026-10-16T13:57:39.000Z';
  p.context.alert=()=>{throw new Error('No popup UI available');};
  const before={...p.globals};
  p.run(buildProject().scripts.status);
  const url=new URL(p.context.budget_status_url);
  assert.equal(url.origin,'https://suho-j.github.io');
  assert.equal(url.pathname,'/beginner-budget/artifacts/tasker-guide/diagnose.html');
  assert.equal(url.search,'');
  const report=new URLSearchParams(url.hash.slice(1));
  assert.equal(report.get('connection'),'ready');
  assert.equal(report.get('queue'),'1');
  assert.equal(report.get('last'),'sent');
  assert.equal(report.get('at'),'2026-10-16T13:57:39.000Z');
  assert.deepEqual([...report.keys()].sort(),['at','connection','last','queue','v']);
  for(const secret of ['PRIVATE-NOTIFICATION',config().device_token,config().public_key,config().connection_id]){
    assert.ok(!decodeURIComponent(url.href).includes(secret));
  }
  assert.deepEqual(p.globals,before);
  assert.equal(p.calls.length,0);
});

test('별도 진단 작업은 스크립트가 실패해도 기본 결과 화면을 열고 기존 프로필을 교체하지 않는다', () => {
  const project=buildStatusProject();
  assert.equal(zlib.gunzipSync(Buffer.from(project.uri.slice('taskerproject://'.length),'base64')).toString(),project.xml);
  assert.ok(!project.xml.includes('<Profile '));
  assert.ok(project.xml.includes('<name>가계부 연결 진단</name>'));
  assert.ok(project.xml.includes('<nme>BB 연결 확인</nme>'));
  const actions=[...project.xml.matchAll(/<Action[^>]*><code>(\d+)<\/code>([\s\S]*?)<\/Action>/g)];
  const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
  const str=(action,index)=>decode(action.match(new RegExp('<Str sr="arg'+index+'" ve="3">([\\s\\S]*?)<\\/Str>'))[1]);
  const locals={}, opened=[];
  for(const [,code,body] of actions){
    if(code==='547')locals[str(body,0).slice(1)]=str(body,1);
    else if(code==='129'){
      try { vm.runInNewContext(str(body,0),{global:()=>{throw new Error('Device script unavailable');},setLocal:(n,v)=>{locals[n]=v;}}); }
      catch(error){assert.ok(body.includes('<se>false</se>'),'Script failure must continue to the native browser action');}
    }else if(code==='104')opened.push(locals[str(body,0).slice(1)]);
    else assert.fail('Unexpected diagnostic action: '+code);
  }
  assert.equal(opened.length,1);
  assert.equal(new URLSearchParams(new URL(opened[0]).hash.slice(1)).get('connection'),'script_error');
  assert.ok(!project.xml.includes('BUDGETCONFIG</Str>'));
});

test('손상된 연결·대기열·상태는 원문을 노출하지 않고 확인 필요로 표시한다', () => {
  const cases=[
    [{},'missing','0'],
    [{BUDGETCONFIG:'%BUDGETCONFIG',BUDGETOUTBOX:'%BUDGETOUTBOX'},'missing','0'],
    [{BUDGETCONFIG:'PRIVATE-BROKEN-JSON',BUDGETOUTBOX:'PRIVATE-BROKEN-QUEUE'},'invalid','invalid'],
    [{BUDGETCONFIG:JSON.stringify({...config(),public_key:''}),BUDGETREADY:config().connection_id},'invalid','0'],
    [{BUDGETCONFIG:JSON.stringify(config()),BUDGETOUTBOX:'{}'},'waiting','invalid'],
    [{BUDGETCONFIG:JSON.stringify(config()),BUDGETREADY:config().connection_id,BUDGETOUTBOX:JSON.stringify(Array(201).fill('PRIVATE'))},'ready','invalid']
  ];
  for(const [globals,connection,queue] of cases){
    const p=phone();Object.assign(p.globals,globals,{BUDGETSTATUS:'PRIVATE-STATUS-'+config().device_token});
    const before={...p.globals};p.run(buildProject().scripts.status);
    const url=p.context.budget_status_url, report=new URLSearchParams(new URL(url).hash.slice(1));
    assert.equal(report.get('connection'),connection);assert.equal(report.get('queue'),queue);
    assert.equal(report.get('last'),'unknown');assert.equal(report.get('at'),'');
    assert.ok(!url.includes('PRIVATE'));assert.ok(!url.includes(config().device_token));
    assert.deepEqual(p.globals,before);
  }
});
