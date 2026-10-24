const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { buildProject, buildStatusProject, buildRepairProject, buildCaptureRestoreProject } = require('../tasker/build-project.cjs');
const { taskerRuntime } = require('./helpers/tasker-runtime.cjs');

const config = () => ({
  endpoint:'https://test.supabase.co/rest/v1/rpc/receive_phone_event',
  public_key:'sb_publishable_test', device_token:'a'.repeat(64), connection_id:'b'.repeat(64)
});

test('자동수집 복원은 수정판과 이름·ID 충돌 없이 세 프로필을 되살리고 기존 보내기로 연결한다', () => {
  const restore=buildCaptureRestoreProject(), repair=buildRepairProject();
  assert.equal(zlib.gunzipSync(Buffer.from(restore.uri.slice('taskerproject://'.length),'base64')).toString(),restore.xml);
  const names=xml=>[...xml.matchAll(/<nme>([^<]+)<\/nme>/g)].map(m=>m[1]);
  assert.equal((restore.xml.match(/<Profile /g)||[]).length,3);
  assert.ok(names(restore.xml).every(name=>!names(repair.xml).includes(name)));
  const ids=xml=>[...xml.matchAll(/<Task sr="task(\d+)">/g)].map(m=>m[1]);
  assert.ok(ids(restore.xml).every(id=>!ids(repair.xml).includes(id)));
  for(const [,mid] of restore.xml.matchAll(/<mid0>(\d+)<\/mid0>/g))assert.ok(ids(restore.xml).includes(mid));
  for(const key of ['BUDGETCONFIG','BUDGETREADY','BUDGETTESTID'])assert.ok(!restore.xml.includes('setGlobal(&apos;'+key+'&apos;'));
  assert.ok(!restore.xml.includes('연결 설정을 붙여'));
  assert.ok(restore.xml.includes('performTask(&quot;BB 보내기&quot;'));
  assert.ok(restore.xml.includes('<repval>15</repval>'));
  const full=buildProject().xml;
  for(const id of ['5202','5203','5205']) {
    const task=xml=>xml.match(new RegExp('<Task sr="task'+id+'">[\\s\\S]*?<\\/Task>'))[0];
    assert.equal(task(restore.xml),task(full));
  }
});
function phone(answer = JSON.stringify(config())) {
  const globals = {};
  const messages = [];
  const calls = [];
  const context = vm.createContext({
    global:n => globals[n] || '', setGlobal:(n,v) => {globals[n] = String(v);},
    setLocal:(n,v) => {context[n] = String(v);},
    prompt:() => answer, confirm:() => true, flashLong:t => messages.push(t), taskRunning:()=>false,
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

test('키 재발급 후 사용자가 확인하면 미전송 원문과 ID를 보존해 새 연결로 재시도한다', () => {
  const next={...config(),device_token:'d'.repeat(64),connection_id:'c'.repeat(64)};
  const p=phone(JSON.stringify(next));
  const event={version:1,event_id:'original-payment',kind:'kbank_notification',
    package_name:'com.kbankwith.smartbank',captured_at:'2026-10-16T14:00:00.000Z',
    text:'카드 승인 쿠팡 18,900원',connection_id:config().connection_id};
  p.globals.BUDGETCONFIG=JSON.stringify(config());
  p.globals.BUDGETOUTBOX=JSON.stringify([event]);
  p.globals.BUDGETREADY=config().connection_id;
  const original=p.globals.BUDGETOUTBOX;
  const confirmations=[];
  p.context.confirm=message=>{confirmations.push(message);return true;};
  p.context.taskRunning=()=>false;
  p.run(buildProject().scripts.setup);
  assert.equal(JSON.parse(p.globals.BUDGETCONFIG).device_token,next.device_token);
  const queue=JSON.parse(p.globals.BUDGETOUTBOX);
  assert.deepEqual(queue[0],{...event,connection_id:next.connection_id});
  assert.equal(queue.length,2);
  assert.equal(p.globals.BUDGETOUTBOXBACKUP,original);
  assert.equal(p.globals.BUDGETREADY,'');
  assert.equal(p.calls[0][0],'BB 보내기');
  assert.equal(confirmations.length,1);
  assert.ok(confirmations[0].includes('1개'));
  assert.ok(confirmations[0].includes('같은 계정'));
  assert.ok(!confirmations[0].includes(event.text));
  // The new token is used while the original payment identity stays unchanged.
  p.run(buildProject().scripts.prepare);
  const body=JSON.parse(p.context.budget_body);
  assert.equal(body.p_token,next.device_token);
  assert.equal(body.p_event.event_id,event.event_id);
});

test('복구 취소·다른 서버·혼합 연결·손상 알림·진행 중 전송은 기존 데이터를 보존한다', () => {
  for(const mode of ['cancel','other-server','mixed','invalid','running','changed']) {
    const next={...config(),device_token:'d'.repeat(64),connection_id:'c'.repeat(64)};
    if(mode==='other-server') next.endpoint='https://other.supabase.co/rest/v1/rpc/receive_phone_event';
    const p=phone(JSON.stringify(next));
    const event={version:1,event_id:'original-payment',kind:'kbank_notification',
      package_name:'com.kbankwith.smartbank',captured_at:'2026-10-16T14:00:00.000Z',
      text:'카드 승인 쿠팡 18,900원',connection_id:mode==='mixed'?'e'.repeat(64):config().connection_id};
    if(mode==='invalid')event.kind='unknown';
    p.globals.BUDGETCONFIG=JSON.stringify(config());
    p.globals.BUDGETOUTBOX=JSON.stringify([event]);
    p.globals.BUDGETREADY=config().connection_id;
    const before={...p.globals};
    p.context.confirm=()=>{
      if(mode==='changed')p.globals.BUDGETOUTBOX=JSON.stringify([event,{...event,event_id:'arrived-during-dialog'}]);
      return mode!=='cancel';
    };
    p.context.taskRunning=()=>mode==='running';
    p.run(buildProject().scripts.setup);
    assert.equal(p.calls.length,0,mode);
    if(mode==='changed') {
      assert.equal(p.globals.BUDGETCONFIG,before.BUDGETCONFIG);
      assert.equal(JSON.parse(p.globals.BUDGETOUTBOX).length,2);
      assert.equal(p.globals.BUDGETOUTBOXBACKUP,undefined);
    }else assert.deepEqual(p.globals,before,mode);
  }
});

test('연결 수정 파일에 복구 작업이 포함되고 기존 시작·알림 프로필은 교체하지 않는다', () => {
  const repair=buildRepairProject();
  assert.ok(repair.xml.includes('<nme>BB 연결 복구</nme>'));
  assert.ok(!repair.xml.includes('<nme>BB 시작</nme>'));
  assert.ok(!repair.xml.includes('<Profile '));
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
  const runtime=taskerRuntime(globals,locals);
  const run=source=>{
    runtime.run(source,{
      prompt:()=>JSON.stringify(config()),performTask:(...a)=>calls.push(a),
      confirm:()=>true,evtprm:['케이뱅크','카드 승인','[합성] 10,000원']});
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
  assert.equal(url.origin,'https://ggbook.pages.dev');
  assert.equal(url.pathname,'/artifacts/tasker-guide/diagnose.html');
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

test('Tasker가 실행 종료 때 지역 변수를 반영해도 진단 결과가 초기 오류 화면으로 돌아가지 않는다', () => {
  const globals={BUDGETCONFIG:JSON.stringify(config()),BUDGETREADY:config().connection_id,
    BUDGETOUTBOX:'[]',BUDGETSTATUS:'마지막 전송 성공: 2026-10-16T13:57:39.000Z'};
  const before={...globals};
  const runtime=taskerRuntime(globals,{budget_status_url:
    'https://suho-j.github.io/beginner-budget/artifacts/tasker-guide/diagnose.html#v=1&connection=script_error&queue=invalid&last=unknown&at='});
  runtime.run(buildProject().scripts.status);
  const result=new URLSearchParams(new URL(runtime.locals.budget_status_url).hash.slice(1));
  assert.equal(result.get('connection'),'ready');
  assert.equal(result.get('queue'),'0');
  assert.equal(result.get('last'),'sent');
  assert.deepEqual(globals,before);
});

test('재전송 때 기존 지역 변수와 이전 HTTP 응답이 남아 있어도 현재 알림만 보내고 확인한다', () => {
  const project=buildProject();
  const runtime=taskerRuntime({}, {budget_send:'0',budget_ack:'1',budget_body:'STALE',
    budget_event_id:'stale',budget_url:'https://stale.invalid',budget_headers:'STALE',budget_batch:'0',
    http_response_code:'200',http_data:'{"ok":true,"event_id":"stale"}'});
  runtime.run(project.scripts.setup,{prompt:()=>JSON.stringify(config())});
  const first=JSON.parse(runtime.globals.BUDGETOUTBOX)[0];
  const second={...first,event_id:'phone-test-second'};
  runtime.globals.BUDGETOUTBOX=JSON.stringify([first,second]);
  runtime.run(project.scripts.prepare);
  assert.equal(runtime.locals.budget_send,'1');
  assert.equal(JSON.parse(runtime.locals.budget_body).p_event.event_id,first.event_id);
  assert.equal(runtime.locals.http_response_code,'0');assert.equal(runtime.locals.http_data,'');
  runtime.locals.http_response_code='503';runtime.locals.http_data='{}';
  runtime.run(project.scripts.acknowledge);runtime.run(project.scripts.connectionStatus);
  assert.equal(runtime.locals.budget_ack,'0');
  assert.equal(JSON.parse(runtime.globals.BUDGETOUTBOX).length,2);
  assert.equal(runtime.globals.BUDGETREADY,'');
  runtime.run(project.scripts.prepare);
  runtime.locals.http_response_code='200';runtime.locals.http_data=JSON.stringify({ok:true,event_id:first.event_id});
  runtime.run(project.scripts.acknowledge);runtime.run(project.scripts.connectionStatus);
  assert.equal(runtime.locals.budget_ack,'1');assert.equal(runtime.globals.BUDGETREADY,config().connection_id);
  assert.deepEqual(JSON.parse(runtime.globals.BUDGETOUTBOX).map(event=>event.event_id),[second.event_id]);
  runtime.run(project.scripts.prepare);
  assert.equal(JSON.parse(runtime.locals.budget_body).p_event.event_id,second.event_id);
  assert.equal(runtime.locals.budget_batch,'3');
  runtime.locals.http_response_code='200';runtime.locals.http_data=JSON.stringify({ok:true,event_id:first.event_id});
  runtime.run(project.scripts.acknowledge);
  assert.equal(runtime.locals.budget_ack,'0');
  assert.deepEqual(JSON.parse(runtime.globals.BUDGETOUTBOX).map(event=>event.event_id),[second.event_id]);
  runtime.locals.http_data=JSON.stringify({ok:true,event_id:second.event_id});
  runtime.run(project.scripts.acknowledge);
  assert.equal(runtime.locals.budget_ack,'1');assert.equal(runtime.globals.BUDGETOUTBOX,'[]');
});

test('수정 가져오기는 전송·진단·복구 작업을 제공하고 기본 브라우저에 잘못된 앱 지정을 넣지 않는다', () => {
  const repair=buildRepairProject();
  assert.equal(zlib.gunzipSync(Buffer.from(repair.uri.slice('taskerproject://'.length),'base64')).toString(),repair.xml);
  assert.ok(repair.xml.includes('<name>가계부 연결 수정</name>'));
  assert.deepEqual([...repair.xml.matchAll(/<nme>([^<]+)<\/nme>/g)].map(match=>match[1]).sort(),['BB 보내기','BB 연결 복구','BB 연결 확인']);
  assert.ok(!repair.xml.includes('<Profile '));
  for(const xml of [repair.xml,buildStatusProject().xml,buildProject().xml]){
    const browser=xml.match(/<code>104<\/code>([\s\S]*?)<\/Action>/)[1];
    assert.ok(browser.includes('%budget_status_url'));
    assert.ok(!browser.includes('sr="arg1"'),'Leave the optional app unset instead of an empty App object that imports as %');
  }
  const sender=xml=>xml.match(/<Task sr="task5204">[\s\S]*?<\/Task>/)[0];
  assert.equal(sender(repair.xml),sender(buildProject().xml));
});
